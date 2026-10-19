import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { terminalEnv } from "../lib/terminal";

export interface ResolvedHost {
  /** what the user picked or the ProxyJump entry, for messages */
  label: string;
  hostname: string;
  port: number;
  user: string;
  identityFiles: string[];
  knownHostsFiles: string[];
  /** name used for the known_hosts lookup ([host]:port for non-22) */
  knownHostsName: string;
  strictHostKeyChecking: string;
  proxyJump: string[];
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p.replace(/^%d/, os.homedir());
}

/** `ssh -G` prints the effective configuration – the same resolution ssh itself uses. */
function sshG(args: string[]): Promise<Map<string, string[]>> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      ["-G", ...args],
      { env: terminalEnv(), timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr.trim() || error.message));
        const map = new Map<string, string[]>();
        for (const line of stdout.split(/\r?\n/)) {
          const i = line.indexOf(" ");
          if (i <= 0) continue;
          const key = line.slice(0, i).toLowerCase();
          map.set(key, [...(map.get(key) ?? []), line.slice(i + 1)]);
        }
        resolve(map);
      },
    );
  });
}

/** Parses "[user@]host[:port]" as used in ProxyJump. */
function parseJumpSpec(spec: string): string[] {
  const m = spec.match(/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m) return [spec];
  const [, user, host, port] = m;
  return [
    ...(port ? ["-p", port] : []),
    user ? `${user}@${host.replace(/^\[|\]$/g, "")}` : host.replace(/^\[|\]$/g, ""),
  ];
}

async function resolveOne(spec: string, label: string): Promise<ResolvedHost> {
  const g = await sshG(parseJumpSpec(spec));
  const first = (k: string) => g.get(k)?.[0] ?? "";
  const hostname = first("hostname");
  const port = Number(first("port") || 22);
  const alias = first("hostkeyalias");
  const lookup = alias && alias !== "none" ? alias : hostname;
  const jump = first("proxyjump");
  return {
    label,
    hostname,
    port,
    user: first("user") || os.userInfo().username,
    identityFiles: (g.get("identityfile") ?? []).map(expandHome),
    knownHostsFiles: [...(g.get("userknownhostsfile") ?? []), ...(g.get("globalknownhostsfile") ?? [])]
      .flatMap((v) => v.split(/\s+/))
      .filter(Boolean)
      .map(expandHome),
    knownHostsName: port === 22 ? lookup : `[${lookup}]:${port}`,
    strictHostKeyChecking: first("stricthostkeychecking") || "ask",
    proxyJump: jump && jump !== "none" ? jump.split(",").map((j) => j.trim()) : [],
  };
}

/**
 * Builds the connection chain like ssh does for ProxyJump "a,b":
 * a is reached with its own configuration (including its own ProxyJump),
 * b through a, and finally the target through b.
 */
export async function resolveChain(alias: string, depth = 0): Promise<ResolvedHost[]> {
  if (depth > 6) throw new Error("ProxyJump chain too deep (loop?)");
  const target = await resolveOne(alias, alias);
  if (!target.proxyJump.length) return [target];
  const [firstJump, ...rest] = target.proxyJump;
  const head = await resolveChain(firstJump, depth + 1);
  const middle = await Promise.all(rest.map((j) => resolveOne(j, j)));
  return [...head, ...middle.map((m) => ({ ...m, proxyJump: [] })), target];
}

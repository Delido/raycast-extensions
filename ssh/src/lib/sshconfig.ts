import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SSH_DIR = path.join(os.homedir(), ".ssh");
export const CONFIG_PATH = path.join(SSH_DIR, "config");
export const CONF_D = path.join(SSH_DIR, "config.d");
export const DEFAULTS_FILE = path.join(CONF_D, "raycast-defaults.conf");
export const TEAM_PREFIX = "raycast-team-";

const BLOCK_START = "# >>> raycast-ssh (managed by the Raycast SSH extension) >>>";
const BLOCK_END = "# <<< raycast-ssh <<<";

export interface HostEntry {
  alias: string;
  hostName?: string;
  user?: string;
  port?: string;
  proxyJump?: string;
  identityFile?: string;
  group?: string;
  /** the "# section:" / folder heading the host is under (its group unless "# group:" says otherwise) */
  section?: string;
  tags: string[];
  description?: string;
  /** URL to open in the browser through the tunnel ("# web: …") */
  web?: string;
  /** local SOCKS port when the host is a tunnel (DynamicForward) */
  socksPort?: number;
  /** true for "SessionType none" hosts (tunnel only, no shell) */
  tunnelOnly?: boolean;
  /** "local" or the source id */
  origin: string;
  file: string;
  line: number;
  /** first value per option (lower-case key) – what ssh uses for single-value options */
  options: Record<string, string>;
  /**
   * every option line as written, in order (LocalForward, IdentityFile, SetEnv … may repeat);
   * used when the block is written back so nothing gets lost
   */
  rawOptions: { key: string; name: string; value: string }[];
}

/**
 * Parses an ssh_config file into concrete host entries (wildcard patterns are skipped).
 * Metadata comes from comments:
 *   # section: Kunden / ACME      → applies to all following hosts until the next section
 *   # --- Kunden / ACME ---       → same (folder style, e.g. from an RDM export)
 *   # group: Datenbanken          → applies to the next Host block only
 *   # tags: prod, linux
 *   # description: Primary DB
 *   # web: https://10.0.0.1:8006 → opened in the browser through the host's SOCKS tunnel
 */
export function parseConfig(text: string, origin: string, file: string): HostEntry[] {
  const entries: HostEntry[] = [];
  let section: string | undefined;
  let pending: { group?: string; tags: string[]; description?: string; web?: string } = { tags: [] };
  let current: HostEntry[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    const folder = line.match(/^#+\s*(?:-{3,}|={3,})\s*(.+?)\s*(?:-{3,}|={3,})\s*$/);
    if (folder) {
      section = folder[1];
      return;
    }
    const meta = line.match(/^#+\s*(section|group|tags|description|desc|web)\s*:\s*(.*)$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === "section") section = value || undefined;
      else if (key === "group") pending.group = value;
      else if (key === "web") pending.web = value;
      else if (key === "tags")
        pending.tags = value
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean);
      else pending.description = value;
      return;
    }
    if (line.startsWith("#")) return;

    const match = line.match(/^(\S+?)\s*(?:=\s*|\s+)(.*)$/);
    if (!match) return;
    const key = match[1].toLowerCase();
    const rawValue = match[2].trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1");

    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((pattern) => pattern && !/[*?!]/.test(pattern))
        .map((alias) => ({
          alias,
          group: pending.group ?? section,
          section,
          tags: pending.tags,
          description: pending.description,
          web: pending.web,
          origin,
          file,
          line: index + 1,
          options: {},
          rawOptions: [],
        }));
      entries.push(...current);
      pending = { tags: [] };
      return;
    }
    if (key === "match") {
      current = [];
      return;
    }
    for (const entry of current) {
      entry.rawOptions.push({ key, name: match[1], value: rawValue });
      if (entry.options[key] !== undefined) continue; // first value wins, like ssh
      entry.options[key] = value;
      if (key === "hostname") entry.hostName = value;
      else if (key === "user") entry.user = value;
      else if (key === "port") entry.port = value;
      else if (key === "proxyjump") entry.proxyJump = value;
      else if (key === "identityfile") entry.identityFile = value;
      else if (key === "dynamicforward") {
        const port = Number(value.split(":").pop());
        if (port) entry.socksPort = port;
      } else if (key === "sessiontype") entry.tunnelOnly = value.toLowerCase() === "none";
    }
  });
  return entries;
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Local hosts plus all synced team files; local entries win on duplicate aliases. */
export async function loadHosts(): Promise<{ hosts: HostEntry[]; overridden: Set<string> }> {
  const local = parseConfig((await readText(CONFIG_PATH)) ?? "", "local", CONFIG_PATH);
  const team: HostEntry[] = [];
  try {
    const files = (await fs.readdir(CONF_D)).filter((f) => f.startsWith(TEAM_PREFIX) && f.endsWith(".conf")).sort();
    for (const f of files) {
      const full = path.join(CONF_D, f);
      const origin = f.slice(TEAM_PREFIX.length, -".conf".length);
      team.push(...parseConfig((await readText(full)) ?? "", origin, full));
    }
  } catch {
    // no config.d yet
  }
  const localAliases = new Set(local.map((h) => h.alias));
  const overridden = new Set<string>();
  const seen = new Set<string>();
  const hosts: HostEntry[] = [];
  for (const h of [...local, ...team]) {
    if (seen.has(h.alias)) {
      if (h.origin !== "local" && localAliases.has(h.alias)) overridden.add(h.alias);
      continue;
    }
    seen.add(h.alias);
    hosts.push(h);
  }
  return { hosts, overridden };
}

export async function isIntegrated(): Promise<boolean> {
  return ((await readText(CONFIG_PATH)) ?? "").includes(BLOCK_START);
}

/**
 * Adds the Include block to ~/.ssh/config (with a backup). It is placed before the first
 * catch-all block ("Host *" / "Match all"), or at the end. Resulting precedence:
 *   1. your own specific hosts   2. team hosts   3. raycast-defaults.conf   4. your own "Host *"
 * "Match all" resets the scope so the Include is not swallowed by a preceding Host block.
 */
export async function integrate(): Promise<string> {
  await fs.mkdir(CONF_D, { recursive: true });
  if (!(await readText(DEFAULTS_FILE))) {
    await fs.writeFile(
      DEFAULTS_FILE,
      "# Personal defaults – managed by Raycast SSH (Manage SSH Sources → Personal Defaults)\n",
    );
  }
  const original = (await readText(CONFIG_PATH)) ?? "";
  if (original.includes(BLOCK_START)) return CONFIG_PATH;

  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const block = [
    BLOCK_START,
    "Match all",
    `Include config.d/${TEAM_PREFIX}*.conf`,
    "Include config.d/raycast-defaults.conf",
    BLOCK_END,
  ];
  const lines = original ? original.split(/\r?\n/) : [];
  const catchAll = lines.findIndex((l) => /^\s*(Host\s+\*\s*$|Match\s+all\b)/i.test(l));
  if (catchAll >= 0) lines.splice(catchAll, 0, ...block, "");
  else lines.push(...(lines.length && lines[lines.length - 1].trim() ? [""] : []), ...block, "");

  if (original) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await fs.copyFile(CONFIG_PATH, `${CONFIG_PATH}.raycast-backup-${stamp}`);
  } else {
    await fs.mkdir(SSH_DIR, { recursive: true });
  }
  await fs.writeFile(CONFIG_PATH, lines.join(eol));
  return CONFIG_PATH;
}

// Options that execute commands or load code.
const RISKY =
  /^\s*(ProxyCommand|LocalCommand|PermitLocalCommand|KnownHostsCommand|Include|IdentityAgent|PKCS11Provider|SecurityKeyProvider)\b/i;
// Options that weaken host key checking or hand out your agent – team files come before your own
// "Host *" in ~/.ssh/config, so they would override your defaults.
const WEAKENING =
  /^\s*(ForwardAgent|UserKnownHostsFile|GlobalKnownHostsFile)\b|^\s*StrictHostKeyChecking\s*(=\s*|\s+)"?(no|off|accept-new)\b/i;
const RISKY_MATCH = /^\s*Match\b.*\bexec\b/i;
const BLOCK_LINE = /^\s*(Host|Match)\b/i;
/** "Host *" (or "Host * !x"): a catch-all that would apply to all your hosts. "Host *.acme.local" is fine. */
const CATCH_ALL = /^\s*Host\s*(=\s*|\s+)(.*)$/i;

function isCatchAll(line: string): boolean {
  const m = line.match(CATCH_ALL);
  if (!m) return false;
  const patterns = m[2].trim().split(/\s+/);
  return patterns.some((p) => p === "*") && patterns.every((p) => p === "*" || p.startsWith("!"));
}

/**
 * Comments out options that execute commands, load code or weaken host key checking, and whole
 * catch-all "Host *" blocks; returns the cleaned text and the number of blocked lines.
 */
export function sanitize(text: string): { text: string; blocked: number } {
  let blocked = 0;
  // Inside a blocked block header, its options are blocked too – otherwise they would silently
  // become part of the previous Host block.
  let inBlockedBlock = false;
  const block = (line: string) => {
    blocked++;
    return `# [blocked by Raycast SSH] ${line.trim()}`;
  };
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => {
      if (BLOCK_LINE.test(line)) {
        inBlockedBlock = isCatchAll(line) || RISKY_MATCH.test(line);
        return inBlockedBlock ? block(line) : line;
      }
      if (inBlockedBlock && line.trim() && !line.trim().startsWith("#")) return block(line);
      if (RISKY.test(line) || WEAKENING.test(line)) return block(line);
      return line;
    })
    .join("\n");
  return { text: cleaned, blocked };
}

export async function writeDefaults(user: string, identityFile: string, extra: string) {
  await fs.mkdir(CONF_D, { recursive: true });
  const lines = ["# Personal defaults – managed by Raycast SSH (Manage SSH Sources → Personal Defaults)", "Host *"];
  if (user.trim()) lines.push(`    User ${user.trim()}`);
  if (identityFile.trim()) lines.push(`    IdentityFile "${identityFile.trim()}"`);
  for (const l of extra.split(/\r?\n/).filter((l) => l.trim())) lines.push(`    ${l.trim()}`);
  await fs.writeFile(DEFAULTS_FILE, lines.join("\n") + "\n");
}

export function parseDefaults(text: string): { user: string; identityFile: string; extra: string } {
  let user = "";
  let identityFile = "";
  const extra: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^host\s/i.test(line)) continue;
    const m = line.match(/^(\S+)\s+(.*)$/);
    if (!m) continue;
    if (m[1].toLowerCase() === "user") user = m[2];
    else if (m[1].toLowerCase() === "identityfile") identityFile = m[2].replace(/^"(.*)"$/, "$1");
    else extra.push(line);
  }
  return { user, identityFile, extra: extra.join("\n") };
}

/** Appends a new host block to the local ~/.ssh/config (before the Raycast block / catch-all). */
export async function appendLocalHost(block: string) {
  const original = (await readText(CONFIG_PATH)) ?? "";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original ? original.split(/\r?\n/) : [];
  const anchor = lines.findIndex((l) => l.startsWith(BLOCK_START) || /^\s*(Host\s+\*\s*$|Match\s+all\b)/i.test(l));
  const blockLines = [...block.trimEnd().split("\n"), ""];
  if (anchor >= 0) lines.splice(anchor, 0, ...blockLines);
  else lines.push("", ...blockLines);
  await fs.mkdir(SSH_DIR, { recursive: true });
  if (original) await fs.copyFile(CONFIG_PATH, `${CONFIG_PATH}.raycast-backup-last`);
  await fs.writeFile(CONFIG_PATH, lines.join(eol));
}

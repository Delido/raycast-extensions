import fs from "node:fs";
import type { AuthenticationType, ClientChannel, SFTPWrapper } from "ssh2";
import { Client, utils } from "../vendor/ssh2.cjs";
import { addKnownHost, checkHostKey, fingerprint, keyType } from "./knownhosts";
import { ResolvedHost, resolveChain } from "./resolve";

export interface ConnectUI {
  status(text: string): void;
  /** Ask for a password / keyboard-interactive answer. Resolves undefined when cancelled. */
  askSecret(hop: ResolvedHost, prompt: string): Promise<string | undefined>;
  /** Unknown host key: "save" (add to known_hosts), "once" or "cancel". */
  confirmHostKey(hop: ResolvedHost, info: { fingerprint: string; type: string }): Promise<"save" | "once" | "cancel">;
}

export interface SftpSession {
  sftp: SFTPWrapper;
  chain: ResolvedHost[];
  close(): void;
}

function agentPath(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
  if (process.platform === "win32") return "\\\\.\\pipe\\openssh-ssh-agent";
  return undefined;
}

/** Unencrypted private keys from IdentityFile that ssh2 can parse (encrypted ones are left to the agent). */
function loadKeys(files: string[]): Buffer[] {
  const keys: Buffer[] = [];
  for (const file of files) {
    try {
      const data = fs.readFileSync(file);
      const parsed = utils.parseKey(data);
      if (!(parsed instanceof Error)) keys.push(data);
    } catch {
      // missing or unreadable
    }
  }
  return keys;
}

class CancelledError extends Error {
  constructor() {
    super("Cancelled");
  }
}

function connectHop(hop: ResolvedHost, ui: ConnectUI, sock?: ClientChannel): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const agent = agentPath();
    const keys = loadKeys(hop.identityFiles);
    let secret: string | undefined;
    let cancelled = false;
    let hostKeyError: Error | undefined;

    // Authentication order like ssh: agent → key files → password / keyboard-interactive
    const plan: AuthenticationType[] = [];
    if (agent) plan.push("agent");
    keys.forEach(() => plan.push("publickey"));
    plan.push("keyboard-interactive", "password");
    let keyIndex = 0;

    const getSecret = async (prompt: string) => {
      if (secret !== undefined) return secret;
      const value = await ui.askSecret(hop, prompt);
      if (value === undefined) {
        cancelled = true;
        throw new CancelledError();
      }
      secret = value;
      return value;
    };

    client.on("ready", () => resolve(client));
    client.on("error", (err) => {
      if (cancelled) reject(new CancelledError());
      else reject(hostKeyError ?? new Error(`${hop.label}: ${err.message}`));
    });

    client.connect({
      host: hop.hostname,
      port: hop.port,
      sock,
      username: hop.user,
      readyTimeout: 30_000,
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        const status = checkHostKey(hop.knownHostsName, key, hop.knownHostsFiles);
        if (status === "ok") return verify(true);
        if (status === "mismatch" || status === "revoked") {
          hostKeyError = new Error(
            `${hop.label}: HOST KEY ${status === "mismatch" ? "HAS CHANGED" : "IS REVOKED"} for ${hop.knownHostsName} (${fingerprint(key)}). Connection refused – check with your admin before updating known_hosts.`,
          );
          return verify(false);
        }
        if (hop.strictHostKeyChecking === "yes") {
          hostKeyError = new Error(`${hop.label}: unknown host key and StrictHostKeyChecking=yes`);
          return verify(false);
        }
        ui.confirmHostKey(hop, { fingerprint: fingerprint(key), type: keyType(key) }).then((answer) => {
          if (answer === "cancel") {
            cancelled = true;
            return verify(false);
          }
          if (answer === "save" && hop.knownHostsFiles[0])
            addKnownHost(hop.knownHostsName, key, hop.knownHostsFiles[0]);
          verify(true);
        });
      },
      authHandler: (methodsLeft, _partial, next) => {
        const allowed = (m: string) => !methodsLeft || methodsLeft.includes(m as AuthenticationType);
        const step = (): void => {
          const method = plan.shift();
          if (!method) return next(false as never);
          if (method === "agent" && allowed("publickey"))
            return next({ type: "agent", username: hop.user, agent: agent! });
          if (method === "publickey" && allowed("publickey")) {
            const key = keys[keyIndex++];
            return next({ type: "publickey", username: hop.user, key });
          }
          if (method === "keyboard-interactive" && allowed("keyboard-interactive")) {
            return next({
              type: "keyboard-interactive",
              username: hop.user,
              prompt: (_name, instructions, _lang, prompts, finish) => {
                if (!prompts.length) return finish([]);
                Promise.all(prompts.map((p) => getSecret(p.prompt || instructions || "Password")))
                  .then(finish)
                  .catch(() => client.end());
              },
            });
          }
          if (method === "password" && allowed("password")) {
            getSecret("Password")
              .then((password) => next({ type: "password", username: hop.user, password }))
              .catch(() => client.end());
            return;
          }
          step();
        };
        step();
      },
    });
  });
}

function forwardOut(client: Client, host: string, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) =>
    client.forwardOut("127.0.0.1", 0, host, port, (err, stream) => (err ? reject(err) : resolve(stream))),
  );
}

/** Connects through the whole ProxyJump chain and opens an SFTP session on the target. */
export async function openSftp(alias: string, ui: ConnectUI): Promise<SftpSession> {
  ui.status("Resolving SSH configuration…");
  const chain = await resolveChain(alias);
  const clients: Client[] = [];
  const close = () => [...clients].reverse().forEach((c) => c.end());
  try {
    let sock: ClientChannel | undefined;
    for (const hop of chain) {
      ui.status(`Connecting to ${hop.label} (${hop.user}@${hop.hostname}:${hop.port})…`);
      if (clients.length) sock = await forwardOut(clients[clients.length - 1], hop.hostname, hop.port);
      clients.push(await connectHop(hop, ui, sock));
    }
    ui.status("Opening SFTP…");
    const target = clients[clients.length - 1];
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
      target.sftp((err, s) => (err ? reject(new Error(`SFTP not available on ${alias}: ${err.message}`)) : resolve(s))),
    );
    return { sftp, chain, close };
  } catch (error) {
    close();
    throw error;
  }
}

export function isCancelled(error: unknown) {
  return error instanceof CancelledError;
}

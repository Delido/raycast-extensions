import { LocalStorage } from "@raycast/api";
import fs from "node:fs/promises";
import { CONFIG_PATH, HostEntry, readText, SSH_DIR } from "./sshconfig";
import { getSources, Source, syncSource, writeSourceFile } from "./sources";

/*
 * Editing hosts: in the local ~/.ssh/config ("only me") or in the file of a team source ("for the
 * team": a commit to the OneDev repository or a write to the file on the share). HTTPS sources are
 * read-only. Team hosts can also just be hidden locally.
 */

export interface HostFields {
  alias: string;
  hostName: string;
  user: string;
  port: string;
  proxyJump: string;
  identityFile: string;
  group: string;
  tags: string;
  description: string;
  web: string;
  /** further options, one per line ("LocalForward 8080 localhost:80") */
  extra: string;
}

const KNOWN = new Set(["hostname", "user", "port", "proxyjump", "identityfile"]);

const OPTION_NAMES: Record<string, string> = {
  hostname: "HostName",
  user: "User",
  port: "Port",
  proxyjump: "ProxyJump",
  identityfile: "IdentityFile",
  forwardagent: "ForwardAgent",
  localforward: "LocalForward",
  remoteforward: "RemoteForward",
  dynamicforward: "DynamicForward",
  serveraliveinterval: "ServerAliveInterval",
  sessiontype: "SessionType",
  requesttty: "RequestTTY",
  stricthostkeychecking: "StrictHostKeyChecking",
};

export function fieldsOf(host?: HostEntry): HostFields {
  return {
    alias: host?.alias ?? "",
    hostName: host?.hostName ?? "",
    user: host?.user ?? "",
    port: host?.port ?? "",
    proxyJump: host?.proxyJump ?? "",
    identityFile: host?.identityFile ?? "",
    group: host?.group ?? "",
    tags: host?.tags.join(", ") ?? "",
    description: host?.description ?? "",
    web: host?.web ?? "",
    extra: Object.entries(host?.options ?? {})
      .filter(([k]) => !KNOWN.has(k))
      .map(([k, v]) => `${OPTION_NAMES[k] ?? k} ${v}`)
      .join("\n"),
  };
}

/** The host block with its metadata comments. Keys stay personal, so team blocks never get IdentityFile. */
export function buildBlock(f: HostFields, forTeam: boolean, section?: string): string {
  const lines: string[] = [];
  // a group that only comes from the section heading above stays implicit
  if (f.group.trim() && f.group.trim() !== section) lines.push(`# group: ${f.group.trim()}`);
  if (f.tags.trim()) lines.push(`# tags: ${f.tags.trim()}`);
  if (f.description.trim()) lines.push(`# description: ${f.description.trim()}`);
  if (f.web.trim()) lines.push(`# web: ${f.web.trim()}`);
  lines.push(`Host ${f.alias.trim()}`);
  if (f.hostName.trim()) lines.push(`    HostName ${f.hostName.trim()}`);
  if (f.user.trim()) lines.push(`    User ${f.user.trim()}`);
  if (f.port.trim() && f.port.trim() !== "22") lines.push(`    Port ${f.port.trim()}`);
  if (f.proxyJump.trim()) lines.push(`    ProxyJump ${f.proxyJump.trim()}`);
  if (f.identityFile.trim() && !forTeam) lines.push(`    IdentityFile "${f.identityFile.trim()}"`);
  for (const line of f.extra.split(/\r?\n/)) {
    if (line.trim() && !/^\s*(host|match)\b/i.test(line)) lines.push(`    ${line.trim()}`);
  }
  return lines.join("\n");
}

const HOST_LINE = /^\s*host\s*(?:=\s*|\s+)(.*)$/i;
const BLOCK_START = /^\s*(host|match)\b/i;
const FOLDER = /^\s*#+\s*(?:-{3,}|={3,})/;
const META_ABOVE = /^\s*#+\s*(group|tags|description|desc|web)\s*:/i;

function patternsOf(line: string): string[] | undefined {
  const m = line.match(HOST_LINE);
  return m ? m[1].trim().split(/\s+/) : undefined;
}

/** Line range [start, end) of the block of an alias, including the metadata comments above it. */
function findBlock(lines: string[], alias: string) {
  const host = lines.findIndex((l) => patternsOf(l)?.includes(alias));
  if (host < 0) return undefined;
  let end = host + 1;
  while (end < lines.length && !BLOCK_START.test(lines[end]) && !FOLDER.test(lines[end])) end++;
  // comments and blank lines right before the next block belong to that block
  while (end > host + 1 && (/^\s*$/.test(lines[end - 1]) || META_ABOVE.test(lines[end - 1]))) end--;
  let start = host;
  while (start > 0 && META_ABOVE.test(lines[start - 1])) start--;
  return { start, host, end, shared: (patternsOf(lines[host]) ?? []).length > 1 };
}

/**
 * Replaces the block of an alias (block = null removes it). A "Host a b" line shared with other aliases
 * keeps the others: the alias is only taken out of the line, and an edited version is added as its own block.
 * Without an existing block the new one is appended.
 */
export function replaceBlock(text: string, alias: string, block: string | null): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  const found = findBlock(lines, alias);
  const blockLines = block ? block.split("\n") : [];
  if (!found) {
    if (!block) return text;
    // new hosts go before a catch-all ("Host *", "Match all"), otherwise at the end
    const anchor = lines.findIndex((l) => /^\s*(Host\s+\*\s*$|Match\s+all\b)/i.test(l));
    if (anchor >= 0) {
      lines.splice(anchor, 0, ...blockLines, "");
      return lines.join(eol);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return [...lines, ...(lines.length ? [""] : []), ...blockLines, ""].join(eol);
  }
  if (found.shared) {
    const rest = (patternsOf(lines[found.host]) ?? []).filter((p) => p !== alias);
    lines[found.host] = lines[found.host].replace(HOST_LINE, (whole, list: string) =>
      whole.replace(list, rest.join(" ")),
    );
    if (block) lines.splice(found.end, 0, "", ...blockLines);
    return lines.join(eol);
  }
  lines.splice(found.start, found.end - found.start, ...blockLines);
  // no double blank line where a block was removed
  if (
    !block &&
    found.start > 0 &&
    found.start < lines.length &&
    !lines[found.start - 1].trim() &&
    !lines[found.start].trim()
  )
    lines.splice(found.start, 1);
  return lines.join(eol);
}

/** Inserts a new local block before the Raycast Include block / the catch-all, like Add Host does. */
function insertLocal(text: string, block: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  const anchor = lines.findIndex(
    (l) => l.startsWith("# >>> raycast-ssh") || /^\s*(Host\s+\*\s*$|Match\s+all\b)/i.test(l),
  );
  const blockLines = [...block.split("\n"), ""];
  if (anchor >= 0) lines.splice(anchor, 0, ...blockLines);
  else lines.push(...(lines.length ? [""] : []), ...blockLines);
  return lines.join(eol);
}

/** Writes the local host (replacing an existing local block of the old alias). */
export async function saveLocal(oldAlias: string | undefined, fields: HostFields, section?: string) {
  const original = (await readText(CONFIG_PATH)) ?? "";
  const block = buildBlock(fields, false, section);
  const lines = original.split(/\r?\n/);
  const exists = oldAlias && lines.some((l) => patternsOf(l)?.includes(oldAlias));
  const next = exists ? replaceBlock(original, oldAlias!, block) : insertLocal(original, block);
  await writeLocal(original, next);
}

export async function deleteLocal(alias: string) {
  const original = (await readText(CONFIG_PATH)) ?? "";
  await writeLocal(original, replaceBlock(original, alias, null));
}

export async function hasLocalBlock(alias: string): Promise<boolean> {
  return ((await readText(CONFIG_PATH)) ?? "").split(/\r?\n/).some((l) => patternsOf(l)?.includes(alias));
}

async function writeLocal(original: string, next: string) {
  await fs.mkdir(SSH_DIR, { recursive: true });
  if (original) await fs.copyFile(CONFIG_PATH, `${CONFIG_PATH}.raycast-backup-last`);
  await fs.writeFile(CONFIG_PATH, next);
}

// ---------- team sources ----------

export interface TeamTarget {
  source: Source;
  file: string;
}

/** Sources that can be written: OneDev (with token) and files on a share; HTTPS is read-only. */
export async function writableSources(): Promise<Source[]> {
  return (await getSources()).filter((s) => s.enabled && (s.type === "file" || (s.type === "onedev" && !!s.token)));
}

/** The files of a source as recorded in its cache ("# ---- name ----" markers). */
export async function filesOf(source: Source, cache: string): Promise<string[]> {
  const text = (await readText(cache)) ?? "";
  return [...text.matchAll(/^# ---- (.+) ----$/gm)].map((m) => m[1]).filter((f) => f && f !== source.url);
}

/** The file of the team source a host came from (marker above it in the cache file). */
export async function fileOfHost(host: HostEntry): Promise<string | undefined> {
  const lines = ((await readText(host.file)) ?? "").split(/\r?\n/);
  for (let i = host.line - 1; i >= 0; i--) {
    const m = lines[i]?.match(/^# ---- (.+) ----$/);
    if (m) return m[1];
  }
  return undefined;
}

/** Changes the host in the team source and syncs it, so Raycast shows the new state right away. */
export async function saveTeam(
  target: TeamTarget,
  oldAlias: string | undefined,
  fields: HostFields | null,
  section?: string,
) {
  const alias = fields?.alias.trim() ?? oldAlias ?? "";
  const message = fields
    ? oldAlias
      ? `SSH host ${oldAlias}${oldAlias !== alias ? ` → ${alias}` : ""} updated from Raycast`
      : `SSH host ${alias} added from Raycast`
    : `SSH host ${oldAlias} removed from Raycast`;
  await writeSourceFile(
    target.source,
    target.file,
    (text) => replaceBlock(text, oldAlias ?? alias, fields ? buildBlock(fields, true, section) : null),
    message,
  );
  const result = await syncSource(target.source, true);
  if (result.status === "error") throw new Error(`Saved, but the sync failed: ${result.state.error}`);
}

// ---------- hidden team hosts ----------

const HIDDEN_KEY = "hidden-hosts";
const hiddenKey = (host: HostEntry) => `${host.origin}|${host.alias}`;

export async function getHidden(): Promise<Set<string>> {
  const raw = await LocalStorage.getItem<string>(HIDDEN_KEY);
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

export function isHidden(hidden: Set<string>, host: HostEntry) {
  return hidden.has(hiddenKey(host));
}

export async function setHidden(host: HostEntry, hide: boolean) {
  const hidden = await getHidden();
  if (hide) hidden.add(hiddenKey(host));
  else hidden.delete(hiddenKey(host));
  await LocalStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

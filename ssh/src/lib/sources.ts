import { getPreferenceValues, LocalStorage } from "@raycast/api";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONF_D, sanitize, TEAM_PREFIX } from "./sshconfig";

export type SourceType = "onedev" | "http" | "file";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  // onedev
  serverUrl?: string;
  project?: string;
  branch?: string;
  /** file or folder inside the repository / on the share */
  path?: string;
  token?: string;
  // http
  url?: string;
  headerName?: string;
  headerValue?: string;
}

export interface SourceState {
  lastCheck?: number;
  lastSuccess?: number;
  lastChange?: number;
  /** commit hash, ETag/Last-Modified or mtime of the last downloaded version */
  version?: string;
  hosts?: number;
  blocked?: number;
  error?: string;
}

const SOURCES_KEY = "sources";
const STATE_KEY = "source-state";

export async function getSources(): Promise<Source[]> {
  const raw = await LocalStorage.getItem<string>(SOURCES_KEY);
  return raw ? (JSON.parse(raw) as Source[]) : [];
}

export async function saveSources(sources: Source[]) {
  await LocalStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
}

export async function getStates(): Promise<Record<string, SourceState>> {
  const raw = await LocalStorage.getItem<string>(STATE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, SourceState>) : {};
}

async function setState(id: string, state: SourceState) {
  const states = await getStates();
  states[id] = state;
  await LocalStorage.setItem(STATE_KEY, JSON.stringify(states));
}

export function newSourceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return `${slug || "source"}-${crypto.randomBytes(3).toString("hex")}`;
}

export function cacheFile(id: string) {
  return path.join(CONF_D, `${TEAM_PREFIX}${id}.conf`);
}

export async function removeSource(id: string) {
  await saveSources((await getSources()).filter((s) => s.id !== id));
  const states = await getStates();
  delete states[id];
  await LocalStorage.setItem(STATE_KEY, JSON.stringify(states));
  await fs.rm(cacheFile(id), { force: true });
}

// ---------- fetching ----------

type FetchResult =
  | { unchanged: true; version?: string }
  | { unchanged: false; version?: string; files: { name: string; text: string }[] };

const isConfFile = (name: string) => /\.(conf|config|ssh)$/i.test(name) || name === "config";

async function onedevFetch(source: Source, knownVersion?: string): Promise<FetchResult> {
  const base = (source.serverUrl ?? "").trim().replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${(source.token ?? "").trim()}`, Accept: "application/json" };
  const get = async <T>(apiPath: string): Promise<T> => {
    const res = await fetch(`${base}/~api/${apiPath}`, { headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`OneDev ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    return JSON.parse(text) as T;
  };

  const projectPath = (source.project ?? "").trim().replace(/^\/+|\/+$/g, "");
  const query = encodeURIComponent(`"Path" is "${projectPath}"`);
  const projects = await get<{ id: number; path: string }[]>(`projects?query=${query}&offset=0&count=1`);
  if (!projects.length) throw new Error(`OneDev project "${projectPath}" not found or no access`);
  const projectId = projects[0].id;
  const branch = (source.branch ?? "").trim() || "main";

  // Cheap change check: only download when the branch head moved.
  const head = await get<{ commitHash: string }>(`repositories/${projectId}/branches/${encodeURIComponent(branch)}`);
  if (knownVersion && head.commitHash === knownVersion) return { unchanged: true, version: head.commitHash };

  const target = (source.path ?? "").trim().replace(/^\/+|\/+$/g, "");
  const readFile = async (file: string) => {
    const res = await get<{ base64Content: string }>(
      `repositories/${projectId}/files?revision=${encodeURIComponent(head.commitHash)}&file=${encodeURIComponent(file)}`,
    );
    return Buffer.from(res.base64Content, "base64").toString("utf8");
  };

  // A folder (or the repo root) collects all *.conf files; otherwise a single file.
  let entries: { path: string; isFile: boolean }[] | undefined;
  try {
    entries = await get<{ path: string; isFile: boolean }[]>(
      `repositories/${projectId}/directories/${head.commitHash}/${target.split("/").map(encodeURIComponent).join("/")}`,
    );
  } catch {
    entries = undefined;
  }
  if (entries && Array.isArray(entries)) {
    const files = entries
      .filter((e) => e.isFile && isConfFile(path.posix.basename(e.path)))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) throw new Error(`No *.conf files in "${target || "/"}"`);
    return {
      unchanged: false,
      version: head.commitHash,
      files: await Promise.all(
        files.map(async (f) => {
          const full = f.path.includes("/") || !target ? f.path : `${target}/${f.path}`;
          return { name: full, text: await readFile(full) };
        }),
      ),
    };
  }
  return { unchanged: false, version: head.commitHash, files: [{ name: target, text: await readFile(target) }] };
}

async function httpFetch(source: Source, knownVersion?: string): Promise<FetchResult> {
  const headers: Record<string, string> = {};
  if (source.headerName?.trim() && source.headerValue) headers[source.headerName.trim()] = source.headerValue;
  if (knownVersion?.startsWith("etag:")) headers["If-None-Match"] = knownVersion.slice(5);
  if (knownVersion?.startsWith("lm:")) headers["If-Modified-Since"] = knownVersion.slice(3);
  const res = await fetch((source.url ?? "").trim(), { headers });
  if (res.status === 304) return { unchanged: true, version: knownVersion };
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  if (/^\s*<!doctype html|^\s*<html/i.test(text))
    throw new Error("Got an HTML page instead of an SSH config (login page? wrong URL?)");
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  const version = etag
    ? `etag:${etag}`
    : lastModified
      ? `lm:${lastModified}`
      : `sha:${crypto.createHash("sha1").update(text).digest("hex")}`;
  if (version === knownVersion) return { unchanged: true, version };
  return { unchanged: false, version, files: [{ name: source.url ?? "", text }] };
}

async function fileFetch(source: Source, knownVersion?: string): Promise<FetchResult> {
  const target = (source.path ?? "").trim();
  const stat = await fs.stat(target);
  const files = stat.isDirectory()
    ? (await fs.readdir(target))
        .filter(isConfFile)
        .sort()
        .map((f) => path.join(target, f))
    : [target];
  if (!files.length) throw new Error(`No *.conf files in ${target}`);
  const stamps = await Promise.all(files.map(async (f) => `${f}:${(await fs.stat(f)).mtimeMs}`));
  const version = `mtime:${crypto.createHash("sha1").update(stamps.join("|")).digest("hex")}`;
  if (version === knownVersion) return { unchanged: true, version };
  return {
    unchanged: false,
    version,
    files: await Promise.all(files.map(async (f) => ({ name: f, text: await fs.readFile(f, "utf8") }))),
  };
}

export interface SyncResult {
  source: Source;
  status: "updated" | "unchanged" | "error" | "disabled";
  state: SourceState;
}

/**
 * Syncs one source. The cache file is only replaced after a successful download,
 * so the last good version keeps working when the source is unreachable.
 */
export async function syncSource(source: Source, force = false): Promise<SyncResult> {
  const previous = (await getStates())[source.id] ?? {};
  if (!source.enabled) return { source, status: "disabled", state: previous };
  const now = Date.now();
  try {
    const known = force ? undefined : previous.version;
    const result =
      source.type === "onedev"
        ? await onedevFetch(source, known)
        : source.type === "http"
          ? await httpFetch(source, known)
          : await fileFetch(source, known);

    const cacheExists = await fs
      .stat(cacheFile(source.id))
      .then(() => true)
      .catch(() => false);
    if (result.unchanged && cacheExists) {
      const state = { ...previous, lastCheck: now, lastSuccess: now, error: undefined };
      await setState(source.id, state);
      return { source, status: "unchanged", state };
    }
    if (result.unchanged) return syncSource(source, true); // cache file missing → download again

    const { blockRisky } = getPreferenceValues<Preferences>();
    let blocked = 0;
    const parts = result.files.map((f) => {
      const cleaned = blockRisky ? sanitize(f.text) : { text: f.text, blocked: 0 };
      blocked += cleaned.blocked;
      // "Match all" keeps one file's trailing Host block from swallowing the next file.
      return `# ---- ${f.name} ----\nMatch all\n${cleaned.text.replace(/\r\n/g, "\n").trimEnd()}\n`;
    });
    const header = [
      `# Managed by Raycast SSH – source "${source.name}" (${source.type})`,
      `# Synced ${new Date(now).toISOString()} – version ${result.version ?? "-"}`,
      "# Do not edit: this file is replaced on the next sync. Override hosts in ~/.ssh/config instead.",
      "",
    ].join("\n");
    const content = header + parts.join("\n");
    const hosts = (content.match(/^\s*Host\s+/gim) ?? []).length;

    await fs.mkdir(CONF_D, { recursive: true });
    const tmp = `${cacheFile(source.id)}.tmp`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, cacheFile(source.id));

    const state: SourceState = {
      lastCheck: now,
      lastSuccess: now,
      lastChange: now,
      version: result.version,
      hosts,
      blocked,
    };
    await setState(source.id, state);
    return { source, status: "updated", state };
  } catch (error) {
    const state = { ...previous, lastCheck: now, error: (error as Error).message };
    await setState(source.id, state);
    return { source, status: "error", state };
  }
}

export async function syncAll(force = false): Promise<SyncResult[]> {
  const sources = await getSources();
  return Promise.all(sources.map((s) => syncSource(s, force)));
}

/** True when auto sync is enabled and the last check is older than the configured interval. */
export async function syncDue(): Promise<boolean> {
  const { syncMinutes } = getPreferenceValues<Preferences>();
  const minutes = Number(syncMinutes || "60");
  if (!minutes) return false;
  const sources = (await getSources()).filter((s) => s.enabled);
  if (!sources.length) return false;
  const states = await getStates();
  return sources.some((s) => Date.now() - (states[s.id]?.lastCheck ?? 0) > minutes * 60_000);
}

import { environment, getPreferenceValues, Keyboard } from "@raycast/api";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getToken } from "./vault";

/* Paperless-ngx REST API: https://docs.paperless-ngx.com/api/ */

export interface Document {
  id: number;
  title: string;
  content?: string;
  correspondent: number | null;
  document_type: number | null;
  storage_path: number | null;
  tags: number[];
  created: string;
  added: string;
  modified?: string;
  archive_serial_number: number | null;
  original_file_name?: string;
  archived_file_name?: string | null;
  page_count?: number | null;
  notes?: unknown[];
  __search_hit__?: { score: number; highlights: string; rank: number };
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  text_color?: string;
  is_inbox_tag: boolean;
  document_count?: number;
}

export interface NamedItem {
  id: number;
  name: string;
  document_count?: number;
}

export interface Page<T> {
  count: number;
  next: string | null;
  results: T[];
}

export interface Task {
  task_id: string;
  status: "PENDING" | "STARTED" | "SUCCESS" | "FAILURE" | "RETRY" | "REVOKED";
  result: string | null;
  related_document: string | number | null;
  task_file_name?: string;
}

export function serverUrl(): string {
  const { serverUrl } = getPreferenceValues<Preferences>();
  return serverUrl.trim().replace(/\/+$/, "");
}

async function headers(extra?: Record<string, string>): Promise<Record<string, string>> {
  return { Authorization: `Token ${await getToken()}`, Accept: "application/json", ...extra };
}

/** Checks a token before it is stored (setup). */
export async function verifyToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl()}/api/documents/?page_size=1`, {
      headers: { Authorization: `Token ${token.trim()}`, Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(`Paperless not reachable: ${(error as Error).message}`);
  }
  if (response.status === 401 || response.status === 403) throw new Error("The token was rejected by Paperless");
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${serverUrl()}/api/${path.replace(/^\//, "")}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(await headers()), ...(init?.headers as Record<string, string>) },
    });
  } catch (error) {
    throw new Error(`Paperless not reachable: ${(error as Error).message}`);
  }
  if (response.status === 401 || response.status === 403) throw new Error("Access denied: check the API token");
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text.slice(0, 300) || `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Loads all items of a small list endpoint (tags, correspondents, document types). */
async function all<T>(endpoint: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = `${endpoint}/?page_size=1000`;
  while (next) {
    const page: Page<T> = await api<Page<T>>(next);
    items.push(...page.results);
    next = page.next;
  }
  return items;
}

export interface Meta {
  tags: Map<number, Tag>;
  correspondents: Map<number, NamedItem>;
  documentTypes: Map<number, NamedItem>;
  storagePaths: Map<number, NamedItem>;
}

/** Plain lists, so the result survives Raycast's JSON cache (Maps would come back as {}). */
export interface MetaLists {
  tags: Tag[];
  correspondents: NamedItem[];
  documentTypes: NamedItem[];
  storagePaths: NamedItem[];
}

export async function loadMeta(): Promise<MetaLists> {
  const [tags, correspondents, documentTypes, storagePaths] = await Promise.all([
    all<Tag>("tags"),
    all<NamedItem>("correspondents"),
    all<NamedItem>("document_types"),
    all<NamedItem>("storage_paths").catch(() => []),
  ]);
  return { tags, correspondents, documentTypes, storagePaths };
}

export function toMeta(lists: MetaLists): Meta {
  const byId = <T extends { id: number }>(list: T[] | undefined) =>
    new Map((Array.isArray(list) ? list : []).map((x) => [x.id, x]));
  return {
    tags: byId(lists.tags),
    correspondents: byId(lists.correspondents),
    documentTypes: byId(lists.documentTypes),
    storagePaths: byId(lists.storagePaths),
  };
}

export const PAGE_SIZE = 30;

export async function searchDocuments(params: Record<string, string>, page: number): Promise<Page<Document>> {
  const query = new URLSearchParams({
    page: String(page + 1),
    page_size: String(PAGE_SIZE),
    truncate_content: "true",
    ...params,
  });
  return api<Page<Document>>(`documents/?${query}`);
}

export async function updateDocument(id: number, changes: Partial<Document>): Promise<Document> {
  return api<Document>(`documents/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export async function modifyTags(ids: number[], add: number[], remove: number[]) {
  await api("documents/bulk_edit/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents: ids, method: "modify_tags", parameters: { add_tags: add, remove_tags: remove } }),
  });
}

export function documentUrl(id: number): string {
  return `${serverUrl()}/documents/${id}/details`;
}

/** Thumbnails need the token, so they are cached as local files for the detail view. */
export async function thumbnailPath(id: number, modified?: string): Promise<string | undefined> {
  const dir = join(environment.supportPath, "thumbs");
  const stamp = (modified ?? "").replace(/\D/g, "").slice(0, 14);
  const file = join(dir, `${id}-${stamp}.webp`);
  if (existsSync(file)) return file;
  try {
    const response = await fetch(`${serverUrl()}/api/documents/${id}/thumb/`, {
      headers: await headers({ Accept: "*/*" }),
    });
    if (!response.ok) return undefined;
    await mkdir(dir, { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    return file;
  } catch {
    return undefined;
  }
}

function downloadDir(): string {
  const { downloadFolder } = getPreferenceValues<Preferences>();
  return downloadFolder?.trim() || join(homedir(), "Downloads");
}

/** Downloads the document (archived PDF, or the original) and returns the saved path. */
export async function downloadDocument(doc: Document, original = false): Promise<string> {
  const response = await fetch(`${serverUrl()}/api/documents/${doc.id}/download/${original ? "?original=true" : ""}`, {
    headers: await headers({ Accept: "*/*" }),
  });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) ?? disposition.match(/filename="?([^";]+)"?/i);
  let name = match ? decodeURIComponent(match[1]) : `${doc.title}.pdf`;
  name = basename(name).replace(/[<>:"/\\|?*]/g, "_");
  const dir = downloadDir();
  await mkdir(dir, { recursive: true });
  let target = join(dir, name);
  for (let i = 2; existsSync(target); i++) target = join(dir, name.replace(/(\.[^.]*)?$/, ` (${i})$1`));
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

export interface UploadOptions {
  title?: string;
  correspondent?: number;
  documentType?: number;
  tags?: number[];
  created?: Date;
}

/** Uploads a file; returns the consumption task id. */
export async function uploadDocument(file: string, options: UploadOptions): Promise<string> {
  const form = new FormData();
  form.append("document", new Blob([await readFile(file)]), basename(file));
  if (options.title) form.append("title", options.title);
  if (options.correspondent) form.append("correspondent", String(options.correspondent));
  if (options.documentType) form.append("document_type", String(options.documentType));
  for (const tag of options.tags ?? []) form.append("tags", String(tag));
  if (options.created) form.append("created", options.created.toISOString().slice(0, 10));
  const result = await api<string>("documents/post_document/", { method: "POST", body: form });
  return typeof result === "string" ? result : String(result);
}

export async function getTask(taskId: string): Promise<Task | undefined> {
  const tasks = await api<Task[]>(`tasks/?task_id=${encodeURIComponent(taskId)}`);
  return tasks[0];
}

/** Turns Paperless search highlights (HTML) into Markdown. */
export function highlightsToMarkdown(html: string): string {
  return html
    .replace(/<span class="match">(.*?)<\/span>/g, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString();
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut {
  return {
    macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
    Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
  };
}

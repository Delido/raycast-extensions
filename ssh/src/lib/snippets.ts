import { LocalStorage } from "@raycast/api";
import { randomUUID } from "node:crypto";

/*
 * Saved commands for running SSH sessions (like the snippets of Tabby): they are typed into the
 * terminal tab in front. A command may contain placeholders:
 *   {{name}}            asked before use
 *   {{name:default}}    asked, prefilled with the default
 */

export interface Snippet {
  id: string;
  title: string;
  command: string;
  description?: string;
  group?: string;
  created: number;
  used?: number;
}

const KEY = "snippets";

export async function getSnippets(): Promise<Snippet[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  try {
    return raw ? (JSON.parse(raw) as Snippet[]) : [];
  } catch {
    return [];
  }
}

export async function saveSnippets(snippets: Snippet[]) {
  await LocalStorage.setItem(KEY, JSON.stringify(snippets));
}

export async function upsertSnippet(snippet: Omit<Snippet, "id" | "created"> & { id?: string; created?: number }) {
  const all = await getSnippets();
  const index = snippet.id ? all.findIndex((s) => s.id === snippet.id) : -1;
  const next: Snippet = { ...snippet, id: snippet.id ?? randomUUID(), created: snippet.created ?? Date.now() };
  if (index >= 0) all[index] = next;
  else all.push(next);
  await saveSnippets(all);
  return next;
}

export async function deleteSnippet(id: string) {
  await saveSnippets((await getSnippets()).filter((s) => s.id !== id));
}

export async function markUsed(id: string) {
  const all = await getSnippets();
  const snippet = all.find((s) => s.id === id);
  if (snippet) {
    snippet.used = Date.now();
    await saveSnippets(all);
  }
}

/** Imports snippets from an export (same ids are replaced); returns the number imported. */
export async function importSnippets(json: string): Promise<number> {
  const parsed = JSON.parse(json) as unknown;
  const list = (Array.isArray(parsed) ? parsed : (parsed as { snippets?: unknown[] })?.snippets) ?? [];
  const valid = list.filter(
    (s): s is Snippet => typeof (s as Snippet)?.title === "string" && typeof (s as Snippet)?.command === "string",
  );
  const all = await getSnippets();
  for (const s of valid) {
    const item: Snippet = { ...s, id: s.id || randomUUID(), created: s.created || Date.now() };
    const index = all.findIndex((x) => x.id === item.id);
    if (index >= 0) all[index] = item;
    else all.push(item);
  }
  await saveSnippets(all);
  return valid.length;
}

export interface Placeholder {
  name: string;
  defaultValue: string;
}

const PLACEHOLDER = /\{\{\s*([\w-]+)\s*(?::([^}]*))?\}\}/g;

/** Placeholders the user has to fill in before the command is used. */
export function placeholders(command: string): Placeholder[] {
  const seen = new Map<string, Placeholder>();
  for (const match of command.matchAll(PLACEHOLDER)) {
    if (!seen.has(match[1])) seen.set(match[1], { name: match[1], defaultValue: match[2] ?? "" });
  }
  return [...seen.values()];
}

export function fill(command: string, values: Record<string, string>): string {
  return command.replace(PLACEHOLDER, (whole, name: string, fallback?: string) => values[name] ?? fallback ?? whole);
}

import { Cache, getPreferenceValues, Keyboard } from "@raycast/api";

export interface Project {
  id: number;
  parentId: number | null;
  name: string;
  key: string | null;
  path: string;
  description: string | null;
  createDate: string;
  codeManagement: boolean;
  issueManagement: boolean;
}

export interface Issue {
  id: number;
  number: number;
  projectId: number;
  title: string;
  description: string | null;
  state: string;
  submitDate: string;
  commentCount: number;
  voteCount: number;
  confidential: boolean;
  lastActivity?: { date: string; description: string };
}

export interface PullRequest {
  id: number;
  number: number;
  targetProjectId: number;
  sourceProjectId: number | null;
  title: string;
  description: string | null;
  status: "OPEN" | "MERGED" | "DISCARDED";
  workInProgress: boolean;
  submitDate: string;
  sourceBranch?: string;
  targetBranch?: string;
  commentCount?: number;
  lastActivity?: { date: string; description: string };
}

export type BuildStatus = "WAITING" | "PENDING" | "RUNNING" | "SUCCESSFUL" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export interface Build {
  id: number;
  number: number;
  projectId: number;
  jobName: string;
  refName: string | null;
  version: string | null;
  commitHash: string;
  status: BuildStatus;
  submitDate: string;
  finishDate: string | null;
  submitReason: string | null;
}

export function getServerUrl(): string {
  const { serverUrl } = getPreferenceValues<Preferences>();
  return serverUrl.trim().replace(/\/+$/, "");
}

export function apiUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${getServerUrl()}/~api/${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function authHeaders(): Record<string, string> {
  const { accessToken } = getPreferenceValues<Preferences>();
  return { Authorization: `Bearer ${accessToken.trim()}`, Accept: "application/json" };
}

export async function parseResponse(response: Response) {
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** Builds a OneDev query from an optional base filter and the fuzzy search text. */
export function buildQuery(filter: string, searchText: string, order?: string): string {
  const parts: string[] = [];
  if (filter) parts.push(filter);
  const text = searchText.trim().replace(/~/g, "");
  if (text) parts.push(`~${text}~`);
  let query = parts.join(" and ");
  if (order) query = `${query} ${order}`.trim();
  return query;
}

// Project paths are needed to build web URLs for issues, pulls and builds.
const cache = new Cache({ namespace: "project-paths" });

export async function resolveProjectPaths(projectIds: number[]): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  const missing = new Set<number>();
  for (const id of projectIds) {
    const cached = cache.get(String(id));
    if (cached) result[id] = cached;
    else missing.add(id);
  }
  await Promise.all(
    [...missing].map(async (id) => {
      try {
        const project = (await parseResponse(
          await fetch(apiUrl(`projects/${id}`), { headers: authHeaders() }),
        )) as Project;
        cache.set(String(id), project.path);
        result[id] = project.path;
      } catch {
        // ignore – item will fall back to a URL without project path
      }
    }),
  );
  return result;
}

export function projectUrl(path: string): string {
  return `${getServerUrl()}/${path}`;
}

export function itemUrl(projectPath: string | undefined, kind: "issues" | "pulls" | "builds", number: number) {
  if (!projectPath) return getServerUrl();
  return `${getServerUrl()}/${projectPath}/~${kind}/${number}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent): Keyboard.Shortcut {
  return { macOS: { modifiers: ["cmd"], key }, Windows: { modifiers: ["ctrl"], key } };
}

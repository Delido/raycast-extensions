import { Config, JiraConfig } from "./config";

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string; custom?: string };
}

export interface Issue {
  id: string;
  key: string;
  summary: string;
  status?: string;
  statusCategory?: string;
  issueType?: string;
  issueTypeIcon?: string;
  project?: string;
  /** Raw text of the job field */
  job?: string;
  /** Raw text of the order field */
  order?: string;
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function authHeader(jira: JiraConfig): string {
  return `Basic ${Buffer.from(`${jira.email}:${jira.token}`).toString("base64")}`;
}

async function request<T>(jira: JiraConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${jira.site}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: authHeader(jira),
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new JiraError(`Jira not reachable (${jira.site}): ${(error as Error).message}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
      const parts = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})];
      if (body.message) parts.push(body.message);
      if (parts.length) message = parts.join(" · ");
    } catch {
      // not JSON
    }
    if (res.status === 401) message = "Jira rejected the login: check email and API token";
    throw new JiraError(`Jira ${res.status}: ${message || res.statusText}`, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function getMyself(jira: JiraConfig) {
  return request<{ accountId: string; displayName: string; emailAddress?: string }>(jira, "/rest/api/3/myself");
}

export async function getFields(jira: JiraConfig): Promise<JiraField[]> {
  const fields = await request<JiraField[]>(jira, "/rest/api/3/field");
  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

/** Plain text of any Jira field value: text, number, select option, user, array, rich text (ADF). */
export function fieldText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(fieldText).filter((v): v is string => !!v);
    return parts.length ? parts.join(", ") : undefined;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Atlassian Document Format
    if (obj.type === "doc" || Array.isArray(obj.content)) {
      const out: string[] = [];
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const n = node as { text?: string; content?: unknown[] };
        if (typeof n.text === "string") out.push(n.text);
        n.content?.forEach(walk);
      };
      walk(obj);
      return out.join(" ").trim() || undefined;
    }
    // Cascading select: value + child.value
    if (typeof obj.value === "string") {
      const child = fieldText(obj.child);
      return child ? `${obj.value} ${child}` : obj.value;
    }
    for (const key of ["name", "displayName", "key", "title"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  return undefined;
}

interface RawIssue {
  id: string;
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string; iconUrl?: string };
    project?: { name?: string; key?: string };
  };
}

function fieldList(config: Config): string[] {
  const list = ["summary", "status", "issuetype", "project"];
  if (config.jobField) list.push(config.jobField.id);
  if (config.orderField) list.push(config.orderField.id);
  return [...new Set(list)];
}

function toIssue(config: Config, raw: RawIssue): Issue {
  const f = raw.fields;
  return {
    id: raw.id,
    key: raw.key,
    summary: f.summary ?? "",
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    issueType: f.issuetype?.name,
    issueTypeIcon: f.issuetype?.iconUrl,
    project: f.project?.name,
    job: config.jobField ? fieldText(f[config.jobField.id]) : undefined,
    order: config.orderField ? fieldText(f[config.orderField.id]) : undefined,
  };
}

export const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

export async function getIssue(config: Config, key: string): Promise<Issue> {
  const raw = await request<RawIssue>(
    config.jira!,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fieldList(config).join(","))}`,
  );
  return toIssue(config, raw);
}

async function searchJql(config: Config, jql: string, maxResults = 30): Promise<Issue[]> {
  const res = await request<{ issues?: RawIssue[] }>(config.jira!, "/rest/api/3/search/jql", {
    method: "POST",
    body: { jql, fields: fieldList(config), maxResults },
  });
  return (res.issues ?? []).map((raw) => toIssue(config, raw));
}

/** Removes characters that have a meaning in Jira's text search or would break the JQL string. */
function textTerm(query: string): string {
  return query
    .replace(/[+\-&|!(){}[\]^~*?\\:"']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word}*`)
    .join(" ");
}

/**
 * Empty query: recently viewed issues. Issue key: that issue first.
 * Otherwise full-text search over summary, description and comments.
 */
export async function searchIssues(config: Config, query: string): Promise<Issue[]> {
  const q = query.trim();
  if (!q) return searchJql(config, "issue in issueHistory() ORDER BY lastViewed DESC");
  const results: Issue[] = [];
  if (ISSUE_KEY.test(q)) {
    try {
      results.push(await getIssue(config, q.toUpperCase()));
    } catch (error) {
      if (!(error instanceof JiraError && (error.status === 404 || error.status === 400))) throw error;
    }
  }
  const term = textTerm(q);
  if (term) {
    const found = await searchJql(config, `text ~ "${term}" ORDER BY updated DESC`);
    for (const issue of found) if (!results.some((r) => r.key === issue.key)) results.push(issue);
  }
  return results;
}

/** Jira expects "2026-11-06T09:15:00.000+0100" */
export function jiraDateTime(date: Date): string {
  const pad = (n: number, len = 2) => String(Math.abs(n)).padStart(len, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.000` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  );
}

export async function addWorklog(
  config: Config,
  key: string,
  input: { started: Date; seconds: number; comment: string; notify: boolean },
): Promise<string> {
  const body: Record<string, unknown> = {
    started: jiraDateTime(input.started),
    // Jira refuses worklogs below one minute
    timeSpentSeconds: Math.max(60, Math.round(input.seconds)),
  };
  if (input.comment.trim()) {
    body.comment = {
      type: "doc",
      version: 1,
      content: input.comment
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
    };
  }
  const res = await request<{ id: string }>(
    config.jira!,
    `/rest/api/3/issue/${encodeURIComponent(key)}/worklog?notifyUsers=${input.notify}`,
    { method: "POST", body },
  );
  return res.id;
}

export async function deleteWorklog(config: Config, key: string, worklogId: string): Promise<void> {
  await request(config.jira!, `/rest/api/3/issue/${encodeURIComponent(key)}/worklog/${worklogId}?notifyUsers=false`, {
    method: "DELETE",
  });
}

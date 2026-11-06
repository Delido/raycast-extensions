import { MocoConfig } from "./config";

export interface MocoTask {
  id: number;
  name: string;
  active: boolean;
  billable: boolean;
}

export interface MocoProject {
  id: number;
  identifier: string;
  name: string;
  active: boolean;
  billable: boolean;
  customer?: { id: number; name: string };
  tasks: MocoTask[];
}

/** What timers and bookings keep of a project/task */
export interface ProjectRef {
  id: number;
  identifier: string;
  name: string;
}

export interface TaskRef {
  id: number;
  name: string;
}

export interface MocoActivity {
  id: number;
  date: string;
  seconds: number;
  hours: number;
  description: string;
  remote_id?: string | null;
  project?: { id: number; name: string };
  task?: { id: number; name: string };
}

export class MocoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function baseUrl(domain: string): string {
  return `https://${domain}.mocoapp.com/api/v1`;
}

async function call(
  domain: string,
  apiKey: string | undefined,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(domain)}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Token token=${apiKey}` } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new MocoError(`MOCO not reachable (${domain}.mocoapp.com): ${(error as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { message?: string; error?: string; errors?: unknown };
      message = body.message ?? body.error ?? (body.errors ? JSON.stringify(body.errors) : message);
    } catch {
      // not JSON
    }
    if (res.status === 401) message = "MOCO rejected the API key";
    if (res.status === 429) message = "Too many requests, try again in a minute";
    throw new MocoError(`MOCO ${res.status}: ${message || res.statusText}`, res.status);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Exchanges email and password for the user's personal API key. */
export async function login(
  domain: string,
  email: string,
  password: string,
): Promise<{ apiKey: string; userId?: number }> {
  const res = await call(domain, undefined, "/session", { method: "POST", body: { email, password } });
  const body = await json<{ api_key?: string; user_id?: number }>(res);
  if (!body?.api_key) throw new MocoError("MOCO did not return an API key: paste it manually instead");
  return { apiKey: body.api_key, userId: body.user_id };
}

/** Checks the key and returns the user's id. */
export async function getSession(moco: Pick<MocoConfig, "domain" | "apiKey">): Promise<{ id: number }> {
  return json(await call(moco.domain, moco.apiKey, "/session"));
}

async function getAll<T>(moco: MocoConfig, path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 20; page++) {
    const res = await call(moco.domain, moco.apiKey, `${path}${sep}page=${page}`);
    out.push(...(await json<T[]>(res)));
    if (!/rel="next"/.test(res.headers.get("link") ?? "")) break;
  }
  return out;
}

/** Active projects the user may book on, with their tasks. */
export async function getAssignedProjects(moco: MocoConfig): Promise<MocoProject[]> {
  const projects = await getAll<MocoProject>(moco, "/projects/assigned?active=true");
  return projects
    .filter((p) => p.active !== false)
    .map((p) => ({ ...p, tasks: (p.tasks ?? []).filter((t) => t.active !== false) }))
    .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
}

export async function createActivity(
  moco: MocoConfig,
  input: {
    date: string;
    projectId: number;
    taskId: number;
    seconds: number;
    description: string;
    billable: boolean;
    /** Links the activity to the Jira issue */
    issueKey?: string;
    issueUrl?: string;
  },
): Promise<number> {
  const res = await call(moco.domain, moco.apiKey, "/activities", {
    method: "POST",
    body: {
      date: input.date,
      project_id: input.projectId,
      task_id: input.taskId,
      seconds: Math.round(input.seconds),
      description: input.description,
      billable: input.billable,
      ...(input.issueKey ? { remote_service: "jira", remote_id: input.issueKey, remote_url: input.issueUrl } : {}),
    },
  });
  return (await json<{ id: number }>(res)).id;
}

export async function deleteActivity(moco: MocoConfig, id: number): Promise<void> {
  await call(moco.domain, moco.apiKey, `/activities/${id}`, { method: "DELETE" });
}

export async function getMyActivities(moco: MocoConfig, from: string, to: string): Promise<MocoActivity[]> {
  const user = moco.userId ? `&user_id=${moco.userId}` : "";
  return getAll<MocoActivity>(moco, `/activities?from=${from}&to=${to}${user}`);
}

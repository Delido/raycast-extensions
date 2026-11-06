import { getPreferenceValues, LocalStorage } from "@raycast/api";
import { Issue } from "./jira";
import { MocoProject, MocoTask } from "./moco";

export interface Match {
  /** Job number read from the issue (after the pattern) */
  job?: string;
  /** Order read from the issue (after the pattern) */
  order?: string;
  project?: MocoProject;
  task?: MocoTask;
  /** Project/task come from an earlier booking on this issue, not from the fields */
  remembered: boolean;
}

function applyPattern(value: string | undefined, pattern: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!pattern?.trim()) return value.trim();
  let re: RegExp;
  try {
    re = new RegExp(pattern.trim(), "i");
  } catch {
    throw new Error(`Invalid regular expression in the settings: ${pattern}`);
  }
  const m = re.exec(value);
  if (!m) return undefined;
  return (m[1] ?? m[0]).trim() || undefined;
}

export function readJob(issue: Issue): string | undefined {
  return applyPattern(issue.job, getPreferenceValues<Preferences>().jobPattern);
}

export function readOrder(issue: Issue): string | undefined {
  return applyPattern(issue.order, getPreferenceValues<Preferences>().orderPattern);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact project number, then a number contained in the value ("P1234 Customer"), then a suffix ("1234" → "P1234"). */
export function findProject(projects: MocoProject[], job: string | undefined): MocoProject | undefined {
  if (!job) return undefined;
  const value = norm(job);
  const exact = projects.find((p) => norm(p.identifier) === value);
  if (exact) return exact;
  const contained = projects
    .filter(
      (p) =>
        p.identifier &&
        new RegExp(`(^|[^a-z0-9])${escape(p.identifier.toLowerCase())}($|[^a-z0-9])`).test(job.toLowerCase()),
    )
    .sort((a, b) => b.identifier.length - a.identifier.length);
  if (contained[0]) return contained[0];
  if (value.length >= 3) {
    const suffix = projects.filter((p) => norm(p.identifier).endsWith(value));
    if (suffix.length === 1) return suffix[0];
  }
  return undefined;
}

/** Exact task name, then a unique partial match; a project with a single task always matches. */
export function findTask(project: MocoProject | undefined, order: string | undefined): MocoTask | undefined {
  if (!project) return undefined;
  if (project.tasks.length === 1) return project.tasks[0];
  if (!order) return undefined;
  const value = norm(order);
  const exact = project.tasks.find((t) => norm(t.name) === value);
  if (exact) return exact;
  const partial = project.tasks.filter((t) => norm(t.name).includes(value) || value.includes(norm(t.name)));
  return partial.length === 1 ? partial[0] : undefined;
}

interface Remembered {
  projectId: number;
  taskId: number;
}

const rememberKey = (issueKey: string) => `choice:${issueKey}`;

/** Remembers a project/task only when it differs from what the issue's fields say. */
export async function rememberChoice(issue: Issue, projects: MocoProject[], projectId: number, taskId: number) {
  const project = findProject(projects, readJob(issue));
  const task = findTask(project, readOrder(issue));
  if (project?.id === projectId && task?.id === taskId) await LocalStorage.removeItem(rememberKey(issue.key));
  else await LocalStorage.setItem(rememberKey(issue.key), JSON.stringify({ projectId, taskId } satisfies Remembered));
}

async function remembered(issueKey: string): Promise<Remembered | undefined> {
  const raw = await LocalStorage.getItem<string>(rememberKey(issueKey));
  try {
    return raw ? (JSON.parse(raw) as Remembered) : undefined;
  } catch {
    return undefined;
  }
}

/** A project/task chosen by hand for this issue wins over the fields, so a correction sticks. */
export async function matchIssue(issue: Issue, projects: MocoProject[]): Promise<Match> {
  const job = readJob(issue);
  const order = readOrder(issue);
  const saved = await remembered(issue.key);
  if (saved) {
    const project = projects.find((p) => p.id === saved.projectId);
    const task = project?.tasks.find((t) => t.id === saved.taskId);
    if (project && task) return { job, order, project, task, remembered: true };
  }
  const project = findProject(projects, job);
  return { job, order, project, task: findTask(project, order), remembered: false };
}

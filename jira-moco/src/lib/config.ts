import { Keyboard, LocalStorage } from "@raycast/api";

export interface JiraConfig {
  /** https://example.atlassian.net */
  site: string;
  email: string;
  token: string;
  accountId?: string;
  displayName?: string;
}

export interface MocoConfig {
  /** Subdomain only: "example" for example.mocoapp.com */
  domain: string;
  apiKey: string;
  userId?: number;
}

export interface FieldRef {
  id: string;
  name: string;
}

export interface Config {
  jira?: JiraConfig;
  moco?: MocoConfig;
  /** Jira field that holds the job number (= MOCO project number) */
  jobField?: FieldRef;
  /** Jira field that holds the order (= MOCO task) */
  orderField?: FieldRef;
}

const KEY = "config";

export async function loadConfig(): Promise<Config> {
  const raw = await LocalStorage.getItem<string>(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Config;
  } catch {
    return {};
  }
}

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const next = { ...(await loadConfig()), ...patch };
  await LocalStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function isComplete(config: Config): boolean {
  return !!config.jira && !!config.moco && !!config.jobField;
}

export function normalizeJiraSite(input: string): string {
  let site = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
  if (!/\./.test(site.replace(/^https?:\/\//i, ""))) site = `${site}.atlassian.net`;
  return site.replace(/\/(jira|browse|wiki).*$/i, "");
}

export function normalizeMocoDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.mocoapp\.com$/i, "")
    .toLowerCase();
}

export function issueUrl(config: Config, key: string): string {
  return `${config.jira?.site ?? ""}/browse/${key}`;
}

export function mocoUrl(config: Config, path = ""): string {
  return `https://${config.moco?.domain ?? ""}.mocoapp.com${path}`;
}

/** Cmd on macOS, Ctrl on Windows */
export function shortcut(key: Keyboard.KeyEquivalent, extra: Keyboard.KeyModifier[] = []): Keyboard.Shortcut {
  return {
    macOS: { modifiers: ["cmd", ...extra], key },
    Windows: { modifiers: ["ctrl", ...extra], key },
  };
}

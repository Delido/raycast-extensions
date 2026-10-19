import { Color, environment, getPreferenceValues, Icon, Image, LocalStorage } from "@raycast/api";

/** Scope of an API session: the ADS controller itself or a single instance (via the ADS proxy). */
export const ADS = "ads";

export interface Metric {
  RawValue: number;
  MaxValue: number;
  Percent: number;
  Units?: string;
}

export interface Instance {
  InstanceID: string;
  InstanceName: string;
  FriendlyName: string;
  Module: string;
  ModuleDisplayName?: string;
  Description?: string;
  Running: boolean;
  AppState: number;
  Suspended?: boolean;
  Metrics?: Record<string, Metric>;
  ApplicationEndpoints?: { DisplayName: string; Endpoint: string }[];
  /** ID of the ADS target (controller) the instance belongs to. */
  TargetID: string;
  StartOnBoot: boolean;
}

export interface ConsoleEntry {
  Timestamp: string;
  Source: string;
  Message: string;
  Type?: string;
}

class UnauthorizedError extends Error {}

/*
 * AMP's JSON field names differ between versions (e.g. "Message" vs. "message" or "Contents").
 * These helpers read a field by any of its known names, case-insensitively.
 */
export type Json = Record<string, unknown>;

export function field(obj: unknown, ...names: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Json;
  for (const name of names) if (rec[name] !== undefined) return rec[name];
  const byLower = new Map(Object.keys(rec).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const key = byLower.get(name.toLowerCase());
    if (key !== undefined && rec[key] !== undefined) return rec[key];
  }
  return undefined;
}

export function str(obj: unknown, ...names: string[]): string {
  const value = field(obj, ...names);
  return value === null || value === undefined ? "" : String(value);
}

export function num(obj: unknown, ...names: string[]): number | undefined {
  const value = Number(field(obj, ...names));
  return Number.isFinite(value) ? value : undefined;
}

export function bool(obj: unknown, ...names: string[]): boolean {
  const value = field(obj, ...names);
  return value === true || value === "true" || value === "True";
}

const loggedShapes = new Set<string>();

/** Development aid: log the field names of a response type once per session (no values). */
export function logShape(kind: string, sample: unknown) {
  if (!environment.isDevelopment || loggedShapes.has(kind) || !sample || typeof sample !== "object") return;
  loggedShapes.add(kind);
  console.log(`[AMP] ${kind} fields: ${Object.keys(sample as Json).join(", ")}`);
}

function normalizeMetric(raw: unknown): Metric | undefined {
  const rawValue = num(raw, "RawValue", "Value", "Current");
  if (rawValue === undefined) return undefined;
  const maxValue = num(raw, "MaxValue", "Max", "Limit") ?? 0;
  const percent = num(raw, "Percent", "Percentage") ?? (maxValue > 0 ? Math.round((rawValue / maxValue) * 100) : 0);
  return { RawValue: rawValue, MaxValue: maxValue, Percent: percent, Units: str(raw, "Units", "Unit") };
}

const STATE_NAMES: Record<string, number> = {
  undefined: -1,
  stopped: 0,
  prestart: 5,
  configuringenvironment: 7,
  starting: 10,
  ready: 20,
  restarting: 30,
  stopping: 40,
  preparingforsleep: 45,
  sleeping: 50,
  waiting: 60,
  installing: 70,
  updating: 75,
  awaitinguserinput: 80,
  failed: 100,
  suspended: 200,
  maintainence: 250,
  maintenance: 250,
  indeterminate: 999,
};

/** App states arrive as numbers or (in some versions) as enum names. */
export function parseAppState(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (/^-?\d+$/.test(value)) return Number(value);
    return STATE_NAMES[value.replace(/[\s_]/g, "").toLowerCase()] ?? -1;
  }
  return -1;
}

/**
 * AMP 2.8 no longer reports the application state in ADSModule/GetInstances (always -1),
 * so ask running instances directly. Older versions keep using the value from the list.
 */
async function withLiveState(instance: Instance): Promise<Instance> {
  if (!instance.Running || instance.AppState !== -1) return instance;
  try {
    const status = await call<unknown>(instance.InstanceID, "Core/GetStatus");
    const state = parseAppState(field(status, "State", "AppState"));
    if (environment.isDevelopment && !loggedShapes.has(`state:${instance.InstanceID}`)) {
      loggedShapes.add(`state:${instance.InstanceID}`);
      console.log(`[AMP] live state ${instance.InstanceName}: ${JSON.stringify(field(status, "State"))} -> ${state}`);
    }
    const metrics = { ...instance.Metrics };
    const rawMetrics = field(status, "Metrics");
    if (rawMetrics && typeof rawMetrics === "object") {
      for (const [key, value] of Object.entries(rawMetrics as Json)) {
        const metric = normalizeMetric(value);
        if (metric) metrics[key] = metric;
      }
    }
    return { ...instance, AppState: state, Metrics: metrics };
  } catch {
    return instance;
  }
}

function normalizeInstance(raw: unknown, targetId = ""): Instance {
  logShape("Instance", raw);
  const metrics: Record<string, Metric> = {};
  const rawMetrics = field(raw, "Metrics");
  if (rawMetrics && typeof rawMetrics === "object") {
    for (const [key, value] of Object.entries(rawMetrics as Json)) {
      const metric = normalizeMetric(value);
      if (metric) metrics[key] = metric;
    }
  }
  const endpoints = field(raw, "ApplicationEndpoints", "Endpoints");
  const instanceName = str(raw, "InstanceName", "Name");
  return {
    InstanceID: str(raw, "InstanceID", "InstanceId", "Id"),
    InstanceName: instanceName,
    FriendlyName: str(raw, "FriendlyName", "DisplayName") || instanceName,
    Module: str(raw, "Module", "ModuleName"),
    ModuleDisplayName: str(raw, "ModuleDisplayName", "ApplicationName") || undefined,
    Description: str(raw, "Description") || undefined,
    Running: bool(raw, "Running", "IsRunning"),
    AppState: parseAppState(field(raw, "AppState", "State")),
    Suspended: bool(raw, "Suspended", "IsSuspended"),
    Metrics: metrics,
    TargetID: str(raw, "TargetID", "TargetId") || targetId,
    StartOnBoot: bool(raw, "DaemonAutostart", "StartOnBoot"),
    ApplicationEndpoints: Array.isArray(endpoints)
      ? endpoints
          .map((e) => ({
            DisplayName: str(e, "DisplayName", "Name") || "Address",
            Endpoint: str(e, "Endpoint", "Uri"),
          }))
          .filter((e) => e.Endpoint)
      : [],
  };
}

function normalizeConsoleEntry(raw: unknown): ConsoleEntry {
  logShape("ConsoleEntry", raw);
  return {
    Timestamp: str(raw, "Timestamp", "Time", "Date"),
    Source: str(raw, "Source", "Sender", "Origin"),
    Message: str(raw, "Message", "Contents", "Content", "Text", "Line"),
    Type: str(raw, "Type", "Kind", "Level") || undefined,
  };
}

function baseUrl(): string {
  return getPreferenceValues<Preferences>().serverUrl.trim().replace(/\/+$/, "");
}

function apiBase(scope: string): string {
  return scope === ADS ? baseUrl() : `${baseUrl()}/API/ADSModule/Servers/${scope}`;
}

export function panelUrl(instanceId?: string): string {
  return instanceId ? `${baseUrl()}/?instance=${instanceId}` : baseUrl();
}

async function rawCall<T>(scope: string, method: string, params: Record<string, unknown>, sessionId = ""): Promise<T> {
  const response = await fetch(`${apiBase(scope)}/API/${method}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, SESSIONID: sessionId }),
  });
  const text = await response.text();
  if (!["Core/GetUpdates", "Core/GetStatus", "ADSModule/GetInstances"].includes(method)) {
    // Diagnostics for `npm run dev` – never log credentials or session IDs.
    const logged = method === "Core/Login" ? { username: params.username } : params;
    // Responses of these methods can contain passwords – log only their size.
    const sensitive = /Login|Settings|Config|FileManager/.test(method);
    const body = sensitive ? `(${text.length} bytes)` : text.slice(0, 500);
    console.log(`[AMP] ${scope} ${method} ${JSON.stringify(logged)} -> ${response.status} ${body}`);
  }
  if (response.status === 401 || response.status === 403) throw new UnauthorizedError("Unauthorized");
  if (!response.ok) throw new Error(`AMP returned ${response.status} ${response.statusText}`);

  let data: unknown = text ? JSON.parse(text) : null;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Json;
    // AMP reports errors as { Title, Message, StackTrace } with HTTP 200.
    const title = field(obj, "Title");
    if (typeof title === "string" && field(obj, "StackTrace") !== undefined) {
      const message = str(obj, "Message");
      if (/unauthori[sz]ed/i.test(title)) throw new UnauthorizedError(message);
      throw new Error(`${title}: ${message}`);
    }
    // Older AMP versions wrap results in { result: … }.
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0].toLowerCase() === "result") data = obj[keys[0]];
  }
  return data as T;
}

const sessions = new Map<string, string>();

async function login(scope: string): Promise<string> {
  const { username, password } = getPreferenceValues<Preferences>();
  const result = await rawCall<unknown>(scope, "Core/Login", {
    username: username.trim(),
    password,
    token: "",
    rememberMe: false,
  });
  const sessionId = str(result, "sessionID", "SessionId");
  if (!bool(result, "success", "Success") || !sessionId) {
    const reason = str(result, "resultReason", "ResultReason");
    throw new Error(`AMP login failed${reason ? `: ${reason}` : " – check username and password"}`);
  }
  sessions.set(scope, sessionId);
  await LocalStorage.setItem(`session:${scope}`, sessionId);
  return sessionId;
}

async function getSession(scope: string): Promise<string> {
  const cached = sessions.get(scope) ?? (await LocalStorage.getItem<string>(`session:${scope}`));
  if (cached) {
    sessions.set(scope, cached);
    return cached;
  }
  return login(scope);
}

/** Calls an AMP API method, logging in (again) when the session is missing or expired. */
export async function call<T>(scope: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rawCall<T>(scope, method, params, await getSession(scope));
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    return rawCall<T>(scope, method, params, await login(scope));
  }
}

/** Calls a method that returns an ActionResult and throws when AMP reports a failure. */
export async function action(scope: string, method: string, params: Record<string, unknown> = {}): Promise<void> {
  const result = await call<unknown>(scope, method, params);
  if (field(result, "Status") === false) throw new Error(str(result, "Reason") || `${method} failed`);
}

export async function fetchInstances(): Promise<Instance[]> {
  const targets = await call<unknown>(ADS, "ADSModule/GetInstances", { ForceIncludeSelf: false });
  const instances = (Array.isArray(targets) ? targets : [])
    .flatMap((t) => {
      const list = field(t, "AvailableInstances", "Instances");
      const targetId = str(t, "InstanceId", "InstanceID", "Id");
      return Array.isArray(list) ? list.map((raw) => normalizeInstance(raw, targetId)) : [];
    })
    .filter((i) => i.InstanceID && i.Module !== "ADS");
  const live = await Promise.all(instances.map(withLiveState));
  return live.sort((a, b) => a.FriendlyName.localeCompare(b.FriendlyName));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starting an ADS instance only launches AMP inside it, not the game server.
 * This starts the instance, waits until it is reachable and then starts the application.
 */
export async function startInstanceAndServer(instance: Instance, timeoutMs = 120_000): Promise<void> {
  await action(ADS, "ADSModule/StartInstance", { InstanceName: instance.InstanceName });

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await sleep(3000);
    const current = (await fetchInstances()).find((i) => i.InstanceID === instance.InstanceID);
    if (!current?.Running) continue;
    try {
      // The instance may accept connections a few seconds after it reports "running".
      await action(instance.InstanceID, "Core/Start");
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Instance did not come online in time");
}

interface SettingSpec {
  Name: string;
  Node: string;
  Category?: string;
  InputType?: string;
  CurrentValue?: unknown;
  Hidden?: boolean;
}

export interface ServerValue {
  label: string;
  value: string;
}

export interface ServerInfo {
  passwords: ServerValue[];
  settings: ServerValue[];
}

/** Settings that belong to AMP itself (Steam login, mail, backups …), not to the game server. */
const INTERNAL_SETTING = /steam|smtp|email|mail|login|ldap|oidc|webhook|backup|s3|twofactor|ads\b|remote/i;
const INTERESTING_SETTING =
  /server ?name|player|slot|max ?users|world|map|level|game ?mode|difficulty|motd|description/i;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Extracts per-role passwords from a JSON list like Enshrouded's userGroups ([{ name, password }]). */
function rolePasswords(value: unknown, source: string): ServerValue[] {
  let parsed = value;
  if (typeof value === "string") {
    if (!/password/i.test(value)) return [];
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const name = field(r, "name", "role");
      const password = field(r, "password");
      return { label: name ? `${source}: ${name}` : source, value: asText(password) };
    })
    .filter((r) => r.value !== "");
}

async function readInstanceFile(instanceId: string, path: string): Promise<string | undefined> {
  try {
    const result = await call<unknown>(instanceId, "FileManagerPlugin/ReadFileChunk", {
      Filename: path,
      Offset: 0,
      ChunkSize: 1024 * 1024,
    });
    const data =
      typeof result === "string"
        ? result
        : result && typeof result === "object"
          ? ((result as Record<string, unknown>).Result ?? (result as Record<string, unknown>).Data)
          : undefined;
    if (typeof data !== "string" || data === "") return undefined;
    const decoded = Buffer.from(data, "base64").toString("utf-8");
    return decoded.trimStart().startsWith("{") ? decoded : data;
  } catch {
    return undefined;
  }
}

/** Game server passwords and a few key settings of a running instance. */
export async function fetchServerInfo(instanceId: string): Promise<ServerInfo> {
  const spec = await call<unknown>(instanceId, "Core/GetSettingsSpec");
  const groups = spec && typeof spec === "object" ? Object.values(spec as Json) : [];
  const all = groups
    .flatMap((g) => (Array.isArray(g) ? g : []))
    .map((s): SettingSpec => ({
      Name: str(s, "Name", "DisplayName"),
      Node: str(s, "Node"),
      Category: str(s, "Category"),
      InputType: str(s, "InputType", "Type"),
      CurrentValue: field(s, "CurrentValue", "Value"),
      Hidden: bool(s, "Hidden", "IsHidden"),
    }))
    .filter((s) => s.Name && !INTERNAL_SETTING.test(`${s.Node} ${s.Category ?? ""}`));
  if (all[0]) logShape("SettingSpec", groups.flat()[0]);

  const passwords: ServerValue[] = [];
  for (const setting of all) {
    if (setting.InputType?.toLowerCase() === "password" && asText(setting.CurrentValue)) {
      passwords.push({ label: setting.Name, value: asText(setting.CurrentValue) });
    } else {
      passwords.push(...rolePasswords(setting.CurrentValue, setting.Name));
    }
  }

  // Enshrouded keeps role passwords only in its server JSON.
  if (passwords.length === 0) {
    for (const path of ["2278520/enshrouded_server.json", "enshrouded_server.json"]) {
      const content = await readInstanceFile(instanceId, path);
      if (!content) continue;
      try {
        const json = JSON.parse(content) as { userGroups?: unknown; password?: unknown };
        passwords.push(...rolePasswords(json.userGroups, "Role"));
        if (asText(json.password)) passwords.push({ label: "Server Password", value: asText(json.password) });
        break;
      } catch {
        // not JSON
      }
    }
  }

  const settings = all
    .filter(
      (s) =>
        !s.Hidden &&
        s.InputType?.toLowerCase() !== "password" &&
        INTERESTING_SETTING.test(s.Name) &&
        asText(s.CurrentValue) !== "",
    )
    .slice(0, 15)
    .map((s) => ({ label: s.Name, value: asText(s.CurrentValue) }));

  return { passwords, settings };
}

export async function fetchConsole(instanceId: string): Promise<ConsoleEntry[]> {
  const updates = await call<unknown>(instanceId, "Core/GetUpdates");
  const entries = field(updates, "ConsoleEntries", "Console", "Entries");
  return Array.isArray(entries) ? entries.map(normalizeConsoleEntry).filter((e) => e.Message !== "") : [];
}

/** AMP serialises dates as "/Date(1697040000000)/" or ISO strings. */
export function parseAmpDate(value: string): Date | undefined {
  if (!value) return undefined;
  const match = /\/Date\((-?\d+)/.exec(value);
  const date = match ? new Date(Number(match[1])) : /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

export const AppState = { Stopped: 0, Ready: 20, Failed: 100 } as const;

const STATES: Record<number, { label: string; color: Color }> = {
  [-1]: { label: "Undefined", color: Color.SecondaryText },
  0: { label: "Stopped", color: Color.SecondaryText },
  5: { label: "Pre-Start", color: Color.Yellow },
  7: { label: "Configuring", color: Color.Yellow },
  10: { label: "Starting", color: Color.Yellow },
  20: { label: "Running", color: Color.Green },
  30: { label: "Restarting", color: Color.Yellow },
  40: { label: "Stopping", color: Color.Yellow },
  45: { label: "Preparing Sleep", color: Color.Yellow },
  50: { label: "Sleeping", color: Color.Blue },
  60: { label: "Waiting", color: Color.Yellow },
  70: { label: "Installing", color: Color.Blue },
  75: { label: "Updating", color: Color.Blue },
  80: { label: "Awaiting Input", color: Color.Orange },
  100: { label: "Failed", color: Color.Red },
  200: { label: "Suspended", color: Color.Red },
  250: { label: "Maintenance", color: Color.Orange },
  999: { label: "Indeterminate", color: Color.SecondaryText },
};

export function stateInfo(instance: Instance): { label: string; color: Color; icon: Image.ImageLike } {
  if (instance.Suspended) {
    return { label: "Suspended", color: Color.Red, icon: { source: Icon.Pause, tintColor: Color.Red } };
  }
  if (!instance.Running) {
    return {
      label: "Instance Offline",
      color: Color.SecondaryText,
      icon: { source: Icon.Power, tintColor: Color.SecondaryText },
    };
  }
  const state = STATES[instance.AppState] ?? { label: `State ${instance.AppState}`, color: Color.SecondaryText };
  const icon =
    instance.AppState === AppState.Ready
      ? Icon.CircleFilled
      : instance.AppState === AppState.Failed
        ? Icon.XMarkCircle
        : instance.AppState === AppState.Stopped
          ? Icon.Circle
          : Icon.CircleProgress50;
  return { ...state, icon: { source: icon, tintColor: state.color } };
}

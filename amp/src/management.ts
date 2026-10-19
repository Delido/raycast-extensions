import {
  action,
  ADS,
  bool,
  call,
  field,
  fetchInstances,
  Instance,
  Json,
  logShape,
  num,
  parseAmpDate,
  str,
} from "./amp";

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ players */

export interface Player {
  id: string;
  name: string;
}

export async function fetchPlayers(instanceId: string): Promise<Player[]> {
  const users = await call<unknown>(instanceId, "Core/GetUserList");
  if (!users || typeof users !== "object") return [];
  if (Array.isArray(users)) {
    return users.map((u) => ({ id: str(u, "Id", "ID", "UID"), name: str(u, "Name", "Username") }));
  }
  return Object.entries(users as Json)
    .map(([id, name]) => ({ id, name: String(name ?? id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ backups */

export interface Backup {
  id: string;
  name: string;
  description: string;
  date?: Date;
  sizeBytes?: number;
  sticky: boolean;
  automatic: boolean;
  local: boolean;
  s3: boolean;
}

export async function fetchBackups(instanceId: string): Promise<Backup[]> {
  const raw = asArray(await call<unknown>(instanceId, "LocalFileBackupPlugin/GetBackups"));
  if (raw[0]) logShape("Backup", raw[0]);
  return raw
    .map((b) => ({
      id: str(b, "Id", "ID", "BackupId"),
      name: str(b, "Name", "Title") || "Backup",
      description: str(b, "Description"),
      date: parseAmpDate(str(b, "ModifiedDate", "CreatedDate", "StoredDate", "Timestamp", "Date")),
      sizeBytes: num(b, "TotalSize", "TotalSizeBytes", "Size", "SizeBytes"),
      sticky: bool(b, "Sticky", "IsSticky"),
      automatic: bool(b, "CreatedAutomatically", "WasCreatedAutomatically"),
      local: bool(b, "StoredLocally", "Local"),
      s3: bool(b, "StoredInS3", "S3"),
    }))
    .filter((b) => b.id)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

export function takeBackup(instanceId: string, title: string, description: string, sticky: boolean) {
  return action(instanceId, "LocalFileBackupPlugin/TakeBackup", {
    Title: title,
    Description: description,
    Sticky: sticky,
  });
}

export function restoreBackup(instanceId: string, backupId: string, deleteExistingData: boolean) {
  return action(instanceId, "LocalFileBackupPlugin/RestoreBackup", {
    BackupId: backupId,
    DeleteExistingData: deleteExistingData,
  });
}

export function deleteBackup(instanceId: string, backupId: string) {
  return action(instanceId, "LocalFileBackupPlugin/DeleteLocalBackup", { BackupId: backupId });
}

export function setBackupSticky(instanceId: string, backupId: string, sticky: boolean) {
  return action(instanceId, "LocalFileBackupPlugin/SetBackupSticky", { BackupId: backupId, Sticky: sticky });
}

/* ----------------------------------------------------------------- settings */

export interface Setting {
  node: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  inputType: string;
  value: string;
  options: { value: string; title: string }[];
  readOnly: boolean;
  placeholder: string;
  suffix: string;
}

function settingValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function settingOptions(value: unknown): { value: string; title: string }[] {
  if (Array.isArray(value)) return value.map((v) => ({ value: String(v), title: String(v) }));
  if (value && typeof value === "object") {
    return Object.entries(value as Json).map(([k, v]) => ({ value: k, title: String(v ?? k) }));
  }
  return [];
}

/** All visible settings of an instance, in AMP's own category order. */
export async function fetchSettings(instanceId: string): Promise<Setting[]> {
  const spec = await call<unknown>(instanceId, "Core/GetSettingsSpec");
  if (!spec || typeof spec !== "object") return [];
  const settings: Setting[] = [];
  for (const [group, list] of Object.entries(spec as Json)) {
    for (const s of asArray(list)) {
      if (bool(s, "Hidden", "IsHidden")) continue;
      const inputType = str(s, "InputType", "Type").toLowerCase();
      if (inputType === "hidden") continue;
      const [category, subcategory] = (str(s, "Category") || group).split(":");
      settings.push({
        node: str(s, "Node"),
        name: str(s, "Name", "DisplayName"),
        description: str(s, "Description"),
        category: category || group,
        subcategory: str(s, "Subcategory") || subcategory || "",
        inputType,
        value: settingValue(field(s, "CurrentValue", "Value")),
        options: settingOptions(field(s, "EnumValues", "Options")),
        readOnly: bool(s, "ReadOnly", "IsReadOnly"),
        placeholder: str(s, "Placeholder"),
        suffix: str(s, "Suffix"),
      });
    }
  }
  return settings.filter((s) => s.node && s.name);
}

export function setSetting(instanceId: string, node: string, value: string) {
  return action(instanceId, "Core/SetConfig", { node, value });
}

/* ----------------------------------------------------------------- schedule */

export interface ScheduledTask {
  id: string;
  name: string;
}

export interface Trigger {
  id: string;
  description: string;
  type: string;
  enabled: boolean;
  tasks: ScheduledTask[];
}

export async function fetchSchedule(instanceId: string): Promise<Trigger[]> {
  const data = await call<unknown>(instanceId, "Core/GetScheduleData");
  const methods = new Map(
    asArray(field(data, "AvailableMethods")).map((m) => [str(m, "Id", "ID"), str(m, "Name", "Description")]),
  );
  const triggers = asArray(field(data, "PopulatedTriggers", "Triggers"));
  if (triggers[0]) logShape("Trigger", triggers[0]);
  return triggers.map((t) => ({
    id: str(t, "Id", "ID"),
    description: str(t, "Description", "Name") || "Trigger",
    type: str(t, "Type", "TriggerType"),
    enabled: field(t, "Enabled", "IsEnabled") === undefined ? true : bool(t, "Enabled", "IsEnabled"),
    tasks: asArray(field(t, "Tasks")).map((task) => {
      const methodId = str(task, "MethodID", "MethodId", "Method");
      return {
        id: str(task, "Id", "ID"),
        name: str(task, "Name", "Description") || methods.get(methodId) || methodId || "Task",
      };
    }),
  }));
}

export function runTrigger(instanceId: string, triggerId: string) {
  return action(instanceId, "Core/RunEventTriggerImmediately", { triggerId });
}

export function setTriggerEnabled(instanceId: string, triggerId: string, enabled: boolean) {
  return action(instanceId, "Core/SetTriggerEnabled", { Id: triggerId, Enabled: enabled });
}

/* ------------------------------------------------------ instance management */

export function upgradeInstance(instance: Instance, restartIfRunning = true) {
  return action(ADS, "ADSModule/UpgradeInstance", {
    InstanceName: instance.InstanceName,
    RestartIfRunning: restartIfRunning,
  });
}

export function updateInstanceInfo(
  instance: Instance,
  info: { friendlyName: string; description: string; startOnBoot: boolean },
) {
  return action(ADS, "ADSModule/UpdateInstanceInfo", {
    InstanceId: instance.InstanceID,
    FriendlyName: info.friendlyName,
    Description: info.description,
    StartOnBoot: info.startOnBoot,
  });
}

export function setSuspended(instance: Instance, suspended: boolean) {
  return action(ADS, "ADSModule/SetInstanceSuspended", {
    InstanceName: instance.InstanceName,
    Suspended: suspended,
    SuspendReason: "",
  });
}

export function deleteInstance(instance: Instance) {
  return action(ADS, "ADSModule/DeleteInstance", { InstanceName: instance.InstanceName });
}

/* ------------------------------------------------------------- bulk actions */

async function defaultTargetId(): Promise<string> {
  const targets = asArray(await call<unknown>(ADS, "ADSModule/GetInstances", { ForceIncludeSelf: false }));
  const id = str(targets[0], "InstanceId", "InstanceID", "Id");
  if (!id) throw new Error("Could not determine the AMP controller (target) ID");
  return id;
}

export async function startAll() {
  return action(ADS, "ADSModule/StartAllInstances", { TargetADSInstance: await defaultTargetId() });
}

export async function stopAll() {
  return action(ADS, "ADSModule/StopAllInstances", { TargetADSInstance: await defaultTargetId() });
}

export async function upgradeAll(restartRunning: boolean) {
  return action(ADS, "ADSModule/UpgradeAllInstances", {
    TargetADSInstance: await defaultTargetId(),
    RestartRunning: restartRunning,
  });
}

/* ------------------------------------------------------------ create server */

export interface AppSummary {
  id: string;
  name: string;
  module: string;
  description: string;
  image?: string;
  tags: string[];
  author: string;
  deprecated: string;
}

/** AMP image sources look like "steam:427410" or "url:https://…". */
function imageUrl(source: string): string | undefined {
  const steam = /^steam:(\d+)$/.exec(source);
  if (steam) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steam[1]}/header.jpg`;
  const url = source.replace(/^url:/, "");
  return /^https?:\/\//.test(url) ? url : undefined;
}

export async function fetchApps(): Promise<AppSummary[]> {
  const raw = asArray(await call<unknown>(ADS, "ADSModule/GetSupportedAppSummaries"));
  if (raw[0]) logShape("AppSummary", raw[0]);
  return raw
    .filter((a) => !bool(a, "IsServiceSpec"))
    .map((a) => {
      const tags = field(a, "Tags", "Categories");
      return {
        id: str(a, "Id", "ID", "SpecId", "AppId"),
        name: str(a, "FriendlyName", "DisplayName", "Name"),
        module: str(a, "Module", "ModuleName"),
        description: str(a, "Description"),
        image: imageUrl(str(a, "DisplayImageSource", "ImageURL", "Image")),
        tags: Array.isArray(tags) ? tags.map(String) : [],
        author: str(a, "Author"),
        deprecated: str(a, "DeprecatedReason"),
      };
    })
    .filter((a) => a.id && a.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createServer(app: AppSummary, friendlyName: string, startOnBoot: boolean): Promise<void> {
  await action(ADS, "ADSModule/CreateInstanceFromSpec", {
    SpecId: app.id,
    TargetADSInstance: await defaultTargetId(),
    FriendlyName: friendlyName,
    StartOnBoot: startOnBoot,
  });
}

/** Waits for a newly created instance, starts it and triggers the game server installation. */
export async function installNewServer(friendlyName: string, timeoutMs = 180_000): Promise<Instance> {
  const deadline = Date.now() + timeoutMs;
  let instance: Instance | undefined;
  while (Date.now() < deadline) {
    instance = (await fetchInstances()).find((i) => i.FriendlyName === friendlyName);
    if (instance) break;
    await sleep(3000);
  }
  if (!instance) throw new Error("The new instance did not appear in time");

  if (!instance.Running) await action(ADS, "ADSModule/StartInstance", { InstanceName: instance.InstanceName });
  let lastError: unknown;
  while (Date.now() < deadline) {
    await sleep(3000);
    const current = (await fetchInstances()).find((i) => i.InstanceID === instance.InstanceID);
    if (!current?.Running) continue;
    try {
      await action(instance.InstanceID, "Core/UpdateApplication");
      return current;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The new instance did not start in time");
}

import { environment, LocalStorage } from "@raycast/api";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Sample } from "./stats";

export interface Target {
  id: string;
  host: string;
  label?: string;
  addedAt: number;
}

export type Status = "ok" | "degraded" | "down" | "unknown";

export interface TargetState {
  status: Status;
  route?: string;
  /** A different route seen once; becomes the route if it shows up again */
  pendingRoute?: string;
  lastCheck?: number;
  lastSample?: Sample;
  hosts: Record<string, string>;
  error?: string;
}

export type EventKind = "route" | "down" | "degraded" | "recovered" | "error";

export interface MonitorEvent {
  t: number;
  target: string;
  host: string;
  kind: EventKind;
  message: string;
  from?: string;
  to?: string;
}

const TARGETS_KEY = "targets";
const dataDir = () => environment.supportPath;
const historyDir = () => join(dataDir(), "history");
const historyFile = (id: string) => join(historyDir(), `${id}.jsonl`);
const eventsFile = () => join(dataDir(), "events.jsonl");

export async function getTargets(): Promise<Target[]> {
  const raw = await LocalStorage.getItem<string>(TARGETS_KEY);
  return raw ? (JSON.parse(raw) as Target[]) : [];
}

export async function saveTargets(targets: Target[]) {
  await LocalStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
}

export async function addTarget(host: string, label?: string): Promise<Target> {
  const targets = await getTargets();
  const existing = targets.find((t) => t.host.toLowerCase() === host.toLowerCase());
  if (existing) return existing;
  const target: Target = {
    id: `${host.replace(/[^a-z0-9.-]/gi, "_")}-${Date.now().toString(36)}`,
    host,
    label: label || undefined,
    addedAt: Date.now(),
  };
  await saveTargets([...targets, target]);
  return target;
}

export async function updateTarget(id: string, changes: Partial<Pick<Target, "host" | "label">>) {
  const targets = await getTargets();
  await saveTargets(targets.map((t) => (t.id === id ? { ...t, ...changes } : t)));
}

export async function removeTarget(id: string) {
  await saveTargets((await getTargets()).filter((t) => t.id !== id));
  await LocalStorage.removeItem(`state:${id}`);
  await rm(historyFile(id), { force: true });
}

export async function getState(id: string): Promise<TargetState> {
  const raw = await LocalStorage.getItem<string>(`state:${id}`);
  return raw ? (JSON.parse(raw) as TargetState) : { status: "unknown", hosts: {} };
}

export async function setState(id: string, state: TargetState) {
  await LocalStorage.setItem(`state:${id}`, JSON.stringify(state));
}

async function readLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const items: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line) as T);
    } catch {
      // skip a partially written line
    }
  }
  return items;
}

export async function appendSample(id: string, sample: Sample) {
  await mkdir(historyDir(), { recursive: true });
  await appendFile(historyFile(id), JSON.stringify(sample) + "\n");
}

export async function readSamples(id: string, sinceMs = 0): Promise<Sample[]> {
  const samples = await readLines<Sample>(historyFile(id));
  return sinceMs ? samples.filter((s) => s.t >= sinceMs) : samples;
}

export async function trimSamples(id: string, keepSinceMs: number) {
  const samples = await readLines<Sample>(historyFile(id));
  const kept = samples.filter((s) => s.t >= keepSinceMs);
  if (kept.length === samples.length) return;
  await writeFile(historyFile(id), kept.map((s) => JSON.stringify(s) + "\n").join(""));
}

export async function clearSamples(id: string) {
  await rm(historyFile(id), { force: true });
}

export async function appendEvent(event: MonitorEvent) {
  await mkdir(dataDir(), { recursive: true });
  await appendFile(eventsFile(), JSON.stringify(event) + "\n");
}

export async function readEvents(limit = 200, target?: string): Promise<MonitorEvent[]> {
  const events = await readLines<MonitorEvent>(eventsFile());
  return events
    .filter((e) => !target || e.target === target)
    .slice(-limit)
    .reverse();
}

export async function trimEvents(keepSinceMs: number) {
  const events = await readLines<MonitorEvent>(eventsFile());
  const kept = events.filter((e) => e.t >= keepSinceMs);
  if (kept.length !== events.length) await writeFile(eventsFile(), kept.map((e) => JSON.stringify(e) + "\n").join(""));
}

export function reportPath(): string {
  return join(dataDir(), "report.html");
}

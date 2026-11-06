import { environment, getPreferenceValues, LaunchType, launchCommand, LocalStorage } from "@raycast/api";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { timersPath } from "./paths";
import { Issue } from "./jira";
import { ProjectRef, TaskRef } from "./moco";
import { ensureTray } from "./tray";

export interface Segment {
  start: number;
  end?: number;
}

export interface Timer {
  id: string;
  /** Jira issue; a timer without one is booked to MOCO only until an issue is assigned */
  issue?: Issue;
  /** Name of a timer without issue */
  title?: string;
  /** MOCO project/task chosen for a timer without issue */
  project?: ProjectRef;
  task?: TaskRef;
  segments: Segment[];
  /** Manual correction in ms (Set Time) */
  offsetMs: number;
  note: string;
  /** Last start, resume or pause: the toggle command resumes the most recent one */
  touched: number;
}

/*
 * Timers live in <supportPath>/timers.json, shared with the tray icon (tray/state.go).
 * Changes are made under <file>.lock and written to a temp file that replaces the original,
 * so neither side ever reads half a file or loses the other's change.
 */

interface StateFile {
  version: number;
  singleRunning: boolean;
  timers: Timer[];
  [key: string]: unknown;
}

/** Where timers were kept before the tray icon existed */
const LEGACY_KEY = "timers";

export { timersPath };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

async function readStateFile(): Promise<StateFile | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      const state = JSON.parse(await readFile(timersPath(), "utf8")) as StateFile;
      return { ...state, timers: Array.isArray(state.timers) ? state.timers : [] };
    } catch (error) {
      if (code(error) === "ENOENT") return undefined;
      if (attempt >= 5) throw error;
      await sleep(30);
    }
  }
}

async function writeStateFile(state: StateFile): Promise<void> {
  await mkdir(environment.supportPath, { recursive: true });
  const tmp = `${timersPath()}.raycast.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  // The tray may be reading the file right now: retry the replace briefly
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(tmp, timersPath());
    } catch (error) {
      if (attempt >= 20) throw error;
      await sleep(25);
    }
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(environment.supportPath, { recursive: true });
  const lock = `${timersPath()}.lock`;
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      await (await open(lock, "wx")).close();
      break;
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
      const age = await stat(lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > 5000) {
        await unlink(lock).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) throw new Error("The timer file is locked, try again");
      await sleep(20);
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lock).catch(() => undefined);
  }
}

/** Takes over timers from LocalStorage once. */
async function migrate(): Promise<Timer[]> {
  const raw = await LocalStorage.getItem<string>(LEGACY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Timer[];
  } catch {
    return [];
  }
}

export async function loadTimers(): Promise<Timer[]> {
  const state = await readStateFile();
  if (state) return state.timers;
  const legacy = await migrate();
  if (legacy.length) await update((timers) => timers);
  return legacy;
}

async function update(fn: (timers: Timer[]) => Timer[]): Promise<Timer[]> {
  const timers = await withLock(async () => {
    const state = (await readStateFile()) ?? { version: 1, singleRunning: true, timers: await migrate() };
    const next = { ...state, version: 1, singleRunning: singleRunning(), timers: fn(state.timers) };
    await writeStateFile(next);
    return next.timers;
  });
  await LocalStorage.removeItem(LEGACY_KEY);
  // Refresh the status shown under "Pause or Resume Timer" in the root search
  launchCommand({ name: "toggle-timer", type: LaunchType.Background }).catch(() => undefined);
  ensureTray().catch(() => undefined);
  return timers;
}

/** Issue key, or the name of a timer without issue */
export function timerLabel(timer: Timer): string {
  return timer.issue?.key ?? (timer.title?.trim() || "Timer without issue");
}

export function isRunning(timer: Timer): boolean {
  const last = timer.segments[timer.segments.length - 1];
  return !!last && last.end === undefined;
}

export function elapsedMs(timer: Timer, now = Date.now()): number {
  const raw = timer.segments.reduce((sum, s) => sum + ((s.end ?? now) - s.start), 0);
  return Math.max(0, raw + timer.offsetMs);
}

export function startedAt(timer: Timer): Date {
  return new Date(timer.segments[0]?.start ?? Date.now());
}

function pause(timer: Timer, now: number): Timer {
  if (!isRunning(timer)) return timer;
  const segments = timer.segments.slice();
  segments[segments.length - 1] = { ...segments[segments.length - 1], end: now };
  return { ...timer, segments, touched: now };
}

function resume(timer: Timer, now: number): Timer {
  if (isRunning(timer)) return timer;
  return { ...timer, segments: [...timer.segments, { start: now }], touched: now };
}

function singleRunning(): boolean {
  return getPreferenceValues<Preferences>().singleRunning !== false;
}

/** Starts a timer for the issue, or resumes the existing one. */
export function startTimer(issue: Issue): Promise<Timer[]> {
  const now = Date.now();
  return update((timers) => {
    const others = singleRunning() ? timers.map((t) => (t.issue?.key === issue.key ? t : pause(t, now))) : timers;
    const existing = others.find((t) => t.issue?.key === issue.key);
    if (existing) return others.map((t) => (t.id === existing.id ? resume({ ...t, issue }, now) : t));
    const timer: Timer = {
      id: `${issue.key}-${now}`,
      issue,
      segments: [{ start: now }],
      offsetMs: 0,
      note: "",
      touched: now,
    };
    return [timer, ...others];
  });
}

/** Starts a new timer without Jira issue. */
export function startFreeTimer(input: { title: string; note?: string; project?: ProjectRef; task?: TaskRef }) {
  const now = Date.now();
  return update((timers) => {
    const timer: Timer = {
      id: `free-${now}`,
      title: input.title.trim(),
      project: input.project,
      task: input.task,
      segments: [{ start: now }],
      offsetMs: 0,
      note: input.note?.trim() ?? "",
      touched: now,
    };
    return [timer, ...(singleRunning() ? timers.map((t) => pause(t, now)) : timers)];
  });
}

export function updateFreeTimer(
  id: string,
  input: { title: string; note: string; project?: ProjectRef; task?: TaskRef },
): Promise<Timer[]> {
  return update((timers) =>
    timers.map((t) =>
      t.id === id
        ? { ...t, title: input.title.trim(), note: input.note.trim(), project: input.project, task: input.task }
        : t,
    ),
  );
}

/**
 * Gives a timer without issue its Jira issue. If that issue already has a timer,
 * both are merged into it (time and notes), so nothing is booked twice.
 */
export function assignIssue(id: string, issue: Issue): Promise<Timer[]> {
  return update((timers) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer) return timers;
    const target = timers.find((t) => t.id !== id && t.issue?.key === issue.key);
    const note = [timer.title, timer.note].filter(Boolean).join(": ");
    if (!target) {
      return timers.map((t) => (t.id === id ? { ...t, issue, note, title: undefined } : t));
    }
    // Both may be running: keep one open segment at most
    const now = Date.now();
    const a = isRunning(target) && isRunning(timer) ? pause(timer, now) : timer;
    const merged: Timer = {
      ...target,
      issue,
      segments: [...target.segments, ...a.segments].sort((x, y) => x.start - y.start),
      offsetMs: target.offsetMs + a.offsetMs,
      note: [target.note, note].filter(Boolean).join("\n"),
      touched: Math.max(target.touched, a.touched),
    };
    // An open segment must be the last one
    const open = merged.segments.filter((s) => s.end === undefined);
    merged.segments = [...merged.segments.filter((s) => s.end !== undefined), ...open.slice(0, 1)];
    return timers.filter((t) => t.id !== id).map((t) => (t.id === target.id ? merged : t));
  });
}

export function resumeTimer(id: string): Promise<Timer[]> {
  const now = Date.now();
  return update((timers) => timers.map((t) => (t.id === id ? resume(t, now) : singleRunning() ? pause(t, now) : t)));
}

export function pauseTimer(id: string): Promise<Timer[]> {
  const now = Date.now();
  return update((timers) => timers.map((t) => (t.id === id ? pause(t, now) : t)));
}

export function pauseAll(): Promise<Timer[]> {
  const now = Date.now();
  return update((timers) => timers.map((t) => pause(t, now)));
}

export function removeTimer(id: string): Promise<Timer[]> {
  return update((timers) => timers.filter((t) => t.id !== id));
}

export function setNote(id: string, note: string): Promise<Timer[]> {
  return update((timers) => timers.map((t) => (t.id === id ? { ...t, note } : t)));
}

/** Corrects the timer so that it shows `targetMs` right now. */
export function setElapsed(id: string, targetMs: number): Promise<Timer[]> {
  const now = Date.now();
  return update((timers) =>
    timers.map((t) => (t.id === id ? { ...t, offsetMs: t.offsetMs + targetMs - elapsedMs(t, now) } : t)),
  );
}

/** Running timers first, then by last activity. */
export function sortTimers(timers: Timer[]): Timer[] {
  return timers.slice().sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || b.touched - a.touched);
}

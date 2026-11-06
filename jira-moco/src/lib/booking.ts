import { getPreferenceValues, LocalStorage } from "@raycast/api";
import { Config, issueUrl } from "./config";
import { addWorklog, deleteWorklog, Issue } from "./jira";
import { createActivity, deleteActivity, ProjectRef, TaskRef } from "./moco";
import { isoDate } from "./time";

export type TargetState = "done" | "failed" | "skipped" | "undone";

export interface Target<Id> {
  state: TargetState;
  id?: Id;
  error?: string;
}

export interface Booking {
  id: string;
  created: number;
  /** Missing for time booked without Jira issue (MOCO only) */
  issue?: Pick<Issue, "key" | "summary" | "id">;
  /** Name of a timer without issue */
  title?: string;
  started: number;
  seconds: number;
  description: string;
  project?: ProjectRef;
  task?: TaskRef;
  billable: boolean;
  jira: Target<string>;
  moco: Target<number>;
}

export interface BookingInput {
  issue?: Issue;
  title?: string;
  started: Date;
  seconds: number;
  description: string;
  toJira: boolean;
  toMoco: boolean;
  project?: ProjectRef;
  task?: TaskRef;
  billable: boolean;
}

/** Issue key, or the name of time booked without issue */
export function bookingLabel(b: Booking): string {
  return b.issue?.key ?? (b.title?.trim() || "Without issue");
}

const KEY = "bookings";
const MAX = 300;

export async function loadBookings(): Promise<Booking[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  try {
    return raw ? (JSON.parse(raw) as Booking[]) : [];
  } catch {
    return [];
  }
}

async function upsert(booking: Booking): Promise<void> {
  const list = (await loadBookings()).filter((b) => b.id !== booking.id);
  list.unshift(booking);
  list.sort((a, b) => b.started - a.started);
  await LocalStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export async function removeBooking(id: string): Promise<void> {
  await LocalStorage.setItem(KEY, JSON.stringify((await loadBookings()).filter((b) => b.id !== id)));
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function bookJira(config: Config, b: Booking): Promise<Target<string>> {
  if (!b.issue) return { state: "skipped" };
  try {
    const id = await addWorklog(config, b.issue.key, {
      started: new Date(b.started),
      seconds: b.seconds,
      comment: b.description,
      notify: getPreferenceValues<Preferences>().notifyWatchers === true,
    });
    return { state: "done", id };
  } catch (error) {
    return { state: "failed", error: message(error) };
  }
}

async function bookMoco(config: Config, b: Booking): Promise<Target<number>> {
  if (!b.project || !b.task) return { state: "failed", error: "No MOCO project or task chosen" };
  try {
    const id = await createActivity(config.moco!, {
      date: isoDate(new Date(b.started)),
      projectId: b.project.id,
      taskId: b.task.id,
      seconds: b.seconds,
      description: b.description,
      billable: b.billable,
      issueKey: b.issue?.key,
      issueUrl: b.issue ? issueUrl(config, b.issue.key) : undefined,
    });
    return { state: "done", id };
  } catch (error) {
    return { state: "failed", error: message(error) };
  }
}

/** Books to Jira and MOCO and records the result, also when one side fails (it can be retried later). */
export async function book(config: Config, input: BookingInput): Promise<Booking> {
  const booking: Booking = {
    id: `${input.issue?.key ?? "free"}-${Date.now()}`,
    created: Date.now(),
    issue: input.issue ? { key: input.issue.key, summary: input.issue.summary, id: input.issue.id } : undefined,
    title: input.issue ? undefined : input.title,
    started: input.started.getTime(),
    seconds: input.seconds,
    description: input.description,
    project: input.project,
    task: input.task,
    billable: input.billable,
    jira: { state: "skipped" },
    moco: { state: "skipped" },
  };
  const [jira, moco] = await Promise.all([
    input.toJira && input.issue ? bookJira(config, booking) : Promise.resolve<Target<string>>({ state: "skipped" }),
    input.toMoco ? bookMoco(config, booking) : Promise.resolve<Target<number>>({ state: "skipped" }),
  ]);
  booking.jira = jira;
  booking.moco = moco;
  if (jira.state === "done" || moco.state === "done") await upsert(booking);
  return booking;
}

/** Books the sides that failed before. */
export async function retry(config: Config, booking: Booking): Promise<Booking> {
  const next = { ...booking };
  if (booking.jira.state === "failed") next.jira = await bookJira(config, booking);
  if (booking.moco.state === "failed") next.moco = await bookMoco(config, booking);
  await upsert(next);
  return next;
}

/** Deletes the worklog and the MOCO activity again. */
export async function undo(config: Config, booking: Booking): Promise<Booking> {
  const next = { ...booking };
  if (booking.jira.state === "done" && booking.jira.id && booking.issue) {
    try {
      await deleteWorklog(config, booking.issue.key, booking.jira.id);
      next.jira = { state: "undone" };
    } catch (error) {
      next.jira = { ...booking.jira, error: message(error) };
    }
  }
  if (booking.moco.state === "done" && booking.moco.id) {
    try {
      await deleteActivity(config.moco!, booking.moco.id);
      next.moco = { state: "undone" };
    } catch (error) {
      next.moco = { ...booking.moco, error: message(error) };
    }
  }
  await upsert(next);
  return next;
}

export function failedParts(b: Booking): string[] {
  return [b.jira.state === "failed" ? "Jira" : "", b.moco.state === "failed" ? "MOCO" : ""].filter(Boolean);
}

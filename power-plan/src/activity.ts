import { LocalStorage } from "@raycast/api";

/* Small log of what the automation did, shown in "Power Plans". */

export type ActivityKind = "game" | "idle" | "switch" | "external" | "restore" | "manual" | "error";

export interface Activity {
  t: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
}

const KEY = "activity";
const MAX = 50;

export async function getActivity(): Promise<Activity[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  return raw ? (JSON.parse(raw) as Activity[]) : [];
}

export async function addActivity(kind: ActivityKind, text: string, detail?: string) {
  const list = await getActivity();
  list.unshift({ t: Date.now(), kind, text, detail });
  await LocalStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export async function clearActivity() {
  await LocalStorage.removeItem(KEY);
}

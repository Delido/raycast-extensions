import { getPreferenceValues } from "@raycast/api";

/* Audio output switching via the companion helper (port 3010, same API as the old SignalCompanion). */

export interface AudioDevice {
  id: string;
  name: string;
  default: boolean;
  in_rotation?: boolean;
}

function companionUrl(): string {
  const { companionUrl } = getPreferenceValues<Preferences>();
  return (companionUrl || "http://127.0.0.1:3010").trim().replace(/\/+$/, "");
}

async function call<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${companionUrl()}${path}`);
  } catch {
    throw new Error("Companion service is not running (audio switching not reachable).");
  }
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!response.ok || json.ok === false) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json;
}

export async function getAudioDevices(): Promise<AudioDevice[]> {
  return (await call<{ devices: AudioDevice[] }>("/devices")).devices;
}

export async function getCurrentAudioDevice(): Promise<AudioDevice | undefined> {
  return (await call<{ current?: AudioDevice }>("/current")).current;
}

export async function setAudioDevice(id: string): Promise<void> {
  await call(`/set?id=${encodeURIComponent(id)}`);
}

export async function nextAudioDevice(): Promise<void> {
  await call("/next");
}

/** "Kopfhörer (CORSAIR VIRTUOSO XT Wireless Gaming Receiver)" -> name and hardware part */
export function splitDeviceName(name: string): { title: string; subtitle?: string } {
  const match = name.match(/^(.*?)\s*\((.*)\)$/);
  return match ? { title: match[1], subtitle: match[2] } : { title: name };
}

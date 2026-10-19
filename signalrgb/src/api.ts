import { getPreferenceValues, Keyboard } from "@raycast/api";

/* Official SignalRGB local REST API: https://docs.signalrgb.com/developer/signalrgb-api/introduction/ */

export interface LightingState {
  enabled: boolean;
  global_brightness: number;
  name: string;
}

export interface Effect {
  id: string;
  name: string;
  applyPath: string;
}

export interface EffectNameResult {
  id: string;
  name: string;
}

interface ApiError {
  title?: string;
  detail?: string;
}

export function getApiUrl(): string {
  const { apiUrl } = getPreferenceValues<Preferences>();
  return (apiUrl || "http://127.0.0.1:16038").trim().replace(/\/+$/, "");
}

export async function request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: object): Promise<T> {
  const url = `${getApiUrl()}${path.startsWith("/api/") ? path : `/api/v1/${path}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("SignalRGB is not running (API not reachable).");
  }
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    if (response.status === 403) throw new Error("This needs SignalRGB Pro and a signed-in account.");
    const error = (json.errors as ApiError[] | undefined)?.[0];
    throw new Error(error?.detail || error?.title || `${response.status} ${response.statusText}`);
  }
  return json.data as T;
}

export async function getLighting(): Promise<LightingState> {
  const data = await request<{ attributes: LightingState }>("GET", "lighting");
  return data.attributes;
}

export async function getEffects(): Promise<Effect[]> {
  const data = await request<{ items: { id: string; attributes: { name: string }; links: { apply: string } }[] }>(
    "GET",
    "lighting/effects",
  );
  return data.items
    .map((item) => ({ id: item.id, name: item.attributes.name, applyPath: item.links.apply }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function applyEffect(effect: Effect): Promise<void> {
  await request("POST", effect.applyPath);
}

export async function stepEffect(direction: "next" | "previous" | "shuffle"): Promise<EffectNameResult> {
  const data = await request<{ id: string; attributes: { name: string } }>("POST", `lighting/${direction}`);
  return { id: data.id, name: data.attributes.name };
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await request("PATCH", "lighting/enabled", { enabled });
}

export async function setBrightness(brightness: number): Promise<void> {
  await request("PATCH", "lighting/global_brightness", { global_brightness: brightness });
}

export async function getPresets(effectId: string): Promise<string[]> {
  const data = await request<{ items: { id: string }[] }>("GET", `lighting/effects/${effectId}/presets`);
  return data.items.map((item) => item.id);
}

export async function applyPreset(effectId: string, preset: string): Promise<void> {
  await request("PATCH", `lighting/effects/${effectId}/presets`, { preset });
}

export async function getLayouts(): Promise<{ layouts: string[]; current: string }> {
  const [all, current] = await Promise.all([
    request<{ items: { id: string }[] }>("GET", "scenes/layouts"),
    request<{ current_layout: { id: string } }>("GET", "scenes/current_layout"),
  ]);
  return { layouts: all.items.map((item) => item.id), current: current.current_layout.id };
}

export async function setLayout(layout: string): Promise<void> {
  await request("PATCH", "scenes/current_layout", { layout });
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut {
  return {
    macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
    Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
  };
}

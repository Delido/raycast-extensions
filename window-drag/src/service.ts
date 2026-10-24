import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* Control of assets/drag-helper.exe (source in helper/), which holds the global mouse hook. */

const API = "http://127.0.0.1:3011";
const configPath = () => join(environment.supportPath, "config.json");

export interface DragStatus {
  version: string;
  pid: number;
  enabled: boolean;
  paused: boolean;
  moves: number;
}

export async function getStatus(): Promise<DragStatus | undefined> {
  try {
    const res = await fetch(`${API}/status`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()) as DragStatus;
  } catch {
    return undefined;
  }
}

export async function writeConfig(prefs: Preferences.WindowDragService) {
  const config = {
    enabled: true,
    modifier: prefs.modifier || "alt",
    moveButton: prefs.moveButton || "right",
    resizeButton: prefs.resizeButton || "middle",
    snap: Number(prefs.snap ?? 15) || 0,
    raise: prefs.raise !== false,
    skipFullscreen: prefs.skipFullscreen !== false,
    exclude: (prefs.exclude ?? "")
      .split(/[,;\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  };
  const text = JSON.stringify(config, null, 2);
  await mkdir(environment.supportPath, { recursive: true });
  if ((await readFile(configPath(), "utf8").catch(() => "")) !== text) await writeFile(configPath(), text);
}

/** Starts the helper detached, so it keeps running after the Raycast command ends. */
export async function startHelper() {
  await new Promise<void>((resolve, reject) =>
    execFile(
      join(environment.assetsPath, "drag-helper.exe"),
      ["launch", "-config", configPath(), "-data", environment.supportPath],
      { windowsHide: true, timeout: 10000 },
      (error) => (error ? reject(error) : resolve()),
    ),
  );
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await getStatus()) return;
  }
  throw new Error("Window Drag did not start");
}

export async function togglePause(): Promise<DragStatus> {
  const res = await fetch(`${API}/pause`, { signal: AbortSignal.timeout(1500) });
  return (await res.json()) as DragStatus;
}

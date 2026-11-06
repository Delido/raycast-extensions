import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { timersPath, trayDir, trayExe } from "./paths";

/*
 * Control of assets/jira-moco-tray.exe (source in tray/): the notification-area icon that
 * shows the running timer. It is started detached and checks the timer file every second;
 * "tray-off" in its folder makes it quit and keeps it from being started again.
 */

export const traySupported = () => process.platform === "win32" && existsSync(trayExe());

const offFile = () => join(trayDir(), "tray-off");

export function isTrayHidden(): boolean {
  return existsSync(offFile());
}

/** The tray writes a heartbeat every 10 s. */
async function isTrayAlive(): Promise<boolean> {
  try {
    const { beat } = JSON.parse(await readFile(join(trayDir(), "tray.json"), "utf8")) as { beat?: number };
    return !!beat && Date.now() - beat < 30_000;
  } catch {
    return false;
  }
}

/** Starts the tray icon unless it runs already or was hidden. */
export async function ensureTray(): Promise<void> {
  if (!traySupported() || isTrayHidden() || (await isTrayAlive())) return;
  await mkdir(trayDir(), { recursive: true });
  const deeplink = `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/`;
  await new Promise<void>((resolve, reject) => {
    execFile(
      trayExe(),
      ["launch", "-state", timersPath(), "-data", trayDir(), "-deeplink", deeplink],
      { windowsHide: true, timeout: 10000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

export async function showTray(): Promise<void> {
  await unlink(offFile()).catch(() => undefined);
  await ensureTray();
}

/** The tray sees the flag within a second and quits. */
export async function hideTray(): Promise<void> {
  await mkdir(trayDir(), { recursive: true });
  await writeFile(offFile(), "hidden in Raycast\n");
}

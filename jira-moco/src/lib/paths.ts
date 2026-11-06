import { environment } from "@raycast/api";
import { join } from "node:path";

/** Timer state shared with the tray icon */
export const timersPath = () => join(environment.supportPath, "timers.json");

/** Log, heartbeat and "hidden" flag of the tray icon */
export const trayDir = () => join(environment.supportPath, "tray");

export const trayExe = () => join(environment.assetsPath, "jira-moco-tray.exe");

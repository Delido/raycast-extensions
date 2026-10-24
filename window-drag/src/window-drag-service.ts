import { environment, getPreferenceValues, LaunchType, showHUD, updateCommandMetadata } from "@raycast/api";
import { getStatus, startHelper, writeConfig } from "./service";

const KEYS: Record<string, string> = { alt: "Alt", win: "Win", ctrl: "Ctrl", shift: "Shift" };
const BUTTONS: Record<string, string> = { left: "left", right: "right", middle: "middle" };

/** Runs every minute: syncs the settings and restarts the helper if it isn't running. */
export default async function WindowDragService() {
  const prefs = getPreferenceValues<Preferences.WindowDragService>();
  const manual = environment.launchType === LaunchType.UserInitiated;
  await writeConfig(prefs);
  let status = await getStatus();
  if (!status) {
    try {
      await startHelper();
      status = await getStatus();
    } catch (error) {
      await updateCommandMetadata({ subtitle: "Not running" });
      if (manual) await showHUD(`Window Drag: ${(error as Error).message}`);
      return;
    }
  }
  const combo = `${KEYS[prefs.modifier ?? "alt"] ?? "Alt"} + ${BUTTONS[prefs.moveButton ?? "right"] ?? "right"} drag`;
  await updateCommandMetadata({ subtitle: status?.paused ? "Paused" : combo });
  if (manual) await showHUD(status?.paused ? "Window Drag is paused" : `Window Drag running · ${combo}`);
}

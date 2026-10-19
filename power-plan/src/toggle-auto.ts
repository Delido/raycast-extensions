import { showHUD } from "@raycast/api";
import { resetAutoState } from "./auto";
import { getSettings, updateSettings } from "./settings";

export default async function ToggleAuto() {
  const settings = await getSettings();
  await updateSettings({ enabled: !settings.enabled, pausedUntil: undefined });
  await resetAutoState();
  await showHUD(settings.enabled ? "⏸ Automatic power plan off" : "▶️ Automatic power plan on");
}

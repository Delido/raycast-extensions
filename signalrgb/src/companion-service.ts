import {
  environment,
  getPreferenceValues,
  LaunchType,
  LocalStorage,
  showHUD,
  updateCommandMetadata,
} from "@raycast/api";
import { notify } from "./notify";
import { getServiceStatus, startService, writeServiceConfig } from "./service";

const ALERT_KEY = "battery-alert-count";
const ALERT_PID_KEY = "battery-alert-pid";

/** Runs every minute: keeps the helper alive, syncs its settings and shows battery and mic state. */
export default async function CompanionService() {
  const prefs = getPreferenceValues<Preferences.CompanionService>();
  const manual = environment.launchType === LaunchType.UserInitiated;

  await writeServiceConfig(prefs);
  let status = await getServiceStatus();
  if (!status) {
    try {
      await startService();
      status = await getServiceStatus();
    } catch (error) {
      await updateCommandMetadata({ subtitle: "Not running" });
      if (manual) await showHUD(`Companion service: ${(error as Error).message}`);
      return;
    }
  }
  if (!status) return;

  const { headset } = status;
  const parts: string[] = [];
  if (headset.battery !== null) parts.push(`🎧 ${headset.battery}%`);
  if (headset.windowsMuted !== null) parts.push(headset.windowsMuted ? "🔇 muted" : "🎤 live");
  if (status.cs2.gameRunning) parts.push("CS2");
  await updateCommandMetadata({ subtitle: parts.join(" · ") || "Running" });

  // The helper plays the alert sound itself; optionally add a Windows notification.
  if (prefs.batteryNotify) {
    const lastPid = Number((await LocalStorage.getItem<string>(ALERT_PID_KEY)) ?? 0);
    const lastCount = lastPid === status.pid ? Number((await LocalStorage.getItem<string>(ALERT_KEY)) ?? 0) : 0;
    if (headset.alertCount > lastCount && headset.battery !== null) {
      await notify("🪫 Headset battery low", `${headset.name}: ${headset.battery}%`, { style: "system" });
    }
    await LocalStorage.setItem(ALERT_KEY, String(headset.alertCount));
    await LocalStorage.setItem(ALERT_PID_KEY, String(status.pid));
  }

  if (manual) await showHUD(`Companion service running · ${parts.join(" · ")}`);
}

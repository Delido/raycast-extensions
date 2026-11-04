import { environment, LaunchType, showHUD } from "@raycast/api";
import { lock, lockIfExpired } from "./lib/vault";

/**
 * Manual: locks now. In the background (every minute): only removes a session whose auto-lock time
 * has passed, so the decrypted UniFi key does not stay in storage while LAPS Connect is not used.
 */
export default async function Lock() {
  if (environment.launchType === LaunchType.Background) {
    await lockIfExpired();
    return;
  }
  await lock();
  await showHUD("🔒 LAPS Connect locked");
}

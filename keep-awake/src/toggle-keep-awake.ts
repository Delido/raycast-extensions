import { getPreferenceValues, showHUD } from "@raycast/api";
import { formatUntil, getState, start, stop } from "./lib/awake";

export default async function Command() {
  if (getState()) {
    stop();
    await showHUD("Keep Awake off");
    return;
  }
  const { defaultDuration } = getPreferenceValues<Preferences>();
  try {
    const state = await start(Number(defaultDuration || "0"));
    await showHUD(`☕ Keep Awake ${formatUntil(state)}${state.teams ? " · Teams available" : ""}`);
  } catch (e) {
    await showHUD(`Keep Awake failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

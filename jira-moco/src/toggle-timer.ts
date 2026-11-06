import { environment, LaunchType, showHUD, updateCommandMetadata } from "@raycast/api";
import { clock } from "./lib/time";
import { ensureTray } from "./lib/tray";
import { elapsedMs, isRunning, loadTimers, pauseTimer, resumeTimer, sortTimers, Timer, timerLabel } from "./lib/timers";

function status(timers: Timer[]): string | null {
  const running = timers.filter(isRunning);
  if (running.length) {
    const more = running.length > 1 ? ` +${running.length - 1}` : "";
    return `▶ ${timerLabel(running[0])} ${clock(elapsedMs(running[0])).replace(/:\d\d$/, "")}${more}`;
  }
  return timers.length ? `⏸ ${timers.length} paused` : null;
}

/**
 * Started by the user: pauses the running timer, or resumes the one used last.
 * Started in the background (every minute, or after a timer change): updates the subtitle
 * and starts the tray icon if it isn't running.
 */
export default async function Command() {
  let timers = await loadTimers();
  if (environment.launchType === LaunchType.UserInitiated) {
    const sorted = sortTimers(timers);
    const running = sorted.find(isRunning);
    if (running) {
      timers = await pauseTimer(running.id);
      await showHUD(`⏸ Paused ${timerLabel(running)} at ${clock(elapsedMs(running))}`);
    } else if (sorted[0]) {
      timers = await resumeTimer(sorted[0].id);
      await showHUD(`▶ Resumed ${timerLabel(sorted[0])}`);
    } else {
      await showHUD("No timer yet: start one in Track Time");
    }
  }
  await updateCommandMetadata({ subtitle: status(timers) });
  // Watchdog: brings the tray icon back after a restart or crash
  await ensureTray().catch(() => undefined);
}

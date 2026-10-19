import {
  environment,
  getPreferenceValues,
  LaunchType,
  LocalStorage,
  showHUD,
  updateCommandMetadata,
} from "@raycast/api";
import { addActivity } from "./activity";
import { getStatus, planName, setPlan } from "./helper";
import { reportGameToCompanion } from "./companion";
import { notify } from "./notify";
import { detectGames, displayName, gamePlanOf, getSettings, idlePlanOf, isPaused } from "./settings";

type Mode = "game" | "idle";

interface AutoState {
  mode?: Mode;
  lastGameSeen?: number;
  lastGame?: string;
  /** Active plan at the end of the previous run, to notice changes made by other programs */
  lastActive?: string;
}

const STATE_KEY = "auto-state";

export async function getAutoState(): Promise<AutoState> {
  const raw = await LocalStorage.getItem<string>(STATE_KEY);
  return raw ? (JSON.parse(raw) as AutoState) : {};
}

/** Forget the last decision, so the next run applies the plan again. */
export async function resetAutoState() {
  await LocalStorage.removeItem(STATE_KEY);
}

export default async function Auto() {
  const prefs = getPreferenceValues<Preferences.Auto>();
  const manual = environment.launchType === LaunchType.UserInitiated;
  const settings = await getSettings();
  const status = await getStatus();
  const games = detectGames(status, settings);
  // Keyboard game mode in the SignalRGB extension follows this detection, also while the plan automation is off.
  await reportGameToCompanion(games.length > 0 ? displayName(games[0].process) : undefined);

  if (!settings.enabled) {
    await updateCommandMetadata({ subtitle: "Off" });
    if (manual) await showHUD("Automatic power plan is off");
    return;
  }
  if (isPaused(settings)) {
    const until = new Date(settings.pausedUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    await updateCommandMetadata({ subtitle: `Paused until ${until}` });
    if (manual) await showHUD(`Automatic power plan paused until ${until}`);
    return;
  }

  const state = await getAutoState();
  const now = Date.now();
  const cooldownMs = Math.max(0, Number(prefs.cooldown) || 0) * 1000;
  const name = (guid?: string) => planName(status.plans, guid);

  if (state.lastActive && status.active !== state.lastActive) {
    await addActivity(
      "external",
      `Plan changed by another program: ${name(status.active)}`,
      `was ${name(state.lastActive)}`,
    );
  }

  let mode: Mode;
  if (games.length > 0) {
    mode = "game";
    state.lastGameSeen = now;
    const game = games[0];
    if (state.mode !== "game" || state.lastGame !== displayName(game.process)) {
      await addActivity(
        "game",
        `Game detected: ${displayName(game.process)}`,
        `${game.detail} · ${game.process.path ?? game.process.name}`,
      );
    }
    state.lastGame = displayName(game.process);
  } else if (state.mode === "game" && state.lastGameSeen && now - state.lastGameSeen < cooldownMs) {
    mode = "game"; // game just closed: wait a bit in case it restarts or a launcher hands over
  } else {
    mode = "idle";
    if (state.mode === "game") {
      await addActivity("idle", "No game running anymore", `${state.lastGame ?? "Game"} closed`);
    }
  }

  const target = mode === "game" ? gamePlanOf(settings, status.plans) : idlePlanOf(settings, status.plans);
  const changed = mode !== state.mode;
  let active = status.active;
  if (target && target !== active && (changed || prefs.enforce || manual)) {
    try {
      await setPlan(target);
      await addActivity(
        changed || manual ? "switch" : "restore",
        changed || manual ? `Switched to ${name(target)}` : `Restored ${name(target)}`,
        `was ${name(active)}`,
      );
      active = target;
      const style = prefs.notificationStyle;
      if (style === "system" || style === "hud") {
        const title = mode === "game" ? `🎮 ${state.lastGame ?? "Game"} started` : "💤 No game running";
        await notify(title, `Power plan: ${name(target)}`, { style });
      }
    } catch (error) {
      await addActivity("error", `Could not switch to ${name(target)}`, (error as Error).message);
    }
  }
  state.mode = mode;
  state.lastActive = active;
  await LocalStorage.setItem(STATE_KEY, JSON.stringify(state));

  const subtitle = mode === "game" ? `🎮 ${state.lastGame} · ${name(active)}` : `💤 ${name(active)}`;
  await updateCommandMetadata({ subtitle });
  if (manual) await showHUD(subtitle);
}

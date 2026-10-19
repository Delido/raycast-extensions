import {
  environment,
  getPreferenceValues,
  LaunchType,
  LocalStorage,
  showHUD,
  updateCommandMetadata,
} from "@raycast/api";
import { notify } from "./notify";
import { runProbe } from "./probe";
import { writeReport } from "./report";
import { ms, pct, routesDiffer, Sample, summarize } from "./stats";
import {
  appendEvent,
  appendSample,
  getState,
  getTargets,
  MonitorEvent,
  setState,
  Status,
  Target,
  TargetState,
  trimEvents,
  trimSamples,
} from "./store";

const LAST_RUN_KEY = "monitor-last-run";
const LAST_TRIM_KEY = "monitor-last-trim";
const TARGETS_DEEPLINK = "raycast://extensions/mendyka/mtr/targets";

function targetName(target: Target) {
  return target.label || target.host;
}

function describeRouteChange(from: string, to: string): string {
  const a = from.split(">");
  const b = to.split(">");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i] && a[i] !== "*" && b[i] !== "*") {
      return `Hop ${i + 1}: ${a[i] ?? "–"} → ${b[i] ?? "–"} (${a.length} → ${b.length} hops)`;
    }
  }
  return `${a.length} → ${b.length} hops`;
}

async function checkTarget(
  target: Target,
  prefs: Preferences,
  notifyEvent: (event: MonitorEvent) => Promise<void>,
): Promise<TargetState> {
  const lossAlert = Number(prefs.lossAlert) || 20;
  const latencyAlert = Number(prefs.latencyAlert) || 150;
  const rounds = Math.max(3, Number(prefs.rounds) || 10);
  const previous = await getState(target.id);
  const state: TargetState = { ...previous, lastCheck: Date.now(), error: undefined };
  const event = (kind: MonitorEvent["kind"], message: string, extra?: Partial<MonitorEvent>) =>
    notifyEvent({ t: Date.now(), target: target.id, host: target.host, kind, message, ...extra });

  let sample: Sample;
  try {
    const result = await runProbe(target.host, rounds, 1000);
    sample = summarize(result);
    state.hosts = { ...previous.hosts, ...result.hosts };
  } catch (error) {
    state.error = (error as Error).message;
    state.status = "down";
    if (previous.status !== "down") await event("error", state.error);
    return state;
  }

  await appendSample(target.id, sample);
  state.lastSample = sample;

  // Status and alerts
  let status: Status = "ok";
  let reason = "";
  if (!sample.reached) {
    status = "down";
    reason = "No reply from the target";
  } else if (sample.loss >= lossAlert) {
    status = "degraded";
    reason = `${pct(sample.loss)} packet loss`;
  } else if ((sample.avg ?? 0) >= latencyAlert) {
    status = "degraded";
    reason = `${ms(sample.avg)} average latency`;
  }
  state.status = status;

  if (status !== previous.status) {
    if (status === "down") await event("down", reason);
    else if (status === "degraded") await event("degraded", reason);
    else if (previous.status === "down" || previous.status === "degraded") {
      await event("recovered", `${pct(sample.loss)} loss, ${ms(sample.avg)} avg`);
    }
  }

  // Route changes need to show up twice in a row, so load balancing doesn't cause alerts.
  if (sample.reached) {
    if (!previous.route) {
      state.route = sample.route;
    } else if (routesDiffer(previous.route, sample.route)) {
      if (previous.pendingRoute && !routesDiffer(previous.pendingRoute, sample.route)) {
        await event("route", describeRouteChange(previous.route, sample.route), {
          from: previous.route,
          to: sample.route,
        });
        state.route = sample.route;
        state.pendingRoute = undefined;
      } else {
        state.pendingRoute = sample.route;
      }
    } else {
      state.pendingRoute = undefined;
    }
  }
  return state;
}

/** Checks all targets once. Returns a short summary, or undefined if there are no targets. */
export async function runChecks(): Promise<string | undefined> {
  const prefs = getPreferenceValues<Preferences>();
  const style = prefs.notificationStyle === "hud" ? "hud" : "system";
  await LocalStorage.setItem(LAST_RUN_KEY, String(Date.now()));

  const targets = await getTargets();
  if (targets.length === 0) return undefined;

  const notifyEvent = async (event: MonitorEvent) => {
    await appendEvent(event);
    const target = targets.find((t) => t.id === event.target);
    const name = target ? targetName(target) : event.host;
    const titles: Record<MonitorEvent["kind"], string> = {
      down: `🔴 ${name} unreachable`,
      degraded: `🟠 ${name} degraded`,
      recovered: `🟢 ${name} OK again`,
      route: `🔀 Route to ${name} changed`,
      error: `⚠️ ${name}: check failed`,
    };
    if (event.kind === "route" && !prefs.notifyRouteChange) return;
    if (event.kind === "recovered" && !prefs.notifyRecovery) return;
    await notify(titles[event.kind], event.message, { style, url: TARGETS_DEEPLINK });
  };

  const states = await Promise.all(
    targets.map(async (target) => {
      const state = await checkTarget(target, prefs, notifyEvent);
      await setState(target.id, state);
      return state;
    }),
  );

  // Trim old data once an hour.
  const retentionMs = (Number(prefs.retentionDays) || 7) * 86_400_000;
  const lastTrim = Number((await LocalStorage.getItem<string>(LAST_TRIM_KEY)) ?? 0);
  if (Date.now() - lastTrim > 3_600_000) {
    await Promise.all(targets.map((t) => trimSamples(t.id, Date.now() - retentionMs)));
    await trimEvents(Date.now() - retentionMs);
    await LocalStorage.setItem(LAST_TRIM_KEY, String(Date.now()));
  }

  await writeReport().catch(() => undefined);

  const bad = states.filter((s) => s.status !== "ok").length;
  const summary =
    bad === 0
      ? `${targets.length} target${targets.length === 1 ? "" : "s"} OK`
      : `${bad} of ${targets.length} with problems`;
  return summary;
}

export default async function Monitor() {
  const { checkEvery } = getPreferenceValues<Preferences.Monitor>();
  const manual = environment.launchType === LaunchType.UserInitiated;

  // Scheduled every minute; honour the configured check interval.
  const intervalMs = Number(checkEvery || "1") * 60_000;
  const lastRun = Number((await LocalStorage.getItem<string>(LAST_RUN_KEY)) ?? 0);
  if (!manual && Date.now() - lastRun < intervalMs - 10_000) return;

  const summary = await runChecks();
  await updateCommandMetadata({ subtitle: summary ?? "No targets" });
  if (manual) await showHUD(summary ? `MTR: ${summary}` : "MTR: add targets in “Monitored Targets” first");
}

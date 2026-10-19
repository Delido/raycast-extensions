import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { latencyChart } from "./chart";
import { ms, pct, Sample } from "./stats";
import { getState, getTargets, MonitorEvent, readEvents, readSamples, reportPath, Status } from "./store";

/* Static HTML report with all monitored targets; rewritten after every background check. */

export interface Buckets {
  avg: (number | null)[];
  low: (number | null)[];
  high: (number | null)[];
  loss: number[];
}

/** Puts samples into fixed time slots so that gaps (PC asleep, offline) stay visible. */
export function bucketSamples(samples: Sample[], from: number, to: number, slots: number): Buckets {
  const size = (to - from) / slots;
  const groups: Sample[][] = Array.from({ length: slots }, () => []);
  for (const sample of samples) {
    const index = Math.floor((sample.t - from) / size);
    if (index >= 0 && index < slots) groups[index].push(sample);
  }
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  return {
    avg: groups.map((g) => mean(g.filter((s) => s.avg !== undefined).map((s) => s.avg!))),
    low: groups.map((g) => {
      const v = g.filter((s) => s.best !== undefined).map((s) => s.best!);
      return v.length ? Math.min(...v) : null;
    }),
    high: groups.map((g) => {
      const v = g.filter((s) => s.worst !== undefined).map((s) => s.worst!);
      return v.length ? Math.max(...v) : null;
    }),
    loss: groups.map((g) => mean(g.map((s) => s.loss)) ?? 0),
  };
}

export function timeLabel(t: number, withDate = false): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return withDate ? `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${time}` : time;
}

export function windowChart(samples: Sample[], hours: number, options: { width?: number; textColor?: string } = {}) {
  const to = Date.now();
  const from = to - hours * 3_600_000;
  const slots = hours <= 1 ? 60 : hours <= 24 ? 288 : 336;
  const b = bucketSamples(samples, from, to, slots);
  return latencyChart({
    latency: b.avg,
    low: b.low,
    high: b.high,
    loss: b.loss,
    width: options.width,
    textColor: options.textColor,
    leftLabel: timeLabel(from, hours > 24),
    rightLabel: hours > 24 ? timeLabel(to, true) : "now",
  });
}

function esc(text: string | undefined | null): string {
  return String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const STATUS_LABEL: Record<Status, string> = { ok: "OK", degraded: "Degraded", down: "Down", unknown: "Not checked" };
const EVENT_ICON: Record<MonitorEvent["kind"], string> = {
  down: "🔴",
  degraded: "🟠",
  recovered: "🟢",
  route: "🔀",
  error: "⚠️",
};

export async function buildReport(): Promise<string> {
  const targets = await getTargets();
  const events = await readEvents(100);
  const since = Date.now() - 7 * 86_400_000;

  const cards = await Promise.all(
    targets.map(async (target) => {
      const [state, samples] = await Promise.all([getState(target.id), readSamples(target.id, since)]);
      const last = state.lastSample;
      const day = samples.filter((s) => s.t >= Date.now() - 86_400_000);
      const dayLoss = day.length ? day.reduce((a, s) => a + s.loss, 0) / day.length : 0;
      const dayAvg = day.filter((s) => s.avg !== undefined);
      const avg24 = dayAvg.length ? dayAvg.reduce((a, s) => a + s.avg!, 0) / dayAvg.length : undefined;

      const hopRows = (last?.hops ?? [])
        .map(([addr, loss, avg], i) => {
          const name = addr ? state.hosts[addr] : undefined;
          return `<tr><td>${i + 1}</td><td>${addr ? esc(name ?? addr) : "???"}${name ? `<small>${esc(addr)}</small>` : ""}</td><td class="${loss >= 20 ? "bad" : loss > 0 ? "warn" : ""}">${pct(loss)}</td><td>${ms(avg)}</td></tr>`;
        })
        .join("");
      const targetEvents = events.filter((e) => e.target === target.id).slice(0, 8);

      return `<section class="card">
  <header>
    <div><h2>${esc(target.label || target.host)}</h2><span class="sub">${esc(target.host)}${last?.ip && last.ip !== target.host ? ` · ${esc(last.ip)}` : ""}</span></div>
    <span class="badge ${state.status}">${STATUS_LABEL[state.status]}</span>
  </header>
  <div class="stats">
    <div><b>${last ? pct(last.loss) : "–"}</b><span>loss now</span></div>
    <div><b>${ms(last?.avg)}</b><span>avg now</span></div>
    <div><b>${ms(last?.jitter)}</b><span>jitter</span></div>
    <div><b>${pct(dayLoss)}</b><span>loss 24 h</span></div>
    <div><b>${ms(avg24)}</b><span>avg 24 h</span></div>
    <div><b>${last?.hops.length ?? "–"}</b><span>hops</span></div>
  </div>
  ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
  <h3>Last 24 hours</h3>
  <div class="chart">${windowChart(samples, 24, { width: 900 })}</div>
  <details><summary>Last 7 days</summary><div class="chart">${windowChart(samples, 168, { width: 900 })}</div></details>
  <div class="cols">
    <div><h3>Route ${last ? `<small>${timeLabel(last.t)}</small>` : ""}</h3><table><thead><tr><th>#</th><th>Host</th><th>Loss</th><th>Avg</th></tr></thead><tbody>${hopRows || '<tr><td colspan="4">No data yet</td></tr>'}</tbody></table></div>
    <div><h3>Events</h3><ul class="events">${targetEvents.map((e) => `<li>${EVENT_ICON[e.kind]} <time>${timeLabel(e.t, true)}</time> ${esc(e.message)}</li>`).join("") || "<li>No events</li>"}</ul></div>
  </div>
</section>`;
    }),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>MTR Monitor</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --text:#1d1f24; --muted:#6b7280; --line:#e5e7eb; }
@media (prefers-color-scheme: dark) { :root { --bg:#14161a; --card:#1d2026; --text:#e8eaee; --muted:#9aa1ad; --line:#2c3038; } }
* { box-sizing:border-box; }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text); font:14px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width:960px; margin:0 auto; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:18px; margin:0; } h3 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:18px 0 8px; }
.top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; color:var(--muted); }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:18px; }
.card header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.sub, small { color:var(--muted); font-size:12px; } td small { display:block; }
.badge { padding:3px 10px; border-radius:99px; font-weight:600; font-size:12px; white-space:nowrap; }
.badge.ok { background:#16a34a22; color:#16a34a; } .badge.degraded { background:#f59e0b22; color:#d97706; }
.badge.down { background:#ef444422; color:#ef4444; } .badge.unknown { background:#8882; color:var(--muted); }
.stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:10px; margin-top:14px; }
.stats div { border:1px solid var(--line); border-radius:8px; padding:8px 10px; } .stats b { display:block; font-size:18px; } .stats span { color:var(--muted); font-size:12px; }
.chart svg { width:100%; height:auto; display:block; }
details summary { cursor:pointer; color:var(--muted); margin-top:10px; }
.cols { display:grid; grid-template-columns:1fr 1fr; gap:18px; } @media (max-width:700px) { .cols { grid-template-columns:1fr; } }
table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-weight:600; font-size:12px; }
td.bad { color:#ef4444; font-weight:600; } td.warn { color:#d97706; }
.events { list-style:none; padding:0; margin:0; } .events li { padding:4px 0; border-bottom:1px solid var(--line); } time { color:var(--muted); font-size:12px; margin-right:4px; }
.error { color:#ef4444; }
</style>
</head>
<body><main>
<div class="top"><h1>MTR Monitor</h1><span>Updated ${new Date().toLocaleString()} · refreshes every minute</span></div>
${cards.join("\n") || "<p>No targets yet. Add some with the Raycast command “Monitored Targets”.</p>"}
</main></body></html>`;
}

export async function writeReport(): Promise<string> {
  const path = reportPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await buildReport(), "utf8");
  return path;
}

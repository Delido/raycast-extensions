import { Color } from "@raycast/api";
import { ProbeRound, ProbeResult } from "./probe";

/* WinMTR-style statistics per hop. */

const KEEP_RTTS = 300;

export interface HopRow {
  ttl: number;
  /** Most frequent responding address, undefined if the hop never answered */
  addr?: string;
  /** All addresses seen at this TTL with counts (load balancing shows up here) */
  addrs: Record<string, number>;
  sent: number;
  recv: number;
  loss: number;
  last?: number;
  best?: number;
  avg?: number;
  worst?: number;
  stdev?: number;
  jitter?: number;
  /** Recent RTTs, null = lost */
  rtts: (number | null)[];
}

interface HopAcc {
  addrs: Record<string, number>;
  sent: number;
  recv: number;
  last?: number;
  best?: number;
  worst?: number;
  sum: number;
  sumSq: number;
  jitterSum: number;
  jitterCount: number;
  rtts: (number | null)[];
}

export class Aggregator {
  private hops: HopAcc[] = [];
  rounds = 0;
  /** Number of hops in the latest round (hops beyond it are stale) */
  length = 0;

  add(round: ProbeRound) {
    this.rounds++;
    this.length = round.hops.length;
    for (const hop of round.hops) {
      const acc = (this.hops[hop.ttl - 1] ??= {
        addrs: {},
        sent: 0,
        recv: 0,
        sum: 0,
        sumSq: 0,
        jitterSum: 0,
        jitterCount: 0,
        rtts: [],
      });
      acc.sent++;
      const answered = hop.addr !== undefined && hop.rtt !== undefined;
      if (answered) {
        const rtt = hop.rtt!;
        acc.addrs[hop.addr!] = (acc.addrs[hop.addr!] ?? 0) + 1;
        acc.recv++;
        if (acc.last !== undefined) {
          acc.jitterSum += Math.abs(rtt - acc.last);
          acc.jitterCount++;
        }
        acc.last = rtt;
        acc.best = acc.best === undefined ? rtt : Math.min(acc.best, rtt);
        acc.worst = acc.worst === undefined ? rtt : Math.max(acc.worst, rtt);
        acc.sum += rtt;
        acc.sumSq += rtt * rtt;
      }
      acc.rtts.push(answered ? hop.rtt! : null);
      if (acc.rtts.length > KEEP_RTTS) acc.rtts.shift();
    }
  }

  rows(): HopRow[] {
    return this.hops.slice(0, this.length).map((acc, index) => {
      const avg = acc.recv ? acc.sum / acc.recv : undefined;
      const variance = acc.recv && avg !== undefined ? acc.sumSq / acc.recv - avg * avg : undefined;
      const addr = Object.entries(acc.addrs).sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        ttl: index + 1,
        addr,
        addrs: acc.addrs,
        sent: acc.sent,
        recv: acc.recv,
        loss: acc.sent ? ((acc.sent - acc.recv) / acc.sent) * 100 : 0,
        last: acc.last,
        best: acc.best,
        avg,
        worst: acc.worst,
        stdev: variance !== undefined ? Math.sqrt(Math.max(0, variance)) : undefined,
        jitter: acc.jitterCount ? acc.jitterSum / acc.jitterCount : undefined,
        rtts: [...acc.rtts],
      };
    });
  }
}

/** Compact per-check record stored by the background monitor. */
export interface Sample {
  t: number;
  ip: string;
  rounds: number;
  /** Loss and latency of the target itself (last hop) */
  loss: number;
  avg?: number;
  best?: number;
  worst?: number;
  jitter?: number;
  reached: boolean;
  /** [address or null, loss %, avg ms or null] per hop */
  hops: [string | null, number, number | null][];
  route: string;
}

export function routeSignature(rows: { addr?: string | null }[]): string {
  return rows.map((row) => row.addr ?? "*").join(">");
}

/** True if two routes differ at a hop where both sides answered, or in length. */
export function routesDiffer(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = a.split(">");
  const y = b.split(">");
  if (x.length !== y.length) return true;
  return x.some((addr, i) => addr !== "*" && y[i] !== "*" && addr !== y[i]);
}

export function summarize(result: ProbeResult): Sample {
  const agg = new Aggregator();
  result.rounds.forEach((round) => agg.add(round));
  const rows = agg.rows();
  const last = rows[rows.length - 1];
  const reached = last?.addr === result.ip;
  return {
    t: result.rounds[0]?.time ?? Date.now(),
    ip: result.ip,
    rounds: agg.rounds,
    loss: reached ? Math.round(last.loss * 10) / 10 : 100,
    avg: reached ? round1(last.avg) : undefined,
    best: reached ? last.best : undefined,
    worst: reached ? last.worst : undefined,
    jitter: reached ? round1(last.jitter) : undefined,
    reached,
    hops: rows.map((row) => [row.addr ?? null, round1(row.loss) ?? 0, round1(row.avg) ?? null]),
    route: routeSignature(rows),
  };
}

function round1(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

export function ms(value: number | undefined | null): string {
  if (value === undefined || value === null) return "–";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
}

export function pct(value: number): string {
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}

export function lossColor(loss: number): Color {
  if (loss >= 20) return Color.Red;
  if (loss > 0) return Color.Orange;
  return Color.Green;
}

const BARS = "▁▂▃▄▅▆▇█";

/** Text sparkline; lost probes are shown as "×". */
export function sparkline(values: (number | null | undefined)[], width = values.length): string {
  const points = values.slice(-width);
  const known = points.filter((v): v is number => typeof v === "number");
  if (known.length === 0) return points.map(() => "×").join("");
  const low = Math.min(...known);
  const high = Math.max(...known);
  return points
    .map((v) => {
      if (typeof v !== "number") return "×";
      if (high - low < 1e-9) return BARS[1];
      return BARS[Math.round(((v - low) / (high - low)) * (BARS.length - 1))];
    })
    .join("");
}

/** WinMTR-like plain text table. */
export function asTable(target: string, rows: HopRow[], hosts: Record<string, string>): string {
  const header = ["#", "Host", "Loss%", "Sent", "Recv", "Best", "Avg", "Worst", "Last", "StDev"];
  const lines = rows.map((row) => [
    String(row.ttl),
    row.addr ? (hosts[row.addr] ? `${hosts[row.addr]} (${row.addr})` : row.addr) : "???",
    row.loss.toFixed(1),
    String(row.sent),
    String(row.recv),
    num(row.best),
    num(row.avg),
    num(row.worst),
    num(row.last),
    num(row.stdev),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (i === 1 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  return [`MTR to ${target}`, fmt(header), ...lines.map(fmt)].join("\n");
}

function num(value: number | undefined): string {
  return value === undefined ? "-" : value < 10 ? value.toFixed(1) : String(Math.round(value));
}

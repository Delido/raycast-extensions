/* Small dependency-free SVG charts, used in Raycast details and in the HTML report. */

export interface ChartOptions {
  /** Latency values, null = lost / no data */
  latency: (number | null | undefined)[];
  /** Optional band (e.g. best..worst per sample) */
  low?: (number | null | undefined)[];
  high?: (number | null | undefined)[];
  /** Loss in percent per point, drawn as red bars */
  loss?: number[];
  width?: number;
  height?: number;
  leftLabel?: string;
  rightLabel?: string;
  /** Text colour for axis labels */
  textColor?: string;
}

const LINE = "#3b82f6";
const BAND = "rgba(59,130,246,0.18)";
const LOSS = "rgba(239,68,68,0.75)";
const GRID = "rgba(136,136,136,0.35)";

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function latencyChart(options: ChartOptions): string {
  const width = options.width ?? 640;
  const height = options.height ?? 180;
  const text = options.textColor ?? "#888888";
  const pad = { left: 44, right: 8, top: 10, bottom: 20 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = Math.max(options.latency.length, options.loss?.length ?? 0, 2);

  const all = [...options.latency, ...(options.high ?? [])].filter((v): v is number => typeof v === "number");
  const maxY = all.length ? niceMax(Math.max(...all) * 1.1) : 10;
  const x = (i: number) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (Math.min(v, maxY) / maxY) * plotH;

  const parts: string[] = [];
  // grid + y labels
  for (let i = 0; i <= 4; i++) {
    const value = (maxY / 4) * i;
    const yy = y(value);
    const label = maxY < 10 && value > 0 ? value.toFixed(1) : String(Math.round(value));
    parts.push(
      `<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${pad.left - 6}" y="${yy + 4}" font-size="11" text-anchor="end" fill="${text}">${label} ms</text>`,
    );
  }
  if (all.length === 0) {
    parts.push(
      `<text x="${pad.left + plotW / 2}" y="${pad.top + plotH / 2}" font-size="13" text-anchor="middle" fill="${text}">No latency data</text>`,
    );
  }

  // loss bars
  if (options.loss) {
    const barW = Math.max(1, plotW / n);
    options.loss.forEach((loss, i) => {
      if (loss <= 0) return;
      const h = (Math.min(loss, 100) / 100) * plotH;
      parts.push(
        `<rect x="${x(i) - barW / 2}" y="${pad.top + plotH - h}" width="${barW}" height="${h}" fill="${LOSS}"/>`,
      );
    });
  }

  // band
  if (options.low && options.high) {
    const segments = segmentsOf(
      options.low.map((lo, i) => (typeof lo === "number" && typeof options.high![i] === "number" ? i : null)),
    );
    for (const seg of segments) {
      const top = seg.map((i) => `${x(i)},${y(options.high![i] as number)}`);
      const bottom = seg.reverse().map((i) => `${x(i)},${y(options.low![i] as number)}`);
      parts.push(`<polygon points="${[...top, ...bottom].join(" ")}" fill="${BAND}"/>`);
    }
  }

  // latency line, broken at gaps; lone points as dots
  for (const seg of segmentsOf(options.latency.map((v, i) => (typeof v === "number" ? i : null)))) {
    if (seg.length === 1) {
      parts.push(`<circle cx="${x(seg[0])}" cy="${y(options.latency[seg[0]] as number)}" r="2" fill="${LINE}"/>`);
    } else {
      const points = seg.map((i) => `${x(i)},${y(options.latency[i] as number)}`).join(" ");
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/>`,
      );
    }
  }

  if (options.leftLabel) {
    parts.push(
      `<text x="${pad.left}" y="${height - 4}" font-size="11" fill="${text}">${escape(options.leftLabel)}</text>`,
    );
  }
  if (options.rightLabel) {
    parts.push(
      `<text x="${width - pad.right}" y="${height - 4}" font-size="11" text-anchor="end" fill="${text}">${escape(options.rightLabel)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, sans-serif">${parts.join("")}</svg>`;
}

function segmentsOf(indices: (number | null)[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (const i of indices) {
    if (i === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(i);
  }
  if (current.length) segments.push(current);
  return segments;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

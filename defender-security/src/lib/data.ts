import { environment, getPreferenceValues, open } from "@raycast/api";
import { readFile, stat, writeFile } from "fs/promises";
import path from "path";

// Liest die vom Report-Lauf geschriebenen Daten und aggregiert sie wie der HTML-Report.
// Raycast erlaubt pro Befehl nur 100 MB JS-Heap. Deshalb liegen die Funde als binäres Int32-Feld
// (außerhalb des Heaps) in aktuell.findings.bin, und die Aggregation kommt ohne große Mengen aus.

export interface Preferences {
  reportFolder?: string;
  demoMode?: boolean;
}

interface RawDevice {
  id?: string;
  n: string;
  g: string;
  os: string;
  t?: string[];
  x?: string;
  l?: string;
}
interface RawSoftware {
  v: string;
  n: string;
  r: string;
  rv: string;
  u: boolean;
}
interface RawCve {
  id: string;
  s: number;
  c: number;
  e: number;
  kb?: string;
  kbn?: string;
  kbu?: string;
}
export interface RawReport {
  meta: { generated: string; tenant: string; demo: boolean; prevRun?: string | null };
  devices: RawDevice[];
  sw: RawSoftware[];
  cves: RawCve[];
  vers: string[];
  paths: string[];
  ev: [number, number, number, number[]][];
  fixed?: [string, string, string, string, string, number][];
  /** je Fund 6 Werte: Gerät, Software, CVE, Version, ErstmalsGesehenTag, NeuSeitLetztemLauf */
  f: Int32Array;
}

/** Felder eines Fundes im flachen Array (Offset o = Index × FIELDS) */
export const FIELDS = 6;
export const DEV = 0,
  SW = 1,
  CVE = 2,
  VER = 3,
  DAY = 4,
  NEW = 5;

export const SEV = ["Niedrig", "Mittel", "Hoch", "Kritisch"];
export const EXP = ["Kein bekannter Exploit", "Exploit öffentlich", "Exploit verifiziert", "Exploit-Kit"];
export const EXP_SHORT = ["–", "Öffentlich", "Verifiziert", "Exploit-Kit"];
const W_SEV = [0.5, 2, 5, 10];
const W_EXP = [1, 1.5, 2.5, 3];

export interface SoftwareAgg {
  i: number;
  name: string;
  key: string;
  action: string;
  updateAvailable: boolean;
  devCount: number;
  cveCount: number;
  versCount: number;
  sevCves: number[];
  maxE: number;
  score: number;
  recent: number;
}
export interface CveAgg {
  i: number;
  id: string;
  s: number;
  c: number;
  e: number;
  kb?: string;
  kbu?: string;
  devCount: number;
  sws: number[];
  recent: number;
  score: number;
}
export interface DeviceAgg {
  i: number;
  name: string;
  group: string;
  os: string;
  tags: string[];
  id?: string;
  sev: number[];
  cveCount: number;
  swCount: number;
  maxE: number;
  score: number;
  n: number;
  recent: number;
}
export interface GroupAgg {
  name: string;
  devCount: number;
  sev: number[];
  score: number;
  n: number;
}

export interface Model {
  raw: RawReport;
  generated: Date;
  prevRun: Date | null;
  software: SoftwareAgg[];
  cves: CveAgg[];
  devices: DeviceAgg[];
  groups: GroupAgg[];
  /** Offsets der Funde im aktuellen Filter (nach Gerät sortiert) */
  offsets: Uint32Array;
  count: number;
  newLabel: string;
  isNew: (o: number) => boolean;
  /** Offsets aller Funde, für die pred(Offset) zutrifft (für Detailansichten) */
  select: (pred: (o: number) => boolean) => number[];
  evidence: (d: number, s: number, v: number) => string[];
  devicesWithPath: (q: string) => Set<number>;
  swByIndex: Map<number, SoftwareAgg>;
}

export function prefs(): Preferences {
  return getPreferenceValues<Preferences>();
}
// Reports im gewählten Ordner, sonst im Datenordner der Extension; Verlauf und Vergleichsstand immer dort.
export const reportsDir = () => prefs().reportFolder || path.join(environment.supportPath, "reports");
export const dataDir = () => path.join(environment.supportPath, "data");
export const templatePath = () => path.join(environment.assetsPath, "report-template.html");
export const reportJsonPath = () => path.join(reportsDir(), "aktuell.json");
export const reportFindingsPath = () => path.join(reportsDir(), "aktuell.findings.bin");
export const reportHtmlPath = () => path.join(reportsDir(), "aktuell.html");

const pretty = (s: string) =>
  String(s || "")
    .replace(/_/g, " ")
    .replace(/(^|[\s-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
export function swName(v: string, n: string) {
  const pv = pretty(v),
    pn = pretty(n);
  return pn.toLowerCase().startsWith(pv.toLowerCase()) ? pn : pv + " " + pn;
}
function swAction(s: RawSoftware) {
  // Defender nennt die Zielversion teils schon im Text ("… to version 159.0.0.0")
  if (s.r) return s.r + (s.rv && !s.r.includes(s.rv) ? " → " + s.rv : "");
  return s.u ? "Update installieren" : "Kein Update verfügbar, Workaround/Ersatz prüfen";
}

export async function loadRaw(): Promise<RawReport> {
  let text: string, bin: Buffer;
  try {
    [text, bin] = await Promise.all([readFile(reportJsonPath(), "utf8"), readFile(reportFindingsPath())]);
  } catch {
    throw new Error(`Keine Daten gefunden in ${reportsDir()}. Zuerst „Schwachstellen-Report aktualisieren“ ausführen.`);
  }
  const raw = JSON.parse(text.replace(/^\uFEFF/, "")) as RawReport;
  // Buffer kann versetzt im Speicher liegen; für Int32Array wird eine ausgerichtete Kopie gebraucht
  raw.f = new Int32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  return raw;
}

export async function loadModel(groupFilter?: string): Promise<Model> {
  return buildModel(await loadRaw(), groupFilter);
}

export const groupNames = (raw: RawReport) =>
  [...new Set(raw.devices.map((d) => d.g))].sort((a, b) => a.localeCompare(b, "de"));

export function buildModel(raw: RawReport, groupFilter?: string): Model {
  const f = raw.f;
  const generated = new Date(raw.meta.generated);
  const today = Math.floor(generated.getTime() / 86400000);
  const prevRun = raw.meta.prevRun ? new Date(raw.meta.prevRun) : null;
  const isNew = prevRun ? (o: number) => f[o + NEW] === 1 : (o: number) => today - f[o + DAY] <= 7;

  // Offsets im Filter, nach Gerät sortiert: so lassen sich eindeutige Geräte/CVEs je Gerät
  // mit kleinen, pro Gerät geleerten Mengen zählen statt mit Mengen über alle Funde.
  const total = f.length / FIELDS;
  let n = 0;
  const all = new Uint32Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * FIELDS;
    if (!groupFilter || raw.devices[f[o + DEV]].g === groupFilter) all[n++] = o;
  }
  const offsets = all.slice(0, n).sort((a, b) => f[a + DEV] - f[b + DEV] || a - b);

  const sw = new Map<number, SoftwareAgg>(),
    cve = new Map<number, CveAgg>(),
    dev = new Map<number, DeviceAgg>(),
    grp = new Map<string, GroupAgg>();
  const swCvePairs = new Set<number>(),
    swVerPairs = new Set<number>(); // klein: höchstens Software × CVEs bzw. Versionen
  const devSw = new Set<number>(),
    devCve = new Set<number>();
  let lastDev = -1;
  for (let k = 0; k < offsets.length; k++) {
    const o = offsets[k];
    const di = f[o + DEV],
      si = f[o + SW],
      ci = f[o + CVE],
      vi = f[o + VER];
    const c = raw.cves[ci],
      d = raw.devices[di],
      s = raw.sw[si];
    const w = W_SEV[c.s] * W_EXP[c.e];
    const fresh = isNew(o);
    const newDevice = di !== lastDev;
    if (newDevice) {
      devSw.clear();
      devCve.clear();
      lastDev = di;
    }

    let a = sw.get(si);
    if (!a) {
      a = {
        i: si,
        name: swName(s.v, s.n),
        key: `${s.v}|${s.n}`,
        action: swAction(s),
        updateAvailable: s.u || !!s.r,
        devCount: 0,
        cveCount: 0,
        versCount: 0,
        sevCves: [0, 0, 0, 0],
        maxE: 0,
        score: 0,
        recent: 0,
      };
      sw.set(si, a);
    }
    if (!devSw.has(si)) {
      devSw.add(si);
      a.devCount++;
    }
    const sc = si * 0x100000 + ci;
    if (!swCvePairs.has(sc)) {
      swCvePairs.add(sc);
      a.cveCount++;
      a.sevCves[c.s]++;
    }
    const sv = si * 0x100000 + vi;
    if (!swVerPairs.has(sv)) {
      swVerPairs.add(sv);
      a.versCount++;
    }
    a.score += w;
    a.maxE = Math.max(a.maxE, c.e);
    if (fresh) a.recent++;

    let b = cve.get(ci);
    if (!b) {
      b = { i: ci, id: c.id, s: c.s, c: c.c, e: c.e, kb: c.kb, kbu: c.kbu, devCount: 0, sws: [], recent: 0, score: 0 };
      cve.set(ci, b);
    }
    if (!devCve.has(ci)) {
      devCve.add(ci);
      b.devCount++;
    }
    if (!b.sws.includes(si)) b.sws.push(si);
    if (fresh) b.recent++;

    let x = dev.get(di);
    if (!x) {
      x = {
        i: di,
        name: d.n,
        group: d.g,
        os: d.os,
        tags: d.t || [],
        id: d.id,
        sev: [0, 0, 0, 0],
        cveCount: 0,
        swCount: 0,
        maxE: 0,
        score: 0,
        n: 0,
        recent: 0,
      };
      dev.set(di, x);
    }
    x.sev[c.s]++;
    x.cveCount = devCve.size;
    x.swCount = devSw.size;
    x.maxE = Math.max(x.maxE, c.e);
    x.score += w;
    x.n++;
    if (fresh) x.recent++;

    let g = grp.get(d.g);
    if (!g) {
      g = { name: d.g, devCount: 0, sev: [0, 0, 0, 0], score: 0, n: 0 };
      grp.set(d.g, g);
    }
    if (newDevice) g.devCount++;
    g.sev[c.s]++;
    g.score += w;
    g.n++;
  }
  for (const b of cve.values()) b.score = b.devCount * W_SEV[b.s] * W_EXP[b.e];

  // Fundstellen: Schlüssel als Zahl (Gerät, Software, Version) statt als Zeichenkette
  const evKey = (d: number, s: number, v: number) => (d * 0x10000 + s) * 0x10000 + v;
  const evMap = new Map<number, number[]>();
  for (const [d, s, v, ps] of raw.ev || []) evMap.set(evKey(d, s, v), ps);

  const byScore = <T extends { score: number }>(m: Map<unknown, T>) =>
    [...m.values()].sort((p, q) => q.score - p.score);
  return {
    raw,
    generated,
    prevRun,
    offsets,
    count: offsets.length,
    isNew,
    software: byScore(sw),
    cves: byScore(cve),
    devices: byScore(dev),
    groups: byScore(grp),
    swByIndex: sw,
    newLabel: prevRun ? "neu seit letztem Lauf" : "neu (7 Tage)",
    select: (pred) => {
      const out: number[] = [];
      for (let k = 0; k < offsets.length; k++) if (pred(offsets[k])) out.push(offsets[k]);
      return out;
    },
    evidence: (d, s, v) => (evMap.get(evKey(d, s, v)) || []).map((i) => raw.paths[i]),
    // Pfadsuche: erst passende Pfade (wenige tausend), dann die Installationen, die sie enthalten
    devicesWithPath: (q) => {
      const hits = new Set<number>();
      raw.paths.forEach((p, i) => {
        if (p.toLowerCase().includes(q)) hits.add(i);
      });
      const devs = new Set<number>();
      if (hits.size) for (const [d, , , ps] of raw.ev || []) if (ps.some((i) => hits.has(i))) devs.add(d);
      return devs;
    },
  };
}

export const fmt = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
export const compact = (n: number) => (n >= 10000 ? fmt(n / 1000) + " Tsd." : fmt(n));
export const dateTime = (d: Date) => d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

// Öffnet den HTML-Report mit Sprungmarke. Windows verwirft beim Öffnen von file://-Links den #-Anker,
// deshalb wird eine kleine Weiterleitungsseite geschrieben und geöffnet.
export async function openReport(hash?: string) {
  const html = reportHtmlPath();
  await stat(html);
  if (!hash) return open(html);
  const redirect = path.join(reportsDir(), "_raycast-open.html");
  const target = "aktuell.html#" + hash;
  await writeFile(
    redirect,
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>Weiterleitung</title><a href="${target}">Report öffnen</a>`,
    "utf8",
  );
  return open(redirect);
}

export const defenderCveUrl = (id: string) =>
  `https://security.microsoft.com/vulnerabilities/vulnerability/${encodeURIComponent(id)}/overview`;
export const defenderDeviceUrl = (id: string) =>
  `https://security.microsoft.com/machines/v2/${encodeURIComponent(id)}/overview`;
export const nvdUrl = (id: string) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(id)}`;

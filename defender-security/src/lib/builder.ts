// Wandelt die Defender-Rohdaten in das kompakte, wörterbuch-codierte Modell des Reports um.
// Funde: [Gerät, Software, CVE, Version, ErstmalsGesehenTag, NeuSeitLetztemLauf]; aggregiert wird erst in der Anzeige.
// Raycast begrenzt den JS-Heap auf 100 MB, deshalb liegen Funde in einem flachen Int32Array
// und Schlüssel als Zahlen-Hashes statt als Zeichenketten im Speicher.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const SEV_CODE: Record<string, number> = { Critical: 3, High: 2, Medium: 1, Low: 0 };
const sevCode = (s: unknown) => SEV_CODE[String(s)] ?? 0;
export function exploitCode(level: unknown) {
  const s = String(level ?? "");
  if (/InKit|ZeroDay/.test(s)) return 3;
  if (/Verified/.test(s)) return 2;
  if (/Public/.test(s)) return 1;
  return 0;
}
const first = (...values: unknown[]) => values.find((v) => v !== undefined && v !== null && v !== "") as any;
// Zeitstempel kommen in UTC ("…Z"); für den Tag reicht der Datumsteil, das hält den Cache klein
const unixDay = (date: string) => {
  if (!date) return 0;
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : Math.floor(t / 86400000);
};

/** 53-Bit-Hash aus zwei 32-Bit-FNV-1a-Varianten; Kollisionen bei 10^6 Schlüsseln praktisch ausgeschlossen. */
export function hashKey(s: string): number {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
  }
  return (h1 >>> 0) * 0x200000 + ((h2 >>> 0) & 0x1fffff);
}
const runKey = (deviceId: string, cveId: string, vendor: string, product: string) =>
  hashKey(`${deviceId}|${cveId}|${vendor}|${product}`);

/** Nur die Felder, die der Report braucht – die API liefert pro Gerät deutlich mehr. */
export const slimMachine = (m: Row) => ({
  id: m.id,
  computerDnsName: m.computerDnsName,
  rbacGroupName: m.rbacGroupName,
  osPlatform: m.osPlatform,
  machineTags: m.machineTags,
  exposureLevel: m.exposureLevel,
  lastSeen: m.lastSeen,
});
export const slimRecommendation = (r: Row) => ({
  id: r.id,
  recommendationName: r.recommendationName,
  recommendedVersion: r.recommendedVersion,
});

export interface Snapshot {
  d: string;
  t: number;
  s: number[];
  e: number;
  dv: number;
  c: number;
}

/** Stand eines Laufs für den Vergleich beim nächsten Lauf (kompakt, Indizes in die eigenen Listen). */
export interface FindingState {
  v: 2;
  time: string;
  devices: [string, string, string][]; // [GeräteId, Name, Gruppe]
  sw: [string, string][]; // [Hersteller, Produkt]
  cves: string[];
  items: number[]; // je Fund: Gerät, Software, CVE, Schweregrad
}

export class PreviousRun {
  readonly keys = new Set<number>();
  private items: Int32Array;
  constructor(readonly state: FindingState) {
    // als Int32Array halten (ein Viertel des Speichers eines JS-Arrays)
    this.items = Int32Array.from(state.items);
    state.items = [];
    for (let i = 0; i < this.items.length; i += 4) this.keys.add(this.keyAt(i));
  }
  keyAt(i: number) {
    const it = this.items,
      d = this.state.devices[it[i]],
      s = this.state.sw[it[i + 1]];
    return runKey(d[0], this.state.cves[it[i + 2]], s[0], s[1]);
  }
  /** Funde, die im letzten Lauf da waren und jetzt fehlen: [Gerät, Gruppe, Hersteller, Produkt, CVE, Schweregrad] */
  fixed(current: Map<number, number>) {
    const out: [string, string, string, string, string, number][] = [];
    const { devices, sw, cves } = this.state,
      items = this.items;
    for (let i = 0; i < items.length; i += 4) {
      if (current.has(this.keyAt(i))) continue;
      const d = devices[items[i]],
        s = sw[items[i + 1]];
      out.push([d[1], d[2], s[0], s[1], cves[items[i + 2]], items[i + 3]]);
    }
    return out;
  }
}

const F = 6; // Felder pro Fund

export class ReportBuilder {
  devices: any[] = [];
  sw: any[] = [];
  cves: any[] = [];
  vers: string[] = [];
  paths: string[] = [];
  count = 0;
  newCount = 0;
  /** Lauf-Schlüssel (Gerät|CVE|Produkt) -> erste Installation; dient auch der Duplikaterkennung */
  currentKeys = new Map<number, number>();

  private f = new Int32Array(F * 65536);
  private stateItems = new Int32Array(4 * 65536);
  private stateCount = 0;
  private otherVersions = new Set<string>(); // selten: gleiche CVE in mehreren Versionen desselben Produkts
  private devIndex = new Map<string, number>();
  private swIndex = new Map<string, number>();
  private cveIndex = new Map<string, number>();
  private verIndex = new Map<string, number>();
  private pathIndex = new Map<string, number>();
  private evIndex = new Map<string, number>(); // "Gerät|Software|Version" -> Nummer der Installation
  private evPaths: number[][] = [];
  private evKeys: [number, number, number][] = [];
  private dayCache = new Map<string, number>();
  private findingsPerCve: number[] = [];
  private machines = new Map<string, Row>();
  private recs = new Map<string, Row>();

  constructor(
    machines: Row[] | null,
    recommendations: Row[] | null,
    private previous: PreviousRun | null,
  ) {
    for (const m of machines || []) this.machines.set(m.id, m);
    for (const r of recommendations || []) this.recs.set(r.id, r);
  }

  add(row: Row) {
    const cveId = row.cveId;
    if (!cveId) return;
    const deviceId = String(row.deviceId);
    const vendor = String(row.softwareVendor ?? "");
    const product = String(row.softwareName ?? "");

    let d = this.devIndex.get(deviceId);
    if (d === undefined) {
      const m = this.machines.get(deviceId) || {};
      d = this.devices.length;
      this.devIndex.set(deviceId, d);
      this.devices.push({
        id: deviceId,
        n: first(m.computerDnsName, row.deviceName, deviceId),
        g: first(row.rbacGroupName, m.rbacGroupName, "Ohne Gruppe"),
        os: first(row.osPlatform, m.osPlatform, "Unbekannt"),
        t: ((m.machineTags as string[]) || []).filter(Boolean),
        x: first(m.exposureLevel, ""),
        l: m.lastSeen ? String(m.lastSeen).slice(0, 10) : "",
      });
    }

    const swKey = `${vendor}|${product}`;
    let s = this.swIndex.get(swKey);
    if (s === undefined) {
      s = this.sw.length;
      this.swIndex.set(swKey, s);
      this.sw.push({ v: vendor, n: product, r: "", rv: "", u: false });
    }
    const sw = this.sw[s];
    if (!sw.r) {
      const rec = row.recommendationReference ? this.recs.get(row.recommendationReference) : undefined;
      if (rec) {
        sw.r = String(rec.recommendationName ?? "");
        sw.rv = String(rec.recommendedVersion ?? "");
      } else if (row.recommendedSecurityUpdate) sw.r = String(row.recommendedSecurityUpdate);
    }
    if (row.securityUpdateAvailable === true) sw.u = true;

    const sev = sevCode(row.vulnerabilitySeverityLevel);
    const exp = exploitCode(row.exploitabilityLevel);
    const cvss = Number(row.cvssScore) || 0;
    let c = this.cveIndex.get(cveId);
    let entry: any;
    if (c === undefined) {
      c = this.cves.length;
      this.cveIndex.set(cveId, c);
      entry = { id: cveId, s: sev, c: cvss, e: exp };
      this.cves.push(entry);
      this.findingsPerCve.push(0);
    } else {
      entry = this.cves[c];
      entry.s = Math.max(entry.s, sev);
      entry.e = Math.max(entry.e, exp);
      entry.c = Math.max(entry.c, cvss);
    }
    if (!entry.kb && row.recommendedSecurityUpdateId) {
      entry.kb = String(row.recommendedSecurityUpdateId);
      entry.kbn = String(row.recommendedSecurityUpdate ?? "");
      entry.kbu = String(row.recommendedSecurityUpdateUrl ?? "");
    }

    const verText = String(row.softwareVersion ?? "");
    let v = this.verIndex.get(verText);
    if (v === undefined) {
      v = this.vers.length;
      this.verIndex.set(verText, v);
      this.vers.push(verText);
    }

    // Fundstellen sind für alle CVEs derselben Installation gleich
    const evKey = `${d}|${s}|${v}`;
    let e = this.evIndex.get(evKey);
    if (e === undefined) {
      e = this.evKeys.length;
      this.evIndex.set(evKey, e);
      this.evKeys.push([d, s, v]);
      const set = new Set<number>();
      for (const p of [...(row.diskPaths || []), ...(row.registryPaths || [])]) {
        if (!p) continue;
        let pi = this.pathIndex.get(p);
        if (pi === undefined) {
          pi = this.paths.length;
          this.pathIndex.set(p, pi);
          this.paths.push(p);
        }
        set.add(pi);
      }
      this.evPaths.push([...set].sort((a, b) => a - b));
    }

    // Stabiler Schlüssel über Läufe hinweg (Indizes ändern sich, IDs nicht)
    const key = runKey(deviceId, cveId, vendor, product);
    const firstInstall = this.currentKeys.get(key);
    if (firstInstall === undefined) {
      this.currentKeys.set(key, e);
      if ((this.stateCount + 1) * 4 > this.stateItems.length) this.stateItems = grow(this.stateItems);
      this.stateItems.set([d, s, c, sev], this.stateCount * 4);
      this.stateCount++;
    } else if (firstInstall === e) {
      return; // doppelte Zeile
    } else {
      const other = `${e}|${c}`;
      if (this.otherVersions.has(other)) return;
      this.otherVersions.add(other);
    }

    const date = String(row.firstSeenTimestamp ?? "").slice(0, 10);
    let day = this.dayCache.get(date);
    if (day === undefined) {
      day = unixDay(date);
      this.dayCache.set(date, day);
    }
    const isNew = this.previous && !this.previous.keys.has(key) ? 1 : 0;

    if ((this.count + 1) * F > this.f.length) this.f = grow(this.f);
    this.f.set([d, s, c, v, day, isNew], this.count * F);
    this.count++;
    this.newCount += isNew;
    this.findingsPerCve[c]++;
  }

  /** Nach dem letzten add(): Hilfstabellen freigeben, die nur zum Einlesen gebraucht werden. */
  finishInput() {
    this.machines.clear();
    this.recs.clear();
    this.devIndex.clear();
    this.swIndex.clear();
    this.cveIndex.clear();
    this.verIndex.clear();
    this.pathIndex.clear();
    this.evIndex.clear();
    this.otherVersions.clear();
    this.previous = null;
  }

  evidenceArray(): [number, number, number, number[]][] {
    const out: [number, number, number, number[]][] = [];
    this.evKeys.forEach(([d, s, v], i) => {
      if (this.evPaths[i].length) out.push([d, s, v, this.evPaths[i]]);
    });
    return out;
  }

  /** Funde als JSON-Array, stückweise erzeugt, damit nie der ganze Text auf einmal im Speicher liegt. */
  *findingsJson(chunk = 20000): Generator<string> {
    yield "[";
    for (let start = 0; start < this.count; start += chunk) {
      const parts: string[] = [];
      for (let i = start; i < Math.min(this.count, start + chunk); i++) {
        const o = i * F,
          f = this.f;
        parts.push(`[${f[o]},${f[o + 1]},${f[o + 2]},${f[o + 3]},${f[o + 4]},${f[o + 5]}]`);
      }
      yield (start ? "," : "") + parts.join(",");
    }
    yield "]";
  }

  /** Funde als Bytes (Int32, little-endian) ohne Kopie des Arrays */
  findingsBuffer(): Buffer {
    return Buffer.from(this.f.buffer, 0, this.count * F * 4);
  }

  state(time: Date): FindingState {
    return {
      v: 2,
      time: time.toISOString(),
      devices: this.devices.map((d) => [d.id, d.n, d.g]),
      sw: this.sw.map((s) => [s.v, s.n]),
      cves: this.cves.map((c) => c.id),
      items: Array.from(this.stateItems.subarray(0, this.stateCount * 4)),
    };
  }

  snapshot(date: Date): Snapshot {
    const s = [0, 0, 0, 0];
    let e = 0;
    this.cves.forEach((c, i) => {
      s[c.s] += this.findingsPerCve[i];
      if (c.e > 0) e += this.findingsPerCve[i];
    });
    return { d: localDate(date), t: this.count, s, e, dv: this.devices.length, c: this.cves.length };
  }
}

function grow(a: Int32Array) {
  const b = new Int32Array(a.length * 2);
  b.set(a);
  return b;
}

export const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Zählt Delta-Ereignisse (New/Fixed) pro Tag und Schweregrad, seitenweise statt alle Ereignisse zu sammeln. */
export class ChangeSummary {
  private days = new Map<string, { d: string; n: number[]; x: number[] }>();
  add(ch: Row) {
    if (ch.status !== "New" && ch.status !== "Fixed") return;
    const day = new Date(ch.eventTimestamp).toISOString().slice(0, 10);
    let e = this.days.get(day);
    if (!e) {
      e = { d: day, n: [0, 0, 0, 0], x: [0, 0, 0, 0] };
      this.days.set(day, e);
    }
    (ch.status === "New" ? e.n : e.x)[sevCode(ch.vulnerabilitySeverityLevel)]++;
  }
  result() {
    return [...this.days.values()].sort((a, b) => a.d.localeCompare(b.d));
  }
}

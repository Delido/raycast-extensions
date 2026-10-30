import { createWriteStream } from "fs";
import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import {
  ChangeSummary,
  FindingState,
  PreviousRun,
  ReportBuilder,
  Snapshot,
  slimMachine,
  slimRecommendation,
} from "./builder";
import { dataDir, reportFindingsPath, reportHtmlPath, reportJsonPath, reportsDir, templatePath } from "./data";
import { DEFAULT_API_BASE, Log, fetchPages, getToken } from "./defender";
import { demoData, demoHistory } from "./demo";
import { Credentials } from "./vault";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GenerateOptions {
  creds?: Credentials;
  tenantName: string;
  demo: boolean;
  log: Log;
  demoScale?: number;
}

// Kleine Seiten: Raycast erlaubt pro Befehl nur 100 MB Heap, eine 50.000er-Seite allein wäre schon zu groß.
const VULN_PAGE_SIZE = 5000;
const CHANGES_PAGE_SIZE = 10000;

const statePath = () => path.join(dataDir(), "findings-state.v2.json.gz");
const historyPath = () => path.join(dataDir(), "history.json");

async function readState(): Promise<FindingState | null> {
  try {
    const s = JSON.parse(gunzipSync(await readFile(statePath())).toString("utf8")) as FindingState;
    return s.v === 2 ? s : null;
  } catch {
    return null;
  }
}

async function readHistory(): Promise<Snapshot[]> {
  try {
    return JSON.parse(await readFile(historyPath(), "utf8")) as Snapshot[];
  } catch {
    return [];
  }
}

const seconds = (since: number) => `${Math.round((Date.now() - since) / 1000)} s`;
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "_");
// "</" maskieren, damit nichts aus den Daten das <script>-Element im HTML beenden kann
const safe = (s: string) => s.replace(/<\//g, "<\\/");

async function writeChunks(file: string, chunks: Iterable<string>) {
  const out = createWriteStream(file, "utf8");
  for (const c of chunks) if (!out.write(c)) await new Promise((r) => out.once("drain", r));
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
}

export async function generateReport(opts: GenerateOptions) {
  const { log } = opts;
  const started = Date.now();
  await mkdir(reportsDir(), { recursive: true });
  await mkdir(dataDir(), { recursive: true });

  let machines: any[] | null = null,
    recommendations: any[] | null = null,
    hadMachines = false;
  let changes: ChangeSummary | null = new ChangeSummary();
  let previousState: FindingState | null;
  let previous: PreviousRun | null;
  let builder: ReportBuilder;

  if (opts.demo) {
    log("Erzeuge Demodaten …");
    const demo = demoData(opts.demoScale ?? 1);
    ({ machines, recommendations } = demo);
    hadMachines = true;
    for (const ch of demo.changes) changes.add(ch);
    previousState = demo.previous;
    previous = new PreviousRun(previousState);
    builder = new ReportBuilder(machines, recommendations, previous);
    for (const row of demo.rows) builder.add(row);
  } else {
    if (!opts.creds) throw new Error("Keine Zugangsdaten.");
    const base = opts.creds.apiBaseUrl || DEFAULT_API_BASE;
    log("Melde an …");
    const token = await getToken(opts.creds);
    previousState = await readState();

    // Geräte und Empfehlungen zuerst, damit die Funde direkt beim Abruf verknüpft werden können
    log("Lade Geräte (Tags, Exposure) …");
    const m: any[] = [];
    if (
      await fetchPages(
        base,
        "/api/machines?$top=10000",
        token,
        (p) => {
          for (const x of p) m.push(slimMachine(x as any));
        },
        log,
        true,
      )
    ) {
      machines = m;
      hadMachines = true;
    }
    log("Lade Sicherheitsempfehlungen …");
    const r: any[] = [];
    if (
      await fetchPages(
        base,
        "/api/recommendations",
        token,
        (p) => {
          for (const x of p) r.push(slimRecommendation(x as any));
        },
        log,
        true,
      )
    )
      recommendations = r;

    log("Lade Schwachstellen pro Gerät (Export-API) …");
    previous = previousState ? new PreviousRun(previousState) : null;
    builder = new ReportBuilder(machines, recommendations, previous);
    machines = null; // liegt jetzt im Builder
    await fetchPages(
      base,
      `/api/machines/SoftwareVulnerabilitiesByMachine?pageSize=${VULN_PAGE_SIZE}`,
      token,
      (page) => {
        for (const row of page) builder.add(row as any);
      },
      log,
    );

    log("Lade Änderungen der letzten 14 Tage …");
    const since = new Date(Date.now() - 14 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    const ok = await fetchPages(
      base,
      `/api/machines/SoftwareVulnerabilityChangesByMachine?pageSize=${CHANGES_PAGE_SIZE}&sinceTime=${since}`,
      token,
      (p) => {
        for (const ch of p) changes!.add(ch as any);
      },
      log,
      true,
    );
    if (!ok) changes = null;
  }
  log(`Daten geladen in ${seconds(started)}`);

  const generated = new Date();
  const snap = builder.snapshot(generated);
  builder.finishInput();
  const fixed = previous ? previous.fixed(builder.currentKeys) : [];
  previous = null;
  builder.currentKeys.clear();

  // Verlauf: pro Tag ein Eintrag, der letzte Lauf des Tages gewinnt. Demo-Läufe verändern die echten Daten nicht.
  let history: Snapshot[];
  if (opts.demo) history = demoHistory(snap);
  else {
    history = [...(await readHistory()).filter((h) => h.d !== snap.d), snap].sort((a, b) => a.d.localeCompare(b.d));
    await writeFile(historyPath(), JSON.stringify(history), "utf8");
    await writeFile(statePath(), gzipSync(JSON.stringify(builder.state(generated))));
  }

  const head = {
    meta: {
      generated: generated.toISOString(),
      prevRun: previousState?.time ?? null,
      tenant: opts.tenantName,
      demo: opts.demo,
      sources: { machines: hadMachines, recommendations: recommendations !== null, changes: changes !== null },
    },
    devices: builder.devices,
    sw: builder.sw,
    cves: builder.cves,
    vers: builder.vers,
    paths: builder.paths,
    history,
    changes: changes ? changes.result() : [],
    fixed,
    ev: builder.evidenceArray(),
  };
  const headJson = safe(JSON.stringify(head));
  const jsonChunks = function* () {
    yield headJson.slice(0, -1) + ',"f":';
    yield* builder.findingsJson();
    yield "}";
  };

  const template = await readFile(templatePath(), "utf8");
  const [before, after] = template.split("__REPORT_DATA__");
  const datedPath = path.join(reportsDir(), `Defender-Schwachstellen_${stamp(generated)}.html`);
  await writeChunks(
    datedPath,
    (function* () {
      yield before;
      yield* jsonChunks();
      yield after;
    })(),
  );
  await copyFile(datedPath, reportHtmlPath());
  // Für Raycast: Stammdaten als JSON, Funde binär (Int32, 6 Werte je Fund) – passt so in Raycasts 100-MB-Heap
  await writeFile(reportFindingsPath(), builder.findingsBuffer());
  await writeFile(reportJsonPath(), headJson, "utf8");

  log("");
  log(
    `Fertig in ${seconds(started)}: ${builder.count.toLocaleString("de-DE")} Funde, ${snap.c} CVEs, ${snap.dv} Geräte (kritisch: ${snap.s[3]}, hoch: ${snap.s[2]})`,
  );
  if (previousState) log(`Seit letztem Lauf: ${builder.newCount} neu, ${fixed.length} behoben`);
  log(`Report: ${datedPath}`);
  return { path: datedPath, findings: builder.count, newCount: builder.newCount, fixed: fixed.length };
}

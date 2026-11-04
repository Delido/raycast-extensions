import { Action, ActionPanel, Clipboard, Color, Icon, Keyboard, List, showHUD } from "@raycast/api";
import {
  CVE,
  CveAgg,
  DEV,
  DeviceAgg,
  EXP,
  EXP_SHORT,
  Model,
  SEV,
  SW,
  SoftwareAgg,
  VER,
  compact,
  defenderCveUrl,
  defenderDeviceUrl,
  fmt,
  groupNames,
  nvdUrl,
  openReport,
  privateFilter,
  RawReport,
  tagNames,
} from "./data";
import { useMemo, useState } from "react";

const SEV_COLOR = [Color.SecondaryText, Color.Yellow, Color.Orange, Color.Red];
export const sevIcon = (s: number) => ({ source: Icon.CircleFilled, tintColor: SEV_COLOR[s] });
const expIcon = (e: number) => (e > 0 ? { source: Icon.Warning, tintColor: Color.Red } : undefined);
const MAX_ROWS = 25;

function pathsMd(paths: string[]) {
  if (!paths.length) return "";
  const files = paths.filter((p) => !/^HKEY_/i.test(p)),
    reg = paths.filter((p) => /^HKEY_/i.test(p));
  return [...files.map((p) => `  - \`${p}\``), ...reg.map((p) => `  - \`${p}\` _(Registry)_`)].join("\n");
}
const more = (total: number) =>
  total > MAX_ROWS ? `\n_… und ${fmt(total - MAX_ROWS)} weitere. Vollständige Liste im Report._\n` : "";
const newBadge = (yes: boolean) => (yes ? " **🆕**" : "");
const swNameOf = (m: Model, si: number) => m.swByIndex.get(si)?.name ?? m.raw.sw[si].n;
const swActionOf = (m: Model, si: number) => m.swByIndex.get(si)?.action ?? "";
const copy = async (text: string) => {
  await Clipboard.copy(text);
  await showHUD("In die Zwischenablage kopiert");
};
/** Namen der Geräte, für die pred zutrifft (für "kopieren"-Aktionen, erst beim Klick berechnet) */
const deviceNames = (m: Model, pred: (o: number) => boolean) =>
  [...new Set(m.select(pred).map((o) => m.raw.devices[m.raw.f[o + DEV]].n))].sort().join("\n");

/* ---------- Markdown für die Detailansicht ---------- */

export function softwareMarkdown(m: Model, a: SoftwareAgg) {
  const f = m.raw.f;
  const mine = m.select((o) => f[o + SW] === a.i);
  const byDev = new Map<number, { n: number; v: number; crit: number; fresh: boolean }>();
  const cveSet = new Set<number>();
  for (const o of mine) {
    const di = f[o + DEV];
    const x = byDev.get(di) || { n: 0, v: f[o + VER], crit: 0, fresh: false };
    x.n++;
    if (m.raw.cves[f[o + CVE]].s === 3) x.crit++;
    x.fresh = x.fresh || m.isNew(o);
    byDev.set(di, x);
    cveSet.add(f[o + CVE]);
  }
  const devs = [...byDev.entries()].sort((p, q) => q[1].crit - p[1].crit || q[1].n - p[1].n);
  const cves = [...cveSet].map((ci) => m.raw.cves[ci]).sort((p, q) => q.s - p.s || q.e - p.e || q.c - p.c);
  return [
    `## ${a.name}`,
    `**Maßnahme:** ${a.action}${a.updateAvailable ? "" : " _(kein Update verfügbar)_"}`,
    `### Verwundbare CVEs`,
    cves
      .slice(0, MAX_ROWS)
      .map((c) => `- ${SEV[c.s]} · **${c.id}** · CVSS ${c.c ? c.c.toFixed(1) : "–"}${c.e ? " · ⚠ " + EXP[c.e] : ""}`)
      .join("\n") + more(cves.length),
    `### Betroffene Geräte und Fundstellen`,
    devs
      .slice(0, MAX_ROWS)
      .map(
        ([di, x]) =>
          `- **${m.raw.devices[di].n}** (${m.raw.devices[di].g}) · Version ${m.raw.vers[x.v]} · ${x.n} CVEs${newBadge(x.fresh)}\n${pathsMd(m.evidence(di, a.i, x.v))}`,
      )
      .join("\n") + more(devs.length),
  ].join("\n\n");
}

export function cveMarkdown(m: Model, b: CveAgg) {
  const f = m.raw.f;
  const mine = m.select((o) => f[o + CVE] === b.i);
  return [
    `## ${b.id}`,
    `${SEV[b.s]} · CVSS ${b.c ? b.c.toFixed(1) : "–"} · ${EXP[b.e]}`,
    b.kb
      ? `**Empfohlenes Sicherheitsupdate:** [KB${b.kb}](${b.kbu || "https://catalog.update.microsoft.com/Search.aspx?q=KB" + b.kb})`
      : "",
    `### Software`,
    b.sws.map((si) => `- **${swNameOf(m, si)}** → ${swActionOf(m, si)}`).join("\n"),
    `### Betroffene Geräte und Fundstellen`,
    mine
      .slice(0, MAX_ROWS)
      .map((o) => {
        const d = m.raw.devices[f[o + DEV]];
        return `- **${d.n}** (${d.g}) · Version ${m.raw.vers[f[o + VER]]}${newBadge(m.isNew(o))}\n${pathsMd(m.evidence(f[o + DEV], f[o + SW], f[o + VER]))}`;
      })
      .join("\n") + more(mine.length),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function deviceMarkdown(m: Model, d: DeviceAgg) {
  const f = m.raw.f;
  const mine = m.select((o) => f[o + DEV] === d.i);
  const bySw = new Map<number, { n: number; v: number; crit: number; high: number; fresh: number }>();
  for (const o of mine) {
    const x = bySw.get(f[o + SW]) || { n: 0, v: f[o + VER], crit: 0, high: 0, fresh: 0 };
    const s = m.raw.cves[f[o + CVE]].s;
    x.n++;
    if (s === 3) x.crit++;
    if (s === 2) x.high++;
    if (m.isNew(o)) x.fresh++;
    bySw.set(f[o + SW], x);
  }
  const rows = [...bySw.entries()].sort((p, q) => q[1].crit - p[1].crit || q[1].high - p[1].high || q[1].n - p[1].n);
  return [
    `## ${d.name}`,
    `${d.group} · ${d.os}${d.tags.length ? " · " + d.tags.join(", ") : ""}`,
    `### Zu aktualisierende Software`,
    rows
      .slice(0, MAX_ROWS)
      .map(
        ([si, x]) =>
          `- **${swNameOf(m, si)}** ${m.raw.vers[x.v]} · ${x.n} CVEs (${x.crit} krit., ${x.high} hoch)${x.fresh ? ` · 🆕 ${x.fresh}` : ""}\n  → ${swActionOf(m, si)}\n${pathsMd(m.evidence(d.i, si, x.v))}`,
      )
      .join("\n") + more(rows.length),
  ].join("\n\n");
}

/* ---------- Listeneinträge ---------- */

// Die Detail-Markdowns laufen über alle Funde. Raycast zeigt nur das Detail der ausgewählten Zeile,
// deshalb wird nur dafür gerechnet und das Ergebnis je Modell zwischengespeichert.
const mdCache = new WeakMap<Model, Map<string, string>>();
function detailMarkdown(m: Model, id: string, make: () => string): string {
  let cache = mdCache.get(m);
  if (!cache) mdCache.set(m, (cache = new Map()));
  let md = cache.get(id);
  if (md === undefined) cache.set(id, (md = make()));
  return md;
}
const itemDetail = (show: boolean, selected: boolean, m: Model, id: string, make: () => string) =>
  show ? <List.Item.Detail markdown={selected ? detailMarkdown(m, id, make) : ""} /> : undefined;

export const softwareId = (a: SoftwareAgg) => "sw:" + a.i;
export const cveId = (b: CveAgg) => "cve:" + b.i;
export const deviceId = (d: DeviceAgg) => "dev:" + d.i;

const reportAction = (hash: string) => (
  <Action title="Im Report öffnen" icon={Icon.Globe} onAction={() => openReport(hash)} />
);

export function SoftwareItem({
  m,
  a,
  title,
  showDetail,
  selected,
  toggleDetail,
}: {
  m: Model;
  a: SoftwareAgg;
  title?: string;
  showDetail: boolean;
  selected: boolean;
  toggleDetail: () => void;
}) {
  return (
    <List.Item
      id={softwareId(a)}
      icon={sevIcon(a.sevCves[3] ? 3 : a.sevCves[2] ? 2 : a.sevCves[1] ? 1 : 0)}
      title={title ?? a.name}
      subtitle={showDetail ? undefined : a.action}
      keywords={[a.key, a.action]}
      accessories={
        showDetail
          ? [{ text: compact(a.score) }]
          : [
              { text: `${fmt(a.devCount)} Geräte`, icon: Icon.Monitor },
              { tag: { value: `${a.sevCves[3]} krit.`, color: a.sevCves[3] ? Color.Red : Color.SecondaryText } },
              { tag: { value: `${a.sevCves[2]} hoch`, color: a.sevCves[2] ? Color.Orange : Color.SecondaryText } },
              ...(a.maxE ? [{ icon: expIcon(a.maxE), tooltip: EXP[a.maxE] }] : []),
              ...(a.recent ? [{ text: `+${fmt(a.recent)}`, tooltip: m.newLabel }] : []),
              { text: compact(a.score), tooltip: "Priorität" },
            ]
      }
      detail={itemDetail(showDetail, selected, m, softwareId(a), () => softwareMarkdown(m, a))}
      actions={
        <ActionPanel>
          {reportAction("sw=" + encodeURIComponent(a.key))}
          <Action
            title={showDetail ? "Details ausblenden" : "Details anzeigen"}
            icon={Icon.Sidebar}
            onAction={toggleDetail}
            shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
          />
          <Action.CopyToClipboard
            title="Maßnahme kopieren"
            content={`${a.name}: ${a.action}`}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <Action
            title="Betroffene Geräte kopieren"
            icon={Icon.Clipboard}
            onAction={() => copy(deviceNames(m, (o) => m.raw.f[o + SW] === a.i))}
          />
        </ActionPanel>
      }
    />
  );
}

export function CveItem({
  m,
  b,
  showDetail,
  selected,
  toggleDetail,
}: {
  m: Model;
  b: CveAgg;
  showDetail: boolean;
  selected: boolean;
  toggleDetail: () => void;
}) {
  const swNames = b.sws.map((si) => swNameOf(m, si)).join(", ");
  return (
    <List.Item
      id={cveId(b)}
      icon={sevIcon(b.s)}
      title={b.id}
      subtitle={showDetail ? undefined : swNames}
      keywords={[swNames]}
      accessories={
        showDetail
          ? [{ text: fmt(b.devCount), icon: Icon.Monitor }]
          : [
              { text: `${fmt(b.devCount)} Geräte`, icon: Icon.Monitor },
              { text: b.c ? `CVSS ${b.c.toFixed(1)}` : undefined },
              ...(b.e ? [{ tag: { value: EXP_SHORT[b.e], color: Color.Red }, icon: expIcon(b.e) }] : []),
              ...(b.recent ? [{ text: `+${fmt(b.recent)}`, tooltip: m.newLabel }] : []),
            ]
      }
      detail={itemDetail(showDetail, selected, m, cveId(b), () => cveMarkdown(m, b))}
      actions={
        <ActionPanel>
          {reportAction("cve=" + encodeURIComponent(b.id))}
          <Action.OpenInBrowser title="In Defender öffnen" url={defenderCveUrl(b.id)} />
          <Action.OpenInBrowser title="NVD öffnen" url={nvdUrl(b.id)} />
          <Action
            title={showDetail ? "Details ausblenden" : "Details anzeigen"}
            icon={Icon.Sidebar}
            onAction={toggleDetail}
            shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
          />
          <Action.CopyToClipboard title="CVE kopieren" content={b.id} shortcut={Keyboard.Shortcut.Common.Copy} />
          <Action
            title="Betroffene Geräte kopieren"
            icon={Icon.Clipboard}
            onAction={() => copy(deviceNames(m, (o) => m.raw.f[o + CVE] === b.i))}
          />
        </ActionPanel>
      }
    />
  );
}

export function DeviceItem({
  m,
  d,
  showDetail,
  selected,
  toggleDetail,
}: {
  m: Model;
  d: DeviceAgg;
  showDetail: boolean;
  selected: boolean;
  toggleDetail: () => void;
}) {
  const devicePaths = () => {
    const f = m.raw.f;
    return [
      ...new Set(m.select((o) => f[o + DEV] === d.i).flatMap((o) => m.evidence(d.i, f[o + SW], f[o + VER]))),
    ].join("\n");
  };
  return (
    <List.Item
      id={deviceId(d)}
      icon={{ source: Icon.Monitor, tintColor: d.sev[3] ? Color.Red : d.sev[2] ? Color.Orange : undefined }}
      title={d.name}
      subtitle={showDetail ? undefined : `${d.group} · ${d.os}`}
      keywords={[d.group, d.os, ...d.tags]}
      accessories={
        showDetail
          ? [{ text: compact(d.score) }]
          : [
              { text: `${fmt(d.n)} Funde` },
              { tag: { value: `${d.sev[3]} krit.`, color: d.sev[3] ? Color.Red : Color.SecondaryText } },
              { tag: { value: `${d.sev[2]} hoch`, color: d.sev[2] ? Color.Orange : Color.SecondaryText } },
              ...(d.maxE ? [{ icon: expIcon(d.maxE), tooltip: EXP[d.maxE] }] : []),
              ...(d.recent ? [{ text: `+${fmt(d.recent)}`, tooltip: m.newLabel }] : []),
            ]
      }
      detail={itemDetail(showDetail, selected, m, deviceId(d), () => deviceMarkdown(m, d))}
      actions={
        <ActionPanel>
          {reportAction("dev=" + encodeURIComponent(d.name))}
          {d.id && !m.raw.meta.demo ? (
            <Action.OpenInBrowser title="In Defender öffnen" url={defenderDeviceUrl(d.id)} />
          ) : null}
          <Action
            title={showDetail ? "Details ausblenden" : "Details anzeigen"}
            icon={Icon.Sidebar}
            onAction={toggleDetail}
            shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
          />
          <Action.CopyToClipboard
            title="Gerätename kopieren"
            content={d.name}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <Action title="Fundstellen kopieren" icon={Icon.Clipboard} onAction={() => copy(devicePaths())} />
        </ActionPanel>
      }
    />
  );
}

/* ---------- Gerätefilter (Gruppe / Tag) ---------- */

export const ALL_DEVICES = "__alle__";

/**
 * Gerätefilter für Suche und Top-Maßnahmen. Startet mit „alle außer private Geräte“
 * (Einstellung „Private Geräte“ bzw. automatisch erkannt); jede andere Auswahl gilt bis zum Schließen.
 */
export function useDeviceFilter(raw?: RawReport) {
  const [chosen, setChosen] = useState<string | null>(null);
  const start = useMemo(() => (raw ? privateFilter(raw.devices) || ALL_DEVICES : ALL_DEVICES), [raw]);
  const value = chosen ?? start;
  return { value, filter: value === ALL_DEVICES ? undefined : value, setValue: setChosen };
}

/** "#privat" → "Tag privat", "!#privat" → "außer Tag privat", "!Gruppe" → "außer Gruppe" */
export function filterLabel(filter: string): string {
  if (filter.startsWith("#")) return `Tag ${filter.slice(1)}`;
  if (filter.startsWith("!#")) return `außer Tag ${filter.slice(2)}`;
  if (filter.startsWith("!")) return `außer ${filter.slice(1)}`;
  return filter;
}

export function DeviceFilterDropdown({
  raw,
  value,
  onChange,
}: {
  raw: RawReport;
  value: string;
  onChange: (value: string) => void;
}) {
  const groups = groupNames(raw),
    tags = tagNames(raw);
  return (
    <List.Dropdown tooltip="Geräte" value={value} onChange={onChange}>
      <List.Dropdown.Item title="Alle Geräte" value={ALL_DEVICES} />
      <List.Dropdown.Section title="Gruppe">
        {groups.map((g) => (
          <List.Dropdown.Item key={g} title={g} value={g} />
        ))}
      </List.Dropdown.Section>
      <List.Dropdown.Section title="Alle außer Gruppe">
        {groups.map((g) => (
          <List.Dropdown.Item key={`!${g}`} title={`außer ${g}`} value={`!${g}`} />
        ))}
      </List.Dropdown.Section>
      {tags.length > 0 && (
        <List.Dropdown.Section title="Tag">
          {tags.map((t) => (
            <List.Dropdown.Item key={`#${t}`} title={`Tag ${t}`} value={`#${t}`} />
          ))}
        </List.Dropdown.Section>
      )}
      {tags.length > 0 && (
        <List.Dropdown.Section title="Alle außer Tag">
          {tags.map((t) => (
            <List.Dropdown.Item key={`!#${t}`} title={`außer Tag ${t}`} value={`!#${t}`} />
          ))}
        </List.Dropdown.Section>
      )}
    </List.Dropdown>
  );
}

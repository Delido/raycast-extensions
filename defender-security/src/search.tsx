import { Action, ActionPanel, Icon, LaunchType, List, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { dateTime, fmt, loadModel } from "./lib/data";
import { CveItem, DeviceItem, SoftwareItem } from "./lib/views";

export default function Command() {
  const { data: m, isLoading, error } = usePromise(loadModel, []);
  const [query, setQuery] = useState("");
  const [showDetail, setShowDetail] = useState(true);
  const toggle = () => setShowDetail((x) => !x);

  // Eigene Filterung: bei leerer Suche die wichtigsten Einträge, sonst Treffer inkl. Pfadsuche
  const res = useMemo(() => {
    if (!m) return null;
    const q = query.trim().toLowerCase();
    const limit = q ? 50 : 8;
    const sw = q ? m.software.filter((a) => `${a.name} ${a.key} ${a.action}`.toLowerCase().includes(q)) : m.software;
    const cves = q ? m.cves.filter((b) => b.id.toLowerCase().includes(q)) : m.cves;
    const pathHits = q.length >= 3 ? m.devicesWithPath(q) : new Set<number>();
    const devs = q
      ? m.devices.filter(
          (d) => `${d.name} ${d.group} ${d.os} ${d.tags.join(" ")}`.toLowerCase().includes(q) || pathHits.has(d.i),
        )
      : m.devices;
    return {
      q,
      total: { sw: sw.length, cves: cves.length, devs: devs.length },
      sw: sw.slice(0, limit),
      cves: cves.slice(0, limit),
      devs: devs.slice(0, limit),
    };
  }, [m, query]);

  const count = (shown: number, total: number) => (shown < total ? `${fmt(shown)} von ${fmt(total)}` : fmt(total));

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      onSearchTextChange={setQuery}
      throttle
      isShowingDetail={showDetail && !!res && res.sw.length + res.cves.length + res.devs.length > 0}
      searchBarPlaceholder={
        m
          ? `CVE, Software, Gerät oder Pfad … (${fmt(m.cves.length)} CVEs, ${fmt(m.devices.length)} Geräte)`
          : "Lade Daten …"
      }
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Keine Daten"
          description={error.message}
          actions={
            <ActionPanel>
              <Action
                title="Report aktualisieren"
                icon={Icon.ArrowClockwise}
                onAction={() => launchCommand({ name: "refresh-report", type: LaunchType.UserInitiated })}
              />
            </ActionPanel>
          }
        />
      ) : null}
      {m && res ? (
        <>
          <List.Section
            title={res.q ? "Software" : "Wichtigste Maßnahmen"}
            subtitle={res.q ? count(res.sw.length, res.total.sw) : `Stand ${dateTime(m.generated)}`}
          >
            {res.sw.map((a) => (
              <SoftwareItem key={a.i} m={m} a={a} showDetail={showDetail} toggleDetail={toggle} />
            ))}
          </List.Section>
          <List.Section title={res.q ? "CVEs" : "Wichtigste CVEs"} subtitle={count(res.cves.length, res.total.cves)}>
            {res.cves.map((b) => (
              <CveItem key={b.i} m={m} b={b} showDetail={showDetail} toggleDetail={toggle} />
            ))}
          </List.Section>
          <List.Section
            title={res.q ? "Geräte" : "Am stärksten betroffene Geräte"}
            subtitle={count(res.devs.length, res.total.devs)}
          >
            {res.devs.map((d) => (
              <DeviceItem key={d.i} m={m} d={d} showDetail={showDetail} toggleDetail={toggle} />
            ))}
          </List.Section>
          <List.EmptyView
            icon={Icon.MagnifyingGlass}
            title="Keine Treffer"
            description="Gesucht wird in CVE-IDs, Software, Geräten, Gruppen, Tags und Pfaden."
          />
        </>
      ) : null}
    </List>
  );
}

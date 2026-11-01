import { Action, ActionPanel, Icon, LaunchType, List, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { buildModel, dateTime, fmt, groupNames, loadRaw, openReport, tagNames } from "./lib/data";
import { SoftwareItem } from "./lib/views";

const ALL = "__alle__";

export default function Command() {
  const { data: raw, isLoading, error } = usePromise(loadRaw, []);
  const [group, setGroup] = useState(ALL);
  const [showDetail, setShowDetail] = useState(false);
  const m = useMemo(() => (raw ? buildModel(raw, group === ALL ? undefined : group) : null), [raw, group]);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      searchBarPlaceholder="Software oder Maßnahme filtern …"
      searchBarAccessory={
        raw ? (
          <List.Dropdown tooltip="Gerätegruppe" storeValue onChange={setGroup}>
            <List.Dropdown.Item title="Alle Gruppen" value={ALL} />
            <List.Dropdown.Section title="Gruppe">
              {groupNames(raw).map((g) => (
                <List.Dropdown.Item key={g} title={g} value={g} />
              ))}
            </List.Dropdown.Section>
            <List.Dropdown.Section title="Alle außer Gruppe">
              {groupNames(raw).map((g) => (
                <List.Dropdown.Item key={`!${g}`} title={`außer ${g}`} value={`!${g}`} />
              ))}
            </List.Dropdown.Section>
            {tagNames(raw).length > 0 && (
              <List.Dropdown.Section title="Alle außer Tag">
                {tagNames(raw).map((t) => (
                  <List.Dropdown.Item key={`!#${t}`} title={`außer Tag ${t}`} value={`!#${t}`} />
                ))}
              </List.Dropdown.Section>
            )}
          </List.Dropdown>
        ) : null
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
      {m ? (
        <List.Section
          title={`Maßnahmen nach Priorität${group === ALL ? "" : " · " + filterLabel(group)}`}
          subtitle={`${fmt(m.count)} Funde · Stand ${dateTime(m.generated)}`}
        >
          {m.software.map((a, idx) => (
            <SoftwareItem
              key={a.i}
              m={m}
              a={a}
              title={`${idx + 1}. ${a.name}`}
              showDetail={showDetail}
              toggleDetail={() => setShowDetail((x) => !x)}
            />
          ))}
        </List.Section>
      ) : null}
      {m && !m.software.length ? (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title="Keine offenen Funde"
          actions={
            <ActionPanel>
              <Action title="Report öffnen" icon={Icon.Globe} onAction={() => openReport()} />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}

/** "!#privat" → "außer Tag privat", "!Gruppe" → "außer Gruppe" */
function filterLabel(filter: string): string {
  if (filter.startsWith("!#")) return `außer Tag ${filter.slice(2)}`;
  if (filter.startsWith("!")) return `außer ${filter.slice(1)}`;
  return filter;
}

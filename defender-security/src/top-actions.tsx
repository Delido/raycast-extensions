import { Action, ActionPanel, Icon, LaunchType, List, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { buildModel, dateTime, fmt, groupNames, loadRaw, openReport } from "./lib/data";
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
            {groupNames(raw).map((g) => (
              <List.Dropdown.Item key={g} title={g} value={g} />
            ))}
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
          title={`Maßnahmen nach Priorität${group === ALL ? "" : " · " + group}`}
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

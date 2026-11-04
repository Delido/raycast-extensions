import { Action, ActionPanel, Icon, LaunchType, List, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { buildModel, dateTime, fmt, loadRaw, openReport } from "./lib/data";
import { DeviceFilterDropdown, filterLabel, SoftwareItem, softwareId, useDeviceFilter } from "./lib/views";

export default function Command() {
  const { data: raw, isLoading, error } = usePromise(loadRaw, []);
  const { value, filter, setValue } = useDeviceFilter(raw);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const m = useMemo(() => (raw ? buildModel(raw, filter) : null), [raw, filter]);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      onSelectionChange={setSelectedId}
      searchBarPlaceholder="Software oder Maßnahme filtern …"
      searchBarAccessory={raw ? <DeviceFilterDropdown raw={raw} value={value} onChange={setValue} /> : null}
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
          title={`Maßnahmen nach Priorität${filter ? " · " + filterLabel(filter) : ""}`}
          subtitle={`${fmt(m.count)} Funde · Stand ${dateTime(m.generated)}`}
        >
          {m.software.map((a, idx) => (
            <SoftwareItem
              key={a.i}
              m={m}
              a={a}
              title={`${idx + 1}. ${a.name}`}
              showDetail={showDetail}
              selected={(selectedId ?? (m.software[0] && softwareId(m.software[0]))) === softwareId(a)}
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

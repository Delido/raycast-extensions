import { Action, ActionPanel, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useLocalStorage } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { primaryShortcut } from "./api";
import {
  CATEGORIES,
  Category,
  categoryOf,
  formatValue,
  round,
  sensorIcon,
  sparkline,
  stats,
  useSensors,
  valueColor,
} from "./sensors";
import { Sensor, SensorHistory } from "./webpipe";

type Filter = "all" | "favorites" | Category;

const HISTORY_ROWS: { key: keyof SensorHistory; title: string }[] = [
  { key: "seconds", title: "Seconds" },
  { key: "minutes", title: "Minutes" },
  { key: "fiveMinutes", title: "5-minute steps" },
  { key: "hours", title: "Hours" },
];

function unitLabel(unit: string): string {
  return ({ C: "°C", Mhz: "MHz", mb: "MB" } as Record<string, string>)[unit] ?? unit;
}

function withUnit(value: number, unit: string): string {
  const label = unitLabel(unit);
  return label ? `${round(value)} ${label}` : round(value);
}

function groupSensors(sensors: Sensor[]): [string, Sensor[]][] {
  const groups = new Map<string, Sensor[]>();
  for (const sensor of sensors) {
    const list = groups.get(sensor.group) ?? [];
    list.push(sensor);
    groups.set(sensor.group, list);
  }
  return [...groups];
}

function asText(sensors: Sensor[]): string {
  return groupSensors(sensors)
    .map(([group, list]) => [group, ...list.map((s) => `  ${s.name}: ${formatValue(s)}`)].join("\n"))
    .join("\n\n");
}

function SensorDetail({ sensor }: { sensor: Sensor }) {
  const rows = HISTORY_ROWS.filter((row) => sensor.history[row.key].length > 0).map((row) => {
    const values = sensor.history[row.key];
    const s = stats(values)!;
    return [
      `**${row.title}** (${values.length})`,
      "```",
      sparkline(values, 40),
      "```",
      `min ${withUnit(s.min, sensor.unit)} · avg ${withUnit(s.avg, sensor.unit)} · max ${withUnit(s.max, sensor.unit)}`,
    ].join("\n");
  });
  const markdown = [`# ${formatValue(sensor)}`, `${sensor.group} · ${sensor.name}`, ...rows].join("\n\n");

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Sensor" text={sensor.name} />
          <List.Item.Detail.Metadata.Label title="Device" text={sensor.group} />
          <List.Item.Detail.Metadata.Label title="Value" text={formatValue(sensor)} />
          <List.Item.Detail.Metadata.Label
            title="Range"
            text={`${withUnit(sensor.min, sensor.unit)} – ${withUnit(sensor.max, sensor.unit)}`}
          />
          <List.Item.Detail.Metadata.Label title="Type" text={sensor.type.replace(/Provider$/, "")} />
          <List.Item.Detail.Metadata.Label title="ID" text={sensor.uid} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function PcSensors() {
  const { sensors, error, isLoading, retry } = useSensors();
  const [filter, setFilter] = useState<Filter>("all");
  const [showingDetail, setShowingDetail] = useState(false);
  const { value: favorites = [], setValue: setFavorites } = useLocalStorage<string[]>("favorite-sensors", []);

  useEffect(() => {
    if (error) showToast({ style: Toast.Style.Failure, title: "SignalRGB", message: error.message });
  }, [error]);

  const visible = useMemo(() => {
    const all = sensors ?? [];
    if (filter === "all") return all;
    if (filter === "favorites") return all.filter((s) => favorites.includes(s.uid));
    return all.filter((s) => categoryOf(s) === filter);
  }, [sensors, filter, favorites]);

  const pinned = filter === "all" ? visible.filter((s) => favorites.includes(s.uid)) : [];

  const toggleFavorite = (sensor: Sensor) =>
    setFavorites(
      favorites.includes(sensor.uid) ? favorites.filter((uid) => uid !== sensor.uid) : [...favorites, sensor.uid],
    );

  const renderItem = (sensor: Sensor, section: string) => {
    const isFavorite = favorites.includes(sensor.uid);
    return (
      <List.Item
        key={`${section}-${sensor.id}`}
        icon={sensorIcon(sensor)}
        title={sensor.name}
        subtitle={section === "favorites" ? sensor.group : undefined}
        keywords={[sensor.group, sensor.type, sensor.unit]}
        accessories={
          showingDetail
            ? [{ tag: { value: formatValue(sensor), color: valueColor(sensor) } }]
            : [
                { text: sparkline(sensor.history.seconds, 20), tooltip: "Last 20 seconds" },
                ...(isFavorite ? [{ icon: Icon.Star, tooltip: "Favorite" }] : []),
                { tag: { value: formatValue(sensor), color: valueColor(sensor) } },
              ]
        }
        detail={showingDetail ? <SensorDetail sensor={sensor} /> : undefined}
        actions={
          <ActionPanel>
            <Action
              title={showingDetail ? "Hide Details" : "Show Details"}
              icon={Icon.Sidebar}
              onAction={() => setShowingDetail((v) => !v)}
            />
            <Action
              title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              icon={isFavorite ? Icon.StarDisabled : Icon.Star}
              shortcut={primaryShortcut("p", true)}
              onAction={() => toggleFavorite(sensor)}
            />
            <ActionPanel.Section>
              <Action.CopyToClipboard
                title="Copy Value"
                content={formatValue(sensor)}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action.CopyToClipboard
                title="Copy Sensor and Value"
                content={`${sensor.group} ${sensor.name}: ${formatValue(sensor)}`}
                shortcut={Keyboard.Shortcut.Common.CopyName}
              />
              <Action.CopyToClipboard title="Copy All Shown Sensors" content={asText(visible)} />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showingDetail}
      searchBarPlaceholder="Filter sensors..."
      searchBarAccessory={
        <List.Dropdown tooltip="Category" value={filter} onChange={(v) => setFilter(v as Filter)}>
          <List.Dropdown.Item title="All Sensors" value="all" icon={Icon.List} />
          <List.Dropdown.Item title="Favorites" value="favorites" icon={Icon.Star} />
          <List.Dropdown.Section>
            {CATEGORIES.map((c) => (
              <List.Dropdown.Item key={c.id} title={c.title} value={c.id} icon={c.icon} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Can't reach SignalRGB"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.RotateClockwise} onAction={retry} />
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView
          icon={Icon.Star}
          title={filter === "favorites" ? "No favorites yet" : "No sensors"}
          description={filter === "favorites" ? "Pin sensors with Ctrl+Shift+P" : undefined}
        />
      )}
      {pinned.length > 0 && (
        <List.Section title="Favorites">{pinned.map((s) => renderItem(s, "favorites"))}</List.Section>
      )}
      {groupSensors(visible).map(([group, list]) => (
        <List.Section key={group} title={group} subtitle={String(list.length)}>
          {list.map((s) => renderItem(s, group))}
        </List.Section>
      ))}
    </List>
  );
}

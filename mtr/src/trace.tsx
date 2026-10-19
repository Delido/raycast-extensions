import {
  Action,
  ActionPanel,
  Color,
  environment,
  getPreferenceValues,
  Icon,
  Keyboard,
  LaunchProps,
  List,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { latencyChart, svgDataUri } from "./chart";
import { startProbe } from "./probe";
import { Aggregator, asTable, HopRow, lossColor, ms, pct, sparkline } from "./stats";
import { addTarget, getTargets } from "./store";

const RECENT_KEY = "recent-traces";

export function primaryShortcut(key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut {
  return {
    macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
    Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
  };
}

async function rememberTarget(target: string) {
  const raw = await LocalStorage.getItem<string>(RECENT_KEY);
  const recent = (raw ? (JSON.parse(raw) as string[]) : []).filter((t) => t.toLowerCase() !== target.toLowerCase());
  await LocalStorage.setItem(RECENT_KEY, JSON.stringify([target, ...recent].slice(0, 10)));
}

function hopTitle(row: HopRow, hosts: Record<string, string>) {
  if (!row.addr) return "???";
  return hosts[row.addr] ?? row.addr;
}

function HopDetail({ row, hosts, intervalMs }: { row: HopRow; hosts: Record<string, string>; intervalMs: number }) {
  const textColor = environment.appearance === "dark" ? "#a0a4ab" : "#6b7280";
  const seconds = Math.round((row.rtts.length * intervalMs) / 1000);
  const chart = latencyChart({
    latency: row.rtts,
    loss: row.rtts.map((v) => (v === null ? 100 : 0)),
    width: 520,
    height: 170,
    textColor,
    leftLabel: `${seconds}s ago`,
    rightLabel: "now",
  });
  const addrs = Object.entries(row.addrs).sort((a, b) => b[1] - a[1]);
  const markdown = [`![Latency](${svgDataUri(chart)})`, "```", sparkline(row.rtts, 60), "```"].join("\n\n");

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Hop" text={`${row.ttl}. ${hopTitle(row, hosts)}`} />
          <List.Item.Detail.Metadata.TagList title="Loss">
            <List.Item.Detail.Metadata.TagList.Item
              text={`${pct(row.loss)} (${row.sent - row.recv} of ${row.sent})`}
              color={lossColor(row.loss)}
            />
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.Label title="Last" text={ms(row.last)} />
          <List.Item.Detail.Metadata.Label
            title="Best / Avg / Worst"
            text={`${ms(row.best)} / ${ms(row.avg)} / ${ms(row.worst)}`}
          />
          <List.Item.Detail.Metadata.Label title="StDev" text={ms(row.stdev)} />
          <List.Item.Detail.Metadata.Label title="Jitter" text={ms(row.jitter)} />
          <List.Item.Detail.Metadata.Separator />
          {addrs.length === 0 ? <List.Item.Detail.Metadata.Label title="Address" text="No reply" /> : null}
          {addrs.map(([addr, count]) => (
            <List.Item.Detail.Metadata.Label
              key={addr}
              title={addrs.length > 1 ? `Address (${Math.round((count / row.recv) * 100)}%)` : "Address"}
              text={hosts[addr] ? `${addr} · ${hosts[addr]}` : addr}
            />
          ))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export function TraceView({ target }: { target: string }) {
  const { traceInterval } = getPreferenceValues<Preferences>();
  const intervalMs = Math.max(200, Number(traceInterval) || 1000);
  const agg = useRef(new Aggregator());
  const [rows, setRows] = useState<HopRow[]>([]);
  const [hosts, setHosts] = useState<Record<string, string>>({});
  const [ip, setIp] = useState<string>();
  const [rounds, setRounds] = useState(0);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<Error>();
  const [showingDetail, setShowingDetail] = useState(false);

  useEffect(() => {
    rememberTarget(target);
  }, [target]);

  useEffect(() => {
    if (!running) return;
    setError(undefined);
    return startProbe(
      target,
      { intervalMs },
      {
        onStart: setIp,
        onRound: (round) => {
          agg.current.add(round);
          setRows(agg.current.rows());
          setRounds(agg.current.rounds);
        },
        onHost: (addr, name) => setHosts((h) => ({ ...h, [addr]: name })),
        onError: (e) => {
          setError(e);
          setRunning(false);
          showToast({ style: Toast.Style.Failure, title: "Trace failed", message: e.message });
        },
      },
    );
  }, [target, running]);

  const reset = () => {
    agg.current = new Aggregator();
    setRows([]);
    setRounds(0);
  };

  const last = rows[rows.length - 1];
  const reached = !!last && last.addr === ip;

  return (
    <List
      isLoading={running && rounds === 0}
      isShowingDetail={showingDetail}
      navigationTitle={`${target}${ip && ip !== target ? ` (${ip})` : ""} · ${rounds} rounds${running ? "" : " · paused"}`}
      searchBarPlaceholder="Filter hops..."
    >
      {error ? <List.EmptyView icon={Icon.ExclamationMark} title="Trace failed" description={error.message} /> : null}
      <List.Section
        title={reached || rows.length === 0 ? "Hops" : "Hops (target not reached)"}
        subtitle={rows.length ? `${rows.length}` : undefined}
      >
        {rows.map((row) => {
          const isTarget = row.addr !== undefined && row.addr === ip;
          return (
            <List.Item
              key={row.ttl}
              icon={{
                source: isTarget ? Icon.BullsEye : row.addr ? Icon.Dot : Icon.QuestionMarkCircle,
                tintColor: row.recv === 0 ? Color.SecondaryText : lossColor(row.loss),
              }}
              title={`${row.ttl}. ${hopTitle(row, hosts)}`}
              subtitle={!showingDetail && row.addr && hosts[row.addr] ? row.addr : undefined}
              keywords={[row.addr ?? "", hosts[row.addr ?? ""] ?? ""]}
              accessories={
                showingDetail
                  ? [{ tag: { value: pct(row.loss), color: lossColor(row.loss) } }]
                  : [
                      { text: sparkline(row.rtts, 15), tooltip: "Recent probes (× = lost)" },
                      { tag: { value: pct(row.loss), color: lossColor(row.loss) }, tooltip: "Loss" },
                      {
                        text: ms(row.avg),
                        tooltip: `Best ${ms(row.best)} · Worst ${ms(row.worst)} · Last ${ms(row.last)}`,
                      },
                    ]
              }
              detail={showingDetail ? <HopDetail row={row} hosts={hosts} intervalMs={intervalMs} /> : undefined}
              actions={
                <ActionPanel>
                  <Action
                    title={showingDetail ? "Hide Details" : "Show Details"}
                    icon={Icon.Sidebar}
                    onAction={() => setShowingDetail((v) => !v)}
                  />
                  <Action
                    title={running ? "Pause" : "Resume"}
                    icon={running ? Icon.Pause : Icon.Play}
                    shortcut={primaryShortcut("p")}
                    onAction={() => setRunning((v) => !v)}
                  />
                  <Action
                    title="Reset Statistics"
                    icon={Icon.RotateClockwise}
                    shortcut={primaryShortcut("r", true)}
                    onAction={reset}
                  />
                  <ActionPanel.Section>
                    <Action.CopyToClipboard
                      title="Copy as Text Table"
                      content={asTable(target, rows, hosts)}
                      shortcut={primaryShortcut("c", true)}
                    />
                    {row.addr ? (
                      <Action.CopyToClipboard
                        title="Copy Address"
                        content={row.addr}
                        shortcut={Keyboard.Shortcut.Common.CopyName}
                      />
                    ) : null}
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      title="Monitor This Target"
                      icon={Icon.Heartbeat}
                      shortcut={primaryShortcut("s")}
                      onAction={async () => {
                        await addTarget(target);
                        await showToast({
                          title: `Monitoring ${target}`,
                          message: "Checked by the background monitor",
                        });
                      }}
                    />
                    {row.addr && !isTarget ? (
                      <Action.Push
                        title="Trace to This Hop"
                        icon={Icon.ArrowRight}
                        target={<TraceView target={row.addr} />}
                      />
                    ) : null}
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

function TargetPicker() {
  const [searchText, setSearchText] = useState("");
  const { data } = usePromise(async () => {
    const raw = await LocalStorage.getItem<string>(RECENT_KEY);
    return { recent: raw ? (JSON.parse(raw) as string[]) : [], monitored: await getTargets() };
  });
  const text = searchText.trim();

  return (
    <List onSearchTextChange={setSearchText} searchBarPlaceholder="Host name or IP address, e.g. 1.1.1.1" filtering>
      {text ? (
        <List.Section title="Trace">
          <List.Item
            icon={Icon.Network}
            title={`Trace ${text}`}
            actions={
              <ActionPanel>
                <Action.Push title="Start Trace" icon={Icon.Play} target={<TraceView target={text} />} />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      <List.Section title="Monitored">
        {data?.monitored.map((t) => (
          <List.Item
            key={t.id}
            icon={Icon.Heartbeat}
            title={t.label || t.host}
            subtitle={t.label ? t.host : undefined}
            actions={
              <ActionPanel>
                <Action.Push title="Start Trace" icon={Icon.Play} target={<TraceView target={t.host} />} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Recent">
        {data?.recent.map((host) => (
          <List.Item
            key={host}
            icon={Icon.Clock}
            title={host}
            actions={
              <ActionPanel>
                <Action.Push title="Start Trace" icon={Icon.Play} target={<TraceView target={host} />} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

export default function Trace(props: LaunchProps<{ arguments: Arguments.Trace }>) {
  const target = props.arguments.target?.trim();
  return target ? <TraceView target={target} /> : <TargetPicker />;
}

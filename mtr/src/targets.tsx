import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  environment,
  Form,
  Icon,
  Keyboard,
  List,
  open,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { svgDataUri } from "./chart";
import { runChecks } from "./monitor";
import { timeLabel, windowChart, writeReport } from "./report";
import { lossColor, ms, pct, Sample, sparkline } from "./stats";
import {
  addTarget,
  clearSamples,
  getState,
  getTargets,
  MonitorEvent,
  readEvents,
  readSamples,
  removeTarget,
  Status,
  Target,
  TargetState,
  updateTarget,
} from "./store";
import { primaryShortcut, TraceView } from "./trace";

type Range = "1" | "24" | "168";

const STATUS: Record<Status, { icon: Icon; color: Color; label: string }> = {
  ok: { icon: Icon.CheckCircle, color: Color.Green, label: "OK" },
  degraded: { icon: Icon.Warning, color: Color.Orange, label: "Degraded" },
  down: { icon: Icon.XMarkCircle, color: Color.Red, label: "Down" },
  unknown: { icon: Icon.Circle, color: Color.SecondaryText, label: "Not checked yet" },
};

const EVENT_ICON: Record<MonitorEvent["kind"], { source: Icon; tintColor: Color }> = {
  down: { source: Icon.XMarkCircle, tintColor: Color.Red },
  degraded: { source: Icon.Warning, tintColor: Color.Orange },
  recovered: { source: Icon.CheckCircle, tintColor: Color.Green },
  route: { source: Icon.Shuffle, tintColor: Color.Blue },
  error: { source: Icon.ExclamationMark, tintColor: Color.Red },
};

interface Row {
  target: Target;
  state: TargetState;
  samples: Sample[];
}

async function loadRows(): Promise<Row[]> {
  const since = Date.now() - 7 * 86_400_000;
  const targets = await getTargets();
  return Promise.all(
    targets.map(async (target) => ({
      target,
      state: await getState(target.id),
      samples: await readSamples(target.id, since),
    })),
  );
}

async function openReport() {
  const path = await writeReport();
  await open(path);
}

function TargetForm({ target, onSaved }: { target?: Target; onSaved: () => void }) {
  const { pop } = useNavigation();
  const [hostError, setHostError] = useState<string>();
  return (
    <Form
      navigationTitle={target ? "Edit Target" : "Add Target"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={target ? "Save" : "Add Target"}
            onSubmit={async (values: { host: string; label: string }) => {
              const host = values.host.trim();
              if (!host || /\s/.test(host)) {
                setHostError("Enter a host name or IPv4 address");
                return;
              }
              if (target) await updateTarget(target.id, { host, label: values.label.trim() || undefined });
              else await addTarget(host, values.label.trim());
              onSaved();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="host"
        title="Host"
        placeholder="1.1.1.1 or example.com"
        defaultValue={target?.host}
        error={hostError}
        onChange={() => setHostError(undefined)}
      />
      <Form.TextField
        id="label"
        title="Name"
        placeholder="optional, e.g. Cloudflare DNS"
        defaultValue={target?.label}
      />
      <Form.Description text="The background monitor (command “Background Monitor”) checks all targets. Enable it once via its background refresh setting." />
    </Form>
  );
}

function EventList({ target }: { target?: Target }) {
  const { data, isLoading } = usePromise((id?: string) => readEvents(500, id), [target?.id]);
  return (
    <List isLoading={isLoading} navigationTitle={target ? `Events · ${target.label || target.host}` : "All Events"}>
      <List.EmptyView
        icon={Icon.CheckCircle}
        title="No events"
        description="Outages, recoveries and route changes appear here"
      />
      {data?.map((event, i) => (
        <List.Item
          key={`${event.t}-${i}`}
          icon={EVENT_ICON[event.kind]}
          title={event.message}
          subtitle={target ? undefined : event.host}
          accessories={[{ date: new Date(event.t), tooltip: new Date(event.t).toLocaleString() }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Event"
                content={`${new Date(event.t).toLocaleString()} ${event.host}: ${event.message}${event.from ? `\nfrom ${event.from}\nto   ${event.to}` : ""}`}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function TargetDetail({ row, range }: { row: Row; range: Range }) {
  const { target, state, samples } = row;
  const hours = Number(range);
  const textColor = environment.appearance === "dark" ? "#a0a4ab" : "#6b7280";
  const inRange = samples.filter((s) => s.t >= Date.now() - hours * 3_600_000);
  const reached = inRange.filter((s) => s.avg !== undefined);
  const avg = reached.length ? reached.reduce((a, s) => a + s.avg!, 0) / reached.length : undefined;
  const loss = inRange.length ? inRange.reduce((a, s) => a + s.loss, 0) / inRange.length : 0;
  const last = state.lastSample;
  const chart = windowChart(samples, hours, { width: 520, textColor });
  const hops = (last?.hops ?? [])
    .map(([addr, hopLoss, hopAvg], i) => {
      const name = addr ? (state.hosts[addr] ?? addr) : "???";
      return `| ${i + 1} | ${name} | ${pct(hopLoss)} | ${ms(hopAvg)} |`;
    })
    .join("\n");

  const markdown = [
    `![Latency](${svgDataUri(chart)})`,
    "```",
    sparkline(
      inRange.slice(-60).map((s) => s.avg ?? null),
      60,
    ),
    "```",
    last
      ? `**Route** · ${timeLabel(last.t)}\n\n| # | Host | Loss | Avg |\n|---|---|---|---|\n${hops}`
      : "_Not checked yet_",
  ].join("\n\n");

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.TagList title="Status">
            <List.Item.Detail.Metadata.TagList.Item
              text={STATUS[state.status].label}
              color={STATUS[state.status].color}
            />
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.Label
            title="Host"
            text={last?.ip && last.ip !== target.host ? `${target.host} (${last.ip})` : target.host}
          />
          {state.error ? <List.Item.Detail.Metadata.Label title="Error" text={state.error} /> : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Now"
            text={last ? `${pct(last.loss)} loss · ${ms(last.avg)} · jitter ${ms(last.jitter)}` : "–"}
          />
          <List.Item.Detail.Metadata.Label
            title={`Last ${hours === 168 ? "7 days" : `${hours} h`}`}
            text={`${pct(loss)} loss · ${ms(avg)} avg`}
          />
          <List.Item.Detail.Metadata.Label title="Checks" text={String(inRange.length)} />
          <List.Item.Detail.Metadata.Label
            title="Last check"
            text={state.lastCheck ? new Date(state.lastCheck).toLocaleString() : "–"}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function Targets() {
  const [range, setRange] = useState<Range>("24");
  const [showingDetail, setShowingDetail] = useState(true);
  const [checking, setChecking] = useState(false);
  const { data, isLoading, revalidate } = usePromise(loadRows);

  const checkNow = async () => {
    setChecking(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Checking targets…" });
    try {
      const summary = await runChecks();
      toast.style = Toast.Style.Success;
      toast.title = summary ?? "No targets";
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Check failed";
      toast.message = (error as Error).message;
    } finally {
      setChecking(false);
      revalidate();
    }
  };

  const commonActions = (
    <>
      <Action.Push
        title="Add Target"
        icon={Icon.Plus}
        shortcut={primaryShortcut("n")}
        target={<TargetForm onSaved={revalidate} />}
      />
      <Action title="Check All Now" icon={Icon.ArrowClockwise} shortcut={primaryShortcut("r")} onAction={checkNow} />
      <Action title="Open Report in Browser" icon={Icon.Globe} shortcut={primaryShortcut("o")} onAction={openReport} />
      <Action.Push
        title="Show All Events"
        icon={Icon.List}
        shortcut={primaryShortcut("l", true)}
        target={<EventList />}
      />
    </>
  );

  return (
    <List
      isLoading={isLoading || checking}
      isShowingDetail={showingDetail && (data?.length ?? 0) > 0}
      searchBarPlaceholder="Filter targets..."
      searchBarAccessory={
        <List.Dropdown tooltip="Time range" value={range} onChange={(v) => setRange(v as Range)}>
          <List.Dropdown.Item title="Last hour" value="1" />
          <List.Dropdown.Item title="Last 24 hours" value="24" />
          <List.Dropdown.Item title="Last 7 days" value="168" />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.Heartbeat}
        title="No monitored targets"
        description="Add a target with Ctrl+N, then enable the “Background Monitor” command"
        actions={<ActionPanel>{commonActions}</ActionPanel>}
      />
      {data?.map((row) => {
        const { target, state } = row;
        const status = STATUS[state.status];
        const last = state.lastSample;
        return (
          <List.Item
            key={target.id}
            icon={{ source: status.icon, tintColor: status.color }}
            title={target.label || target.host}
            subtitle={!showingDetail && target.label ? target.host : undefined}
            keywords={[target.host]}
            accessories={
              showingDetail
                ? [{ text: ms(last?.avg) }]
                : [
                    {
                      text: sparkline(
                        row.samples.slice(-30).map((s) => s.avg ?? null),
                        30,
                      ),
                      tooltip: "Last 30 checks",
                    },
                    ...(last ? [{ tag: { value: pct(last.loss), color: lossColor(last.loss) }, tooltip: "Loss" }] : []),
                    { text: ms(last?.avg), tooltip: "Average latency" },
                    ...(state.lastCheck ? [{ date: new Date(state.lastCheck), tooltip: "Last check" }] : []),
                  ]
            }
            detail={showingDetail ? <TargetDetail row={row} range={range} /> : undefined}
            actions={
              <ActionPanel>
                <Action.Push title="Live Trace" icon={Icon.Play} target={<TraceView target={target.host} />} />
                <Action
                  title={showingDetail ? "Hide Details" : "Show Details"}
                  icon={Icon.Sidebar}
                  shortcut={primaryShortcut("d")}
                  onAction={() => setShowingDetail((v) => !v)}
                />
                <Action.Push
                  title="Show Events"
                  icon={Icon.List}
                  shortcut={primaryShortcut("l")}
                  target={<EventList target={target} />}
                />
                <ActionPanel.Section>{commonActions}</ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.Push
                    title="Edit Target"
                    icon={Icon.Pencil}
                    shortcut={Keyboard.Shortcut.Common.Edit}
                    target={<TargetForm target={target} onSaved={revalidate} />}
                  />
                  {state.route ? (
                    <Action.CopyToClipboard
                      title="Copy Route"
                      content={state.route
                        .split(">")
                        .map((addr, i) => `${i + 1}. ${state.hosts[addr] ? `${state.hosts[addr]} (${addr})` : addr}`)
                        .join("\n")}
                    />
                  ) : null}
                  <Action
                    title="Clear History"
                    icon={Icon.Eraser}
                    onAction={async () => {
                      if (
                        await confirmAlert({
                          title: `Clear history of ${target.host}?`,
                          primaryAction: { title: "Clear", style: Alert.ActionStyle.Destructive },
                        })
                      ) {
                        await clearSamples(target.id);
                        revalidate();
                      }
                    }}
                  />
                  <Action
                    title="Remove Target"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={async () => {
                      if (
                        await confirmAlert({
                          title: `Stop monitoring ${target.host}?`,
                          message: "Its history is deleted as well.",
                          primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
                        })
                      ) {
                        await removeTarget(target.id);
                        revalidate();
                      }
                    }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

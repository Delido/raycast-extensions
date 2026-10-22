import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  launchCommand,
  LaunchType,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { primaryShortcut } from "./api";
import {
  cs2CfgInstalled,
  effectInstalled,
  getServiceLog,
  getServiceStatus,
  installCs2Cfg,
  installEffect,
  readBatteryNow,
  restartService,
  ServiceStatus,
  setMicMute,
  stopService,
  testSound,
  uninstallCs2Cfg,
} from "./service";

function since(iso?: string): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function batteryIcon(level: number | null, low: boolean) {
  if (level === null) return { source: Icon.Battery, tintColor: Color.SecondaryText };
  if (low || level <= 20) return { source: Icon.Battery, tintColor: Color.Red };
  return { source: level >= 60 ? Icon.BatteryCharging : Icon.Battery, tintColor: Color.Green };
}

async function run(title: string, action: () => Promise<unknown>, done?: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title });
  try {
    const result = await action();
    toast.style = Toast.Style.Success;
    if (typeof result === "string") toast.message = result;
    done?.();
  } catch (error) {
    toast.hide();
    await showFailureToast(error, { title });
  }
}

function LogView() {
  const { data, isLoading, revalidate } = usePromise(() => getServiceLog(300));
  const markdown = data ? "```\n" + [...data].reverse().join("\n") + "\n```" : "";
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="Companion Service Log"
      markdown={markdown || "_No log yet_"}
      actions={
        <ActionPanel>
          <Action title="Refresh" icon={Icon.RotateClockwise} onAction={revalidate} />
          <Action.CopyToClipboard title="Copy Log" content={(data ?? []).join("\n")} />
        </ActionPanel>
      }
    />
  );
}

export default function Companion() {
  const [status, setStatus] = useState<ServiceStatus | undefined>();
  const [loaded, setLoaded] = useState(false);
  const setup = usePromise(async () => ({ cfg: await cs2CfgInstalled(), effect: await effectInstalled() }));

  const refresh = async () => {
    setStatus(await getServiceStatus());
    setLoaded(true);
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);

  const startViaCommand = () =>
    run(
      "Starting companion service",
      () => launchCommand({ name: "companion-service", type: LaunchType.UserInitiated }),
      () => setTimeout(refresh, 1500),
    );

  const serviceActions = (
    <ActionPanel.Section title="Service">
      {status ? (
        <>
          <Action
            title="Restart Service"
            icon={Icon.RotateClockwise}
            onAction={() => run("Restarting", restartService, refresh)}
          />
          <Action title="Stop Service" icon={Icon.Stop} onAction={() => run("Stopping", stopService, refresh)} />
        </>
      ) : (
        <Action title="Start Service" icon={Icon.Play} onAction={startViaCommand} />
      )}
      <Action.Push title="Show Log" icon={Icon.Document} shortcut={primaryShortcut("l")} target={<LogView />} />
    </ActionPanel.Section>
  );

  if (loaded && !status) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Plug}
          title="Companion service is not running"
          description="Start it here. To keep it running, enable background refresh of “Companion Service” in Raycast settings."
          actions={<ActionPanel>{serviceActions}</ActionPanel>}
        />
      </List>
    );
  }

  const h = status?.headset;
  const k = status?.keyboard;
  const c = status?.cs2;
  const st = c?.state;

  let cs2Title = "CS2 not running";
  let cs2Subtitle = "Servers start automatically when cs2.exe runs";
  let cs2Icon = { source: Icon.Circle, tintColor: Color.SecondaryText };
  if (c && !c.enabled) {
    cs2Title = "CS2 integration off";
    cs2Subtitle = "Enable it in the Companion Service settings";
  } else if (c?.listening && st?.connected) {
    cs2Title = `${st.health ?? "?"} HP · ${st.armor ?? 0} armor · ${st.team ?? "–"}`;
    cs2Subtitle = `Round ${st.round ?? "–"} ${st.round_phase ?? ""} · ${st.kills ?? 0}/${st.deaths ?? 0} K/D${st.weapon ? ` · ${st.weapon.replace("weapon_", "")}` : ""}`;
    cs2Icon = { source: Icon.BullsEye, tintColor: Color.Green };
  } else if (c?.listening) {
    cs2Title = "CS2 running · waiting for game data";
    cs2Subtitle = c.posts ? `last update ${since(c.lastPostAt)}` : "No data yet (is the GSI config installed?)";
    cs2Icon = { source: Icon.BullsEye, tintColor: Color.Orange };
  } else if (c?.gameRunning || (c && !c.listening && c.error)) {
    cs2Title = "CS2 running · servers not started";
    cs2Subtitle = c.error ?? "";
    cs2Icon = { source: Icon.ExclamationMark, tintColor: Color.Red };
  }

  return (
    <List isLoading={!loaded} navigationTitle="Headset & Companion">
      {h ? (
        <List.Section title={h.name} subtitle={h.present ? undefined : "receiver not connected"}>
          <List.Item
            icon={batteryIcon(h.battery, h.batteryLow)}
            title={h.battery !== null ? `Battery ${h.battery}%` : "Battery unknown"}
            subtitle={h.battery !== null ? `read ${since(h.batteryAt)}` : "Headset off or asleep"}
            accessories={h.batteryLow ? [{ tag: { value: "Low", color: Color.Red } }] : []}
            actions={
              <ActionPanel>
                <Action
                  title="Read Battery Now"
                  icon={Icon.RotateClockwise}
                  onAction={() => run("Reading battery", async () => `${await readBatteryNow()}%`, refresh)}
                />
                <Action
                  title="Play Alert Sound"
                  icon={Icon.SpeakerHigh}
                  onAction={() => run("Playing sound", testSound)}
                />
                {serviceActions}
              </ActionPanel>
            }
          />
          <List.Item
            icon={
              h.windowsMuted
                ? { source: Icon.MicrophoneDisabled, tintColor: Color.Red }
                : { source: Icon.Microphone, tintColor: Color.Green }
            }
            title={
              h.windowsMuted === null ? "Microphone unknown" : h.windowsMuted ? "Microphone muted" : "Microphone live"
            }
            subtitle={h.micName}
            accessories={[
              ...(h.listening ? [] : [{ tag: { value: "button not monitored", color: Color.Orange } }]),
              ...(h.lastMuteChange
                ? [
                    {
                      text: `${h.lastMuteSource === "headset" ? "headset button" : "Windows"} · ${since(h.lastMuteChange)}`,
                    },
                  ]
                : []),
            ]}
            actions={
              <ActionPanel>
                <Action
                  title={h.windowsMuted ? "Unmute Microphone" : "Mute Microphone"}
                  icon={h.windowsMuted ? Icon.Microphone : Icon.MicrophoneDisabled}
                  onAction={() => run("Microphone", () => setMicMute(!h.windowsMuted), refresh)}
                />
                {serviceActions}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      {k ? (
        <List.Section title={k.name} subtitle={k.present ? undefined : "not connected"}>
          <List.Item
            icon={{ source: Icon.GameController, tintColor: k.gameMode ? Color.Purple : Color.SecondaryText }}
            title={`Game Mode ${k.gameMode ? "on" : "off"}`}
            subtitle={
              k.gameActive
                ? `Game: ${k.game ?? "?"}`
                : k.reportedAt
                  ? "No game running"
                  : "Waiting for the Power Plan extension"
            }
            accessories={[
              ...(k.lastError ? [{ tag: { value: k.lastError, color: Color.Red } }] : []),
              ...(k.reportedAt ? [{ text: `reported ${since(k.reportedAt)}` }] : []),
            ]}
            actions={<ActionPanel>{serviceActions}</ActionPanel>}
          />
        </List.Section>
      ) : null}
      {c ? (
        <List.Section title="Counter-Strike 2">
          <List.Item
            icon={cs2Icon}
            title={cs2Title}
            subtitle={cs2Subtitle}
            accessories={c.listening ? [{ tag: { value: `:${c.port} · :${c.httpsPort}`, color: Color.Green } }] : []}
            actions={
              <ActionPanel>
                {c.listening ? (
                  <Action.OpenInBrowser title="Open Game State" url={`http://127.0.0.1:${c.port}/state`} />
                ) : null}
                {serviceActions}
              </ActionPanel>
            }
          />
          <List.Item
            icon={
              setup.data?.cfg
                ? { source: Icon.CheckCircle, tintColor: Color.Green }
                : { source: Icon.Circle, tintColor: Color.Orange }
            }
            title={setup.data?.cfg ? "GSI config installed" : "GSI config not installed"}
            subtitle={setup.data?.cfg ?? "CS2 needs it to send game data; restart CS2 afterwards"}
            actions={
              <ActionPanel>
                <Action
                  title={setup.data?.cfg ? "Reinstall GSI Config" : "Install GSI Config"}
                  icon={Icon.Download}
                  onAction={() =>
                    run("Installing GSI config", () => installCs2Cfg(c.port, "signalcompanion"), setup.revalidate)
                  }
                />
                {setup.data?.cfg ? (
                  <Action
                    title="Remove GSI Config"
                    icon={Icon.Trash}
                    onAction={() => run("Removing", uninstallCs2Cfg, setup.revalidate)}
                  />
                ) : null}
              </ActionPanel>
            }
          />
          <List.Item
            icon={
              setup.data?.effect
                ? { source: Icon.CheckCircle, tintColor: Color.Green }
                : { source: Icon.Circle, tintColor: Color.Orange }
            }
            title={setup.data?.effect ? "CS2 Reactive effect installed" : "CS2 Reactive effect not installed"}
            subtitle={
              c.caPatchedNow
                ? "Restart SignalRGB once so it trusts the HTTPS bridge"
                : c.caTrusted?.length
                  ? "SignalRGB trusts the HTTPS bridge"
                  : c.httpsRunning
                    ? "⚠️ SignalRGB doesn't trust the HTTPS bridge, the effect gets no data (see Show Log)"
                    : "Apply “CS2 Reactive (SignalCompanion)” to a layer in SignalRGB"
            }
            actions={
              <ActionPanel>
                <Action
                  title={setup.data?.effect ? "Reinstall Effect" : "Install Effect"}
                  icon={Icon.Download}
                  onAction={() => run("Installing effect", installEffect, setup.revalidate)}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      {status ? (
        <List.Section title="Service">
          <List.Item
            icon={{ source: Icon.CheckCircle, tintColor: Color.Green }}
            title="Companion service running"
            subtitle={`v${status.version} · pid ${status.pid} · since ${new Date(status.started).toLocaleString()}`}
            actions={<ActionPanel>{serviceActions}</ActionPanel>}
          />
        </List.Section>
      ) : null}
    </List>
  );
}

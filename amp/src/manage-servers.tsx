import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { useEffect, useRef } from "react";
import {
  action,
  ADS,
  AppState,
  fetchInstances,
  Instance,
  Metric,
  panelUrl,
  startInstanceAndServer,
  stateInfo,
} from "./amp";
import { BackupsList } from "./components/BackupsList";
import { Console } from "./components/Console";
import { CreateServer } from "./components/CreateServer";
import { EditInstanceForm } from "./components/EditInstanceForm";
import { InstanceDetails } from "./components/InstanceDetails";
import { PlayersList } from "./components/PlayersList";
import { ScheduleList } from "./components/ScheduleList";
import { SettingsList } from "./components/SettingsList";
import { deleteInstance, setSuspended, startAll, stopAll, upgradeAll, upgradeInstance } from "./management";
import { runAction } from "./run";

const REFRESH_INTERVAL_MS = 5000;

const shortcut = (key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut => ({
  macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
  Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
});

function metricAccessories(instance: Instance): List.Item.Accessory[] {
  if (!instance.Running || !instance.Metrics) return [];
  const m = instance.Metrics as Record<string, Metric | undefined>;
  const cpu = m["CPU Usage"];
  const memory = m["Memory Usage"];
  const users = m["Active Users"];
  const accessories: List.Item.Accessory[] = [];
  if (users) {
    accessories.push({ icon: Icon.TwoPeople, text: `${users.RawValue}/${users.MaxValue}`, tooltip: "Active users" });
  }
  if (cpu) accessories.push({ icon: Icon.ComputerChip, text: `${cpu.Percent}%`, tooltip: "CPU usage" });
  if (memory) {
    const used = memory.RawValue >= 1024 ? `${(memory.RawValue / 1024).toFixed(1)} GB` : `${memory.RawValue} MB`;
    accessories.push({ icon: Icon.MemoryChip, text: used, tooltip: `Memory usage (${memory.Percent}%)` });
  }
  return accessories;
}

export default function Command() {
  // Report errors only once instead of on every background refresh.
  const errorShown = useRef(false);
  const { data, isLoading, revalidate } = useCachedPromise(fetchInstances, [], {
    keepPreviousData: true,
    onData: () => {
      errorShown.current = false;
    },
    onError: (error) => {
      if (errorShown.current) return;
      errorShown.current = true;
      showFailureToast(error, { title: "Could not load AMP instances" });
    },
  });

  useEffect(() => {
    const timer = setInterval(revalidate, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [revalidate]);

  const refreshSoon = () => setTimeout(revalidate, 1500);

  const globalActions = (
    <ActionPanel.Section title="All Servers">
      <Action.Push
        title="Create Game Server"
        icon={Icon.PlusCircle}
        target={<CreateServer onCreated={revalidate} />}
        shortcut={Keyboard.Shortcut.Common.New}
      />
      <Action
        title="Start All Instances"
        icon={Icon.Play}
        onAction={() =>
          runAction("Start All", startAll, {
            confirm: { title: "Start all AMP instances?" },
            onSuccess: refreshSoon,
          })
        }
      />
      <Action
        title="Stop All Instances"
        icon={Icon.Stop}
        style={Action.Style.Destructive}
        onAction={() =>
          runAction("Stop All", stopAll, {
            confirm: {
              title: "Stop all AMP instances?",
              message: "All game servers will go offline.",
              destructive: true,
            },
            onSuccess: refreshSoon,
          })
        }
      />
      <Action
        title="Update AMP on All Instances"
        icon={Icon.Download}
        onAction={() =>
          runAction("Update All", () => upgradeAll(true), {
            confirm: { title: "Update AMP on all instances?", message: "Running instances will be restarted." },
            successTitle: "Update started",
            onSuccess: refreshSoon,
          })
        }
      />
    </ActionPanel.Section>
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter instances…">
      <List.EmptyView
        icon={Icon.HardDrive}
        title="No instances found"
        actions={<ActionPanel>{globalActions}</ActionPanel>}
      />
      {data?.map((instance) => {
        const state = stateInfo(instance);
        const id = instance.InstanceID;
        const name = instance.FriendlyName;
        const appRunning = instance.Running && instance.AppState === AppState.Ready;
        const appStopped =
          instance.Running && (instance.AppState === AppState.Stopped || instance.AppState === AppState.Failed);
        const endpoint = instance.ApplicationEndpoints?.find((e) => e.Endpoint)?.Endpoint;
        const run = (label: string, task: () => Promise<unknown>, confirm?: { title: string; destructive?: boolean }) =>
          runAction(label, task, { subject: name, confirm, onSuccess: refreshSoon });

        const startServer = (
          <Action
            key="start"
            title="Start Server"
            icon={Icon.Play}
            onAction={() => run("Start Server", () => action(id, "Core/Start"))}
          />
        );
        const openConsole = (
          <Action.Push
            key="console"
            title="Open Console"
            icon={Icon.Terminal}
            target={<Console instance={instance} />}
            shortcut={shortcut("t")}
          />
        );

        return (
          <List.Item
            key={id}
            icon={state.icon}
            title={name}
            subtitle={instance.ModuleDisplayName ?? instance.Module}
            keywords={[instance.InstanceName, instance.Module, ...(instance.Description ? [instance.Description] : [])]}
            accessories={[...metricAccessories(instance), { tag: { value: state.label, color: state.color } }]}
            actions={
              <ActionPanel>
                {instance.Running ? (
                  <>
                    <ActionPanel.Section title="Server">
                      {appStopped ? [startServer, openConsole] : appRunning ? openConsole : [openConsole, startServer]}
                      {appRunning && (
                        <Action
                          title="Restart Server"
                          icon={Icon.RotateClockwise}
                          shortcut={shortcut("r", true)}
                          onAction={() =>
                            run("Restart Server", () => action(id, "Core/Restart"), { title: "Restart server?" })
                          }
                        />
                      )}
                      {appRunning && (
                        <Action
                          title="Stop Server"
                          icon={Icon.Stop}
                          style={Action.Style.Destructive}
                          shortcut={Keyboard.Shortcut.Common.Duplicate}
                          onAction={() =>
                            run("Stop Server", () => action(id, "Core/Stop"), {
                              title: "Stop server?",
                              destructive: true,
                            })
                          }
                        />
                      )}
                      <Action
                        title="Update Game Server"
                        icon={Icon.Download}
                        onAction={() =>
                          run("Update Server", () => action(id, "Core/UpdateApplication"), {
                            title: "Update game server? It will be stopped if it is running.",
                          })
                        }
                      />
                      <Action
                        title="Kill Server"
                        icon={Icon.XMarkCircle}
                        style={Action.Style.Destructive}
                        onAction={() =>
                          run("Kill Server", () => action(id, "Core/Kill"), {
                            title: "Kill server process? Unsaved progress may be lost.",
                            destructive: true,
                          })
                        }
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section title="Manage">
                      <Action.Push
                        title="Show Server Details"
                        icon={Icon.Key}
                        target={<InstanceDetails instance={instance} />}
                        shortcut={shortcut("i")}
                      />
                      <Action.Push
                        title="Players"
                        icon={Icon.TwoPeople}
                        target={<PlayersList instance={instance} />}
                        shortcut={shortcut("p")}
                      />
                      <Action.Push
                        title="Backups"
                        icon={Icon.HardDrive}
                        target={<BackupsList instance={instance} />}
                        shortcut={shortcut("b")}
                      />
                      <Action.Push
                        title="Settings"
                        icon={Icon.Gear}
                        target={<SettingsList instance={instance} />}
                        shortcut={shortcut("g")}
                      />
                      <Action.Push
                        title="Schedule"
                        icon={Icon.Calendar}
                        target={<ScheduleList instance={instance} />}
                        shortcut={shortcut("j")}
                      />
                    </ActionPanel.Section>
                  </>
                ) : (
                  <ActionPanel.Section title="Server">
                    <Action
                      title="Start Server"
                      icon={Icon.Play}
                      onAction={() => run("Start Server", () => startInstanceAndServer(instance))}
                    />
                    <Action
                      title="Start Instance Only"
                      icon={Icon.Power}
                      onAction={() =>
                        run("Start Instance", () =>
                          action(ADS, "ADSModule/StartInstance", { InstanceName: instance.InstanceName }),
                        )
                      }
                    />
                  </ActionPanel.Section>
                )}
                <ActionPanel.Section title="Instance">
                  <Action.Push
                    title="Edit Instance"
                    icon={Icon.Pencil}
                    target={<EditInstanceForm instance={instance} onSaved={refreshSoon} />}
                    shortcut={Keyboard.Shortcut.Common.Edit}
                  />
                  <Action
                    title="Update AMP on This Instance"
                    icon={Icon.ArrowUpCircle}
                    onAction={() =>
                      run("Update AMP", () => upgradeInstance(instance, true), {
                        title: "Update AMP on this instance? It will be restarted if running.",
                      })
                    }
                  />
                  {instance.Running && (
                    <Action
                      title="Stop Instance"
                      icon={Icon.Power}
                      style={Action.Style.Destructive}
                      onAction={() =>
                        run(
                          "Stop Instance",
                          () => action(ADS, "ADSModule/StopInstance", { InstanceName: instance.InstanceName }),
                          { title: "Stop the whole AMP instance?", destructive: true },
                        )
                      }
                    />
                  )}
                  <Action
                    title={instance.Suspended ? "Unsuspend Instance" : "Suspend Instance"}
                    icon={instance.Suspended ? Icon.LockUnlocked : Icon.Lock}
                    onAction={() =>
                      run(
                        instance.Suspended ? "Unsuspend" : "Suspend",
                        () => setSuspended(instance, !instance.Suspended),
                        instance.Suspended
                          ? undefined
                          : { title: "Suspend instance? It will be stopped and cannot be started until unsuspended." },
                      )
                    }
                  />
                  <Action
                    title="Delete Instance"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.RemoveAll}
                    onAction={() =>
                      runAction("Delete Instance", () => deleteInstance(instance), {
                        subject: name,
                        confirm: {
                          title: `Delete "${name}" permanently?`,
                          message:
                            "The instance and ALL its files, worlds and backups will be deleted. This cannot be undone.",
                          destructive: true,
                        },
                        successTitle: "Deletion started",
                        onSuccess: refreshSoon,
                      })
                    }
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.OpenInBrowser
                    title="Open in AMP Panel"
                    url={panelUrl(id)}
                    shortcut={Keyboard.Shortcut.Common.Open}
                  />
                  {endpoint && (
                    <Action.CopyToClipboard
                      title="Copy Connection Address"
                      content={endpoint}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  )}
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    onAction={revalidate}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                  />
                </ActionPanel.Section>
                {globalActions}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

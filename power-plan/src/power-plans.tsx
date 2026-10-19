import { Action, ActionPanel, Color, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { Activity, addActivity, clearActivity, getActivity } from "./activity";
import { getAutoState, resetAutoState } from "./auto";
import GameDetection from "./game-detection";
import { BALANCED, getStatus, HIGH_PERFORMANCE, Plan, POWER_SAVER, setPlan, ULTIMATE } from "./helper";
import { detectGames, displayName, gamePlanOf, getSettings, idlePlanOf, isPaused, updateSettings } from "./settings";

export function primaryShortcut(key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut {
  return {
    macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
    Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
  };
}

function planIcon(plan: Plan): Icon {
  switch (plan.guid) {
    case POWER_SAVER:
      return Icon.Leaf;
    case BALANCED:
      return Icon.Gauge;
    case HIGH_PERFORMANCE:
    case ULTIMATE:
      return Icon.Bolt;
    default:
      return Icon.Battery;
  }
}

async function load() {
  const [status, settings, auto, activity] = await Promise.all([
    getStatus(),
    getSettings(),
    getAutoState(),
    getActivity(),
  ]);
  return {
    status,
    settings,
    auto,
    activity,
    games: detectGames(status, settings),
    gamePlan: gamePlanOf(settings, status.plans),
    idlePlan: idlePlanOf(settings, status.plans),
  };
}

const ACTIVITY_ICON: Record<Activity["kind"], { source: Icon; tintColor: Color }> = {
  game: { source: Icon.GameController, tintColor: Color.Purple },
  idle: { source: Icon.Moon, tintColor: Color.Blue },
  switch: { source: Icon.ArrowRight, tintColor: Color.Green },
  restore: { source: Icon.RotateAntiClockwise, tintColor: Color.Orange },
  external: { source: Icon.Warning, tintColor: Color.Orange },
  manual: { source: Icon.Person, tintColor: Color.SecondaryText },
  error: { source: Icon.ExclamationMark, tintColor: Color.Red },
};

const MANUAL_PAUSE_MS = 60 * 60_000;

const PAUSE_OPTIONS = [
  { title: "30 Minutes", ms: 30 * 60_000 },
  { title: "1 Hour", ms: 60 * 60_000 },
  { title: "3 Hours", ms: 3 * 60 * 60_000 },
  { title: "Until Tomorrow", ms: -1 },
];

export default function PowerPlans() {
  const { data, isLoading, revalidate } = usePromise(load);

  const activate = async (plan: Plan) => {
    try {
      await setPlan(plan.guid);
      const current = await getSettings();
      // A plan picked by hand would be undone by the automation, so pause it for a while.
      if (current.enabled && !isPaused(current)) {
        await updateSettings({ pausedUntil: Date.now() + MANUAL_PAUSE_MS });
        await resetAutoState();
        await addActivity("manual", `${plan.name} chosen by hand`, "Automatic switching paused for 1 hour");
        await showToast({ title: `${plan.name} active`, message: "Automatic switching paused for 1 hour" });
      } else {
        await addActivity("manual", `${plan.name} chosen by hand`);
        await showToast({ title: `${plan.name} active` });
      }
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: "Could not switch power plan" });
    }
  };

  const change = async (message: string, changes: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(changes);
    await resetAutoState(); // apply the new setup on the next background run
    await showToast({ style: Toast.Style.Success, title: message });
    revalidate();
  };

  const settings = data?.settings;
  const paused = settings ? isPaused(settings) : false;
  const game = data?.games[0];

  let autoTitle = "Automatic switching is off";
  let autoSubtitle = "";
  let autoIcon = { source: Icon.Pause, tintColor: Color.SecondaryText };
  if (settings?.enabled && paused) {
    autoTitle = "Automatic switching is paused";
    autoSubtitle = `until ${new Date(settings.pausedUntil!).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
    autoIcon = { source: Icon.Clock, tintColor: Color.Orange };
  } else if (settings?.enabled) {
    autoTitle = game ? `Game running: ${displayName(game.process)}` : "No game running";
    autoSubtitle = game ? game.detail : "";
    autoIcon = game
      ? { source: Icon.GameController, tintColor: Color.Purple }
      : { source: Icon.Moon, tintColor: Color.Blue };
  }

  const automationActions = settings ? (
    <>
      <Action
        title={settings.enabled ? "Disable Automatic Switching" : "Enable Automatic Switching"}
        icon={settings.enabled ? Icon.Pause : Icon.Play}
        shortcut={primaryShortcut("t", true)}
        onAction={() =>
          change(settings.enabled ? "Automatic switching off" : "Automatic switching on", {
            enabled: !settings.enabled,
            pausedUntil: undefined,
          })
        }
      />
      {settings.enabled && paused ? (
        <Action
          title="Resume Now"
          icon={Icon.Play}
          onAction={() => change("Automatic switching resumed", { pausedUntil: undefined })}
        />
      ) : null}
      {settings.enabled && !paused ? (
        <ActionPanel.Submenu title="Pause Automatic Switching" icon={Icon.Clock} shortcut={primaryShortcut("p", true)}>
          {PAUSE_OPTIONS.map((option) => (
            <Action
              key={option.title}
              title={option.title}
              onAction={() => {
                let until = Date.now() + option.ms;
                if (option.ms < 0) {
                  const tomorrow = new Date();
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  tomorrow.setHours(6, 0, 0, 0);
                  until = tomorrow.getTime();
                }
                return change("Automatic switching paused", { pausedUntil: until });
              }}
            />
          ))}
        </ActionPanel.Submenu>
      ) : null}
      <Action.Push
        title="Game Detection"
        icon={Icon.GameController}
        shortcut={primaryShortcut("g")}
        target={<GameDetection />}
        onPop={revalidate}
      />
      <Action title="Refresh" icon={Icon.RotateClockwise} shortcut={primaryShortcut("r")} onAction={revalidate} />
    </>
  ) : null;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter power plans...">
      {data ? (
        <List.Section title="Automatic">
          <List.Item
            icon={autoIcon}
            title={autoTitle}
            subtitle={autoSubtitle}
            accessories={
              settings?.enabled && !paused
                ? [
                    {
                      icon: Icon.GameController,
                      text: data.status.plans.find((p) => p.guid === data.gamePlan)?.name ?? "–",
                      tooltip: "Plan while gaming",
                    },
                    {
                      icon: Icon.Moon,
                      text: data.status.plans.find((p) => p.guid === data.idlePlan)?.name ?? "–",
                      tooltip: "Plan otherwise",
                    },
                  ]
                : []
            }
            actions={<ActionPanel>{automationActions}</ActionPanel>}
          />
        </List.Section>
      ) : null}
      <List.Section title="Power Plans">
        {data?.status.plans.map((plan) => {
          const active = plan.guid === data.status.active;
          return (
            <List.Item
              key={plan.guid}
              icon={{ source: planIcon(plan), tintColor: active ? Color.Green : undefined }}
              title={plan.name}
              accessories={[
                ...(plan.guid === data.gamePlan ? [{ tag: { value: "Games", color: Color.Purple } }] : []),
                ...(plan.guid === data.idlePlan ? [{ tag: { value: "Otherwise", color: Color.Blue } }] : []),
                ...(active ? [{ tag: { value: "Active", color: Color.Green } }] : []),
              ]}
              actions={
                <ActionPanel>
                  <Action title="Activate" icon={Icon.Checkmark} onAction={() => activate(plan)} />
                  <ActionPanel.Section>
                    <Action
                      title="Use While Gaming"
                      icon={Icon.GameController}
                      shortcut={primaryShortcut("g", true)}
                      onAction={() => change(`${plan.name} is used while gaming`, { gamePlan: plan.guid })}
                    />
                    <Action
                      title="Use When No Game Runs"
                      icon={Icon.Moon}
                      shortcut={primaryShortcut("i", true)}
                      onAction={() => change(`${plan.name} is used when no game runs`, { idlePlan: plan.guid })}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section>{automationActions}</ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action.CopyToClipboard
                      title="Copy GUID"
                      content={plan.guid}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
      {data && data.activity.length > 0 ? (
        <List.Section title="Recent Activity">
          {data.activity.slice(0, 20).map((entry, i) => (
            <List.Item
              key={`${entry.t}-${i}`}
              icon={ACTIVITY_ICON[entry.kind]}
              title={entry.text}
              subtitle={entry.detail}
              accessories={[{ date: new Date(entry.t), tooltip: new Date(entry.t).toLocaleString() }]}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="Copy Activity Log"
                    content={data.activity
                      .map((a) => `${new Date(a.t).toLocaleString()}  ${a.text}${a.detail ? ` (${a.detail})` : ""}`)
                      .join("\n")}
                  />
                  <Action
                    title="Clear Activity Log"
                    icon={Icon.Trash}
                    onAction={async () => {
                      await clearActivity();
                      revalidate();
                    }}
                  />
                  {automationActions}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}

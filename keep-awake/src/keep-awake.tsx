import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { AwakeState, formatUntil, getState, start, stop } from "./lib/awake";

const DURATIONS = [
  { minutes: 0, title: "Indefinitely" },
  { minutes: 30, title: "30 Minutes" },
  { minutes: 60, title: "1 Hour" },
  { minutes: 120, title: "2 Hours" },
  { minutes: 240, title: "4 Hours" },
  { minutes: 480, title: "8 Hours" },
];

export default function Command() {
  const { teamsPresence } = getPreferenceValues<Preferences>();
  const defaultTeams = teamsPresence !== false;
  const [state, setState] = useState<AwakeState | undefined>(getState);

  useEffect(() => {
    const timer = setInterval(() => setState(getState()), 5000);
    return () => clearInterval(timer);
  }, []);

  async function run(minutes: number, teams: boolean) {
    try {
      const s = await start(minutes, teams);
      await showHUD(`☕ Keep Awake ${formatUntil(s)}${s.teams ? " · Teams available" : ""}`);
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not start Keep Awake", message: String(e) });
    }
  }

  return (
    <List>
      <List.Section title="Status">
        {state ? (
          <List.Item
            icon={{ source: Icon.Bolt, tintColor: Color.Green }}
            title={`Awake ${formatUntil(state)}`}
            subtitle={[state.teams && "Teams available", state.display && "display on"].filter(Boolean).join(" · ")}
            accessories={[{ tag: { value: "active", color: Color.Green } }]}
            actions={
              <ActionPanel>
                <Action
                  title="Stop Keep Awake"
                  icon={Icon.Stop}
                  onAction={async () => {
                    stop();
                    await showHUD("Keep Awake off");
                  }}
                />
              </ActionPanel>
            }
          />
        ) : (
          <List.Item
            icon={{ source: Icon.BoltDisabled, tintColor: Color.SecondaryText }}
            title="Off"
            subtitle="The computer follows its normal power settings"
          />
        )}
      </List.Section>
      <List.Section title={state ? "Restart" : "Start"}>
        {DURATIONS.map((d) => (
          <List.Item
            key={d.minutes}
            icon={Icon.Clock}
            title={d.title}
            actions={
              <ActionPanel>
                <Action
                  title={defaultTeams ? "Start with Teams Presence" : "Start"}
                  icon={Icon.Bolt}
                  onAction={() => run(d.minutes, defaultTeams)}
                />
                <Action
                  title={defaultTeams ? "Start Without Teams Presence" : "Start with Teams Presence"}
                  icon={Icon.Bolt}
                  shortcut={{ macOS: { modifiers: ["cmd"], key: "t" }, Windows: { modifiers: ["ctrl"], key: "t" } }}
                  onAction={() => run(d.minutes, !defaultTeams)}
                />
                {state && (
                  <Action
                    title="Stop Keep Awake"
                    icon={Icon.Stop}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={async () => {
                      stop();
                      await showHUD("Keep Awake off");
                    }}
                  />
                )}
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

import { Action, ActionPanel, Color, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { action, ConsoleEntry, fetchConsole, Instance, parseAmpDate } from "../amp";

const MAX_LINES = 500;
const POLL_INTERVAL_MS = 2000;

function entryColor(entry: ConsoleEntry): Color | undefined {
  const type = entry.Type?.toLowerCase() ?? "";
  if (type.includes("error")) return Color.Red;
  if (type.includes("warn")) return Color.Orange;
  if (type.includes("chat")) return Color.Blue;
  return undefined;
}

export function Console({ instance }: { instance: Instance }) {
  const [entries, setEntries] = useState<(ConsoleEntry & { key: number })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [command, setCommand] = useState("");
  const counter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let reportedError = false;

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const updates = await fetchConsole(instance.InstanceID);
        if (!cancelled && updates.length > 0) {
          const keyed = updates.map((e) => ({ ...e, key: counter.current++ }));
          setEntries((prev) => [...prev, ...keyed].slice(-MAX_LINES));
        }
        reportedError = false;
      } catch (error) {
        if (!cancelled && !reportedError) {
          reportedError = true;
          showFailureToast(error, { title: "Could not read console" });
        }
      } finally {
        busy = false;
        if (!cancelled) setIsLoading(false);
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [instance.InstanceID]);

  async function send() {
    const message = command.trim();
    if (!message) return;
    try {
      await action(instance.InstanceID, "Core/SendConsoleMessage", { message });
      setCommand("");
      await showToast({ style: Toast.Style.Success, title: "Sent", message });
    } catch (error) {
      await showFailureToast(error, { title: "Could not send command" });
    }
  }

  const newestFirst = [...entries].reverse();

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchText={command}
      onSearchTextChange={setCommand}
      navigationTitle={`Console · ${instance.FriendlyName}`}
      searchBarPlaceholder="Type a console command and press Enter…"
    >
      <List.EmptyView icon={Icon.Terminal} title={isLoading ? "Connecting…" : "No console output yet"} />
      {newestFirst.map((entry) => {
        const date = parseAmpDate(entry.Timestamp);
        const color = entryColor(entry);
        return (
          <List.Item
            key={entry.key}
            icon={{ source: Icon.Dot, tintColor: color ?? Color.SecondaryText }}
            title={entry.Message}
            subtitle={entry.Source}
            accessories={date ? [{ text: date.toLocaleTimeString(), tooltip: date.toLocaleString() }] : []}
            actions={
              <ActionPanel>
                {command.trim() ? (
                  <Action title={`Send "${command.trim()}"`} icon={Icon.Terminal} onAction={send} />
                ) : (
                  <Action.CopyToClipboard title="Copy Line" content={entry.Message} />
                )}
                {command.trim() && <Action.CopyToClipboard title="Copy Line" content={entry.Message} />}
                <Action.CopyToClipboard
                  title="Copy Entire Console"
                  content={entries.map((e) => `[${e.Source}] ${e.Message}`).join("\n")}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
                <Action
                  title="Clear View"
                  icon={Icon.Trash}
                  onAction={() => setEntries([])}
                  shortcut={{ macOS: { modifiers: ["cmd"], key: "l" }, Windows: { modifiers: ["ctrl"], key: "l" } }}
                />
              </ActionPanel>
            }
          />
        );
      })}
      {newestFirst.length === 0 && command.trim() && (
        <List.Item
          title={`Send "${command.trim()}"`}
          icon={Icon.Terminal}
          actions={
            <ActionPanel>
              <Action title="Send Command" icon={Icon.Terminal} onAction={send} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

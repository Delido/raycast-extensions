import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { ErrorView, SignOutAction } from "./components";
import { CalendarEvent, formatTime, teamsLink } from "./graph";
import { getUpcomingEvents, joinUrl } from "./meetings-api";

function dayLabel(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export default function Meetings() {
  const { data, isLoading, error, revalidate } = usePromise(() => getUpcomingEvents(7), []);

  const groups = new Map<string, CalendarEvent[]>();
  for (const event of data ?? []) {
    const label = dayLabel(new Date(event.start.dateTime));
    groups.set(label, [...(groups.get(label) ?? []), event]);
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter meetings...">
      {[...groups.entries()].map(([label, events]) => (
        <List.Section key={label} title={label}>
          {events.map((event) => {
            const start = new Date(event.start.dateTime);
            const end = new Date(event.end.dateTime);
            const running = start.getTime() <= Date.now() && end.getTime() > Date.now();
            const soon = !running && start.getTime() - Date.now() < 15 * 60_000;
            const url = joinUrl(event);
            return (
              <List.Item
                key={event.id}
                icon={{
                  source: url ? Icon.Video : Icon.Calendar,
                  tintColor: running ? Color.Green : soon ? Color.Orange : undefined,
                }}
                title={event.subject || "(no subject)"}
                subtitle={event.organizer?.emailAddress?.name}
                accessories={[
                  ...(running ? [{ tag: { value: "Now", color: Color.Green } }] : []),
                  ...(soon ? [{ tag: { value: "Soon", color: Color.Orange } }] : []),
                  { text: event.isAllDay ? "All day" : `${formatTime(start)} – ${formatTime(end)}` },
                ]}
                actions={
                  <ActionPanel>
                    {url && <Action.Open title="Join Meeting" icon={Icon.Video} target={teamsLink(url)} />}
                    <Action.OpenInBrowser title="Open in Outlook" url={event.webLink} />
                    <ActionPanel.Section>
                      {url && (
                        <Action.CopyToClipboard
                          title="Copy Join Link"
                          content={url}
                          shortcut={Keyboard.Shortcut.Common.Copy}
                        />
                      )}
                      <Action
                        title="Refresh"
                        icon={Icon.ArrowClockwise}
                        shortcut={Keyboard.Shortcut.Common.Refresh}
                        onAction={revalidate}
                      />
                      <SignOutAction onSignedOut={revalidate} />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
      {error && !isLoading ? (
        <ErrorView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No upcoming meetings" icon={Icon.Calendar} />
      )}
    </List>
  );
}

import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { Booking, bookingLabel, failedParts, loadBookings, removeBooking, retry, Target, undo } from "./lib/booking";
import { Config, isComplete, issueUrl, mocoUrl, shortcut } from "./lib/config";
import { useConfig } from "./lib/hooks";
import { getMyActivities } from "./lib/moco";
import { dayLabel, hours, isoDate } from "./lib/time";
import { Setup } from "./setup";

export default function Command() {
  const { data: config, isLoading, revalidate } = useConfig();
  if (isLoading || !config) return <List isLoading />;
  if (!isComplete(config)) return <Setup onDone={revalidate} />;
  return <Bookings config={config} />;
}

const STATE_TEXT: Record<Target<unknown>["state"], string> = {
  done: "booked",
  failed: "failed",
  skipped: "not booked",
  undone: "undone",
};

function targetAccessory(name: string, target: Target<unknown>): List.Item.Accessory {
  const tooltip = `${name}: ${STATE_TEXT[target.state]}${target.error ? ` (${target.error})` : ""}`;
  switch (target.state) {
    case "done":
      return { tag: { value: name, color: target.error ? Color.Orange : Color.Green }, tooltip };
    case "failed":
      return { tag: { value: name, color: Color.Red }, tooltip };
    case "undone":
      return { tag: { value: name, color: Color.SecondaryText }, tooltip };
    default:
      return { text: { value: name, color: Color.SecondaryText }, tooltip };
  }
}

function icon(b: Booking) {
  if (failedParts(b).length) return { source: Icon.ExclamationMark, tintColor: Color.Red, tooltip: "Partly failed" };
  if (b.jira.state === "undone" || b.moco.state === "undone")
    return { source: Icon.Undo, tintColor: Color.SecondaryText, tooltip: "Undone" };
  return { source: Icon.CheckCircle, tintColor: Color.Green, tooltip: "Booked" };
}

export function Bookings({ config }: { config: Config }) {
  const { data: bookings = [], isLoading, revalidate } = usePromise(loadBookings);
  const today = isoDate(new Date());
  const mocoToday = usePromise(() => getMyActivities(config.moco!, today, today), [], { onError: () => undefined });

  const refresh = () => {
    revalidate();
    mocoToday.revalidate();
  };

  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = isoDate(new Date(b.started));
    groups.set(day, [...(groups.get(day) ?? []), b]);
  }

  const doRetry = async (b: Booking) => {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Booking ${failedParts(b).join(" + ")} again…`,
    });
    const next = await retry(config, b);
    const still = failedParts(next);
    toast.style = still.length ? Toast.Style.Failure : Toast.Style.Success;
    toast.title = still.length ? `${still.join(" + ")} failed again` : "Booked";
    toast.message = [next.jira.error, next.moco.error].filter(Boolean).join("\n") || undefined;
    refresh();
  };

  const doUndo = async (b: Booking) => {
    const ok = await confirmAlert({
      title: `Undo ${hours(b.seconds)} on ${bookingLabel(b)}?`,
      message: b.issue ? "Deletes the Jira worklog and the MOCO activity again." : "Deletes the MOCO activity again.",
      primaryAction: { title: "Undo Booking", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    try {
      const next = await undo(config, b);
      const errors = [next.jira.error, next.moco.error].filter(Boolean);
      if (errors.length) await showFailureToast(new Error(errors.join("\n")), { title: "Not everything was undone" });
      else await showToast({ style: Toast.Style.Success, title: "Booking undone" });
    } catch (error) {
      await showFailureToast(error, { title: "Undo failed" });
    }
    refresh();
  };

  const mocoTotal = mocoToday.data?.reduce((sum, a) => sum + (a.seconds ?? Math.round((a.hours ?? 0) * 3600)), 0);

  return (
    <List
      isLoading={isLoading || mocoToday.isLoading}
      navigationTitle={mocoTotal !== undefined ? `Booked Time · today in MOCO ${hours(mocoTotal)}` : "Booked Time"}
      searchBarPlaceholder="Filter bookings"
    >
      {[...groups.entries()].map(([day, list]) => {
        const booked = list
          .filter((b) => b.jira.state === "done" || b.moco.state === "done")
          .reduce((sum, b) => sum + b.seconds, 0);
        const subtitle =
          day === today && mocoTotal !== undefined
            ? `here ${hours(booked)} · MOCO total ${hours(mocoTotal)}`
            : hours(booked);
        return (
          <List.Section key={day} title={dayLabel(day)} subtitle={subtitle}>
            {list.map((b) => {
              const failed = failedParts(b);
              const canUndo = b.jira.state === "done" || b.moco.state === "done";
              return (
                <List.Item
                  key={b.id}
                  icon={icon(b)}
                  title={bookingLabel(b)}
                  subtitle={b.description || b.issue?.summary}
                  keywords={[
                    b.issue?.summary ?? "",
                    b.project?.identifier ?? "",
                    b.project?.name ?? "",
                    b.task?.name ?? "",
                  ]}
                  accessories={[
                    ...(b.project
                      ? [{ text: `${b.project.identifier} · ${b.task?.name ?? ""}`, tooltip: b.project.name }]
                      : []),
                    { text: hours(b.seconds), tooltip: new Date(b.started).toLocaleString() },
                    b.issue
                      ? targetAccessory("Jira", b.jira)
                      : {
                          text: { value: "No issue", color: Color.SecondaryText },
                          tooltip: "Booked without Jira issue",
                        },
                    targetAccessory("MOCO", b.moco),
                  ]}
                  actions={
                    <ActionPanel>
                      {failed.length ? (
                        <Action
                          title={`Retry ${failed.join(" + ")}`}
                          icon={Icon.RotateClockwise}
                          onAction={() => doRetry(b)}
                        />
                      ) : null}
                      {b.issue ? (
                        <Action.OpenInBrowser title="Open in Jira" url={issueUrl(config, b.issue.key)} />
                      ) : null}
                      <Action.OpenInBrowser
                        title="Open MOCO"
                        url={mocoUrl(config, "/activities")}
                        shortcut={Keyboard.Shortcut.Common.Open}
                      />
                      {b.issue ? (
                        <Action.CopyToClipboard
                          title="Copy Issue Key"
                          content={b.issue.key}
                          shortcut={Keyboard.Shortcut.Common.Copy}
                        />
                      ) : null}
                      {canUndo ? (
                        <Action
                          title="Undo Booking"
                          icon={Icon.Undo}
                          style={Action.Style.Destructive}
                          shortcut={shortcut("z")}
                          onAction={() => doUndo(b)}
                        />
                      ) : null}
                      <Action
                        title="Remove from List"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        shortcut={Keyboard.Shortcut.Common.Remove}
                        onAction={async () => {
                          await removeBooking(b.id);
                          refresh();
                        }}
                      />
                      <Action
                        title="Refresh"
                        icon={Icon.RotateClockwise}
                        shortcut={Keyboard.Shortcut.Common.Refresh}
                        onAction={refresh}
                      />
                    </ActionPanel>
                  }
                />
              );
            })}
          </List.Section>
        );
      })}
      {!isLoading && !bookings.length ? (
        <List.EmptyView
          icon={Icon.Clock}
          title="Nothing booked yet"
          description={
            mocoTotal !== undefined
              ? `Today in MOCO: ${hours(mocoTotal)}. Bookings made with Track Time appear here.`
              : "Bookings made with Track Time appear here."
          }
        />
      ) : null}
    </List>
  );
}

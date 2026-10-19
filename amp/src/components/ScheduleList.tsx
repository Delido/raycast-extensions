import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { Instance, panelUrl } from "../amp";
import { fetchSchedule, runTrigger, setTriggerEnabled } from "../management";
import { runAction } from "../run";

export function ScheduleList({ instance }: { instance: Instance }) {
  const id = instance.InstanceID;
  const { data, isLoading, revalidate } = useCachedPromise(fetchSchedule, [id], { keepPreviousData: true });

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Schedule · ${instance.FriendlyName}`}
      searchBarPlaceholder="Filter scheduled tasks…"
    >
      <List.EmptyView
        icon={Icon.Calendar}
        title="No scheduled tasks"
        description="Create schedules in the AMP panel"
        actions={
          <ActionPanel>
            <Action.OpenInBrowser title="Open in AMP Panel" url={panelUrl(id)} />
          </ActionPanel>
        }
      />
      {data?.map((trigger) => (
        <List.Item
          key={trigger.id}
          icon={
            trigger.enabled
              ? { source: Icon.Calendar, tintColor: Color.Green }
              : { source: Icon.Calendar, tintColor: Color.SecondaryText }
          }
          title={trigger.description}
          subtitle={trigger.tasks.map((t) => t.name).join(" → ")}
          keywords={trigger.tasks.map((t) => t.name)}
          accessories={[
            { text: `${trigger.tasks.length} task${trigger.tasks.length === 1 ? "" : "s"}` },
            trigger.enabled
              ? { tag: { value: "Enabled", color: Color.Green } }
              : { tag: { value: "Disabled", color: Color.SecondaryText } },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Run Now"
                icon={Icon.Play}
                onAction={() =>
                  runAction("Run Now", () => runTrigger(id, trigger.id), {
                    subject: trigger.description,
                    confirm: {
                      title: "Run these tasks now?",
                      message: trigger.tasks.map((t) => t.name).join(", ") || trigger.description,
                    },
                    successTitle: "Tasks started",
                  })
                }
              />
              <Action
                title={trigger.enabled ? "Disable" : "Enable"}
                icon={trigger.enabled ? Icon.Pause : Icon.Checkmark}
                onAction={() =>
                  runAction(
                    trigger.enabled ? "Disable" : "Enable",
                    () => setTriggerEnabled(id, trigger.id, !trigger.enabled),
                    {
                      subject: trigger.description,
                      onSuccess: revalidate,
                    },
                  )
                }
              />
              <Action.OpenInBrowser title="Edit in AMP Panel" url={panelUrl(id)} />
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                onAction={revalidate}
                shortcut={Keyboard.Shortcut.Common.Refresh}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

import {
  Action,
  ActionPanel,
  closeMainWindow,
  Color,
  Form,
  Icon,
  List,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { ErrorView, SignOutAction } from "./components";
import { graph, Presence, presenceInfo } from "./graph";

const STATUSES: { title: string; availability: string; activity: string; color: Color; icon: Icon }[] = [
  { title: "Available", availability: "Available", activity: "Available", color: Color.Green, icon: Icon.CheckCircle },
  { title: "Busy", availability: "Busy", activity: "Busy", color: Color.Red, icon: Icon.CircleFilled },
  {
    title: "Do Not Disturb",
    availability: "DoNotDisturb",
    activity: "DoNotDisturb",
    color: Color.Red,
    icon: Icon.MinusCircle,
  },
  {
    title: "Be Right Back",
    availability: "BeRightBack",
    activity: "BeRightBack",
    color: Color.Yellow,
    icon: Icon.Clock,
  },
  { title: "Appear Away", availability: "Away", activity: "Away", color: Color.Yellow, icon: Icon.Clock },
  {
    title: "Appear Offline",
    availability: "Offline",
    activity: "OffWork",
    color: Color.SecondaryText,
    icon: Icon.XMarkCircle,
  },
];

const DURATIONS = [
  { title: "Until Reset", value: undefined },
  { title: "30 Minutes", value: "PT30M" },
  { title: "1 Hour", value: "PT1H" },
  { title: "2 Hours", value: "PT2H" },
  { title: "4 Hours", value: "PT4H" },
  { title: "Today", value: "endOfDay" },
];

function isoDuration(value: string | undefined): string | undefined {
  if (value !== "endOfDay") return value;
  const end = new Date();
  end.setHours(23, 59, 0, 0);
  const minutes = Math.max(1, Math.round((end.getTime() - Date.now()) / 60000));
  return `PT${minutes}M`;
}

export default function SetStatus() {
  const { data, isLoading, error, revalidate } = usePromise(() => graph<Presence>("me/presence"), []);
  const current = presenceInfo(data);
  const message = data?.statusMessage?.message?.content;

  async function setPresence(status: (typeof STATUSES)[number], duration?: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${status.title}…` });
    try {
      const expirationDuration = isoDuration(duration);
      await graph("me/presence/setUserPreferredPresence", {
        method: "POST",
        body: JSON.stringify({
          availability: status.availability,
          activity: status.activity,
          ...(expirationDuration ? { expirationDuration } : {}),
        }),
      });
      await closeMainWindow();
      await showHUD(`Teams status: ${status.title}`);
    } catch (e) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to set status";
      toast.message = (e as Error).message;
    }
  }

  async function resetPresence() {
    try {
      await graph("me/presence/clearUserPreferredPresence", { method: "POST", body: "{}" });
      await closeMainWindow();
      await showHUD("Teams status reset");
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to reset status", message: (e as Error).message });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Set your Teams status...">
      {data && (
        <List.Section title="Current">
          <List.Item
            icon={{ source: Icon.CircleFilled, tintColor: current?.color }}
            title={current?.label ?? data.availability}
            subtitle={message ? `“${message.replace(/<[^>]+>/g, "")}”` : undefined}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Set Status Message"
                  icon={Icon.SpeechBubble}
                  target={<StatusMessageForm current={message} onDone={revalidate} />}
                />
                <Action title="Reset Status" icon={Icon.ArrowCounterClockwise} onAction={resetPresence} />
                <SignOutAction onSignedOut={revalidate} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      <List.Section title="Set Status">
        {STATUSES.map((status) => (
          <List.Item
            key={status.availability}
            icon={{ source: status.icon, tintColor: status.color }}
            title={status.title}
            actions={
              <ActionPanel>
                <Action title={`Set ${status.title}`} icon={status.icon} onAction={() => setPresence(status)} />
                <ActionPanel.Submenu title="Set for…" icon={Icon.Clock}>
                  {DURATIONS.map((d) => (
                    <Action key={d.title} title={d.title} onAction={() => setPresence(status, d.value)} />
                  ))}
                </ActionPanel.Submenu>
              </ActionPanel>
            }
          />
        ))}
        <List.Item
          icon={Icon.ArrowCounterClockwise}
          title="Reset Status"
          subtitle="Back to automatic status"
          actions={
            <ActionPanel>
              <Action title="Reset Status" icon={Icon.ArrowCounterClockwise} onAction={resetPresence} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.SpeechBubble}
          title="Set Status Message"
          actions={
            <ActionPanel>
              <Action.Push
                title="Set Status Message"
                icon={Icon.SpeechBubble}
                target={<StatusMessageForm current={message} onDone={revalidate} />}
              />
            </ActionPanel>
          }
        />
      </List.Section>
      {error && !isLoading && <ErrorView error={error} retry={revalidate} />}
    </List>
  );
}

function StatusMessageForm({ current, onDone }: { current?: string; onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Status Message"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Status Message"
            icon={Icon.SpeechBubble}
            onSubmit={async (values: { message: string; expiry: string }) => {
              const toast = await showToast({ style: Toast.Style.Animated, title: "Saving…" });
              try {
                const hours = Number(values.expiry);
                const expiry = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : undefined;
                await graph("me/presence/setStatusMessage", {
                  method: "POST",
                  body: JSON.stringify({
                    statusMessage: {
                      message: { content: values.message, contentType: "text" },
                      ...(expiry ? { expiryDateTime: { dateTime: expiry.replace("Z", ""), timeZone: "UTC" } } : {}),
                    },
                  }),
                });
                toast.style = Toast.Style.Success;
                toast.title = values.message ? "Status message set" : "Status message cleared";
                onDone();
                pop();
              } catch (e) {
                toast.style = Toast.Style.Failure;
                toast.title = "Failed to set status message";
                toast.message = (e as Error).message;
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="message"
        title="Message"
        placeholder="Leave empty to clear"
        defaultValue={current?.replace(/<[^>]+>/g, "")}
      />
      <Form.Dropdown id="expiry" title="Clear After" defaultValue="0">
        <Form.Dropdown.Item title="Never" value="0" />
        <Form.Dropdown.Item title="1 Hour" value="1" />
        <Form.Dropdown.Item title="4 Hours" value="4" />
        <Form.Dropdown.Item title="Today" value={String(Math.max(1, 24 - new Date().getHours()))} />
        <Form.Dropdown.Item title="This Week" value="168" />
      </Form.Dropdown>
    </Form>
  );
}

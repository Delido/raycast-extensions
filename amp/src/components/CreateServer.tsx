import { Action, ActionPanel, Color, Form, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { AppSummary, createServer, fetchApps, installNewServer } from "../management";

/** Lists the games AMP can deploy and opens the creation form for the chosen one. */
export function CreateServer({ onCreated }: { onCreated?: () => void }) {
  const { data, isLoading } = useCachedPromise(fetchApps, [], { keepPreviousData: true });

  return (
    <List isLoading={isLoading} navigationTitle="Create Game Server" searchBarPlaceholder="Search games…">
      <List.EmptyView icon={Icon.GameController} title="No games found" />
      {data?.map((app) => (
        <List.Item
          key={app.id}
          icon={app.image ? { source: app.image, fallback: Icon.GameController } : Icon.GameController}
          title={app.name}
          subtitle={app.description}
          keywords={[app.module, app.author, ...app.tags].filter(Boolean)}
          accessories={[
            ...(app.deprecated ? [{ tag: { value: "Deprecated", color: Color.Orange }, tooltip: app.deprecated }] : []),
            ...(app.author ? [{ text: app.author, icon: Icon.Person }] : []),
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Create Server"
                icon={Icon.Plus}
                target={<CreateServerForm app={app} onCreated={onCreated} />}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

interface Values {
  friendlyName: string;
  install: boolean;
  startOnBoot: boolean;
}

function CreateServerForm({ app, onCreated }: { app: AppSummary; onCreated?: () => void }) {
  const { pop } = useNavigation();

  async function submit(values: Values) {
    const name = values.friendlyName.trim();
    if (!name) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: "Creating server…", message: name });
    try {
      await createServer(app, name, values.startOnBoot);
      onCreated?.();
      if (values.install) {
        toast.title = "Installing game server…";
        toast.message = "This can take several minutes";
        await installNewServer(name);
        toast.style = Toast.Style.Success;
        toast.title = "Installation started";
        toast.message = `${name} – follow progress in the console`;
      } else {
        toast.style = Toast.Style.Success;
        toast.title = "Server created";
      }
      onCreated?.();
      pop();
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: "Could not create server" });
    }
  }

  return (
    <Form
      navigationTitle={`New ${app.name} Server`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Server" icon={Icon.Plus} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Game" text={app.name} />
      <Form.TextField id="friendlyName" title="Server Name" defaultValue={`${app.name} Server`} />
      <Form.Checkbox
        id="install"
        title="Installation"
        label="Start instance and install the game right away"
        defaultValue={true}
      />
      <Form.Checkbox id="startOnBoot" title="Autostart" label="Start when the AMP host boots" defaultValue={true} />
      <Form.Description text="Ports, memory and other options use AMP's defaults and can be changed later in Settings." />
    </Form>
  );
}

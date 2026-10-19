import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { Instance } from "../amp";
import { updateInstanceInfo } from "../management";
import { runAction } from "../run";

interface Values {
  friendlyName: string;
  description: string;
  startOnBoot: boolean;
}

export function EditInstanceForm({ instance, onSaved }: { instance: Instance; onSaved: () => void }) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle={`Edit · ${instance.FriendlyName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={async (values: Values) => {
              if (!values.friendlyName.trim()) return;
              const ok = await runAction(
                "Save Instance",
                () => updateInstanceInfo(instance, { ...values, friendlyName: values.friendlyName.trim() }),
                { subject: values.friendlyName, successTitle: "Instance saved", onSuccess: onSaved },
              );
              if (ok) pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="friendlyName" title="Name" defaultValue={instance.FriendlyName} />
      <Form.TextArea id="description" title="Description" defaultValue={instance.Description ?? ""} />
      <Form.Checkbox
        id="startOnBoot"
        title="Autostart"
        label="Start this instance when the AMP host boots"
        defaultValue={instance.StartOnBoot}
      />
      <Form.Description text={`Internal name: ${instance.InstanceName} (cannot be changed)`} />
    </Form>
  );
}

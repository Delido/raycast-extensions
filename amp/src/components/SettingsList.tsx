import { Action, ActionPanel, Form, Icon, Keyboard, List, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { Instance } from "../amp";
import { fetchSettings, setSetting, Setting } from "../management";
import { runAction } from "../run";

const MASK = "••••••••";

function displayValue(setting: Setting, revealed: boolean): string {
  if (setting.inputType === "password") return setting.value ? (revealed ? setting.value : MASK) : "";
  if (setting.inputType === "checkbox") return setting.value.toLowerCase() === "true" ? "On" : "Off";
  const option = setting.options.find((o) => o.value === setting.value);
  return `${option?.title ?? setting.value}${setting.suffix && setting.value ? ` ${setting.suffix}` : ""}`;
}

export function SettingsList({ instance }: { instance: Instance }) {
  const id = instance.InstanceID;
  const { data, isLoading, revalidate } = useCachedPromise(fetchSettings, [id], { keepPreviousData: true });
  const [category, setCategory] = useState("all");
  const [revealed, setRevealed] = useState(false);

  const categories = useMemo(() => [...new Set((data ?? []).map((s) => s.category))], [data]);
  const visible = (data ?? []).filter((s) => category === "all" || s.category === category);
  const sections = useMemo(() => {
    const map = new Map<string, Setting[]>();
    for (const s of visible) {
      const key = s.subcategory ? `${s.category} › ${s.subcategory}` : s.category;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Settings · ${instance.FriendlyName}`}
      searchBarPlaceholder="Search settings…"
      searchBarAccessory={
        <List.Dropdown tooltip="Category" onChange={setCategory}>
          <List.Dropdown.Item value="all" title="All Categories" />
          {categories.map((c) => (
            <List.Dropdown.Item key={c} value={c} title={c} />
          ))}
        </List.Dropdown>
      }
    >
      {sections.map(([title, settings]) => (
        <List.Section key={title} title={title}>
          {settings.map((setting) => (
            <List.Item
              key={setting.node}
              icon={setting.inputType === "password" ? Icon.Key : setting.readOnly ? Icon.Lock : Icon.Gear}
              title={setting.name}
              keywords={[setting.description, setting.node, setting.category]}
              accessories={[{ text: displayValue(setting, revealed), tooltip: setting.description || undefined }]}
              actions={
                <ActionPanel>
                  {!setting.readOnly && (
                    <Action.Push
                      title="Edit Setting"
                      icon={Icon.Pencil}
                      target={<EditSettingForm instance={instance} setting={setting} onSaved={revalidate} />}
                    />
                  )}
                  <Action
                    title={revealed ? "Hide Passwords" : "Show Passwords"}
                    icon={revealed ? Icon.EyeDisabled : Icon.Eye}
                    onAction={() => setRevealed((r) => !r)}
                    shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                  />
                  <Action.CopyToClipboard
                    title="Copy Value"
                    content={setting.value}
                    concealed={setting.inputType === "password"}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
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
        </List.Section>
      ))}
    </List>
  );
}

function EditSettingForm(props: { instance: Instance; setting: Setting; onSaved: () => void }) {
  const { instance, setting, onSaved } = props;
  const { pop } = useNavigation();

  async function save(value: string) {
    const ok = await runAction("Save Setting", () => setSetting(instance.InstanceID, setting.node, value), {
      subject: setting.name,
      successTitle: "Setting saved",
      onSuccess: onSaved,
    });
    if (ok) pop();
  }

  let field;
  if (setting.inputType === "checkbox") {
    field = <Form.Checkbox id="value" label={setting.name} defaultValue={setting.value.toLowerCase() === "true"} />;
  } else if (setting.options.length > 0) {
    field = (
      <Form.Dropdown id="value" title={setting.name} defaultValue={setting.value}>
        {setting.options.map((o) => (
          <Form.Dropdown.Item key={o.value} value={o.value} title={o.title} />
        ))}
      </Form.Dropdown>
    );
  } else if (setting.inputType === "password") {
    field = <Form.PasswordField id="value" title={setting.name} defaultValue={setting.value} />;
  } else if (setting.inputType === "textarea" || setting.value.length > 80) {
    field = <Form.TextArea id="value" title={setting.name} defaultValue={setting.value} />;
  } else {
    field = (
      <Form.TextField
        id="value"
        title={setting.name}
        defaultValue={setting.value}
        placeholder={setting.placeholder || undefined}
        info={setting.suffix ? `Unit: ${setting.suffix}` : undefined}
      />
    );
  }

  return (
    <Form
      navigationTitle={setting.name}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={(values: { value: string | boolean }) =>
              save(typeof values.value === "boolean" ? (values.value ? "True" : "False") : values.value)
            }
          />
        </ActionPanel>
      }
    >
      {field}
      {setting.description && <Form.Description text={setting.description} />}
      <Form.Description text="Most settings take effect after the server is restarted." />
    </Form>
  );
}

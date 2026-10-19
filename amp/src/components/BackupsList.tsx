import { Action, ActionPanel, Color, Form, Icon, Keyboard, List, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { Instance } from "../amp";
import { Backup, deleteBackup, fetchBackups, restoreBackup, setBackupSticky, takeBackup } from "../management";
import { formatBytes, runAction } from "../run";

export function BackupsList({ instance }: { instance: Instance }) {
  const id = instance.InstanceID;
  const { data, isLoading, revalidate } = useCachedPromise(fetchBackups, [id], { keepPreviousData: true });
  const refreshSoon = () => setTimeout(revalidate, 2000);

  const takeBackupAction = (
    <Action.Push
      title="Take Backup"
      icon={Icon.Plus}
      target={<TakeBackupForm instance={instance} onDone={refreshSoon} />}
      shortcut={Keyboard.Shortcut.Common.New}
    />
  );

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Backups · ${instance.FriendlyName}`}
      searchBarPlaceholder="Filter backups…"
    >
      <List.EmptyView
        icon={Icon.HardDrive}
        title="No backups yet"
        actions={<ActionPanel>{takeBackupAction}</ActionPanel>}
      />
      {data?.map((backup) => (
        <List.Item
          key={backup.id}
          icon={backup.sticky ? { source: Icon.Pin, tintColor: Color.Orange } : Icon.HardDrive}
          title={backup.name}
          subtitle={backup.description}
          accessories={[
            ...(backup.automatic ? [{ tag: "Auto" }] : []),
            ...(backup.s3 ? [{ tag: { value: "S3", color: Color.Blue } }] : []),
            ...(formatBytes(backup.sizeBytes) ? [{ text: formatBytes(backup.sizeBytes) }] : []),
            ...(backup.date ? [{ date: backup.date, tooltip: backup.date.toLocaleString() }] : []),
          ]}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action
                  title="Restore Backup"
                  icon={Icon.RotateAntiClockwise}
                  style={Action.Style.Destructive}
                  onAction={() => restore(instance, backup, refreshSoon)}
                />
                {takeBackupAction}
                <Action
                  title={backup.sticky ? "Unpin Backup" : "Pin Backup (Keep Forever)"}
                  icon={Icon.Pin}
                  shortcut={Keyboard.Shortcut.Common.Pin}
                  onAction={() =>
                    runAction(
                      backup.sticky ? "Unpin Backup" : "Pin Backup",
                      () => setBackupSticky(id, backup.id, !backup.sticky),
                      { subject: backup.name, onSuccess: revalidate },
                    )
                  }
                />
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action
                  title="Delete Backup"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() =>
                    runAction("Delete Backup", () => deleteBackup(id, backup.id), {
                      subject: backup.name,
                      confirm: { title: "Delete this backup?", destructive: true },
                      onSuccess: revalidate,
                    })
                  }
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  onAction={revalidate}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function restore(instance: Instance, backup: Backup, onDone: () => void) {
  return runAction("Restore Backup", () => restoreBackup(instance.InstanceID, backup.id, false), {
    subject: backup.name,
    confirm: {
      title: "Restore this backup?",
      message: `${instance.FriendlyName} will be stopped and its files replaced with "${backup.name}".`,
      destructive: true,
    },
    successTitle: "Restore started",
    onSuccess: onDone,
  });
}

function TakeBackupForm({ instance, onDone }: { instance: Instance; onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`New Backup · ${instance.FriendlyName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Take Backup"
            icon={Icon.HardDrive}
            onSubmit={async (values: { title: string; description: string; sticky: boolean }) => {
              const ok = await runAction(
                "Take Backup",
                () =>
                  takeBackup(instance.InstanceID, values.title || "Raycast Backup", values.description, values.sticky),
                { subject: instance.FriendlyName, successTitle: "Backup started", onSuccess: onDone },
              );
              if (ok) pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" defaultValue={`Backup ${new Date().toLocaleString()}`} />
      <Form.TextArea id="description" title="Description" placeholder="Optional" />
      <Form.Checkbox id="sticky" label="Keep forever (never delete automatically)" defaultValue={false} />
      <Form.Description text="Depending on the game, AMP may stop the server while the backup is taken." />
    </Form>
  );
}

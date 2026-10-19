import { Action, ActionPanel, Color, Icon, List, showHUD } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { getAudioDevices, setAudioDevice, splitDeviceName } from "./audio";

export default function AudioOutput() {
  const { data, isLoading, error, revalidate } = usePromise(getAudioDevices);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search audio outputs...">
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Companion service not running"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.RotateClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ) : null}
      {data?.map((device) => {
        const { title, subtitle } = splitDeviceName(device.name);
        return (
          <List.Item
            key={device.id}
            icon={
              device.default
                ? { source: Icon.CheckCircle, tintColor: Color.Green }
                : /kopfh|head|virtuoso|arctis|hyperx/i.test(device.name)
                  ? Icon.Headphones
                  : Icon.Speaker
            }
            title={title}
            subtitle={subtitle}
            accessories={device.default ? [{ tag: { value: "Default", color: Color.Green } }] : []}
            actions={
              <ActionPanel>
                <Action
                  title="Set as Default Output"
                  icon={Icon.Speaker}
                  onAction={async () => {
                    try {
                      await setAudioDevice(device.id);
                      await showHUD(`🔊 ${title}`);
                    } catch (e) {
                      await showFailureToast(e, { title: "Companion service" });
                      revalidate();
                    }
                  }}
                />
                <Action title="Refresh" icon={Icon.RotateClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

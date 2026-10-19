import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useState } from "react";
import {
  applyEffect,
  applyPreset,
  Effect,
  getEffects,
  getLayouts,
  getLighting,
  getPresets,
  primaryShortcut,
  request,
  setBrightness,
  setEnabled,
  setLayout,
  stepEffect,
} from "./api";

interface EffectInfo {
  description?: string;
  image?: string;
  publisher?: string;
  uses_audio?: boolean;
  uses_video?: boolean;
  uses_input?: boolean;
  uses_meters?: boolean;
}

const BRIGHTNESS_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

async function run(title: string, action: () => Promise<unknown>, after?: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title });
  try {
    await action();
    toast.style = Toast.Style.Success;
    after?.();
  } catch (error) {
    toast.hide();
    await showFailureToast(error, { title: "SignalRGB" });
  }
}

function EffectDetail({ effect }: { effect: Effect }) {
  const { data } = usePromise(
    async (id: string) =>
      (await request<{ attributes: EffectInfo }>("GET", `lighting/effects/${encodeURIComponent(id)}`)).attributes,
    [effect.id],
  );
  const features = [
    data?.uses_audio && "Audio",
    data?.uses_video && "Screen",
    data?.uses_input && "Input",
    data?.uses_meters && "Meters",
  ].filter(Boolean) as string[];
  const markdown = [
    data?.image ? `![](${data.image}?raycast-height=180)` : "",
    `## ${effect.name}`,
    data?.description ?? "",
  ].join("\n\n");

  return (
    <List.Item.Detail
      isLoading={!data}
      markdown={markdown}
      metadata={
        data && (data.publisher || features.length > 0) ? (
          <List.Item.Detail.Metadata>
            {data.publisher ? <List.Item.Detail.Metadata.Label title="Publisher" text={data.publisher} /> : null}
            {features.length > 0 ? (
              <List.Item.Detail.Metadata.TagList title="Uses">
                {features.map((f) => (
                  <List.Item.Detail.Metadata.TagList.Item key={f} text={f} />
                ))}
              </List.Item.Detail.Metadata.TagList>
            ) : null}
          </List.Item.Detail.Metadata>
        ) : undefined
      }
    />
  );
}

function PresetList({ effect, onApplied }: { effect: Effect; onApplied: () => void }) {
  const { data, isLoading } = usePromise(getPresets, [effect.id]);
  return (
    <List isLoading={isLoading} navigationTitle={`${effect.name} Presets`} searchBarPlaceholder="Filter presets...">
      <List.EmptyView icon={Icon.Swatch} title="This effect has no presets" />
      {data?.map((preset) => (
        <List.Item
          key={preset}
          icon={Icon.Swatch}
          title={preset}
          actions={
            <ActionPanel>
              <Action
                title="Apply Preset"
                icon={Icon.Checkmark}
                onAction={() =>
                  run(
                    `Applying ${preset}`,
                    async () => {
                      await applyEffect(effect);
                      await applyPreset(effect.id, preset);
                    },
                    onApplied,
                  )
                }
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export default function Effects() {
  const [showingDetail, setShowingDetail] = useState(false);
  const lighting = usePromise(getLighting);
  const effects = usePromise(getEffects);
  const layouts = usePromise(getLayouts);

  const error = lighting.error ?? effects.error;
  const current = lighting.data;
  const refresh = () => {
    lighting.revalidate();
    layouts.revalidate();
  };

  const globalActions = (
    <>
      <ActionPanel.Section>
        <Action
          title="Next Effect"
          icon={Icon.Forward}
          shortcut={primaryShortcut("arrowRight")}
          onAction={() => run("Next effect", () => stepEffect("next"), refresh)}
        />
        <Action
          title="Previous Effect"
          icon={Icon.Rewind}
          shortcut={primaryShortcut("arrowLeft")}
          onAction={() => run("Previous effect", () => stepEffect("previous"), refresh)}
        />
        <Action
          title="Random Effect"
          icon={Icon.Shuffle}
          shortcut={primaryShortcut("r", true)}
          onAction={() => run("Random effect", () => stepEffect("shuffle"), refresh)}
        />
        {current ? (
          <Action
            title={current.enabled ? "Disable Lighting" : "Enable Lighting"}
            icon={current.enabled ? Icon.LightBulbOff : Icon.LightBulb}
            shortcut={primaryShortcut("t", true)}
            onAction={() =>
              run(current.enabled ? "Lighting off" : "Lighting on", () => setEnabled(!current.enabled), refresh)
            }
          />
        ) : null}
        <ActionPanel.Submenu title="Set Brightness" icon={Icon.Sun} shortcut={primaryShortcut("b", true)}>
          {BRIGHTNESS_STEPS.map((value) => (
            <Action
              key={value}
              title={`${value}%`}
              icon={current?.global_brightness === value ? Icon.Checkmark : Icon.Circle}
              onAction={() => run(`Brightness ${value}%`, () => setBrightness(value), refresh)}
            />
          ))}
        </ActionPanel.Submenu>
        {layouts.data && layouts.data.layouts.length > 0 ? (
          <ActionPanel.Submenu title="Switch Layout" icon={Icon.AppWindowGrid3x3} shortcut={primaryShortcut("l", true)}>
            {layouts.data.layouts.map((layout) => (
              <Action
                key={layout}
                title={layout}
                icon={layouts.data?.current === layout ? Icon.Checkmark : Icon.Circle}
                onAction={() => run(`Layout ${layout}`, () => setLayout(layout), refresh)}
              />
            ))}
          </ActionPanel.Submenu>
        ) : null}
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action
          title="Refresh"
          icon={Icon.RotateClockwise}
          shortcut={primaryShortcut("r")}
          onAction={() => {
            refresh();
            effects.revalidate();
          }}
        />
      </ActionPanel.Section>
    </>
  );

  return (
    <List
      isLoading={lighting.isLoading || effects.isLoading}
      isShowingDetail={showingDetail}
      searchBarPlaceholder="Search effects..."
      navigationTitle={
        current
          ? `${current.enabled ? "On" : "Off"} · ${current.global_brightness}% · ${current.name}`
          : "Lighting Effects"
      }
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Can't reach SignalRGB"
          description={error.message}
          actions={<ActionPanel>{globalActions}</ActionPanel>}
        />
      ) : null}
      {effects.data?.map((effect) => {
        const isCurrent = effect.name === current?.name;
        return (
          <List.Item
            key={effect.id}
            icon={isCurrent ? { source: Icon.CheckCircle, tintColor: Color.Green } : Icon.Brush}
            title={effect.name}
            accessories={
              isCurrent && !showingDetail
                ? [{ tag: { value: current?.enabled ? "Active" : "Paused", color: Color.Green } }]
                : []
            }
            detail={showingDetail ? <EffectDetail effect={effect} /> : undefined}
            actions={
              <ActionPanel>
                <Action
                  title="Apply Effect"
                  icon={Icon.Checkmark}
                  onAction={() => run(`Applying ${effect.name}`, () => applyEffect(effect), refresh)}
                />
                <Action.Push
                  title="Show Presets"
                  icon={Icon.Swatch}
                  shortcut={primaryShortcut("p")}
                  target={<PresetList effect={effect} onApplied={refresh} />}
                />
                <Action
                  title={showingDetail ? "Hide Details" : "Show Details"}
                  icon={Icon.Sidebar}
                  shortcut={primaryShortcut("d")}
                  onAction={() => setShowingDetail((v) => !v)}
                />
                {globalActions}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

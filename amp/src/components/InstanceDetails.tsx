import { Action, ActionPanel, Detail, Icon, Keyboard } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { fetchServerInfo, Instance, panelUrl, stateInfo } from "../amp";

function mask(value: string): string {
  return "•".repeat(Math.min(Math.max(value.length, 6), 16));
}

export function InstanceDetails({ instance }: { instance: Instance }) {
  const [revealed, setRevealed] = useState(false);
  const { data, isLoading, revalidate } = useCachedPromise(fetchServerInfo, [instance.InstanceID]);
  const state = stateInfo(instance);
  const endpoints = instance.ApplicationEndpoints?.filter((e) => e.Endpoint) ?? [];
  const passwords = data?.passwords ?? [];

  const lines = [`# ${instance.FriendlyName}`, ""];
  if (data) {
    lines.push("## Passwords", "");
    if (passwords.length === 0) {
      lines.push("_No game server password set._");
    } else {
      for (const p of passwords) lines.push(`- **${p.label}:** \`${revealed ? p.value : mask(p.value)}\``);
    }
    if (data.settings.length > 0) {
      lines.push("", "## Settings", "");
      for (const s of data.settings) lines.push(`- **${s.label}:** ${s.value}`);
    }
  }

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={instance.FriendlyName}
      markdown={lines.join("\n")}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item text={state.label} color={state.color} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Game" text={instance.ModuleDisplayName ?? instance.Module} />
          {endpoints.map((e) => (
            <Detail.Metadata.Label key={e.DisplayName} title={e.DisplayName} text={e.Endpoint} />
          ))}
          <Detail.Metadata.Label title="Instance" text={instance.InstanceName} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {passwords.length > 0 && (
            <Action
              title={revealed ? "Hide Passwords" : "Show Passwords"}
              icon={revealed ? Icon.EyeDisabled : Icon.Eye}
              onAction={() => setRevealed((r) => !r)}
            />
          )}
          {passwords.map((p, index) => (
            <Action.CopyToClipboard
              key={p.label}
              title={`Copy ${p.label}`}
              content={p.value}
              concealed
              shortcut={index === 0 ? Keyboard.Shortcut.Common.Copy : undefined}
            />
          ))}
          {endpoints.map((e) => (
            <Action.CopyToClipboard key={e.DisplayName} title={`Copy ${e.DisplayName}`} content={e.Endpoint} />
          ))}
          <Action.OpenInBrowser title="Open in AMP Panel" url={panelUrl(instance.InstanceID)} />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            onAction={revalidate}
            shortcut={Keyboard.Shortcut.Common.Refresh}
          />
        </ActionPanel>
      }
    />
  );
}

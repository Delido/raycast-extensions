import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useEffect } from "react";
import { action, Instance } from "../amp";
import { fetchPlayers, Player } from "../management";
import { runAction } from "../run";

/** Console commands for games whose moderation works via the server console. */
const MODERATION: Record<string, { label: string; command: (name: string) => string; destructive?: boolean }[]> = {
  Minecraft: [
    { label: "Kick", command: (n) => `kick ${n}`, destructive: true },
    { label: "Ban", command: (n) => `ban ${n}`, destructive: true },
    { label: "Make Operator", command: (n) => `op ${n}` },
    { label: "Remove Operator", command: (n) => `deop ${n}` },
    { label: "Whitelist", command: (n) => `whitelist add ${n}` },
  ],
};

export function PlayersList({ instance }: { instance: Instance }) {
  const { data, isLoading, revalidate } = useCachedPromise(fetchPlayers, [instance.InstanceID], {
    keepPreviousData: true,
  });

  useEffect(() => {
    const timer = setInterval(revalidate, 10_000);
    return () => clearInterval(timer);
  }, [revalidate]);

  const moderation = MODERATION[instance.Module] ?? [];
  const send = (player: Player, label: string, command: string, destructive?: boolean) =>
    runAction(label, () => action(instance.InstanceID, "Core/SendConsoleMessage", { message: command }), {
      subject: player.name,
      confirm: destructive ? { title: `${label} ${player.name}?`, destructive: true } : undefined,
      successTitle: `${label}: sent`,
      onSuccess: () => setTimeout(revalidate, 1500),
    });

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Players · ${instance.FriendlyName}`}
      searchBarPlaceholder="Filter players…"
    >
      <List.EmptyView icon={Icon.TwoPeople} title="Nobody is online" />
      <List.Section title="Online" subtitle={data ? String(data.length) : undefined}>
        {data?.map((player) => (
          <List.Item
            key={player.id || player.name}
            icon={Icon.Person}
            title={player.name}
            subtitle={player.id !== player.name ? player.id : undefined}
            actions={
              <ActionPanel>
                {moderation.length > 0 && (
                  <ActionPanel.Section>
                    {moderation.map((m) => (
                      <Action
                        key={m.label}
                        title={m.label}
                        icon={m.destructive ? Icon.XMarkCircle : Icon.Person}
                        style={m.destructive ? Action.Style.Destructive : Action.Style.Regular}
                        onAction={() => send(player, m.label, m.command(player.name), m.destructive)}
                      />
                    ))}
                  </ActionPanel.Section>
                )}
                <ActionPanel.Section>
                  <Action.CopyToClipboard title="Copy Name" content={player.name} />
                  {player.id && <Action.CopyToClipboard title="Copy ID" content={player.id} />}
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
      </List.Section>
    </List>
  );
}

import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { ErrorView, MessageForm, SignOutAction } from "./components";
import { Channel, graph, primaryShortcut, sendChannelMessage, Team, teamsLink } from "./graph";

export default function TeamsChannels() {
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const teams = (await graph<{ value: Team[] }>("me/joinedTeams")).value.sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    const channels = await Promise.all(
      teams.map((team) =>
        graph<{ value: Channel[] }>(
          `teams/${team.id}/channels?$select=id,displayName,description,webUrl,membershipType`,
        )
          .then((r) => r.value)
          .catch(() => [] as Channel[]),
      ),
    );
    return teams.map((team, i) => ({
      team,
      // "General" first, then alphabetical – like Teams itself.
      channels: channels[i].sort(
        (a, b) =>
          Number(b.displayName === "General" || b.displayName === "Allgemein") -
            Number(a.displayName === "General" || a.displayName === "Allgemein") ||
          a.displayName.localeCompare(b.displayName),
      ),
    }));
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter teams and channels...">
      {data?.map(({ team, channels }) => (
        <List.Section key={team.id} title={team.displayName} subtitle={String(channels.length)}>
          {channels.map((channel) => (
            <List.Item
              key={channel.id}
              icon={channel.membershipType === "private" ? Icon.Lock : Icon.Hashtag}
              title={channel.displayName}
              subtitle={channel.description ?? undefined}
              keywords={[team.displayName]}
              accessories={[{ text: team.displayName }]}
              actions={
                <ActionPanel>
                  <Action.Open title="Open in Teams" icon={Icon.Message} target={teamsLink(channel.webUrl)} />
                  <Action.Push
                    title="Post Message"
                    icon={Icon.Envelope}
                    shortcut={primaryShortcut("m")}
                    target={
                      <MessageForm
                        title={`${team.displayName} › ${channel.displayName}`}
                        send={(text) => sendChannelMessage(team.id, channel.id, text)}
                      />
                    }
                  />
                  <ActionPanel.Section>
                    <Action.CopyToClipboard
                      title="Copy Channel Link"
                      content={channel.webUrl}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={Keyboard.Shortcut.Common.Refresh}
                      onAction={revalidate}
                    />
                    <SignOutAction onSignedOut={revalidate} />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      {error && !isLoading ? (
        <ErrorView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No teams found" icon={Icon.TwoPeople} />
      )}
    </List>
  );
}

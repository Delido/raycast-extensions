import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { ErrorView, SignOutAction } from "./components";
import { formatSummary, graph, MessageHit, teamsLink } from "./graph";

const PAGE_SIZE = 25;

interface SearchResponse {
  value: { hitsContainers: { hits?: MessageHit[]; moreResultsAvailable: boolean }[] }[];
}

/** Microsoft Search matches whole words only; append "*" to plain words for prefix search. */
function prefixQuery(text: string): string {
  if (text.includes('"')) return text;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^(AND|OR|NOT)$/.test(w) || /[:*()]/.test(w) || w.startsWith("-") ? w : `${w}*`))
    .join(" ");
}

function messageLink(hit: MessageHit): string | undefined {
  const r = hit.resource;
  if (r.webLink) return r.webLink;
  const context = encodeURIComponent(JSON.stringify({ contextType: "chat" }));
  if (r.chatId) return `https://teams.microsoft.com/l/message/${r.chatId}/${r.id}?context=${context}`;
  if (r.channelIdentity?.channelId && r.channelIdentity.teamId) {
    return `https://teams.microsoft.com/l/message/${r.channelIdentity.channelId}/${r.id}?groupId=${r.channelIdentity.teamId}`;
  }
  return undefined;
}

export default function SearchMessages() {
  const [searchText, setSearchText] = useState("");
  const text = searchText.trim();

  const { data, isLoading, error, pagination, revalidate } = usePromise(
    (text: string) =>
      async ({ page }: { page: number }) => {
        if (!text) return { data: [] as MessageHit[], hasMore: false };
        const result = await graph<SearchResponse>("search/query", {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                entityTypes: ["chatMessage"],
                query: { queryString: prefixQuery(text) },
                from: page * PAGE_SIZE,
                size: PAGE_SIZE,
              },
            ],
          }),
        });
        const container = result.value[0]?.hitsContainers[0];
        return { data: container?.hits ?? [], hasMore: container?.moreResultsAvailable ?? false };
      },
    [text],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search chat and channel messages..."
      pagination={pagination}
      throttle
    >
      {data?.map((hit) => {
        const link = messageLink(hit);
        const summary = formatSummary(hit.summary) || hit.resource.subject || "(no preview)";
        const from = hit.resource.from?.emailAddress?.name;
        return (
          <List.Item
            key={hit.hitId}
            icon={hit.resource.channelIdentity?.channelId ? Icon.Hashtag : Icon.Message}
            title={summary}
            subtitle={from}
            accessories={hit.resource.createdDateTime ? [{ date: new Date(hit.resource.createdDateTime) }] : undefined}
            actions={
              <ActionPanel>
                {link && <Action.Open title="Open in Teams" icon={Icon.Message} target={teamsLink(link)} />}
                <ActionPanel.Section>
                  {link && (
                    <Action.CopyToClipboard
                      title="Copy Message Link"
                      content={link}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  )}
                  <Action.CopyToClipboard
                    title="Copy Text"
                    content={summary}
                    shortcut={Keyboard.Shortcut.Common.CopyName}
                  />
                  <SignOutAction onSignedOut={revalidate} />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
      {error && !isLoading ? (
        <ErrorView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView
          title={text ? "No messages found" : "Type to search messages"}
          description={text ? undefined : 'Supports KQL, e.g. from:"Jane Doe" or "exact phrase"'}
          icon={Icon.MagnifyingGlass}
        />
      )}
    </List>
  );
}

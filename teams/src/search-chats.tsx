import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { ErrorView, MessageForm, SignOutAction } from "./components";
import { Chat, getMe, graph, primaryShortcut, sendChatMessage, stripHtml, teamsLink } from "./graph";

const CHAT_ICONS: Record<Chat["chatType"], Icon> = {
  oneOnOne: Icon.Person,
  group: Icon.TwoPeople,
  meeting: Icon.Calendar,
};

function chatTitle(chat: Chat, myId: string): string {
  if (chat.topic) return chat.topic;
  const others = (chat.members ?? [])
    .filter((m) => m.userId !== myId)
    .map((m) => m.displayName)
    .filter(Boolean);
  return others.join(", ") || "Chat";
}

export default function SearchChats() {
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const [me, chats] = await Promise.all([
      getMe(),
      graph<{ value: Chat[] }>(
        "me/chats?$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc&$top=50",
      ),
    ]);
    return { myId: me.id, chats: chats.value };
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter chats...">
      {data?.chats.map((chat) => {
        const title = chatTitle(chat, data.myId);
        const preview = chat.lastMessagePreview;
        const previewText = stripHtml(preview?.body?.content);
        const from = preview?.from?.user?.displayName;
        return (
          <List.Item
            key={chat.id}
            icon={CHAT_ICONS[chat.chatType] ?? Icon.Message}
            title={title}
            subtitle={previewText ? `${from ? `${from}: ` : ""}${previewText}` : undefined}
            keywords={(chat.members ?? []).map((m) => m.displayName ?? "").filter(Boolean)}
            accessories={preview ? [{ date: new Date(preview.createdDateTime) }] : undefined}
            actions={
              <ActionPanel>
                <Action.Open title="Open in Teams" icon={Icon.Message} target={teamsLink(chat.webUrl)} />
                <Action.Push
                  title="Send Message"
                  icon={Icon.Envelope}
                  shortcut={primaryShortcut("m")}
                  target={<MessageForm title={title} send={(text) => sendChatMessage(chat.id, text)} />}
                />
                <ActionPanel.Section>
                  <Action.CopyToClipboard
                    title="Copy Chat Link"
                    content={chat.webUrl}
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
        );
      })}
      {error && !isLoading ? (
        <ErrorView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No chats found" icon={Icon.Message} />
      )}
    </List>
  );
}

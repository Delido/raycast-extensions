import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { ErrorView, MessageForm, SignOutAction } from "./components";
import {
  callUserLink,
  chatWithUserLink,
  getOneOnOneChat,
  getPresences,
  presenceInfo,
  primaryShortcut,
  searchUsers,
  sendChatMessage,
  User,
} from "./graph";

export default function SearchPeople() {
  const [searchText, setSearchText] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  const { data, isLoading, error, revalidate } = usePromise(
    async (text: string) => {
      const users = (await searchUsers(text)).filter((u) => u.mail || u.userPrincipalName);
      // Presence is a nice-to-have: don't fail the list if it is not permitted.
      const presences = await getPresences(users.map((u) => u.id)).catch(() => ({}));
      return { users, presences };
    },
    [searchText.trim()],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search people by name or email..."
      isShowingDetail={showDetail && !!data?.users.length}
      throttle
    >
      <List.Section title={searchText.trim() ? "People" : "Frequent Contacts"}>
        {data?.users.map((user) => (
          <PersonItem
            key={user.id}
            user={user}
            presence={presenceInfo(data.presences[user.id as keyof typeof data.presences])}
            showDetail={showDetail}
            toggleDetail={() => setShowDetail((v) => !v)}
            onSignedOut={revalidate}
          />
        ))}
      </List.Section>
      {error && !isLoading ? (
        <ErrorView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No people found" icon={Icon.Person} />
      )}
    </List>
  );
}

function PersonItem({
  user,
  presence,
  showDetail,
  toggleDetail,
  onSignedOut,
}: {
  user: User;
  presence?: { label: string; color: string };
  showDetail: boolean;
  toggleDetail: () => void;
  onSignedOut: () => void;
}) {
  const upn = user.userPrincipalName || user.mail || "";
  const email = user.mail || upn;
  const phone = user.mobilePhone || user.businessPhones?.[0];

  return (
    <List.Item
      icon={{ source: Icon.CircleFilled, tintColor: presence?.color ?? "secondaryText" }}
      title={user.displayName}
      subtitle={showDetail ? undefined : [user.jobTitle, user.department].filter(Boolean).join(" · ")}
      keywords={[email]}
      accessories={showDetail ? undefined : presence ? [{ text: presence.label }] : undefined}
      detail={
        <List.Item.Detail
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Name" text={user.displayName} />
              {presence && (
                <List.Item.Detail.Metadata.TagList title="Status">
                  <List.Item.Detail.Metadata.TagList.Item text={presence.label} color={presence.color} />
                </List.Item.Detail.Metadata.TagList>
              )}
              {user.jobTitle && <List.Item.Detail.Metadata.Label title="Job Title" text={user.jobTitle} />}
              {user.department && <List.Item.Detail.Metadata.Label title="Department" text={user.department} />}
              {user.officeLocation && <List.Item.Detail.Metadata.Label title="Office" text={user.officeLocation} />}
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Link title="Email" target={`mailto:${email}`} text={email} />
              {phone && <List.Item.Detail.Metadata.Link title="Phone" target={`tel:${phone}`} text={phone} />}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <Action.Open title="Chat in Teams" icon={Icon.Message} target={chatWithUserLink(upn)} />
          <Action.Push
            title="Send Message"
            icon={Icon.Envelope}
            shortcut={primaryShortcut("m")}
            target={
              <MessageForm
                title={user.displayName}
                send={async (text) => {
                  const chat = await getOneOnOneChat(user.id);
                  await sendChatMessage(chat.id, text);
                }}
              />
            }
          />
          <Action.Open
            title="Call"
            icon={Icon.Phone}
            target={callUserLink(upn)}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "a" },
              Windows: { modifiers: ["ctrl", "shift"], key: "a" },
            }}
          />
          <Action.Open
            title="Video Call"
            icon={Icon.Video}
            target={callUserLink(upn, true)}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "v" },
              Windows: { modifiers: ["ctrl", "shift"], key: "v" },
            }}
          />
          <Action.Open
            title="Send Email"
            icon={Icon.AtSymbol}
            target={`mailto:${email}`}
            shortcut={primaryShortcut("e")}
          />
          <Action
            title={showDetail ? "Hide Details" : "Show Details"}
            icon={Icon.Sidebar}
            shortcut={primaryShortcut("y")}
            onAction={toggleDetail}
          />
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Email" content={email} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Name"
              content={user.displayName}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            {phone && <Action.CopyToClipboard title="Copy Phone Number" content={phone} />}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <SignOutAction onSignedOut={onSignedOut} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

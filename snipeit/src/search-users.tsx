import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { decode, list, User, webUrl } from "./api";
import { ErrorEmptyView, UserItems } from "./components";

const PAGE_SIZE = 50;

export default function SearchUsers() {
  const [searchText, setSearchText] = useState("");

  const { data, isLoading, error, pagination, revalidate } = usePromise(
    (search: string) =>
      async ({ page }: { page: number }) => {
        const result = await list<User>("users", {
          search,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          sort: "last_name",
          order: "asc",
        });
        return { data: result.rows, hasMore: (page + 1) * PAGE_SIZE < result.total };
      },
    [searchText.trim()],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search users by name, username or email..."
      pagination={pagination}
      throttle
    >
      {data?.map((user) => {
        const counts = [
          user.assets_count ? { icon: Icon.ComputerChip, text: String(user.assets_count), tooltip: "Assets" } : null,
          user.licenses_count ? { icon: Icon.Key, text: String(user.licenses_count), tooltip: "Licenses" } : null,
          user.accessories_count
            ? { icon: Icon.Keyboard, text: String(user.accessories_count), tooltip: "Accessories" }
            : null,
        ].filter((x): x is NonNullable<typeof x> => x !== null);
        const url = webUrl("users", user.id);
        return (
          <List.Item
            key={user.id}
            icon={Icon.Person}
            title={decode(user.name)}
            subtitle={[decode(user.jobtitle), decode(user.department?.name)].filter(Boolean).join(" · ")}
            keywords={[user.username ?? "", user.email ?? "", user.employee_num ?? ""]}
            accessories={counts}
            actions={
              <ActionPanel>
                <Action.Push title="Show Assigned Items" icon={Icon.List} target={<UserItems user={user} />} />
                <Action.OpenInBrowser title="Open in Snipe-IT" url={url} />
                <ActionPanel.Section>
                  {user.email && (
                    <Action.CopyToClipboard
                      title="Copy Email"
                      content={user.email}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  )}
                  {user.username && (
                    <Action.CopyToClipboard
                      title="Copy Username"
                      content={user.username}
                      shortcut={Keyboard.Shortcut.Common.CopyName}
                    />
                  )}
                  <Action.CopyToClipboard title="Copy URL" content={url} />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
      {error && !isLoading ? (
        <ErrorEmptyView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No users found" icon={Icon.Person} />
      )}
    </List>
  );
}

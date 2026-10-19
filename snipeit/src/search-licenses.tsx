import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { dateText, decode, License, list, toDate, webUrl } from "./api";
import { ErrorEmptyView } from "./components";

const PAGE_SIZE = 50;
const SOON_MS = 60 * 86_400_000;

export default function SearchLicenses() {
  const [searchText, setSearchText] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  const { data, isLoading, error, pagination, revalidate } = usePromise(
    (search: string) =>
      async ({ page }: { page: number }) => {
        const result = await list<License>("licenses", {
          search,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          sort: "name",
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
      searchBarPlaceholder="Search licenses..."
      pagination={pagination}
      isShowingDetail={showDetail && !!data?.length}
      throttle
    >
      {data?.map((license) => {
        const expires = toDate(license.expiration_date);
        const expired = expires && expires.getTime() < Date.now();
        const soon = expires && !expired && expires.getTime() - Date.now() < SOON_MS;
        const free = license.free_seats_count;
        const url = webUrl("licenses", license.id);
        return (
          <List.Item
            key={license.id}
            icon={{ source: Icon.Key, tintColor: expired ? Color.Red : soon ? Color.Orange : undefined }}
            title={decode(license.name)}
            subtitle={showDetail ? undefined : decode(license.manufacturer?.name)}
            accessories={
              showDetail
                ? undefined
                : [
                    {
                      tag: {
                        value: `${free}/${license.seats} free`,
                        color:
                          free === 0
                            ? Color.Red
                            : free <= Math.max(1, license.seats * 0.1)
                              ? Color.Orange
                              : Color.Green,
                      },
                    },
                    ...(expires
                      ? [
                          {
                            text: {
                              value: dateText(license.expiration_date),
                              color: expired ? Color.Red : soon ? Color.Orange : undefined,
                            },
                            tooltip: expired ? "Expired" : "Expires",
                          },
                        ]
                      : []),
                  ]
            }
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Seats" text={`${free} free of ${license.seats}`} />
                    {license.expiration_date && (
                      <List.Item.Detail.Metadata.Label title="Expires" text={dateText(license.expiration_date)} />
                    )}
                    {license.manufacturer && (
                      <List.Item.Detail.Metadata.Label title="Manufacturer" text={decode(license.manufacturer.name)} />
                    )}
                    {license.category && (
                      <List.Item.Detail.Metadata.Label title="Category" text={decode(license.category.name)} />
                    )}
                    {license.license_name && (
                      <List.Item.Detail.Metadata.Label title="Licensed To" text={decode(license.license_name)} />
                    )}
                    {license.license_email && (
                      <List.Item.Detail.Metadata.Label title="License Email" text={license.license_email} />
                    )}
                    {license.order_number && (
                      <List.Item.Detail.Metadata.Label title="Order No." text={license.order_number} />
                    )}
                    {license.notes && <List.Item.Detail.Metadata.Label title="Notes" text={decode(license.notes)} />}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open in Snipe-IT" url={url} />
                <Action
                  title={showDetail ? "Hide Details" : "Show Details"}
                  icon={Icon.Sidebar}
                  shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                  onAction={() => setShowDetail((v) => !v)}
                />
                <ActionPanel.Section>
                  {/* product_key is only returned if the user may see it */}
                  {license.product_key && (
                    <Action.CopyToClipboard
                      title="Copy Product Key"
                      content={license.product_key}
                      concealed
                      shortcut={Keyboard.Shortcut.Common.Copy}
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
        <List.EmptyView title="No licenses found" icon={Icon.Key} />
      )}
    </List>
  );
}

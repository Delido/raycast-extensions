import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { formatDate, PageListItem, pageUrl } from "./api";
import { CopyActions, PageDetail, TYPE_ICONS, usePaginatedList } from "./components";

export default function RecentPages() {
  const { data, isLoading, pagination } = usePaginatedList<PageListItem>("pages", { sort: "-updated_at" });

  return (
    <List isLoading={isLoading} pagination={pagination} searchBarPlaceholder="Filter recently updated pages...">
      {data?.map((page) => {
        const url = pageUrl(page.book_slug, page.slug);
        return (
          <List.Item
            key={page.id}
            icon={TYPE_ICONS.page}
            title={page.name}
            subtitle={page.book_slug}
            accessories={[
              ...(page.draft ? [{ tag: { value: "Draft", color: Color.Yellow } }] : []),
              { date: new Date(page.updated_at), tooltip: `Updated ${formatDate(page.updated_at)}` },
            ]}
            actions={
              <ActionPanel>
                <Action.Push title="Show Page" icon={Icon.Eye} target={<PageDetail id={page.id} url={url} />} />
                <Action.OpenInBrowser url={url} />
                <CopyActions url={url} name={page.name} />
              </ActionPanel>
            }
          />
        );
      })}
      <List.EmptyView title="No pages found" icon={Icon.Document} />
    </List>
  );
}

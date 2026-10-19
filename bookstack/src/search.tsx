import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { api, formatDate, primaryShortcut, SearchResult, stripHtml } from "./api";
import { BookContents, CopyActions, PageDetail, ShelfBooks, TYPE_ICONS } from "./components";

const PAGE_SIZE = 30;

const TYPES = [
  { title: "All Types", value: "" },
  { title: "Pages", value: "page" },
  { title: "Chapters", value: "chapter" },
  { title: "Books", value: "book" },
  { title: "Shelves", value: "bookshelf" },
];

export default function Search() {
  const [searchText, setSearchText] = useState("");
  const [type, setType] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  const text = searchText.trim();
  const query = text ? `${text}${type ? ` {type:${type}}` : ""}` : "";

  const { data, isLoading, pagination } = usePromise(
    (query: string) =>
      async ({ page }: { page: number }) => {
        if (!query) return { data: [] as SearchResult[], hasMore: false };
        const result = await api<{ data: SearchResult[]; total: number }>("search", {
          query,
          page: String(page + 1),
          count: String(PAGE_SIZE),
        });
        return { data: result.data, hasMore: (page + 1) * PAGE_SIZE < result.total };
      },
    [query],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search BookStack..."
      pagination={pagination}
      isShowingDetail={showDetail && !!data?.length}
      throttle
      searchBarAccessory={
        <List.Dropdown tooltip="Type" storeValue onChange={setType}>
          {TYPES.map((t) => (
            <List.Dropdown.Item key={t.value} title={t.title} value={t.value} />
          ))}
        </List.Dropdown>
      }
    >
      {data?.map((item) => (
        <SearchItem
          key={`${item.type}-${item.id}`}
          item={item}
          showDetail={showDetail}
          toggleDetail={() => setShowDetail((v) => !v)}
        />
      ))}
      <List.EmptyView
        title={text ? "No results" : "Type to search BookStack"}
        description={text ? undefined : "Supports BookStack search syntax, e.g. [tag=value] or {updated_by:me}"}
        icon={Icon.MagnifyingGlass}
      />
    </List>
  );
}

function location(item: SearchResult) {
  return [item.book?.name, item.chapter?.name].filter(Boolean).join(" › ");
}

function SearchItem({
  item,
  showDetail,
  toggleDetail,
}: {
  item: SearchResult;
  showDetail: boolean;
  toggleDetail: () => void;
}) {
  const preview = stripHtml(item.preview_html?.content ?? "");
  const loc = location(item);

  return (
    <List.Item
      icon={TYPE_ICONS[item.type] ?? Icon.Document}
      title={item.name}
      subtitle={showDetail ? undefined : loc || preview}
      accessories={
        showDetail
          ? undefined
          : [
              ...(item.draft ? [{ tag: { value: "Draft", color: Color.Yellow } }] : []),
              ...item.tags.slice(0, 2).map((tag) => ({ tag: tag.value ? `${tag.name}: ${tag.value}` : tag.name })),
              { date: new Date(item.updated_at), tooltip: `Updated ${formatDate(item.updated_at)}` },
            ]
      }
      detail={
        <List.Item.Detail
          markdown={`## ${item.name}\n\n${preview}`}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Type" text={item.type} />
              {item.book && <List.Item.Detail.Metadata.Label title="Book" text={item.book.name} />}
              {item.chapter && <List.Item.Detail.Metadata.Label title="Chapter" text={item.chapter.name} />}
              <List.Item.Detail.Metadata.Label title="Updated" text={formatDate(item.updated_at)} />
              {item.tags.length > 0 && (
                <List.Item.Detail.Metadata.TagList title="Tags">
                  {item.tags.map((tag) => (
                    <List.Item.Detail.Metadata.TagList.Item
                      key={`${tag.name}:${tag.value}`}
                      text={tag.value ? `${tag.name}: ${tag.value}` : tag.name}
                    />
                  ))}
                </List.Item.Detail.Metadata.TagList>
              )}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          {item.type === "page" && (
            <Action.Push title="Show Page" icon={Icon.Eye} target={<PageDetail id={item.id} url={item.url} />} />
          )}
          {item.type === "book" && (
            <Action.Push title="Show Contents" icon={Icon.List} target={<BookContents book={item} />} />
          )}
          {item.type === "bookshelf" && (
            <Action.Push title="Show Books" icon={Icon.List} target={<ShelfBooks shelf={item} />} />
          )}
          <Action.OpenInBrowser url={item.url} />
          <Action
            title={showDetail ? "Hide Preview" : "Show Preview"}
            icon={Icon.Sidebar}
            shortcut={primaryShortcut("y")}
            onAction={toggleDetail}
          />
          <CopyActions url={item.url} name={item.name} />
        </ActionPanel>
      }
    />
  );
}

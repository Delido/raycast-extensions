import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { formatDate, Shelf, shelfUrl } from "./api";
import { CopyActions, ShelfBooks, TYPE_ICONS, usePaginatedList } from "./components";

export default function BrowseShelves() {
  const { data, isLoading, pagination } = usePaginatedList<Shelf>("shelves", { sort: "+name" });

  return (
    <List isLoading={isLoading} pagination={pagination} searchBarPlaceholder="Filter shelves...">
      {data?.map((shelf) => {
        const url = shelfUrl(shelf.slug);
        return (
          <List.Item
            key={shelf.id}
            icon={TYPE_ICONS.bookshelf}
            title={shelf.name}
            subtitle={shelf.description}
            accessories={[{ date: new Date(shelf.updated_at), tooltip: `Updated ${formatDate(shelf.updated_at)}` }]}
            actions={
              <ActionPanel>
                <Action.Push title="Show Books" icon={Icon.List} target={<ShelfBooks shelf={shelf} />} />
                <Action.OpenInBrowser url={url} />
                <CopyActions url={url} name={shelf.name} />
              </ActionPanel>
            }
          />
        );
      })}
      <List.EmptyView title="No shelves found" icon={Icon.Folder} />
    </List>
  );
}

import { Icon, List } from "@raycast/api";
import { Book } from "./api";
import { BookItem, usePaginatedList } from "./components";

export default function BrowseBooks() {
  const { data, isLoading, pagination } = usePaginatedList<Book>("books", { sort: "+name" });

  return (
    <List isLoading={isLoading} pagination={pagination} searchBarPlaceholder="Filter books...">
      {data?.map((book) => (
        <BookItem key={book.id} book={book} />
      ))}
      <List.EmptyView title="No books found" icon={Icon.Book} />
    </List>
  );
}

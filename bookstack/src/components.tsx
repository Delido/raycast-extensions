import { Action, ActionPanel, Color, Detail, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  api,
  Book,
  BookDetails,
  bookUrl,
  ContentType,
  formatDate,
  getBaseUrl,
  Page,
  pageMarkdown,
  primaryShortcut,
  ShelfDetails,
  shelfUrl,
} from "./api";

export const TYPE_ICONS: Record<ContentType, { source: Icon; tintColor: Color }> = {
  page: { source: Icon.Document, tintColor: Color.Blue },
  chapter: { source: Icon.Bookmark, tintColor: Color.Purple },
  book: { source: Icon.Book, tintColor: Color.Orange },
  bookshelf: { source: Icon.Folder, tintColor: Color.Green },
};

export function CopyActions({ url, name }: { url: string; name: string }) {
  return (
    <ActionPanel.Section>
      <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
      <Action.CopyToClipboard
        title="Copy Markdown Link"
        content={`[${name}](${url})`}
        shortcut={Keyboard.Shortcut.Common.CopyName}
      />
    </ActionPanel.Section>
  );
}

export function PageDetail({ id, url }: { id: number; url?: string }) {
  const { data: page, isLoading } = usePromise((id: number) => api<Page>(`pages/${id}`), [id]);
  const link = url ?? `${getBaseUrl()}/link/${id}`;

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={page?.name ?? "Page"}
      markdown={page ? `# ${page.name}\n\n${pageMarkdown(page)}` : ""}
      metadata={
        page && (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Updated" text={formatDate(page.updated_at)} />
            <Detail.Metadata.Label title="Updated By" text={page.updated_by?.name ?? "-"} />
            <Detail.Metadata.Label title="Created" text={formatDate(page.created_at)} />
            <Detail.Metadata.Label title="Created By" text={page.created_by?.name ?? "-"} />
            <Detail.Metadata.Label title="Revisions" text={String(page.revision_count)} />
            {!!page.tags?.length && (
              <Detail.Metadata.TagList title="Tags">
                {page.tags.map((tag) => (
                  <Detail.Metadata.TagList.Item
                    key={`${tag.name}:${tag.value}`}
                    text={tag.value ? `${tag.name}: ${tag.value}` : tag.name}
                  />
                ))}
              </Detail.Metadata.TagList>
            )}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Link title="Open" target={link} text="Open in BookStack" />
          </Detail.Metadata>
        )
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={link} />
          {url && (
            <Action.OpenInBrowser
              title="Edit Page"
              icon={Icon.Pencil}
              url={`${url}/edit`}
              shortcut={primaryShortcut("e")}
            />
          )}
          {page && (
            <Action.CopyToClipboard
              title="Copy Page as Markdown"
              content={pageMarkdown(page)}
              shortcut={primaryShortcut("m")}
            />
          )}
          <CopyActions url={link} name={page?.name ?? ""} />
        </ActionPanel>
      }
    />
  );
}

export function BookContents({ book }: { book: Pick<Book, "id" | "name" | "slug"> }) {
  const { data, isLoading } = usePromise((id: number) => api<BookDetails>(`books/${id}`), [book.id]);
  const url = bookUrl(book.slug);

  const loosePages = data?.contents.filter((item) => item.type === "page") ?? [];
  const chapters = data?.contents.filter((item) => item.type === "chapter") ?? [];

  const pageItem = (page: { id: number; name: string; url: string; updated_at: string; draft: boolean }) => (
    <List.Item
      key={`page-${page.id}`}
      icon={TYPE_ICONS.page}
      title={page.name}
      accessories={[
        ...(page.draft ? [{ tag: { value: "Draft", color: Color.Yellow } }] : []),
        { date: new Date(page.updated_at), tooltip: `Updated ${formatDate(page.updated_at)}` },
      ]}
      actions={
        <ActionPanel>
          <Action.Push title="Show Page" icon={Icon.Eye} target={<PageDetail id={page.id} url={page.url} />} />
          <Action.OpenInBrowser url={page.url} />
          <CopyActions url={page.url} name={page.name} />
        </ActionPanel>
      }
    />
  );

  return (
    <List isLoading={isLoading} navigationTitle={book.name} searchBarPlaceholder={`Filter ${book.name}...`}>
      {loosePages.length > 0 && <List.Section title="Pages">{loosePages.map(pageItem)}</List.Section>}
      {chapters.map((chapter) =>
        chapter.type === "chapter" ? (
          <List.Section key={`chapter-${chapter.id}`} title={chapter.name} subtitle={`${chapter.pages.length}`}>
            {chapter.pages.length === 0 ? (
              <List.Item
                icon={TYPE_ICONS.chapter}
                title={chapter.name}
                subtitle="Empty chapter"
                actions={
                  <ActionPanel>
                    <Action.OpenInBrowser url={chapter.url} />
                  </ActionPanel>
                }
              />
            ) : (
              chapter.pages.map(pageItem)
            )}
          </List.Section>
        ) : null,
      )}
      <List.EmptyView
        title="This book is empty"
        icon={Icon.Book}
        actions={
          <ActionPanel>
            <Action.OpenInBrowser url={url} />
          </ActionPanel>
        }
      />
    </List>
  );
}

export function BookItem({ book }: { book: Book }) {
  const url = bookUrl(book.slug);
  return (
    <List.Item
      icon={TYPE_ICONS.book}
      title={book.name}
      subtitle={book.description}
      accessories={[{ date: new Date(book.updated_at), tooltip: `Updated ${formatDate(book.updated_at)}` }]}
      actions={
        <ActionPanel>
          <Action.Push title="Show Contents" icon={Icon.List} target={<BookContents book={book} />} />
          <Action.OpenInBrowser url={url} />
          <CopyActions url={url} name={book.name} />
        </ActionPanel>
      }
    />
  );
}

export function ShelfBooks({ shelf }: { shelf: { id: number; name: string; slug: string } }) {
  const { data, isLoading } = usePromise((id: number) => api<ShelfDetails>(`shelves/${id}`), [shelf.id]);
  const url = shelfUrl(shelf.slug);
  return (
    <List isLoading={isLoading} navigationTitle={shelf.name} searchBarPlaceholder={`Filter books in ${shelf.name}...`}>
      {data?.books.map((book) => (
        <BookItem key={book.id} book={book} />
      ))}
      <List.EmptyView
        title="No books on this shelf"
        icon={Icon.Folder}
        actions={
          <ActionPanel>
            <Action.OpenInBrowser url={url} />
          </ActionPanel>
        }
      />
    </List>
  );
}

/** Paginated listing helper for BookStack list endpoints (offset/count). */
export function usePaginatedList<T>(endpoint: string, params: Record<string, string>) {
  const PAGE_SIZE = 50;
  const key = JSON.stringify(params);
  return usePromise(
    (endpoint: string, key: string) =>
      async ({ page }: { page: number }) => {
        const result = await api<{ data: T[]; total: number }>(endpoint, {
          ...JSON.parse(key),
          count: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        return { data: result.data, hasMore: (page + 1) * PAGE_SIZE < result.total };
      },
    [endpoint, key],
  );
}

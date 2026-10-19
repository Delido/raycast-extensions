import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { Document, searchDocuments } from "./api";
import { DocumentItem, useMeta } from "./components";
import { Gate } from "./gate";

/** "type:3", "tag:5", "corr:2" or "" */
function filterParams(filter: string): Record<string, string> {
  const [kind, id] = filter.split(":");
  if (kind === "type") return { document_type__id: id };
  if (kind === "tag") return { tags__id__all: id };
  if (kind === "corr") return { correspondent__id: id };
  return {};
}

function SearchDocumentsView() {
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState("");
  const [similarTo, setSimilarTo] = useState<Document>();
  const [showingDetail, setShowingDetail] = useState(true);
  const { data: meta } = useMeta();

  const text = searchText.trim();
  const params: Record<string, string> = similarTo
    ? { more_like_id: String(similarTo.id) }
    : text
      ? { query: text, ...filterParams(filter) }
      : { ordering: "-created", ...filterParams(filter) };

  const { data, isLoading, pagination, revalidate } = usePromise(
    (key: string) =>
      async ({ page }: { page: number }) => {
        const result = await searchDocuments(JSON.parse(key), page);
        return { data: result.results, hasMore: !!result.next };
      },
    [JSON.stringify(params)],
  );

  const sorted = <T extends { name: string }>(items: Iterable<T>) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showingDetail && (data?.length ?? 0) > 0}
      pagination={pagination}
      throttle
      filtering={false}
      onSearchTextChange={(value) => {
        setSearchText(value);
        setSimilarTo(undefined);
      }}
      navigationTitle={similarTo ? `Similar to ${similarTo.title}` : undefined}
      searchBarPlaceholder="Full-text search, e.g. invoice 2025 or tag:insurance"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" value={filter} onChange={setFilter}>
          <List.Dropdown.Item title="All Documents" value="" icon={Icon.Document} />
          {meta ? (
            <>
              <List.Dropdown.Section title="Document Types">
                {sorted(meta.documentTypes.values()).map((t) => (
                  <List.Dropdown.Item key={`type:${t.id}`} title={t.name} value={`type:${t.id}`} icon={Icon.Folder} />
                ))}
              </List.Dropdown.Section>
              <List.Dropdown.Section title="Tags">
                {sorted(meta.tags.values()).map((t) => (
                  <List.Dropdown.Item
                    key={`tag:${t.id}`}
                    title={t.name}
                    value={`tag:${t.id}`}
                    icon={{ source: Icon.Tag, tintColor: t.color }}
                  />
                ))}
              </List.Dropdown.Section>
              <List.Dropdown.Section title="Correspondents">
                {sorted(meta.correspondents.values()).map((c) => (
                  <List.Dropdown.Item key={`corr:${c.id}`} title={c.name} value={`corr:${c.id}`} icon={Icon.Person} />
                ))}
              </List.Dropdown.Section>
            </>
          ) : null}
        </List.Dropdown>
      }
    >
      <List.EmptyView icon={Icon.MagnifyingGlass} title={text ? "No documents found" : "No documents"} />
      <List.Section title={text || similarTo ? "Results" : "Newest Documents"}>
        {data?.map((doc) => (
          <DocumentItem
            key={doc.id}
            doc={doc}
            meta={meta}
            showingDetail={showingDetail}
            toggleDetail={() => setShowingDetail((v) => !v)}
            onChanged={revalidate}
            onMoreLikeThis={setSimilarTo}
          />
        ))}
      </List.Section>
    </List>
  );
}

export default function SearchDocuments() {
  return (
    <Gate>
      <SearchDocumentsView />
    </Gate>
  );
}

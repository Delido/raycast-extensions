import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { searchDocuments } from "./api";
import { DocumentItem, useMeta } from "./components";
import { Gate } from "./gate";

function InboxView() {
  const [showingDetail, setShowingDetail] = useState(true);
  const { data: meta, isLoading: metaLoading } = useMeta();
  const inboxTags = meta ? [...meta.tags.values()].filter((t) => t.is_inbox_tag).map((t) => t.id) : [];

  const { data, isLoading, pagination, revalidate } = usePromise(
    (tags: string) =>
      async ({ page }: { page: number }) => {
        if (!tags) return { data: [], hasMore: false };
        const result = await searchDocuments({ tags__id__in: tags, ordering: "-added" }, page);
        return { data: result.results, hasMore: !!result.next };
      },
    [inboxTags.join(",")],
    { execute: !!meta },
  );

  return (
    <List
      isLoading={metaLoading || isLoading}
      isShowingDetail={showingDetail && (data?.length ?? 0) > 0}
      pagination={pagination}
      searchBarPlaceholder="Filter inbox..."
    >
      {meta && inboxTags.length === 0 ? (
        <List.EmptyView
          icon={Icon.Tray}
          title="No inbox tag"
          description="Mark a tag as inbox tag in Paperless (Tags → Edit → Inbox tag)"
        />
      ) : (
        <List.EmptyView icon={Icon.CheckCircle} title="Inbox is empty" description="Nothing left to sort" />
      )}
      <List.Section title="Inbox" subtitle={data ? String(data.length) : undefined}>
        {data?.map((doc) => (
          <DocumentItem
            key={doc.id}
            doc={doc}
            meta={meta}
            showingDetail={showingDetail}
            toggleDetail={() => setShowingDetail((v) => !v)}
            onChanged={revalidate}
            inboxTags={inboxTags}
          />
        ))}
      </List.Section>
    </List>
  );
}

export default function Inbox() {
  return (
    <Gate>
      <InboxView />
    </Gate>
  );
}

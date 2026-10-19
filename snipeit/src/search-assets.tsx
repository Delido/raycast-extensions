import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { Asset, list } from "./api";
import { AssetItem, ErrorEmptyView } from "./components";

const PAGE_SIZE = 50;

// Values of the "status" filter of GET /api/v1/hardware
const FILTERS = [
  { title: "All Assets", value: "" },
  { title: "Deployed", value: "Deployed" },
  { title: "Ready to Deploy", value: "RTD" },
  { title: "Pending", value: "Pending" },
  { title: "Undeployable", value: "Undeployable" },
  { title: "Archived", value: "Archived" },
  { title: "Requestable", value: "Requestable" },
];

export default function SearchAssets() {
  const [searchText, setSearchText] = useState("");
  const [status, setStatus] = useState("");

  const { data, isLoading, error, pagination, revalidate } = usePromise(
    (search: string, status: string) =>
      async ({ page }: { page: number }) => {
        const result = await list<Asset>("hardware", {
          search,
          status,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          sort: search ? undefined : "updated_at",
          order: "desc",
        });
        return { data: result.rows, hasMore: (page + 1) * PAGE_SIZE < result.total };
      },
    [searchText.trim(), status],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by name, tag, serial, model or user..."
      pagination={pagination}
      throttle
      searchBarAccessory={
        <List.Dropdown tooltip="Status" storeValue onChange={setStatus}>
          {FILTERS.map((f) => (
            <List.Dropdown.Item key={f.value} title={f.title} value={f.value} />
          ))}
        </List.Dropdown>
      }
    >
      <List.Section title={searchText.trim() ? "Results" : "Recently Updated"}>
        {data?.map((asset) => (
          <AssetItem key={asset.id} asset={asset} onChange={revalidate} />
        ))}
      </List.Section>
      {error && !isLoading ? (
        <ErrorEmptyView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No assets found" icon={Icon.ComputerChip} />
      )}
    </List>
  );
}

import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { Asset, Rows, request } from "./api";
import { AssetItem, ErrorEmptyView } from "./components";

export default function AuditDue() {
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const [overdue, due] = await Promise.all([
      request<Rows<Asset>>("GET", "hardware/audit/overdue?limit=500"),
      request<Rows<Asset>>("GET", "hardware/audit/due?limit=500"),
    ]);
    const overdueIds = new Set(overdue.rows.map((a) => a.id));
    return { overdue: overdue.rows, due: due.rows.filter((a) => !overdueIds.has(a.id)) };
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter assets...">
      <List.Section title="Overdue" subtitle={String(data?.overdue.length ?? "")}>
        {data?.overdue.map((asset) => (
          <AssetItem key={asset.id} asset={asset} onChange={revalidate} />
        ))}
      </List.Section>
      <List.Section title="Due Soon" subtitle={String(data?.due.length ?? "")}>
        {data?.due.map((asset) => (
          <AssetItem key={asset.id} asset={asset} onChange={revalidate} />
        ))}
      </List.Section>
      {error && !isLoading ? (
        <ErrorEmptyView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title="No audits due" icon={Icon.CheckCircle} />
      )}
    </List>
  );
}

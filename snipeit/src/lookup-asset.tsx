import { Icon, LaunchProps, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { lookupAsset } from "./api";
import { AssetDetail, AssetItem, ErrorEmptyView } from "./components";

/** Look up by asset tag or serial (works well with a barcode scanner). A single hit opens directly. */
export default function LookupAsset(props: LaunchProps<{ arguments: Arguments.LookupAsset }>) {
  const query = props.arguments.query.trim();
  const { data, isLoading, error, revalidate } = usePromise(lookupAsset, [query]);

  if (data?.length === 1) {
    return <AssetDetail asset={data[0]} onChange={revalidate} />;
  }

  return (
    <List isLoading={isLoading} navigationTitle={`Look up “${query}”`}>
      {data?.map((asset) => (
        <AssetItem key={asset.id} asset={asset} onChange={revalidate} />
      ))}
      {error && !isLoading ? (
        <ErrorEmptyView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title={`No asset found for “${query}”`} icon={Icon.MagnifyingGlass} />
      )}
    </List>
  );
}

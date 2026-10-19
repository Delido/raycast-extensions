import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { decode, list, minimum, remaining, StockItem, webUrl } from "./api";
import { ErrorEmptyView } from "./components";

const VIEWS = [
  { title: "Accessories", value: "accessories" },
  { title: "Consumables", value: "consumables" },
  { title: "Low Stock (all)", value: "low" },
];

type Kind = "accessories" | "consumables";
type Row = StockItem & { kind: Kind };

async function load(kind: Kind): Promise<Row[]> {
  const result = await list<StockItem>(kind, { limit: 500, sort: "name", order: "asc" });
  return result.rows.map((row) => ({ ...row, kind }));
}

function isLow(item: StockItem) {
  const min = minimum(item);
  return min > 0 ? remaining(item) <= min : remaining(item) === 0;
}

export default function Inventory() {
  const [view, setView] = useState("accessories");

  const { data, isLoading, error, revalidate } = usePromise(
    async (view: string) => {
      if (view === "low") {
        const [a, c] = await Promise.all([load("accessories"), load("consumables")]);
        return [...a, ...c].filter(isLow);
      }
      return load(view as Kind);
    },
    [view],
  );

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter items..."
      searchBarAccessory={
        <List.Dropdown tooltip="View" storeValue onChange={setView}>
          {VIEWS.map((v) => (
            <List.Dropdown.Item key={v.value} title={v.title} value={v.value} />
          ))}
        </List.Dropdown>
      }
    >
      {data?.map((item) => {
        const low = isLow(item);
        const min = minimum(item);
        return (
          <List.Item
            key={`${item.kind}-${item.id}`}
            icon={{
              source: item.kind === "accessories" ? Icon.Keyboard : Icon.Box,
              tintColor: low ? Color.Red : undefined,
            }}
            title={decode(item.name)}
            subtitle={[decode(item.category?.name), decode(item.manufacturer?.name)].filter(Boolean).join(" · ")}
            keywords={[item.model_number ?? "", item.item_no ?? ""]}
            accessories={[
              ...(item.location ? [{ icon: Icon.Pin, text: decode(item.location.name) }] : []),
              {
                tag: { value: `${remaining(item)} / ${item.qty}`, color: low ? Color.Red : Color.Green },
                tooltip: min ? `Remaining / total (minimum ${min})` : "Remaining / total",
              },
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open in Snipe-IT" url={webUrl(item.kind, item.id)} />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        );
      })}
      {error && !isLoading ? (
        <ErrorEmptyView error={error} retry={revalidate} />
      ) : (
        <List.EmptyView title={view === "low" ? "Nothing is low on stock" : "No items found"} icon={Icon.Box} />
      )}
    </List>
  );
}

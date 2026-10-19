import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { escapeRegex, getHosts, Query } from "./api";
import { HostItem } from "./components";

const MAX_ITEMS = 500;

const FILTERS: { title: string; value: string; query?: Query }[] = [
  { title: "All Hosts", value: "all" },
  { title: "Down / Unreachable", value: "down", query: { op: "!=", left: "state", right: "0" } },
  {
    title: "With Service Problems",
    value: "service-problems",
    query: {
      op: "or",
      expr: [
        { op: ">", left: "num_services_crit", right: "0" },
        { op: ">", left: "num_services_unknown", right: "0" },
        { op: ">", left: "num_services_warn", right: "0" },
      ],
    },
  },
];

export default function SearchHosts() {
  const [searchText, setSearchText] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const filter = FILTERS.find((f) => f.value === filterValue) ?? FILTERS[0];

  const text = searchText.trim();
  const parts: Query[] = [];
  if (text) {
    const regex = escapeRegex(text);
    parts.push({
      op: "or",
      expr: [
        { op: "~~", left: "name", right: regex },
        { op: "~~", left: "alias", right: regex },
        { op: "~~", left: "address", right: regex },
      ],
    });
  }
  if (filter.query) parts.push(filter.query);
  const query: Query | undefined =
    parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { op: "and", expr: parts };

  const { data, isLoading, revalidate } = usePromise(
    async (queryJson: string) => {
      const hosts = await getHosts(queryJson ? (JSON.parse(queryJson) as Query) : undefined);
      return hosts.sort((a, b) => b.state - a.state || a.name.localeCompare(b.name));
    },
    [query ? JSON.stringify(query) : ""],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search hosts by name, alias or IP..."
      throttle
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" storeValue onChange={setFilterValue}>
          {FILTERS.map((f) => (
            <List.Dropdown.Item key={f.value} title={f.title} value={f.value} />
          ))}
        </List.Dropdown>
      }
    >
      <List.Section
        title="Hosts"
        subtitle={data ? (data.length > MAX_ITEMS ? `${MAX_ITEMS} of ${data.length}` : String(data.length)) : undefined}
      >
        {data?.slice(0, MAX_ITEMS).map((host) => (
          <HostItem key={host.name} host={host} onChange={revalidate} />
        ))}
      </List.Section>
      <List.EmptyView title="No hosts found" icon={Icon.HardDrive} />
    </List>
  );
}

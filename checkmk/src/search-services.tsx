import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { escapeRegex, getServices, Query } from "./api";
import { compareServices, ServiceItem } from "./components";

const MAX_ITEMS = 500;

const UNHANDLED: Query[] = [
  { op: "=", left: "acknowledged", right: "0" },
  { op: "=", left: "scheduled_downtime_depth", right: "0" },
];

const FILTERS: { title: string; value: string; query?: Query[] }[] = [
  { title: "All Services", value: "all" },
  { title: "Problems", value: "problems", query: [{ op: "!=", left: "state", right: "0" }] },
  { title: "Unhandled Problems", value: "unhandled", query: [{ op: "!=", left: "state", right: "0" }, ...UNHANDLED] },
  { title: "CRIT", value: "crit", query: [{ op: "=", left: "state", right: "2" }] },
  { title: "WARN", value: "warn", query: [{ op: "=", left: "state", right: "1" }] },
  { title: "UNKNOWN", value: "unknown", query: [{ op: "=", left: "state", right: "3" }] },
];

export default function SearchServices() {
  const [searchText, setSearchText] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const filter = FILTERS.find((f) => f.value === filterValue) ?? FILTERS[0];

  const text = searchText.trim();
  const parts: Query[] = [...(filter.query ?? [])];
  if (text) {
    // Every word must match the host or the service name, so "web01 cpu" narrows down nicely.
    for (const word of text.split(/\s+/).map(escapeRegex)) {
      parts.push({
        op: "or",
        expr: [
          { op: "~~", left: "description", right: word },
          { op: "~~", left: "host_name", right: word },
        ],
      });
    }
  }
  // Without search text and without a filter the result could be huge, so wait for input.
  const enabled = parts.length > 0;
  const query: Query = parts.length === 1 ? parts[0] : { op: "and", expr: parts };

  const { data, isLoading, revalidate } = usePromise(
    async (queryJson: string) => {
      if (!queryJson) return [];
      const services = await getServices(JSON.parse(queryJson) as Query);
      return services.sort(compareServices);
    },
    [enabled ? JSON.stringify(query) : ""],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search services (e.g. web01 cpu)..."
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
        title="Services"
        subtitle={
          data?.length ? (data.length > MAX_ITEMS ? `${MAX_ITEMS} of ${data.length}` : String(data.length)) : undefined
        }
      >
        {data?.slice(0, MAX_ITEMS).map((service) => (
          <ServiceItem key={`${service.host_name}|${service.description}`} service={service} onChange={revalidate} />
        ))}
      </List.Section>
      <List.EmptyView
        title={enabled ? "No services found" : "Type to search services"}
        description={enabled ? undefined : "Search by host and/or service name, or pick a filter"}
        icon={Icon.MagnifyingGlass}
      />
    </List>
  );
}

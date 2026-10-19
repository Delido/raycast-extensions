import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { getHosts, getServices, isHandled, Query } from "./api";
import { compareServices, HostItem, ServiceItem } from "./components";

const PROBLEM: Query = { op: "!=", left: "state", right: "0" };

export default function Problems() {
  const [scope, setScope] = useState("unhandled");

  const { data, isLoading, revalidate } = usePromise(async () => {
    const [hosts, services] = await Promise.all([getHosts(PROBLEM), getServices(PROBLEM)]);
    return { hosts, services: services.sort(compareServices) };
  }, []);

  const showHandled = scope === "all";
  const hosts = (data?.hosts ?? []).filter((h) => h.has_been_checked && (showHandled || !isHandled(h)));
  // Services on hosts that are down are noise in the unhandled view.
  const downHosts = new Set(hosts.map((h) => h.name));
  const services = (data?.services ?? []).filter(
    (s) => s.has_been_checked && (showHandled || (!isHandled(s) && !downHosts.has(s.host_name))),
  );

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter problems..."
      searchBarAccessory={
        <List.Dropdown tooltip="Scope" storeValue onChange={setScope}>
          <List.Dropdown.Item title="Unhandled Problems" value="unhandled" />
          <List.Dropdown.Item title="All Problems" value="all" />
        </List.Dropdown>
      }
    >
      <List.Section title="Hosts" subtitle={String(hosts.length)}>
        {hosts.map((host) => (
          <HostItem key={host.name} host={host} onChange={revalidate} />
        ))}
      </List.Section>
      <List.Section title="Services" subtitle={String(services.length)}>
        {services.map((service) => (
          <ServiceItem key={`${service.host_name}|${service.description}`} service={service} onChange={revalidate} />
        ))}
      </List.Section>
      <List.EmptyView title="All good" description="No problems right now" icon={Icon.CheckCircle} />
    </List>
  );
}

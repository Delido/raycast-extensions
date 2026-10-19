import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import {
  acknowledgeHost,
  acknowledgeService,
  formatAge,
  getServices,
  Host,
  hostUrl,
  isHandled,
  primaryShortcut,
  scheduleDowntime,
  Service,
  serviceUrl,
} from "./api";
import { usePromise } from "@raycast/utils";

export const SERVICE_STATES: Record<number, { label: string; color: Color }> = {
  0: { label: "OK", color: Color.Green },
  1: { label: "WARN", color: Color.Yellow },
  2: { label: "CRIT", color: Color.Red },
  3: { label: "UNKNOWN", color: Color.Orange },
};

export const HOST_STATES: Record<number, { label: string; color: Color }> = {
  0: { label: "UP", color: Color.Green },
  1: { label: "DOWN", color: Color.Red },
  2: { label: "UNREACH", color: Color.Orange },
};

const PENDING = { label: "PEND", color: Color.SecondaryText };

export function serviceState(service: Service) {
  return service.has_been_checked ? (SERVICE_STATES[service.state] ?? PENDING) : PENDING;
}

export function hostState(host: Host) {
  return host.has_been_checked ? (HOST_STATES[host.state] ?? PENDING) : PENDING;
}

function handledAccessories(item: { acknowledged: number; scheduled_downtime_depth: number }) {
  return [
    ...(item.acknowledged ? [{ icon: Icon.Checkmark, tooltip: "Acknowledged" }] : []),
    ...(item.scheduled_downtime_depth ? [{ icon: Icon.Moon, tooltip: "In scheduled downtime" }] : []),
  ];
}

const DOWNTIMES = [
  { title: "30 Minutes", minutes: 30 },
  { title: "1 Hour", minutes: 60 },
  { title: "2 Hours", minutes: 120 },
  { title: "8 Hours", minutes: 480 },
  { title: "1 Day", minutes: 1440 },
  { title: "1 Week", minutes: 10080 },
];

function HandleActions({
  hostName,
  description,
  onDone,
}: {
  hostName: string;
  description?: string;
  onDone: () => void;
}) {
  return (
    <ActionPanel.Section title="Handle">
      <Action.Push
        title="Acknowledge Problem"
        icon={Icon.Checkmark}
        shortcut={{
          macOS: { modifiers: ["cmd", "shift"], key: "a" },
          Windows: { modifiers: ["ctrl", "shift"], key: "a" },
        }}
        target={<AcknowledgeForm hostName={hostName} description={description} onDone={onDone} />}
      />
      <ActionPanel.Submenu title="Schedule Downtime" icon={Icon.Moon} shortcut={primaryShortcut("d")}>
        {DOWNTIMES.map((d) => (
          <Action
            key={d.minutes}
            title={d.title}
            onAction={async () => {
              const toast = await showToast({ style: Toast.Style.Animated, title: "Scheduling downtime…" });
              try {
                await scheduleDowntime(hostName, description, d.minutes, "Scheduled via Raycast");
                toast.style = Toast.Style.Success;
                toast.title = `Downtime scheduled (${d.title})`;
                onDone();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Failed to schedule downtime";
                toast.message = (error as Error).message;
              }
            }}
          />
        ))}
      </ActionPanel.Submenu>
    </ActionPanel.Section>
  );
}

function AcknowledgeForm({
  hostName,
  description,
  onDone,
}: {
  hostName: string;
  description?: string;
  onDone: () => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Acknowledge Problem"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Acknowledge"
            icon={Icon.Checkmark}
            onSubmit={async (values: { comment: string }) => {
              const toast = await showToast({ style: Toast.Style.Animated, title: "Acknowledging…" });
              try {
                const comment = values.comment.trim() || "Acknowledged via Raycast";
                if (description) await acknowledgeService(hostName, description, comment);
                else await acknowledgeHost(hostName, comment);
                toast.style = Toast.Style.Success;
                toast.title = "Problem acknowledged";
                onDone();
                pop();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Failed to acknowledge";
                toast.message = (error as Error).message;
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Target" text={description ? `${hostName} – ${description}` : hostName} />
      <Form.TextArea id="comment" title="Comment" placeholder="Acknowledged via Raycast" />
    </Form>
  );
}

export function ServiceItem({
  service,
  showHost = true,
  onChange,
}: {
  service: Service;
  showHost?: boolean;
  onChange: () => void;
}) {
  const state = serviceState(service);
  const url = serviceUrl(service.host_name, service.description);
  return (
    <List.Item
      icon={{ source: Icon.CircleFilled, tintColor: state.color }}
      title={service.description}
      subtitle={showHost ? service.host_name : service.plugin_output}
      keywords={[service.host_name]}
      accessories={[
        ...handledAccessories(service),
        { tag: { value: state.label, color: state.color } },
        { text: formatAge(service.last_state_change), tooltip: "Time in current state" },
      ]}
      actions={
        <ActionPanel>
          <Action.Push title="Show Details" icon={Icon.Sidebar} target={<ServiceDetail service={service} />} />
          <Action.OpenInBrowser title="Open in Checkmk" url={url} />
          {service.state !== 0 && (
            <HandleActions hostName={service.host_name} description={service.description} onDone={onChange} />
          )}
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Status Text"
              content={`${service.host_name} – ${service.description}: ${state.label} – ${service.plugin_output}`}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={onChange}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ServiceDetail({ service }: { service: Service }) {
  const state = serviceState(service);
  const url = serviceUrl(service.host_name, service.description);
  const longOutput = service.long_plugin_output?.replace(/\\n/g, "\n").trim();
  const markdown = [
    `# ${service.description}`,
    "```",
    service.plugin_output || "(no output)",
    "```",
    ...(longOutput ? ["### Details", "```", longOutput, "```"] : []),
  ].join("\n");

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${service.host_name} – ${service.description}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Host" text={service.host_name} />
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item text={state.label} color={state.color} />
            {service.acknowledged ? <Detail.Metadata.TagList.Item text="Acknowledged" /> : null}
            {service.scheduled_downtime_depth ? <Detail.Metadata.TagList.Item text="Downtime" /> : null}
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="In State Since" text={formatAge(service.last_state_change)} />
          <Detail.Metadata.Label
            title="Last Check"
            text={service.last_check ? new Date(service.last_check * 1000).toLocaleString() : "-"}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Link title="Checkmk" target={url} text="Open service" />
          <Detail.Metadata.Link title="" target={hostUrl(service.host_name)} text="Open host" />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open in Checkmk" url={url} />
          <Action.CopyToClipboard
            title="Copy Output"
            content={[service.plugin_output, longOutput].filter(Boolean).join("\n")}
          />
        </ActionPanel>
      }
    />
  );
}

export function HostItem({ host, onChange }: { host: Host; onChange: () => void }) {
  const state = hostState(host);
  const url = hostUrl(host.name);
  const counts = [
    host.num_services_crit
      ? { tag: { value: String(host.num_services_crit), color: Color.Red }, tooltip: "CRIT services" }
      : null,
    host.num_services_unknown
      ? { tag: { value: String(host.num_services_unknown), color: Color.Orange }, tooltip: "UNKNOWN services" }
      : null,
    host.num_services_warn
      ? { tag: { value: String(host.num_services_warn), color: Color.Yellow }, tooltip: "WARN services" }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <List.Item
      icon={{ source: Icon.HardDrive, tintColor: state.color }}
      title={host.name}
      subtitle={[host.alias !== host.name ? host.alias : "", host.address].filter(Boolean).join(" · ")}
      keywords={[host.alias, host.address]}
      accessories={[...handledAccessories(host), ...counts, { tag: { value: state.label, color: state.color } }]}
      actions={
        <ActionPanel>
          <Action.Push title="Show Services" icon={Icon.List} target={<HostServices host={host} />} />
          <Action.OpenInBrowser title="Open in Checkmk" url={url} />
          <HandleActions hostName={host.name} onDone={onChange} />
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Host Name"
              content={host.name}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            {host.address && <Action.CopyToClipboard title="Copy IP Address" content={host.address} />}
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={onChange}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export function HostServices({ host }: { host: Host }) {
  const { data, isLoading, revalidate } = usePromise(
    (name: string) => getServices({ op: "=", left: "host_name", right: name }),
    [host.name],
  );
  const sorted = [...(data ?? [])].sort(compareServices);
  return (
    <List isLoading={isLoading} navigationTitle={host.name} searchBarPlaceholder={`Filter services on ${host.name}...`}>
      {sorted.map((service) => (
        <ServiceItem key={service.description} service={service} showHost={false} onChange={revalidate} />
      ))}
    </List>
  );
}

const SEVERITY: Record<number, number> = { 2: 0, 3: 1, 1: 2, 0: 3 };

/** Worst state first (CRIT, UNKNOWN, WARN, OK), unhandled before handled, then by name. */
export function compareServices(a: Service, b: Service): number {
  return (
    (SEVERITY[a.state] ?? 4) - (SEVERITY[b.state] ?? 4) ||
    Number(isHandled(a)) - Number(isHandled(b)) ||
    a.host_name.localeCompare(b.host_name) ||
    a.description.localeCompare(b.description)
  );
}

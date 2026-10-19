import {
  Action,
  ActionPanel,
  Alert,
  closeMainWindow,
  Color,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { getSources, getStates, syncAll, syncDue } from "./lib/sources";
import { appendLocalHost, CONFIG_PATH, HostEntry, integrate, isIntegrated, loadHosts } from "./lib/sshconfig";
import {
  frecency,
  getUsage,
  isPortOpen,
  openBrowserViaTunnel,
  openInVSCode,
  openSession,
  sshCommand,
  waitForPort,
} from "./lib/terminal";
import ManageSources from "./manage-sources";
import { SftpBrowser } from "./sftp/browser";

const RECENT_COUNT = 6;

export default function SearchHosts() {
  const [showDetail, setShowDetail] = useState(false);
  const { data, isLoading, revalidate } = usePromise(async () => {
    const [{ hosts, overridden }, usage, sources, states, integrated] = await Promise.all([
      loadHosts(),
      getUsage(),
      getSources(),
      getStates(),
      isIntegrated(),
    ]);
    const names = Object.fromEntries(sources.map((s) => [s.id, s.name]));
    const offline = sources.filter((s) => s.enabled && states[s.id]?.error);
    return { hosts, overridden, usage, names, integrated, hasSources: sources.length > 0, offline };
  }, []);

  // Background refresh of team sources (only downloads when something changed).
  useEffect(() => {
    (async () => {
      if (!(await syncDue())) return;
      const results = await syncAll();
      if (results.some((r) => r.status === "updated")) revalidate();
    })();
  }, []);

  async function sync(force: boolean) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Syncing sources…" });
    const results = await syncAll(force);
    const errors = results.filter((r) => r.status === "error");
    const updated = results.filter((r) => r.status === "updated").length;
    toast.style = errors.length ? Toast.Style.Failure : Toast.Style.Success;
    toast.title = errors.length
      ? `${errors.length} source(s) unreachable – using cached hosts`
      : updated
        ? `${updated} source(s) updated`
        : "Everything up to date";
    toast.message = errors.map((e) => `${e.source.name}: ${e.state.error}`).join("\n") || undefined;
    revalidate();
  }

  const hosts = data?.hosts ?? [];
  const recent = hosts
    .filter((h) => data?.usage[h.alias])
    .sort((a, b) => frecency(data?.usage[b.alias]) - frecency(data?.usage[a.alias]))
    .slice(0, RECENT_COUNT);
  const recentSet = new Set(recent.map((h) => h.alias));

  const groups = new Map<string, HostEntry[]>();
  for (const host of hosts) {
    if (recentSet.has(host.alias)) continue;
    const originName = host.origin === "local" ? "Local" : (data?.names[host.origin] ?? host.origin);
    const key = host.group ? groupParts(host.group).section : originName;
    groups.set(key, [...(groups.get(key) ?? []), host]);
  }

  const common = { showDetail, toggleDetail: () => setShowDetail((v) => !v), sync, revalidate, data };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail && hosts.length > 0}
      searchBarPlaceholder="Search SSH hosts..."
    >
      {data && data.hasSources && !data.integrated && (
        <List.Section title="Setup">
          <List.Item
            icon={{ source: Icon.Warning, tintColor: Color.Orange }}
            title="Enable team hosts for ssh"
            subtitle="Adds one Include block to ~/.ssh/config (backup is created)"
            actions={
              <ActionPanel>
                <Action
                  title="Enable Team Hosts"
                  icon={Icon.Plug}
                  onAction={async () => {
                    if (
                      await confirmAlert({
                        title: "Add Include block to ~/.ssh/config?",
                        message:
                          "Team hosts become available to ssh, VS Code, WinSCP etc. Your own host entries keep priority. A backup of your config is created first.",
                        primaryAction: { title: "Add Include Block" },
                      })
                    ) {
                      await integrate();
                      await showToast({ style: Toast.Style.Success, title: "Team hosts enabled" });
                      revalidate();
                    }
                  }}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {data && data.offline.length > 0 && (
        <List.Section title="Sources">
          <List.Item
            icon={{ source: Icon.WifiDisabled, tintColor: Color.Orange }}
            title={`${data.offline.map((s) => s.name).join(", ")} unreachable`}
            subtitle="Using cached hosts from the last successful sync"
            actions={
              <ActionPanel>
                <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={() => sync(false)} />
                <Action.Push title="Manage Sources" icon={Icon.Gear} target={<ManageSources />} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {recent.length > 0 && (
        <List.Section title="Recent">
          {recent.map((host) => (
            <HostItem key={`r-${host.alias}`} host={host} {...common} />
          ))}
        </List.Section>
      )}
      {[...groups.entries()]
        .sort(([a], [b]) => (a === "Local" ? -1 : b === "Local" ? 1 : a.localeCompare(b)))
        .map(([title, items]) => (
          <List.Section key={title} title={title} subtitle={String(items.length)}>
            {items.map((host) => (
              <HostItem key={`${host.origin}-${host.alias}`} host={host} {...common} />
            ))}
          </List.Section>
        ))}
      <List.EmptyView
        title="No SSH hosts found"
        description="Add hosts to ~/.ssh/config or configure a team source"
        icon={Icon.Terminal}
        actions={
          <ActionPanel>
            <Action.Push title="Add Host" icon={Icon.Plus} target={<AddHostForm onDone={revalidate} />} />
            <Action.Push title="Manage Sources" icon={Icon.Gear} target={<ManageSources />} />
          </ActionPanel>
        }
      />
    </List>
  );
}

function HostItem({
  host,
  showDetail,
  toggleDetail,
  sync,
  revalidate,
  data,
}: {
  host: HostEntry;
  showDetail: boolean;
  toggleDetail: () => void;
  sync: (force: boolean) => void;
  revalidate: () => void;
  data?: { names: Record<string, string>; overridden: Set<string> };
}) {
  const target = `${host.user ? `${host.user}@` : ""}${host.hostName ?? host.alias}${host.port && host.port !== "22" ? `:${host.port}` : ""}`;
  const originName = host.origin === "local" ? "Local" : (data?.names[host.origin] ?? host.origin);
  const overrides = host.origin === "local" && data?.overridden.has(host.alias);

  return (
    <List.Item
      icon={
        host.socksPort
          ? { source: Icon.Network, tintColor: Color.Purple }
          : { source: Icon.Terminal, tintColor: host.origin === "local" ? Color.PrimaryText : Color.Blue }
      }
      title={host.alias}
      subtitle={showDetail ? undefined : target}
      keywords={[
        host.hostName ?? "",
        host.user ?? "",
        ...(host.group ? groupParts(host.group).all : []),
        host.description ?? "",
        ...host.tags,
      ]}
      accessories={
        showDetail
          ? undefined
          : [
              ...(host.socksPort
                ? [
                    {
                      tag: { value: `SOCKS :${host.socksPort}`, color: Color.Purple },
                      tooltip: host.web ?? "SOCKS tunnel",
                    },
                  ]
                : []),
              ...(host.proxyJump ? [{ icon: Icon.Shuffle, tooltip: `via ${host.proxyJump}` }] : []),
              ...(host.group && groupParts(host.group).rest
                ? [{ icon: Icon.Folder, text: groupParts(host.group).rest, tooltip: host.group }]
                : []),
              ...host.tags.slice(0, 2).map((t) => ({ tag: t })),
              ...(overrides ? [{ tag: { value: "overrides team", color: Color.Orange } }] : []),
              { text: originName, tooltip: host.origin === "local" ? CONFIG_PATH : `Team source: ${originName}` },
            ]
      }
      detail={
        <List.Item.Detail
          markdown={host.description ? `**${host.alias}** – ${host.description}` : `**${host.alias}**`}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Host" text={host.hostName ?? host.alias} />
              <List.Item.Detail.Metadata.Label title="User" text={host.user ?? "(default)"} />
              {host.port && <List.Item.Detail.Metadata.Label title="Port" text={host.port} />}
              {host.proxyJump && <List.Item.Detail.Metadata.Label title="Jump Host" text={host.proxyJump} />}
              {host.identityFile && <List.Item.Detail.Metadata.Label title="Identity File" text={host.identityFile} />}
              <List.Item.Detail.Metadata.Label title="Source" text={originName} />
              {host.group && <List.Item.Detail.Metadata.Label title="Group" text={host.group} />}
              {host.tags.length > 0 && (
                <List.Item.Detail.Metadata.TagList title="Tags">
                  {host.tags.map((t) => (
                    <List.Item.Detail.Metadata.TagList.Item key={t} text={t} />
                  ))}
                </List.Item.Detail.Metadata.TagList>
              )}
              <List.Item.Detail.Metadata.Separator />
              {Object.entries(host.options)
                .filter(([k]) => !["hostname", "user", "port", "proxyjump", "identityfile"].includes(k))
                .map(([k, v]) => (
                  <List.Item.Detail.Metadata.Label key={k} title={k} text={v} />
                ))}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section title={host.alias}>
            {host.socksPort && host.web && (
              <Action
                title="Open in Browser Via Tunnel"
                icon={Icon.Globe}
                onAction={() => browserViaTunnel(host, revalidate)}
              />
            )}
            <Action
              title={host.tunnelOnly ? "Start Tunnel" : "Connect"}
              icon={host.tunnelOnly ? Icon.Network : Icon.Terminal}
              onAction={() => connect(() => openSession(host.alias), host.alias, revalidate)}
            />
            <Action
              title="Connect in New Window"
              icon={Icon.Window}
              shortcut={Keyboard.Shortcut.Common.Open}
              onAction={() => connect(() => openSession(host.alias, { newWindow: true }), host.alias, revalidate)}
            />
            {!host.tunnelOnly && (
              <Action.Push
                title="Browse Files (SFTP)"
                icon={Icon.Folder}
                shortcut={{
                  macOS: { modifiers: ["cmd", "shift"], key: "f" },
                  Windows: { modifiers: ["ctrl", "shift"], key: "f" },
                }}
                target={<SftpBrowser alias={host.alias} />}
              />
            )}
            <Action.Push
              title="Connect as User…"
              icon={Icon.Person}
              shortcut={{ macOS: { modifiers: ["cmd"], key: "u" }, Windows: { modifiers: ["ctrl"], key: "u" } }}
              target={<ConnectAsForm host={host} onDone={revalidate} />}
            />
            <Action
              title="Open in VS Code"
              icon={Icon.Code}
              shortcut={{
                macOS: { modifiers: ["cmd", "shift"], key: "v" },
                Windows: { modifiers: ["ctrl", "shift"], key: "v" },
              }}
              onAction={() => connect(() => openInVSCode(host.alias), host.alias, revalidate)}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy SSH Command"
              content={sshCommand(host.alias)}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard
              title="Copy Hostname"
              content={host.hostName ?? host.alias}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            <Action.CopyToClipboard title="Copy Config Block" content={configBlock(host)} />
            <Action
              title={showDetail ? "Hide Details" : "Show Details"}
              icon={Icon.Sidebar}
              shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
              onAction={toggleDetail}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.Push
              title="Add Host"
              icon={Icon.Plus}
              shortcut={Keyboard.Shortcut.Common.New}
              target={<AddHostForm onDone={revalidate} />}
            />
            <Action.Open title="Open Local SSH Config" icon={Icon.Document} target={CONFIG_PATH} />
            <Action
              title="Sync Sources Now"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={() => sync(false)}
            />
            <Action.Push title="Manage Sources" icon={Icon.Gear} target={<ManageSources />} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/** Splits "A\B\C\D" (RDM style) or "A / B / C" into a section (first two levels) and the rest. */
function groupParts(group: string) {
  const all = group.split(/\s*[\\/›]\s*/).filter(Boolean);
  return { section: all.slice(0, 2).join(" › "), rest: all.slice(2).join(" › "), all };
}

/** Starts the SOCKS tunnel if needed (the user types the jump password in the terminal), then opens the browser. */
async function browserViaTunnel(host: HostEntry, revalidate: () => void) {
  const port = host.socksPort!;
  try {
    if (!(await isPortOpen(port))) {
      await openSession(host.alias);
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Waiting for tunnel ${host.alias}…`,
        message: "Log in in the terminal tab if asked",
      });
      if (!(await waitForPort(port))) {
        toast.style = Toast.Style.Failure;
        toast.title = `Tunnel ${host.alias} did not come up`;
        toast.message = `Nothing is listening on 127.0.0.1:${port} – check the terminal tab`;
        return;
      }
      toast.hide();
    }
    await openBrowserViaTunnel(host.web!, port);
    revalidate();
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Could not open browser", message: (error as Error).message });
  }
}

async function connect(open: () => Promise<void>, alias: string, revalidate: () => void) {
  try {
    // Hide Raycast right away so the terminal can take the focus.
    await closeMainWindow({ clearRootSearch: true });
    await open();
    revalidate();
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: `Could not open ${alias}`,
      message: (error as Error).message,
    });
  }
}

/** Config block for sharing a host with the team (no keys, no user unless set explicitly). */
function configBlock(host: HostEntry): string {
  const lines: string[] = [];
  if (host.group) lines.push(`# group: ${host.group}`);
  if (host.tags.length) lines.push(`# tags: ${host.tags.join(", ")}`);
  if (host.description) lines.push(`# description: ${host.description}`);
  lines.push(`Host ${host.alias}`);
  for (const [k, v] of Object.entries(host.options)) {
    if (k === "identityfile") continue; // keys stay local
    lines.push(`    ${OPTION_NAMES[k] ?? k} ${v}`);
  }
  return lines.join("\n");
}

const OPTION_NAMES: Record<string, string> = {
  hostname: "HostName",
  user: "User",
  port: "Port",
  proxyjump: "ProxyJump",
  forwardagent: "ForwardAgent",
  localforward: "LocalForward",
  remoteforward: "RemoteForward",
  serveraliveinterval: "ServerAliveInterval",
};

function ConnectAsForm({ host, onDone }: { host: HostEntry; onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`Connect to ${host.alias}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Connect"
            icon={Icon.Terminal}
            onSubmit={async (values: { user: string }) => {
              if (!values.user.trim()) return;
              await connect(() => openSession(host.alias, { user: values.user.trim() }), host.alias, onDone);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Host" text={`${host.alias} (${host.hostName ?? host.alias})`} />
      <Form.TextField id="user" title="User" placeholder="root" defaultValue={host.user} autoFocus />
    </Form>
  );
}

function AddHostForm({ onDone }: { onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Add SSH Host"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Add to ~/.Ssh/config"
            icon={Icon.Plus}
            onSubmit={async (v: Record<string, string>) => {
              const alias = v.alias.trim();
              if (!/^[\w.-]+$/.test(alias) || !v.hostName.trim()) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Alias (letters, digits, . - _) and host are required",
                });
                return;
              }
              const { hosts } = await loadHosts();
              if (
                hosts.some((h) => h.alias === alias) &&
                !(await confirmAlert({
                  title: `"${alias}" already exists`,
                  message: "Your local entry will take priority. Add anyway?",
                  primaryAction: { title: "Add", style: Alert.ActionStyle.Default },
                }))
              ) {
                return;
              }
              const lines: string[] = [];
              if (v.group.trim()) lines.push(`# group: ${v.group.trim()}`);
              if (v.tags.trim()) lines.push(`# tags: ${v.tags.trim()}`);
              if (v.description.trim()) lines.push(`# description: ${v.description.trim()}`);
              lines.push(`Host ${alias}`, `    HostName ${v.hostName.trim()}`);
              if (v.user.trim()) lines.push(`    User ${v.user.trim()}`);
              if (v.port.trim() && v.port.trim() !== "22") lines.push(`    Port ${v.port.trim()}`);
              if (v.proxyJump.trim()) lines.push(`    ProxyJump ${v.proxyJump.trim()}`);
              if (v.identityFile.trim()) lines.push(`    IdentityFile "${v.identityFile.trim()}"`);
              await appendLocalHost(lines.join("\n"));
              await showToast({ style: Toast.Style.Success, title: `${alias} added` });
              onDone();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="alias" title="Alias" placeholder="web01" />
      <Form.TextField id="hostName" title="Host / IP" placeholder="10.0.0.11 or web01.example.com" />
      <Form.TextField id="user" title="User" placeholder="empty = your default user" />
      <Form.TextField id="port" title="Port" placeholder="22" />
      <Form.TextField id="proxyJump" title="Jump Host" placeholder="optional, e.g. jump01" />
      <Form.TextField id="identityFile" title="Identity File" placeholder="optional, e.g. ~/.ssh/id_ed25519" />
      <Form.Separator />
      <Form.TextField id="group" title="Group" placeholder="optional, e.g. Kunden / ACME" />
      <Form.TextField id="tags" title="Tags" placeholder="optional, comma separated" />
      <Form.TextField id="description" title="Description" placeholder="optional" />
    </Form>
  );
}

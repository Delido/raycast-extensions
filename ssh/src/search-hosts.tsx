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
import { cacheFile, getSources, getStates, syncAll, syncDue } from "./lib/sources";
import {
  buildBlock,
  deleteLocal,
  fieldsOf,
  fileOfHost,
  filesOf,
  getHidden,
  HostFields,
  isHidden,
  saveLocal,
  saveTeam,
  setHidden,
  writableSources,
} from "./lib/hostedit";
import { CONFIG_PATH, HostEntry, integrate, isIntegrated, loadHosts } from "./lib/sshconfig";
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
    const [{ hosts: all, overridden }, usage, sources, states, integrated, hidden, writable] = await Promise.all([
      loadHosts(),
      getUsage(),
      getSources(),
      getStates(),
      isIntegrated(),
      getHidden(),
      writableSources(),
    ]);
    const names = Object.fromEntries(sources.map((s) => [s.id, s.name]));
    const offline = sources.filter((s) => s.enabled && states[s.id]?.error);
    const hosts = all.filter((h) => !isHidden(hidden, h));
    const hiddenHosts = all.filter((h) => isHidden(hidden, h));
    return {
      hosts,
      hiddenHosts,
      overridden,
      usage,
      names,
      integrated,
      hasSources: sources.length > 0,
      offline,
      writable: new Set(writable.map((s) => s.id)),
    };
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
      {data && data.hiddenHosts.length > 0 && (
        <List.Section title="Hidden">
          <List.Item
            icon={{ source: Icon.EyeDisabled, tintColor: Color.SecondaryText }}
            title={`${data.hiddenHosts.length} hidden team host${data.hiddenHosts.length === 1 ? "" : "s"}`}
            subtitle="Hidden only for you – Enter shows them"
            actions={
              <ActionPanel>
                <Action.Push
                  title="Show Hidden Hosts"
                  icon={Icon.Eye}
                  target={<HiddenHosts hosts={data.hiddenHosts} names={data.names} onDone={revalidate} />}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      <List.EmptyView
        title="No SSH hosts found"
        description="Add hosts to ~/.ssh/config or configure a team source"
        icon={Icon.Terminal}
        actions={
          <ActionPanel>
            <Action.Push title="Add Host" icon={Icon.Plus} target={<HostForm onDone={revalidate} />} />
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
  data?: { names: Record<string, string>; overridden: Set<string>; writable: Set<string> };
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
              onAction={() => connect(() => openSession(host.alias), host, revalidate)}
            />
            <Action
              title="Connect in New Window"
              icon={Icon.Window}
              shortcut={Keyboard.Shortcut.Common.Open}
              onAction={() => connect(() => openSession(host.alias, { newWindow: true }), host, revalidate)}
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
              onAction={() => connect(() => openInVSCode(host.alias), host, revalidate)}
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
          <ActionPanel.Section title="Edit">
            <Action.Push
              title="Edit Host"
              icon={Icon.Pencil}
              shortcut={Keyboard.Shortcut.Common.Edit}
              target={<HostForm host={host} onDone={revalidate} />}
            />
            <Action.Push
              title="Add Host"
              icon={Icon.Plus}
              shortcut={Keyboard.Shortcut.Common.New}
              target={<HostForm onDone={revalidate} />}
            />
            {host.origin === "local" ? (
              <Action
                title={overrides ? "Remove Local Override" : "Delete Host"}
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={Keyboard.Shortcut.Common.Remove}
                onAction={() => removeLocalHost(host, !!overrides, revalidate)}
              />
            ) : (
              <>
                <Action
                  title="Hide for Me"
                  icon={Icon.EyeDisabled}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={async () => {
                    await setHidden(host, true);
                    await showToast({
                      style: Toast.Style.Success,
                      title: `${host.alias} hidden`,
                      message: "Only for you",
                    });
                    revalidate();
                  }}
                />
                {data?.writable.has(host.origin) && (
                  <Action
                    title="Delete from Team Source"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.RemoveAll}
                    onAction={() => removeTeamHost(host, originName, revalidate)}
                  />
                )}
              </>
            )}
          </ActionPanel.Section>
          <ActionPanel.Section>
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

/**
 * Team hosts live in ~/.ssh/config.d; ssh only sees them through the Include block in ~/.ssh/config.
 * Without it ssh takes the alias as a host name ("Could not resolve hostname"), so offer to add it.
 */
async function ensureIntegrated(host: HostEntry): Promise<boolean> {
  if (host.origin === "local" || (await isIntegrated())) return true;
  if (
    !(await confirmAlert({
      title: "ssh does not know the team hosts yet",
      message:
        "Raycast lists them, but ssh only reads ~/.ssh/config. Add the Include block for the team hosts now? Your own entries keep priority, a backup of your config is created first.",
      primaryAction: { title: "Add Include Block and Connect" },
    }))
  )
    return false;
  await integrate();
  return true;
}

async function connect(open: () => Promise<void>, host: HostEntry, revalidate: () => void) {
  const alias = host.alias;
  try {
    if (!(await ensureIntegrated(host))) return;
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

/** Config block for sharing a host with the team – the same block "Save for the team" writes (no keys). */
function configBlock(host: HostEntry): string {
  return buildBlock(fieldsOf(host), true);
}

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
              await connect(() => openSession(host.alias, { user: values.user.trim() }), host, onDone);
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

async function removeLocalHost(host: HostEntry, overrides: boolean, revalidate: () => void) {
  if (
    !(await confirmAlert({
      title: overrides ? `Remove your local version of "${host.alias}"?` : `Delete "${host.alias}"?`,
      message: overrides
        ? "The team version of this host is used again."
        : "The host is removed from ~/.ssh/config (a backup is kept as config.raycast-backup-last).",
      primaryAction: { title: overrides ? "Remove" : "Delete", style: Alert.ActionStyle.Destructive },
    }))
  )
    return;
  try {
    await deleteLocal(host.alias);
    await showToast({
      style: Toast.Style.Success,
      title: overrides ? "Local version removed" : `${host.alias} deleted`,
    });
    revalidate();
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Could not delete", message: (error as Error).message });
  }
}

async function removeTeamHost(host: HostEntry, sourceName: string, revalidate: () => void) {
  if (
    !(await confirmAlert({
      title: `Delete "${host.alias}" for the whole team?`,
      message: `The host is removed from "${sourceName}" (a commit in OneDev, or the file on the share). To remove it only for you, use Hide for Me.`,
      primaryAction: { title: "Delete for Everyone", style: Alert.ActionStyle.Destructive },
    }))
  )
    return;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Removing ${host.alias} from ${sourceName}…` });
  try {
    const source = (await getSources()).find((s) => s.id === host.origin);
    const file = await fileOfHost(host);
    if (!source || !file) throw new Error("Source or file of this host not found – sync and try again");
    await saveTeam({ source, file }, host.alias, null);
    toast.style = Toast.Style.Success;
    toast.title = `${host.alias} removed from ${sourceName}`;
    revalidate();
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Could not delete";
    toast.message = (error as Error).message;
  }
}

function HiddenHosts({
  hosts,
  names,
  onDone,
}: {
  hosts: HostEntry[];
  names: Record<string, string>;
  onDone: () => void;
}) {
  const [list, setList] = useState(hosts);
  return (
    <List navigationTitle="Hidden Hosts" searchBarPlaceholder="Search hidden hosts...">
      {list.map((host) => (
        <List.Item
          key={`${host.origin}-${host.alias}`}
          icon={{ source: Icon.EyeDisabled, tintColor: Color.SecondaryText }}
          title={host.alias}
          subtitle={host.hostName}
          accessories={[{ text: names[host.origin] ?? host.origin }]}
          actions={
            <ActionPanel>
              <Action
                title="Show Again"
                icon={Icon.Eye}
                onAction={async () => {
                  await setHidden(host, false);
                  setList((l) => l.filter((h) => h !== host));
                  onDone();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
      <List.EmptyView title="No hidden hosts" icon={Icon.Eye} />
    </List>
  );
}

/** Values that would produce a broken config line (ssh takes the rest of the line as the value). */
function fieldError(v: HostFields): string | undefined {
  if (/\s/.test(v.hostName.trim())) return "Host / IP must not contain spaces";
  if (/\s/.test(v.user.trim())) return "User must not contain spaces";
  const port = v.port.trim();
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535))
    return "Port must be a number (1–65535)";
  if (/\s/.test(v.proxyJump.trim())) return "Jump host must not contain spaces (use a,b for several)";
  return undefined;
}

/** Add or edit a host – for you only (~/.ssh/config) or for the team (commit / file on the share). */
function HostForm({ host, onDone }: { host?: HostEntry; onDone: () => void }) {
  const { pop } = useNavigation();
  const initial = fieldsOf(host);
  const { data: targets, isLoading } = usePromise(async () => {
    const list: { value: string; title: string }[] = [];
    for (const source of await writableSources()) {
      const files = await filesOf(source, cacheFile(source.id));
      for (const file of files.length ? files : [source.path ?? ""]) {
        const name = file.split(/[\\/]/).pop();
        list.push({
          value: `team|${source.id}|${file}`,
          title: `Team: ${source.name}${files.length > 1 ? ` › ${name}` : ""}`,
        });
      }
    }
    const own = host && host.origin !== "local" ? await fileOfHost(host) : undefined;
    return { list, own: own && host ? `team|${host.origin}|${own}` : undefined };
  }, []);

  const teamHost = !!host && host.origin !== "local";
  return (
    <Form
      isLoading={isLoading}
      navigationTitle={host ? `Edit ${host.alias}` : "Add SSH Host"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={host ? "Save" : "Add Host"}
            icon={host ? Icon.Check : Icon.Plus}
            onSubmit={async (v: HostFields & { target: string }) => {
              const alias = v.alias.trim();
              if (!/^[\w.-]+$/.test(alias) || !v.hostName.trim()) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Alias (letters, digits, . - _) and host are required",
                });
                return;
              }
              const invalid = fieldError(v);
              if (invalid) {
                await showToast({ style: Toast.Style.Failure, title: invalid });
                return;
              }
              const toast = await showToast({ style: Toast.Style.Animated, title: "Saving…" });
              try {
                if (v.target === "local") {
                  await saveLocal(host?.alias, v, host?.origin === "local" ? host.section : undefined);
                  toast.title = teamHost ? `${alias} saved for you (overrides the team version)` : `${alias} saved`;
                } else {
                  const [, sourceId, ...rest] = v.target.split("|");
                  const file = rest.join("|");
                  const source = (await getSources()).find((s) => s.id === sourceId);
                  if (!source) throw new Error("Source not found");
                  // only the host's own file knows the old alias; any other file gets it added
                  const sameFile = targets?.own ? v.target === targets.own : host?.origin === sourceId;
                  await saveTeam(
                    { source, file },
                    sameFile ? host?.alias : undefined,
                    v,
                    sameFile ? host?.section : undefined,
                  );
                  toast.title = `${alias} saved for the team (${source.name})`;
                  if (host?.origin === "local")
                    toast.message = "Your local entry still takes priority – delete it to use the team version";
                }
                toast.style = Toast.Style.Success;
                onDone();
                pop();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Could not save";
                toast.message = (error as Error).message;
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="target"
        title="Save For"
        defaultValue="local"
        info="Only me: written to your ~/.ssh/config (for a team host: your own version that overrides it). Team: a commit to the OneDev repository or a change of the file on the share – everyone gets it with the next sync. HTTPS sources are read-only."
      >
        <Form.Dropdown.Item
          value="local"
          title={teamHost ? "Only Me (local version, overrides the team host)" : "Only Me (~/.ssh/config)"}
          icon={Icon.Person}
        />
        {(targets?.list ?? []).map((t) => (
          <Form.Dropdown.Item
            key={t.value}
            value={t.value}
            title={t.value === targets?.own ? `${t.title} (this host)` : t.title}
            icon={Icon.TwoPeople}
          />
        ))}
      </Form.Dropdown>
      <Form.Separator />
      <Form.TextField id="alias" title="Alias" placeholder="web01" defaultValue={initial.alias} />
      <Form.TextField
        id="hostName"
        title="Host / IP"
        placeholder="10.0.0.11 or web01.example.com"
        defaultValue={initial.hostName}
      />
      <Form.TextField id="user" title="User" placeholder="empty = your default user" defaultValue={initial.user} />
      <Form.TextField id="port" title="Port" placeholder="22" defaultValue={initial.port} />
      <Form.TextField
        id="proxyJump"
        title="Jump Host"
        placeholder="optional, e.g. jump01"
        defaultValue={initial.proxyJump}
      />
      <Form.TextField
        id="identityFile"
        title="Identity File"
        placeholder="optional, e.g. ~/.ssh/id_ed25519"
        defaultValue={initial.identityFile}
        info="Keys stay personal: this is only written to your local config, never to a team source."
      />
      <Form.Separator />
      <Form.TextField
        id="group"
        title="Group"
        placeholder="optional, e.g. Kunden / ACME"
        defaultValue={initial.group}
      />
      <Form.TextField id="tags" title="Tags" placeholder="optional, comma separated" defaultValue={initial.tags} />
      <Form.TextField id="description" title="Description" placeholder="optional" defaultValue={initial.description} />
      <Form.TextField
        id="web"
        title="Web URL"
        placeholder="optional, opened through the SOCKS tunnel"
        defaultValue={initial.web}
      />
      <Form.TextArea
        id="extra"
        title="More Options"
        placeholder="one per line, e.g. LocalForward 8080 localhost:80"
        defaultValue={initial.extra}
      />
    </Form>
  );
}

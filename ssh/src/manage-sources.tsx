import {
  Action,
  ActionPanel,
  Alert,
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
import { useState } from "react";
import {
  cacheFile,
  getSources,
  getStates,
  newSourceId,
  removeSource,
  saveSources,
  Source,
  SourceType,
  syncSource,
} from "./lib/sources";
import { DEFAULTS_FILE, integrate, isIntegrated, parseDefaults, readText, writeDefaults } from "./lib/sshconfig";

const TYPE_LABEL: Record<SourceType, string> = { onedev: "OneDev", http: "HTTPS URL", file: "File / Share" };
const TYPE_ICON: Record<SourceType, Icon> = { onedev: Icon.Code, http: Icon.Globe, file: Icon.Folder };

function ago(ts?: number): string {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ManageSources() {
  const { data, isLoading, revalidate } = usePromise(async () => {
    const [sources, states, integrated, defaults] = await Promise.all([
      getSources(),
      getStates(),
      isIntegrated(),
      readText(DEFAULTS_FILE),
    ]);
    return { sources, states, integrated, defaults: parseDefaults(defaults ?? "") };
  }, []);

  async function sync(source: Source, force: boolean) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Syncing ${source.name}…` });
    const r = await syncSource(source, force);
    toast.style = r.status === "error" ? Toast.Style.Failure : Toast.Style.Success;
    toast.title =
      r.status === "error"
        ? `${source.name}: unreachable – cache kept`
        : r.status === "updated"
          ? `${source.name}: ${r.state.hosts ?? 0} hosts updated`
          : `${source.name}: up to date`;
    toast.message = r.state.error ?? (r.state.blocked ? `${r.state.blocked} risky option(s) disabled` : undefined);
    revalidate();
  }

  return (
    <List isLoading={isLoading} navigationTitle="SSH Sources">
      <List.Section title="Team Sources">
        {data?.sources.map((source) => {
          const state = data.states[source.id] ?? {};
          return (
            <List.Item
              key={source.id}
              icon={{
                source: TYPE_ICON[source.type],
                tintColor: !source.enabled ? Color.SecondaryText : state.error ? Color.Orange : Color.Green,
              }}
              title={source.name}
              subtitle={TYPE_LABEL[source.type]}
              accessories={[
                ...(state.blocked
                  ? [{ icon: Icon.Shield, text: String(state.blocked), tooltip: "Risky options disabled" }]
                  : []),
                ...(state.error ? [{ icon: Icon.WifiDisabled, tooltip: state.error }] : []),
                { text: `${state.hosts ?? 0} hosts` },
                {
                  text: source.enabled ? `checked ${ago(state.lastCheck)}` : "disabled",
                  tooltip: `Last change: ${ago(state.lastChange)} · last success: ${ago(state.lastSuccess)}${state.version ? ` · version ${state.version.slice(0, 18)}` : ""}`,
                },
              ]}
              actions={
                <ActionPanel>
                  <Action title="Sync Now" icon={Icon.ArrowClockwise} onAction={() => sync(source, false)} />
                  <Action.Push
                    title="Edit Source"
                    icon={Icon.Pencil}
                    shortcut={Keyboard.Shortcut.Common.Edit}
                    target={<SourceForm source={source} onDone={revalidate} />}
                  />
                  <Action title="Force Full Download" icon={Icon.Download} onAction={() => sync(source, true)} />
                  <Action
                    title={source.enabled ? "Disable Source" : "Enable Source"}
                    icon={source.enabled ? Icon.Pause : Icon.Play}
                    onAction={async () => {
                      const all = await getSources();
                      await saveSources(all.map((s) => (s.id === source.id ? { ...s, enabled: !s.enabled } : s)));
                      revalidate();
                    }}
                  />
                  <Action.Open title="Open Cached File" icon={Icon.Document} target={cacheFile(source.id)} />
                  {state.error && <Action.CopyToClipboard title="Copy Error" content={state.error} />}
                  <Action
                    title="Remove Source"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={async () => {
                      if (
                        await confirmAlert({
                          title: `Remove "${source.name}"?`,
                          message: "Its cached hosts are removed from your machine as well.",
                          primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
                        })
                      ) {
                        await removeSource(source.id);
                        revalidate();
                      }
                    }}
                  />
                  <ActionPanel.Section>
                    <Action.Push title="Add Source" icon={Icon.Plus} target={<SourceForm onDone={revalidate} />} />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })}
        <List.Item
          icon={Icon.Plus}
          title="Add Source…"
          subtitle="OneDev repository, HTTPS URL or file share"
          actions={
            <ActionPanel>
              <Action.Push title="Add Source" icon={Icon.Plus} target={<SourceForm onDone={revalidate} />} />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="This Computer">
        <List.Item
          icon={Icon.Person}
          title="Personal Defaults"
          subtitle={
            data?.defaults.user
              ? `User ${data.defaults.user}${data.defaults.identityFile ? ` · ${data.defaults.identityFile}` : ""}`
              : "Your user and key for hosts without a fixed user"
          }
          actions={
            <ActionPanel>
              <Action.Push
                title="Edit Personal Defaults"
                icon={Icon.Pencil}
                target={<DefaultsForm initial={data?.defaults} onDone={revalidate} />}
              />
            </ActionPanel>
          }
        />
        <List.Item
          icon={{
            source: data?.integrated ? Icon.CheckCircle : Icon.Circle,
            tintColor: data?.integrated ? Color.Green : Color.Orange,
          }}
          title="Include Block in ~/.ssh/config"
          subtitle={data?.integrated ? "Active – team hosts work in every ssh client" : "Not yet added"}
          actions={
            <ActionPanel>
              {!data?.integrated && (
                <Action
                  title="Add Include Block"
                  icon={Icon.Plug}
                  onAction={async () => {
                    await integrate();
                    await showToast({ style: Toast.Style.Success, title: "Include block added (backup created)" });
                    revalidate();
                  }}
                />
              )}
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

function SourceForm({ source, onDone }: { source?: Source; onDone: () => void }) {
  const { pop } = useNavigation();
  const [type, setType] = useState<SourceType>(source?.type ?? "onedev");

  return (
    <Form
      navigationTitle={source ? `Edit ${source.name}` : "Add Source"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save and Sync"
            icon={Icon.Check}
            onSubmit={async (v: Record<string, string | boolean>) => {
              const str = (k: string) => String(v[k] ?? "").trim();
              const missing = !str("name")
                ? "Name is required"
                : type === "onedev" && (!str("serverUrl") || !str("project") || !str("token"))
                  ? "Server URL, project and token are required"
                  : type === "http" && !str("url")
                    ? "URL is required"
                    : type === "file" && !str("path")
                      ? "Path is required"
                      : undefined;
              if (missing) {
                await showToast({ style: Toast.Style.Failure, title: missing });
                return;
              }

              const updated: Source = {
                id: source?.id ?? newSourceId(str("name")),
                name: str("name"),
                type,
                enabled: Boolean(v.enabled),
                serverUrl: str("serverUrl") || undefined,
                project: str("project") || undefined,
                branch: str("branch") || undefined,
                path: str("path") || undefined,
                token: str("token") || undefined,
                url: str("url") || undefined,
                headerName: str("headerName") || undefined,
                headerValue: str("headerValue") || undefined,
              };
              const all = await getSources();
              await saveSources(source ? all.map((s) => (s.id === source.id ? updated : s)) : [...all, updated]);

              if (!(await isIntegrated())) {
                const ok = await confirmAlert({
                  title: "Add Include block to ~/.ssh/config?",
                  message:
                    "Needed so that ssh knows the team hosts. Your own entries keep priority; a backup of your config is created first.",
                  primaryAction: { title: "Add Include Block" },
                });
                if (ok) await integrate();
              }
              const toast = await showToast({ style: Toast.Style.Animated, title: "Syncing…" });
              const r = await syncSource(updated, true);
              toast.style = r.status === "error" ? Toast.Style.Failure : Toast.Style.Success;
              toast.title = r.status === "error" ? "Saved, but sync failed" : `${r.state.hosts ?? 0} hosts loaded`;
              toast.message = r.state.error;
              onDone();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="Team Hosts" defaultValue={source?.name} />
      <Form.Dropdown id="type" title="Type" value={type} onChange={(t) => setType(t as SourceType)}>
        <Form.Dropdown.Item value="onedev" title="OneDev Repository" icon={Icon.Code} />
        <Form.Dropdown.Item value="http" title="HTTPS URL (raw file)" icon={Icon.Globe} />
        <Form.Dropdown.Item value="file" title="File or Folder (local / network share)" icon={Icon.Folder} />
      </Form.Dropdown>
      <Form.Checkbox id="enabled" label="Enabled" defaultValue={source?.enabled ?? true} />
      <Form.Separator />
      {type === "onedev" && (
        <>
          <Form.TextField
            id="serverUrl"
            title="Server URL"
            placeholder="https://onedev.example.com"
            defaultValue={source?.serverUrl}
          />
          <Form.TextField
            id="project"
            title="Project Path"
            placeholder="team/ssh-sessions"
            defaultValue={source?.project}
          />
          <Form.TextField id="branch" title="Branch" placeholder="main" defaultValue={source?.branch} />
          <Form.TextField
            id="path"
            title="File or Folder"
            placeholder="hosts.conf, or a folder with *.conf (empty = repo root)"
            defaultValue={source?.path}
          />
          <Form.PasswordField
            id="token"
            title="Access Token"
            placeholder="OneDev → My Account → Access Tokens"
            defaultValue={source?.token}
          />
          <Form.Description text="Read access to the repository is enough. Only the branch head is checked on each sync; files are downloaded only when a new commit exists." />
        </>
      )}
      {type === "http" && (
        <>
          <Form.TextField
            id="url"
            title="URL"
            placeholder="https://git.example.com/raw/hosts.conf"
            defaultValue={source?.url}
          />
          <Form.TextField
            id="headerName"
            title="Auth Header"
            placeholder="optional, e.g. Authorization"
            defaultValue={source?.headerName}
          />
          <Form.PasswordField
            id="headerValue"
            title="Header Value"
            placeholder="optional, e.g. Bearer …"
            defaultValue={source?.headerValue}
          />
          <Form.Description text="Uses ETag / Last-Modified, so unchanged files are not downloaded again." />
        </>
      )}
      {type === "file" && (
        <>
          <Form.TextField
            id="path"
            title="Path"
            placeholder={
              process.platform === "win32"
                ? "\\\\server\\share\\ssh\\hosts.conf or a folder"
                : "/Volumes/share/ssh or a file"
            }
            defaultValue={source?.path}
          />
          <Form.Description text="A file, or a folder whose *.conf files are combined. Only re-read when a file changed." />
        </>
      )}
    </Form>
  );
}

function DefaultsForm({
  initial,
  onDone,
}: {
  initial?: { user: string; identityFile: string; extra: string };
  onDone: () => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Personal Defaults"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={async (v: { user: string; identityFile: string; extra: string }) => {
              await writeDefaults(v.user, v.identityFile, v.extra);
              if (!(await isIntegrated())) await integrate();
              await showToast({ style: Toast.Style.Success, title: "Defaults saved" });
              onDone();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Applies to every host that does not set its own value – team hosts with a fixed user or jump host keep theirs. Stored only on this computer (~/.ssh/config.d/raycast-defaults.conf)." />
      <Form.TextField id="user" title="Default User" placeholder="your login, e.g. jdoe" defaultValue={initial?.user} />
      <Form.TextField
        id="identityFile"
        title="Identity File"
        placeholder="~/.ssh/id_ed25519 (optional – the ssh-agent is used otherwise)"
        defaultValue={initial?.identityFile}
      />
      <Form.TextArea
        id="extra"
        title="Further Options"
        placeholder={"ServerAliveInterval 30\nAddKeysToAgent yes"}
        defaultValue={initial?.extra}
      />
    </Form>
  );
}

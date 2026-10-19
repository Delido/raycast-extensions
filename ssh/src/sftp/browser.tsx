import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Detail,
  Form,
  Icon,
  Keyboard,
  List,
  showInFinder,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReactNode, useEffect, useRef, useState } from "react";
import { openSession } from "../lib/terminal";
import { isCancelled, openSftp, SftpSession } from "./connection";
import {
  download,
  formatSize,
  joinPath,
  list,
  mkdir,
  parentPath,
  readHead,
  realpath,
  remove,
  RemoteEntry,
  rename,
  rmdir,
  upload,
} from "./ops";
import { ResolvedHost } from "./resolve";

type Phase =
  | { kind: "connecting"; text: string }
  | { kind: "secret"; hop: ResolvedHost; prompt: string; resolve: (v: string | undefined) => void }
  | {
      kind: "hostkey";
      hop: ResolvedHost;
      info: { fingerprint: string; type: string };
      resolve: (v: "save" | "once" | "cancel") => void;
    }
  | { kind: "error"; message: string }
  | { kind: "ready"; session: SftpSession; home: string };

/** Graphical SFTP browser for one host. The connection lives as long as this view is open. */
export function SftpBrowser({ alias }: { alias: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting", text: "Starting…" });
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<SftpSession | undefined>(undefined);
  const pendingRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setPhase({ kind: "connecting", text: "Starting…" });
    openSftp(alias, {
      status: (text) => alive && setPhase({ kind: "connecting", text }),
      askSecret: (hop, prompt) =>
        new Promise((resolve) => {
          pendingRef.current = () => resolve(undefined);
          setPhase({ kind: "secret", hop, prompt, resolve });
        }),
      confirmHostKey: (hop, info) =>
        new Promise((resolve) => {
          pendingRef.current = () => resolve("cancel");
          setPhase({ kind: "hostkey", hop, info, resolve });
        }),
    })
      .then(async (session) => {
        if (!alive) return session.close();
        sessionRef.current = session;
        const home = await realpath(session.sftp, ".").catch(() => "/");
        setPhase({ kind: "ready", session, home });
      })
      .catch((error) => {
        if (alive) setPhase({ kind: "error", message: isCancelled(error) ? "Cancelled" : (error as Error).message });
      });
    return () => {
      alive = false;
      pendingRef.current?.();
      sessionRef.current?.close();
      sessionRef.current = undefined;
    };
  }, [alias, attempt]);

  if (phase.kind === "secret") {
    const { hop } = phase;
    return (
      <Form
        navigationTitle={`Login ${hop.label}`}
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title="Log in"
              icon={Icon.Key}
              onSubmit={(v: { secret: string }) => {
                setPhase({ kind: "connecting", text: `Authenticating at ${hop.label}…` });
                phase.resolve(v.secret);
              }}
            />
            <Action title="Cancel" icon={Icon.XMarkCircle} onAction={() => phase.resolve(undefined)} />
          </ActionPanel>
        }
      >
        <Form.Description title="Host" text={`${hop.user}@${hop.hostname}${hop.port !== 22 ? `:${hop.port}` : ""}`} />
        <Form.Description text="The password is only kept in memory for this connection and never stored." />
        <Form.PasswordField id="secret" title={phase.prompt.replace(/:\s*$/, "")} autoFocus />
      </Form>
    );
  }

  if (phase.kind === "hostkey") {
    const { hop, info } = phase;
    return (
      <Detail
        navigationTitle="Unknown Host Key"
        markdown={[
          `# Unknown host key`,
          `The authenticity of **${hop.label}** (\`${hop.knownHostsName}\`) can't be established.`,
          "",
          `| | |`,
          `|---|---|`,
          `| Key type | \`${info.type}\` |`,
          `| Fingerprint | \`${info.fingerprint}\` |`,
          "",
          "Only continue if you trust this fingerprint (same question as `ssh` asks the first time).",
        ].join("\n")}
        actions={
          <ActionPanel>
            <Action
              title="Trust and Save to Known_hosts"
              icon={Icon.CheckCircle}
              onAction={() => phase.resolve("save")}
            />
            <Action title="Trust Once" icon={Icon.Check} onAction={() => phase.resolve("once")} />
            <Action
              title="Cancel"
              icon={Icon.XMarkCircle}
              style={Action.Style.Destructive}
              onAction={() => phase.resolve("cancel")}
            />
          </ActionPanel>
        }
      />
    );
  }

  if (phase.kind === "ready") {
    return <DirectoryView alias={alias} session={phase.session} initialPath={phase.home} />;
  }

  return (
    <List isLoading={phase.kind === "connecting"} navigationTitle={`SFTP ${alias}`}>
      <List.EmptyView
        icon={phase.kind === "error" ? { source: Icon.Warning, tintColor: Color.Red } : Icon.Network}
        title={phase.kind === "error" ? "Connection failed" : phase.text}
        description={phase.kind === "error" ? phase.message : undefined}
        actions={
          phase.kind === "error" ? (
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={() => setAttempt((a) => a + 1)} />
              <Action.CopyToClipboard title="Copy Error" content={phase.message} />
            </ActionPanel>
          ) : undefined
        }
      />
    </List>
  );
}

function DirectoryView({ alias, session, initialPath }: { alias: string; session: SftpSession; initialPath: string }) {
  const [cwd, setCwd] = useState(initialPath);
  const { sftp } = session;
  const { data, isLoading, error, revalidate } = usePromise((dir: string) => list(sftp, dir), [cwd]);
  const goUp = () => setCwd(parentPath(cwd));

  const folderActions = (
    <ActionPanel.Section title={cwd}>
      <Action.Push
        title="Upload Files Here"
        icon={Icon.Upload}
        shortcut={{ macOS: { modifiers: ["cmd"], key: "u" }, Windows: { modifiers: ["ctrl"], key: "u" } }}
        target={<UploadForm sftp={sftp} dir={cwd} onDone={revalidate} />}
      />
      <Action.Push
        title="New Folder"
        icon={Icon.NewFolder}
        shortcut={Keyboard.Shortcut.Common.New}
        target={
          <NameForm
            title="New Folder"
            label="Folder name"
            onSubmit={async (name) => mkdir(sftp, joinPath(cwd, name))}
            onDone={revalidate}
          />
        }
      />
      <Action.Push
        title="Go to Path…"
        icon={Icon.ArrowRight}
        shortcut={{ macOS: { modifiers: ["cmd"], key: "g" }, Windows: { modifiers: ["ctrl"], key: "g" } }}
        target={
          <NameForm
            title="Go to Path"
            label="Path"
            initial={cwd}
            onSubmit={async (p) => setCwd(p.startsWith("/") ? p : joinPath(cwd, p))}
          />
        }
      />
      {cwd !== "/" && (
        <Action
          title="Go up"
          icon={Icon.ArrowUp}
          shortcut={{ macOS: { modifiers: ["cmd"], key: "arrowUp" }, Windows: { modifiers: ["ctrl"], key: "arrowUp" } }}
          onAction={goUp}
        />
      )}
      <Action.CopyToClipboard title="Copy Current Path" content={cwd} />
      <Action
        title="Refresh"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={revalidate}
      />
      <Action title="Open SSH Session" icon={Icon.Terminal} onAction={() => openSession(alias)} />
    </ActionPanel.Section>
  );

  return (
    <List isLoading={isLoading} navigationTitle={`${alias}:${cwd}`} searchBarPlaceholder={`Filter ${cwd}`}>
      {cwd !== "/" && (
        <List.Item
          icon={Icon.ArrowUp}
          title=".."
          subtitle={parentPath(cwd)}
          actions={
            <ActionPanel>
              <Action title="Go up" icon={Icon.ArrowUp} onAction={goUp} />
              {folderActions}
            </ActionPanel>
          }
        />
      )}
      {data?.map((entry) => (
        <EntryItem
          key={entry.path}
          entry={entry}
          sftp={sftp}
          onOpenDir={setCwd}
          onChange={revalidate}
          folderActions={folderActions}
        />
      ))}
      {error && !isLoading && (
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title={`Cannot read ${cwd}`}
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Go up" icon={Icon.ArrowUp} onAction={goUp} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

function EntryItem({
  entry,
  sftp,
  onOpenDir,
  onChange,
  folderActions,
}: {
  entry: RemoteEntry;
  sftp: SftpSession["sftp"];
  onOpenDir: (p: string) => void;
  onChange: () => void;
  folderActions: ReactNode;
}) {
  return (
    <List.Item
      icon={entry.isDir ? { source: Icon.Folder, tintColor: Color.Blue } : entry.isLink ? Icon.Link : Icon.Document}
      title={entry.name}
      accessories={[
        ...(entry.isLink ? [{ icon: Icon.Link, tooltip: "Symbolic link" }] : []),
        ...(entry.isDir ? [] : [{ text: formatSize(entry.size) }]),
        { text: entry.mode, tooltip: entry.owner },
        { date: entry.mtime, tooltip: entry.mtime.toLocaleString() },
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section title={entry.name}>
            {entry.isDir ? (
              <Action title="Open Folder" icon={Icon.Folder} onAction={() => onOpenDir(entry.path)} />
            ) : (
              <>
                <Action.Push title="Preview" icon={Icon.Eye} target={<FilePreview sftp={sftp} entry={entry} />} />
                <Action
                  title="Download to Downloads"
                  icon={Icon.Download}
                  shortcut={{ macOS: { modifiers: ["cmd"], key: "d" }, Windows: { modifiers: ["ctrl"], key: "d" } }}
                  onAction={() => downloadEntry(sftp, entry, path.join(os.homedir(), "Downloads"))}
                />
                <Action.Push
                  title="Download to…"
                  icon={Icon.Download}
                  target={<DownloadToForm sftp={sftp} entry={entry} />}
                />
              </>
            )}
            <Action.CopyToClipboard title="Copy Path" content={entry.path} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.Push
              title="Rename"
              icon={Icon.Pencil}
              shortcut={Keyboard.Shortcut.Common.Edit}
              target={
                <NameForm
                  title={`Rename ${entry.name}`}
                  label="New name"
                  initial={entry.name}
                  onSubmit={async (name) => rename(sftp, entry.path, joinPath(path.posix.dirname(entry.path), name))}
                  onDone={onChange}
                />
              }
            />
            <Action
              title="Delete"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={Keyboard.Shortcut.Common.Remove}
              onAction={async () => {
                if (
                  !(await confirmAlert({
                    title: `Delete ${entry.name}?`,
                    message: entry.isDir ? "Only empty folders can be deleted." : entry.path,
                    primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
                  }))
                )
                  return;
                try {
                  await (entry.isDir ? rmdir(sftp, entry.path) : remove(sftp, entry.path));
                  await showToast({ style: Toast.Style.Success, title: `${entry.name} deleted` });
                  onChange();
                } catch (e) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "Delete failed",
                    message: (e as Error).message,
                  });
                }
              }}
            />
          </ActionPanel.Section>
          {folderActions}
        </ActionPanel>
      }
    />
  );
}

function uniqueLocalPath(dir: string, name: string): string {
  let target = path.join(dir, name);
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`);
  return target;
}

async function downloadEntry(sftp: SftpSession["sftp"], entry: RemoteEntry, dir: string) {
  const target = uniqueLocalPath(dir, entry.name);
  const toast = await showToast({ style: Toast.Style.Animated, title: `Downloading ${entry.name}…` });
  try {
    await download(sftp, entry.path, target, (done, total) => {
      toast.message = `${formatSize(done)} / ${formatSize(total)}`;
    });
    toast.style = Toast.Style.Success;
    toast.title = `Downloaded ${entry.name}`;
    toast.message = target;
    toast.primaryAction = { title: "Show in Folder", onAction: () => showInFinder(target) };
  } catch (e) {
    fs.rmSync(target, { force: true });
    toast.style = Toast.Style.Failure;
    toast.title = "Download failed";
    toast.message = (e as Error).message;
  }
}

function DownloadToForm({ sftp, entry }: { sftp: SftpSession["sftp"]; entry: RemoteEntry }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`Download ${entry.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Download"
            icon={Icon.Download}
            onSubmit={async (v: { dir: string[] }) => {
              if (!v.dir?.[0]) return;
              pop();
              await downloadEntry(sftp, entry, v.dir[0]);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="dir"
        title="Folder"
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
      />
    </Form>
  );
}

function UploadForm({ sftp, dir, onDone }: { sftp: SftpSession["sftp"]; dir: string; onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`Upload to ${dir}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Upload"
            icon={Icon.Upload}
            onSubmit={async (v: { files: string[] }) => {
              const files = (v.files ?? []).filter((f) => fs.statSync(f).isFile());
              if (!files.length) return;
              pop();
              const toast = await showToast({
                style: Toast.Style.Animated,
                title: `Uploading ${files.length} file(s)…`,
              });
              try {
                for (const [i, file] of files.entries()) {
                  const name = path.basename(file);
                  await upload(sftp, file, joinPath(dir, name), (done, total) => {
                    toast.message = `${i + 1}/${files.length} ${name}: ${formatSize(done)} / ${formatSize(total)}`;
                  });
                }
                toast.style = Toast.Style.Success;
                toast.title = `Uploaded ${files.length} file(s)`;
                toast.message = dir;
                onDone();
              } catch (e) {
                toast.style = Toast.Style.Failure;
                toast.title = "Upload failed";
                toast.message = (e as Error).message;
                onDone();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Target" text={dir} />
      <Form.FilePicker id="files" title="Files" allowMultipleSelection canChooseDirectories={false} />
      <Form.Description text="Existing files with the same name are overwritten." />
    </Form>
  );
}

function NameForm({
  title,
  label,
  initial,
  onSubmit,
  onDone,
}: {
  title: string;
  label: string;
  initial?: string;
  onSubmit: (value: string) => Promise<unknown>;
  onDone?: () => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={title}
            icon={Icon.Check}
            onSubmit={async (v: { value: string }) => {
              const value = v.value.trim();
              if (!value) return;
              try {
                await onSubmit(value);
                onDone?.();
                pop();
              } catch (e) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: `${title} failed`,
                  message: (e as Error).message,
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="value" title={label} defaultValue={initial} autoFocus />
    </Form>
  );
}

const PREVIEW_BYTES = 256 * 1024;
const LANG: Record<string, string> = {
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  conf: "nginx",
  ini: "ini",
  xml: "xml",
  html: "html",
  js: "javascript",
  ts: "typescript",
  py: "python",
  php: "php",
  sql: "sql",
  md: "markdown",
  log: "",
  txt: "",
};

function FilePreview({ sftp, entry }: { sftp: SftpSession["sftp"]; entry: RemoteEntry }) {
  const { data, isLoading, error } = usePromise((p: string) => readHead(sftp, p, PREVIEW_BYTES), [entry.path]);
  const isBinary = data ? data.subarray(0, 8000).includes(0) : false;
  const text = data && !isBinary ? data.toString("utf8") : "";
  const lang = LANG[path.extname(entry.name).slice(1).toLowerCase()] ?? "";
  const markdown = error
    ? `**Cannot read file:** ${error.message}`
    : isBinary
      ? `_Binary file (${formatSize(entry.size)}) – download it to open._`
      : [
          entry.size > PREVIEW_BYTES
            ? `_Showing the first ${formatSize(PREVIEW_BYTES)} of ${formatSize(entry.size)}._\n`
            : "",
          "```" + lang,
          text.replace(/```/g, "ˋˋˋ"),
          "```",
        ].join("\n");
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={entry.path}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Download to Downloads"
            icon={Icon.Download}
            onAction={() => downloadEntry(sftp, entry, path.join(os.homedir(), "Downloads"))}
          />
          {text && <Action.CopyToClipboard title="Copy Content" content={text} />}
          <Action.CopyToClipboard title="Copy Path" content={entry.path} />
        </ActionPanel>
      }
    />
  );
}

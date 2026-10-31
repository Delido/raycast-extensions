import {
  Action,
  Keyboard,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Form,
  Icon,
  List,
  LocalStorage,
  popToRoot,
  showToast,
  Toast,
} from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { collect, execute, Item, markExisting, Options, plan, Result } from "./lib/rename";
import { selectedPaths } from "./lib/selection";
import { undoLast, UNDO_KEY } from "./undo-rename";

const DEFAULTS: Options = {
  search: "",
  replace: "",
  regex: false,
  matchAll: true,
  caseSensitive: false,
  applyTo: "name",
  textCase: "none",
  includeFiles: true,
  includeFolders: true,
  recursive: false,
};

const PREVIEW_ROWS = 12;

const TOKENS_HELP =
  "${} numbers the items – ${start=10,increment=5,padding=3}. Dates from the creation time: $YYYY $YY $MMMM $MMM $MM $DD $DDDD $hh $mm $ss. Random: ${rstringalnum=8} ${ruuidv4}. With regular expressions $1, $2 … insert groups. $$ is a literal $.";

export default function RenameFiles() {
  const [files, setFiles] = useState<string[]>([]);
  const [loadingSelection, setLoadingSelection] = useState(true);
  const [options, setOptions] = useCachedState<Options>("options", DEFAULTS);
  const [items, setItems] = useState<Item[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [collectError, setCollectError] = useState<string>();

  // start with the selection of File Explorer / Finder
  useEffect(() => {
    selectedPaths()
      .then((paths) => paths.length > 0 && setFiles(paths))
      .finally(() => setLoadingSelection(false));
  }, []);

  useEffect(() => {
    collect(files, options.recursive)
      .then((list) => {
        setItems(list);
        setCollectError(undefined);
      })
      .catch((e) => setCollectError(e instanceof Error ? e.message : String(e)));
  }, [files, options.recursive]);

  // an invalid regular expression is shown at the search field instead of failing
  const { planned, patternError } = useMemo(() => {
    try {
      return { planned: plan(items, options), patternError: undefined };
    } catch (e) {
      return { planned: [] as Result[], patternError: e instanceof Error ? e.message : String(e) };
    }
  }, [items, options]);
  const error = patternError ?? collectError;

  useEffect(() => {
    let cancelled = false;
    const copy = planned.map((r) => ({ ...r }));
    markExisting(copy).then(() => !cancelled && setResults(copy));
    return () => {
      cancelled = true;
    };
  }, [planned]);

  const set =
    <K extends keyof Options>(key: K) =>
    (value: Options[K]) =>
      setOptions((o) => ({ ...o, [key]: value }));
  const renames = results.filter((r) => r.status === "rename");
  const problems = results.filter((r) => r.status === "conflict" || r.status === "invalid");

  return (
    <Form
      isLoading={loadingSelection}
      navigationTitle={results.length ? `Bulk Rename · ${renames.length} of ${results.length}` : "Bulk Rename"}
      actions={
        <ActionPanel>
          <Action
            title={`Rename ${renames.length} Item${renames.length === 1 ? "" : "s"}`}
            icon={Icon.Pencil}
            onAction={() => run(results)}
          />
          <Action.Push
            title="Show Full Preview"
            icon={Icon.List}
            shortcut={{ Windows: { modifiers: ["ctrl"], key: "p" }, macOS: { modifiers: ["cmd"], key: "p" } }}
            target={<Preview results={results} />}
          />
          <Action
            title="Use Current Selection"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={async () => {
              const paths = await selectedPaths();
              if (paths.length) setFiles(paths);
              else await showToast({ style: Toast.Style.Failure, title: "Nothing selected in File Explorer" });
            }}
          />
          <Action
            title="Reset Options"
            icon={Icon.Eraser}
            shortcut={{
              Windows: { modifiers: ["ctrl", "shift"], key: "r" },
              macOS: { modifiers: ["cmd", "shift"], key: "r" },
            }}
            onAction={() => setOptions(DEFAULTS)}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="files"
        title="Files and Folders"
        allowMultipleSelection
        canChooseDirectories
        value={files}
        onChange={setFiles}
        info="Starts with the selection of File Explorer. Select files there before opening Bulk Rename, or pick them here."
      />
      <Form.TextField
        id="search"
        title="Search For"
        placeholder="Text or regular expression (empty = whole name)"
        value={options.search}
        onChange={set("search")}
        error={error}
      />
      <Form.TextField
        id="replace"
        title="Replace With"
        placeholder="e.g. Photo ${padding=3} or $YYYY-$MM-$DD $1"
        value={options.replace}
        onChange={set("replace")}
        info={TOKENS_HELP}
      />
      <Form.Checkbox id="regex" label="Use regular expressions" value={options.regex} onChange={set("regex")} />
      <Form.Checkbox id="matchAll" label="Match all occurrences" value={options.matchAll} onChange={set("matchAll")} />
      <Form.Checkbox
        id="caseSensitive"
        label="Case sensitive"
        value={options.caseSensitive}
        onChange={set("caseSensitive")}
      />
      <Form.Dropdown
        id="applyTo"
        title="Apply To"
        value={options.applyTo}
        onChange={(v) => set("applyTo")(v as Options["applyTo"])}
      >
        <Form.Dropdown.Item value="name" title="Name only" />
        <Form.Dropdown.Item value="extension" title="Extension only" />
        <Form.Dropdown.Item value="both" title="Name and extension" />
      </Form.Dropdown>
      <Form.Dropdown
        id="textCase"
        title="Text Case"
        value={options.textCase}
        onChange={(v) => set("textCase")(v as Options["textCase"])}
      >
        <Form.Dropdown.Item value="none" title="Keep" />
        <Form.Dropdown.Item value="lower" title="lowercase" />
        <Form.Dropdown.Item value="upper" title="UPPERCASE" />
        <Form.Dropdown.Item value="title" title="Title Case" />
        <Form.Dropdown.Item value="capitalize" title="Capitalize Each Word" />
      </Form.Dropdown>
      <Form.Checkbox
        id="includeFiles"
        title="Include"
        label="Files"
        value={options.includeFiles}
        onChange={set("includeFiles")}
      />
      <Form.Checkbox
        id="includeFolders"
        label="Folders"
        value={options.includeFolders}
        onChange={set("includeFolders")}
      />
      <Form.Checkbox
        id="recursive"
        label="Items inside selected folders"
        value={options.recursive}
        onChange={set("recursive")}
      />
      <Form.Separator />
      <Form.Description title="Preview" text={previewText(results)} />
      {problems.length > 0 && (
        <Form.Description
          title="Skipped"
          text={problems
            .slice(0, 6)
            .map((r) => `⚠ ${r.oldName} → ${r.newName}: ${r.reason}`)
            .join("\n")}
        />
      )}
    </Form>
  );
}

function previewText(results: Result[]): string {
  if (results.length === 0) return "Select files in File Explorer first, or pick them above.";
  const renames = results.filter((r) => r.status === "rename");
  if (renames.length === 0) return `No changes for ${results.length} item${results.length === 1 ? "" : "s"}.`;
  const lines = renames.slice(0, PREVIEW_ROWS).map((r) => `${r.oldName}  →  ${r.newName}`);
  if (renames.length > PREVIEW_ROWS) lines.push(`… ${renames.length - PREVIEW_ROWS} more (Ctrl+P shows all)`);
  return lines.join("\n");
}

async function run(results: Result[]) {
  const renames = results.filter((r) => r.status === "rename");
  if (renames.length === 0) {
    await showToast({ style: Toast.Style.Failure, title: "Nothing to rename" });
    return;
  }
  const skipped = results.filter((r) => r.status === "conflict" || r.status === "invalid").length;
  if (
    skipped > 0 &&
    !(await confirmAlert({
      title: `Rename ${renames.length} items?`,
      message: `${skipped} item${skipped === 1 ? "" : "s"} with conflicts or invalid names will be skipped.`,
      primaryAction: { title: "Rename", style: Alert.ActionStyle.Default },
    }))
  )
    return;

  const toast = await showToast({ style: Toast.Style.Animated, title: `Renaming ${renames.length} items…` });
  const { done, failed } = await execute(results);
  await LocalStorage.setItem(UNDO_KEY, JSON.stringify(done));
  toast.style = failed.length ? Toast.Style.Failure : Toast.Style.Success;
  toast.title = `Renamed ${done.length} item${done.length === 1 ? "" : "s"}`;
  toast.message = failed.length ? `${failed.length} failed: ${failed[0].error}` : undefined;
  toast.primaryAction = { title: "Undo", onAction: () => undoLast() };
  if (!failed.length) await popToRoot();
}

function Preview({ results }: { results: Result[] }) {
  const icon = (r: Result) =>
    r.status === "rename"
      ? { source: Icon.Pencil, tintColor: Color.Green }
      : r.status === "unchanged"
        ? { source: Icon.Minus, tintColor: Color.SecondaryText }
        : { source: Icon.Warning, tintColor: Color.Orange };
  return (
    <List navigationTitle="Preview" searchBarPlaceholder="Filter by name…">
      {(["rename", "conflict", "invalid", "unchanged"] as const).map((status) => {
        const rows = results.filter((r) => r.status === status);
        if (!rows.length) return null;
        const title = {
          rename: "Renamed",
          conflict: "Conflicts (skipped)",
          invalid: "Invalid (skipped)",
          unchanged: "Unchanged",
        }[status];
        return (
          <List.Section key={status} title={title} subtitle={String(rows.length)}>
            {rows.map((r) => (
              <List.Item
                key={r.item.path}
                icon={icon(r)}
                title={r.newName}
                subtitle={r.newName === r.oldName ? undefined : `was ${r.oldName}`}
                accessories={r.reason ? [{ text: r.reason }] : r.item.isDirectory ? [{ icon: Icon.Folder }] : undefined}
                actions={
                  <ActionPanel>
                    <Action title="Rename All" icon={Icon.Pencil} onAction={() => run(results)} />
                    <Action.ShowInFinder path={r.item.path} />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}

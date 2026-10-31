import { randomBytes, randomUUID } from "node:crypto";
import { readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

/*
 * The rename rules of PowerRename:
 * - search text or regular expression (JavaScript syntax, $1 … in the replacement), first or every match
 * - applied to the name, the extension or both
 * - ${} in the replacement numbers the items: ${start=10,increment=5,padding=3}
 * - date tokens from the creation time: $YYYY $YY $MMMM $MMM $MM $M $DDDD $DDD $DD $D $hh $mm $ss $fff
 * - ${rstringalnum=8} ${rstringalpha=8} ${rstringdigit=8} ${ruuidv4} for random parts
 * - text case afterwards: lower, UPPER, Title Case, Capitalize each word
 * An empty search with a replacement replaces the whole name (handy for "Photo ${padding=3}").
 */

export type ApplyTo = "name" | "extension" | "both";
export type TextCase = "none" | "lower" | "upper" | "title" | "capitalize";

export interface Options {
  search: string;
  replace: string;
  regex: boolean;
  matchAll: boolean;
  caseSensitive: boolean;
  applyTo: ApplyTo;
  textCase: TextCase;
  includeFiles: boolean;
  includeFolders: boolean;
  recursive: boolean;
}

export interface Item {
  path: string;
  isDirectory: boolean;
  created: Date;
}

export interface Result {
  item: Item;
  oldName: string;
  newName: string;
  status: "rename" | "unchanged" | "conflict" | "invalid";
  reason?: string;
}

/** The selected paths, plus everything inside selected folders when recursive. */
export async function collect(paths: string[], recursive: boolean): Promise<Item[]> {
  const items: Item[] = [];
  const seen = new Set<string>();
  const add = async (file: string) => {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const info = await stat(file);
    items.push({ path: path.resolve(file), isDirectory: info.isDirectory(), created: info.birthtime ?? info.mtime });
    if (recursive && info.isDirectory()) {
      for (const entry of await readdir(file)) await add(path.join(file, entry));
    }
  };
  for (const p of paths) await add(p);
  return items.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}

const MONTHS = (style: "long" | "short") =>
  Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleString(undefined, { month: style }));
const DAYS = (style: "long" | "short") =>
  Array.from({ length: 7 }, (_, d) => new Date(2000, 0, 2 + d).toLocaleString(undefined, { weekday: style }));

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Replaces date, counter and random tokens of the replacement for one item. */
export function expandTokens(template: string, created: Date, index: number): string {
  const date: Record<string, string> = {
    YYYY: String(created.getFullYear()),
    YY: String(created.getFullYear()).slice(-2),
    MMMM: MONTHS("long")[created.getMonth()],
    MMM: MONTHS("short")[created.getMonth()],
    MM: pad(created.getMonth() + 1),
    M: String(created.getMonth() + 1),
    DDDD: DAYS("long")[created.getDay()],
    DDD: DAYS("short")[created.getDay()],
    DD: pad(created.getDate()),
    D: String(created.getDate()),
    hh: pad(created.getHours()),
    h: String(created.getHours()),
    mm: pad(created.getMinutes()),
    m: String(created.getMinutes()),
    ss: pad(created.getSeconds()),
    s: String(created.getSeconds()),
    fff: pad(created.getMilliseconds(), 3),
  };
  return (
    template
      // $$ stays a literal $ (parked on a private-use character meanwhile)
      .replace(/\$\$/g, "")
      .replace(/\$\{([^}]*)\}/g, (_, spec: string) => token(spec, index))
      .replace(/\$(YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|hh|h|mm|m|ss|s|fff)(?![A-Za-z])/g, (_, key: string) => date[key])
      .replace(//g, "$$")
  );
}

function token(spec: string, index: number): string {
  const options = Object.fromEntries(
    spec
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split("=");
        return [k.trim().toLowerCase(), (v ?? "").trim()];
      }),
  );
  if ("ruuidv4" in options) return randomUUID();
  for (const kind of ["rstringalnum", "rstringalpha", "rstringdigit"]) {
    if (kind in options) {
      const length = Math.min(64, Math.max(1, Number(options[kind]) || 8));
      const chars = {
        rstringalnum: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        rstringalpha: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        rstringdigit: "0123456789",
      }[kind]!;
      return Array.from(randomBytes(length), (b) => chars[b % chars.length]).join("");
    }
  }
  const start = Number(options.start ?? 1) || 0;
  const increment = Number(options.increment ?? 1) || 1;
  const padding = Number(options.padding ?? 0) || 0;
  const value = start + index * increment;
  return value < 0 ? `-${String(-value).padStart(padding, "0")}` : String(value).padStart(padding, "0");
}

function applyCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case "lower":
      return text.toLocaleLowerCase();
    case "upper":
      return text.toLocaleUpperCase();
    case "title":
      return text
        .toLocaleLowerCase()
        .replace(/(^|[\s_\-.(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase());
    case "capitalize":
      return text.replace(/(^|[\s_\-.(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase());
    default:
      return text;
  }
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits "report.final.pdf" into "report.final" and "pdf"; folders and dotfiles have no extension. */
function split(name: string, isDirectory: boolean): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (isDirectory || dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

// control characters are not allowed in file names, so the pattern has to contain them
// eslint-disable-next-line no-control-regex
const INVALID = process.platform === "win32" ? /[<>:"/\\|?*\u0000-\u001f]/ : /[/\u0000]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Computes the new names (nothing is renamed yet). */
export function plan(items: Item[], options: Options): Result[] {
  let pattern: RegExp | undefined;
  if (options.search) {
    const flags = (options.matchAll ? "g" : "") + (options.caseSensitive ? "" : "i") + "u";
    pattern = new RegExp(options.regex ? options.search : escapeRegex(options.search), flags);
  }

  let index = 0;
  const results: Result[] = items
    .filter((item) => (item.isDirectory ? options.includeFolders : options.includeFiles))
    .map((item) => {
      const oldName = path.basename(item.path);
      const { stem, ext } = split(oldName, item.isDirectory);
      const part = options.applyTo === "name" ? stem : options.applyTo === "extension" ? ext : oldName;
      let next = part;
      const matches = pattern
        ? new RegExp(pattern.source, pattern.flags.replace("g", "")).test(part)
        : !!options.replace;
      if (matches) {
        const replacement = expandTokens(options.replace, item.created, index);
        if (!pattern) next = replacement;
        else if (options.regex) next = part.replace(pattern, replacement);
        else next = part.replace(pattern, () => replacement);
        index++;
      }
      next = applyCase(next, options.textCase);
      const newName =
        options.applyTo === "name"
          ? ext
            ? `${next}.${ext}`
            : next
          : options.applyTo === "extension"
            ? next
              ? `${stem}.${next}`
              : stem
            : next;
      return { item, oldName, newName, status: newName === oldName ? "unchanged" : "rename" } as Result;
    });

  // invalid names and conflicts (two items to the same name, or an existing file that is not renamed away)
  const targets = new Map<string, Result>();
  const sameName = (a: string, b: string) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  for (const r of results) {
    if (r.status !== "rename") continue;
    if (!r.newName.trim() || INVALID.test(r.newName) || /[. ]$/.test(r.newName) || RESERVED.test(r.newName)) {
      r.status = "invalid";
      r.reason = !r.newName.trim() ? "empty name" : "not allowed as a file name";
      continue;
    }
    const target = path.join(path.dirname(r.item.path), r.newName);
    const key = process.platform === "win32" ? target.toLowerCase() : target;
    const other = targets.get(key);
    if (other) {
      r.status = "conflict";
      r.reason = `same new name as ${other.oldName}`;
      continue;
    }
    targets.set(key, r);
  }
  // an unchanged item, or one outside the batch, blocking a target
  const renamedAway = new Set(results.filter((r) => r.status === "rename").map((r) => r.item.path.toLowerCase()));
  for (const r of results) {
    if (r.status !== "rename") continue;
    const target = path.join(path.dirname(r.item.path), r.newName);
    if (sameName(target, r.item.path)) continue; // case-only change
    const blocker = results.find((x) => sameName(x.item.path, target));
    if (blocker && !renamedAway.has(blocker.item.path.toLowerCase())) {
      r.status = "conflict";
      r.reason = `${blocker.oldName} exists`;
    }
  }
  return results;
}

/** Whether a file outside the batch already has the target name. */
export async function markExisting(results: Result[]) {
  const inBatch = new Set(results.map((r) => r.item.path.toLowerCase()));
  for (const r of results) {
    if (r.status !== "rename") continue;
    const target = path.join(path.dirname(r.item.path), r.newName);
    if (target.toLowerCase() === r.item.path.toLowerCase() || inBatch.has(target.toLowerCase())) continue;
    try {
      await stat(target);
      r.status = "conflict";
      r.reason = "a file with this name exists";
    } catch {
      // free
    }
  }
}

export interface Done {
  from: string;
  to: string;
}

/**
 * Renames deepest paths first, so a folder is renamed after the items inside it. Swaps within the
 * batch (a → b, b → a) go through a temporary name.
 */
export async function execute(
  results: Result[],
): Promise<{ done: Done[]; failed: { result: Result; error: string }[] }> {
  const todo = results
    .filter((r) => r.status === "rename")
    .sort((a, b) => b.item.path.split(path.sep).length - a.item.path.split(path.sep).length);
  const done: Done[] = [];
  const failed: { result: Result; error: string }[] = [];
  const temp: { from: string; tmp: string; to: string }[] = [];
  const sources = new Set(todo.map((r) => r.item.path.toLowerCase()));

  for (const r of todo) {
    const to = path.join(path.dirname(r.item.path), r.newName);
    try {
      if (sources.has(to.toLowerCase()) && to.toLowerCase() !== r.item.path.toLowerCase()) {
        const tmp = `${r.item.path}.renaming-${randomBytes(4).toString("hex")}`;
        await rename(r.item.path, tmp);
        temp.push({ from: r.item.path, tmp, to });
      } else {
        await rename(r.item.path, to);
        done.push({ from: r.item.path, to });
      }
    } catch (error) {
      failed.push({ result: r, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const t of temp) {
    try {
      await rename(t.tmp, t.to);
      done.push({ from: t.from, to: t.to });
    } catch (error) {
      await rename(t.tmp, t.from).catch(() => undefined);
      failed.push({
        result: todo.find((r) => r.item.path === t.from)!,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { done, failed };
}

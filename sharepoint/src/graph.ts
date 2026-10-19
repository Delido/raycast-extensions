import { getPreferenceValues, Keyboard } from "@raycast/api";
import { getAccessToken } from "./auth";

export type EntityType = "driveItem" | "listItem" | "site";

export interface SearchRequest {
  entityType: EntityType;
  kql: string;
  /** List item fields to return (e.g. the page title, which list item hits don't include by default). */
  fields?: string[];
  /** Client-side filter on the hit URL, for results the index classifies too broadly. */
  urlFilter?: RegExp;
}

export interface DriveItemResource {
  "@odata.type": "#microsoft.graph.driveItem";
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  createdBy?: { user?: { displayName?: string } };
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { siteId?: string; driveId?: string; sharepointIds?: { listItemUniqueId?: string } };
}

export interface SiteResource {
  "@odata.type": "#microsoft.graph.site";
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  webUrl: string;
  lastModifiedDateTime?: string;
}

export interface SearchHit {
  hitId: string;
  rank: number;
  summary?: string;
  resource: DriveItemResource | SiteResource;
}

interface SearchResponse {
  value: {
    hitsContainers: {
      hits?: SearchHit[];
      total: number;
      moreResultsAvailable: boolean;
    }[];
  }[];
}

export async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/** Runs a Microsoft Search query (KQL) against SharePoint/OneDrive content. */
export async function search(
  queryString: string,
  entityType: EntityType,
  from: number,
  size: number,
  fields?: string[],
) {
  const restriction = scopeRestriction();
  const fullQuery = restriction ? `(${queryString}) ${restriction}` : queryString;

  const body = JSON.stringify({
    requests: [
      { entityTypes: [entityType], query: { queryString: fullQuery }, from, size, ...(fields ? { fields } : {}) },
    ],
  });
  const result = await graph<SearchResponse>("search/query", { method: "POST", body });
  const container = result.value[0]?.hitsContainers[0];
  return {
    hits: container?.hits ?? [],
    total: container?.total ?? 0,
    hasMore: container?.moreResultsAvailable ?? false,
  };
}

/** "Limit Search To" accepts KQL or a plain site URL, which is turned into path:"<url>". */
function scopeRestriction(): string {
  const { scopeQuery } = getPreferenceValues<Preferences>();
  const value = scopeQuery?.trim() ?? "";
  if (/^https?:\/\//i.test(value)) return `path:"${value.replace(/\/+$/, "")}"`;
  return value;
}

const KQL_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR", "ONEAR"]);

/**
 * Microsoft Search only matches whole words. Append "*" to plain words so that
 * typing "Troublesh" already finds "Troubleshooting". KQL syntax (quotes,
 * property:value, operators, parentheses) is left untouched.
 */
export function prefixQuery(text: string): string {
  if (text.includes('"')) return text;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (KQL_OPERATORS.has(word) || /[:*()=<>]/.test(word) || word.startsWith("-")) return word;
      return `${word}*`;
    })
    .join(" ");
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(`${u.host}${u.pathname}`).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Gives list item hits (e.g. site pages) a file-like name derived from their URL. */
function normalizeHit(hit: SearchHit): SearchHit {
  const resource = hit.resource as Omit<DriveItemResource, "@odata.type"> & {
    "@odata.type": string;
    fields?: { title?: string };
  };
  if (resource["@odata.type"] !== "#microsoft.graph.listItem") return hit;
  // Pages are shown by their title; the ".aspx" suffix keeps the page icon and is stripped for display.
  let name = resource.fields?.title ? `${resource.fields.title}.aspx` : resource.name;
  if (!name) {
    try {
      name = decodeURIComponent(new URL(resource.webUrl).pathname.split("/").pop() ?? "");
    } catch {
      name = resource.webUrl;
    }
  }
  return { ...hit, resource: { ...resource, "@odata.type": "#microsoft.graph.driveItem", name } };
}

/**
 * Runs several searches in parallel (Graph allows only one entity combination per
 * request) and merges the hits, removing duplicates by URL.
 */
export async function searchMany(requests: SearchRequest[], text: string, from: number, size: number) {
  const query = prefixQuery(text);
  const results = await Promise.all(
    requests.map((r) => search([query, r.kql].filter(Boolean).join(" "), r.entityType, from, size, r.fields)),
  );

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const longest = Math.max(0, ...results.map((r) => r.hits.length));
  // Interleave so that each source contributes its best hits first.
  for (let i = 0; i < longest; i++) {
    for (const [index, result] of results.entries()) {
      const hit = result.hits[i];
      if (!hit) continue;
      const urlFilter = requests[index].urlFilter;
      if (urlFilter && !urlFilter.test(hit.resource.webUrl)) continue;
      const key = normalizeUrl(hit.resource.webUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(normalizeHit(hit));
    }
  }
  return { hits, hasMore: results.some((r) => r.hasMore) };
}

/** Converts Microsoft Search highlight markup (<c0>, <ddd/>) to plain text or Markdown. */
export function formatSummary(summary: string | undefined, markdown = false): string {
  if (!summary) return "";
  return summary
    .replace(/<c0>(.*?)<\/c0>/g, markdown ? "**$1**" : "$1")
    .replace(/<ddd\/>/g, "…")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

const OFFICE_SCHEMES: Record<string, string> = {
  doc: "ms-word",
  docx: "ms-word",
  docm: "ms-word",
  xls: "ms-excel",
  xlsx: "ms-excel",
  xlsm: "ms-excel",
  ppt: "ms-powerpoint",
  pptx: "ms-powerpoint",
  pptm: "ms-powerpoint",
  vsdx: "ms-visio",
};

/** Office URI scheme (works on Windows and macOS) to open a document in the desktop app. */
export function desktopAppUrl(name: string, webUrl: string): string | undefined {
  const scheme = OFFICE_SCHEMES[fileExtension(name)];
  return scheme ? `${scheme}:ofe|u|${webUrl}` : undefined;
}

/** Derives "Site › Library › Folder" from a SharePoint document URL. */
export function locationFromUrl(webUrl: string): string {
  try {
    const url = new URL(webUrl);
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    parts.pop(); // file name
    if (parts[0] === "sites" || parts[0] === "teams" || parts[0] === "personal") parts.shift();
    return parts.join(" › ");
  } catch {
    return "";
  }
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleString() : "";
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent): Keyboard.Shortcut {
  return { macOS: { modifiers: ["cmd"], key }, Windows: { modifiers: ["ctrl"], key } };
}

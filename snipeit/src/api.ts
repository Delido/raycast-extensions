import { Color, getPreferenceValues, Keyboard } from "@raycast/api";
import http from "node:http";
import https from "node:https";

export interface Ref {
  id: number;
  name: string;
}

export interface DateField {
  date?: string;
  datetime?: string;
  formatted?: string;
}

export interface StatusLabel {
  id: number;
  name: string;
  status_type?: string; // deployable | pending | undeployable | archived
  status_meta?: string; // deployed | deployable | pending | undeployable | archived
}

export interface AssignedTo {
  id: number;
  name?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  employee_number?: string;
  type?: "user" | "location" | "asset";
}

export interface Asset {
  id: number;
  name: string | null;
  asset_tag: string;
  serial: string | null;
  model?: Ref | null;
  model_number?: string | null;
  status_label?: StatusLabel | null;
  category?: Ref | null;
  manufacturer?: Ref | null;
  supplier?: Ref | null;
  location?: Ref | null;
  rtd_location?: Ref | null;
  company?: Ref | null;
  assigned_to?: AssignedTo | null;
  notes?: string | null;
  order_number?: string | null;
  purchase_date?: DateField | null;
  purchase_cost?: string | null;
  warranty_months?: string | null;
  warranty_expires?: DateField | null;
  eol?: string | null;
  last_audit_date?: DateField | null;
  next_audit_date?: DateField | null;
  last_checkout?: DateField | null;
  expected_checkin?: DateField | null;
  updated_at?: DateField | null;
  image?: string | null;
  custom_fields?: Record<string, { field: string; value: string | null; field_format?: string }> | [];
  available_actions?: { checkout?: boolean; checkin?: boolean; update?: boolean };
}

export interface User {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string | null;
  employee_num?: string | null;
  jobtitle?: string | null;
  phone?: string | null;
  department?: Ref | null;
  location?: Ref | null;
  company?: Ref | null;
  manager?: Ref | null;
  avatar?: string | null;
  assets_count?: number;
  licenses_count?: number;
  accessories_count?: number;
  consumables_count?: number;
  activated?: boolean;
}

export interface License {
  id: number;
  name: string;
  seats: number;
  free_seats_count: number;
  expiration_date?: DateField | null;
  termination_date?: DateField | null;
  manufacturer?: Ref | null;
  category?: Ref | null;
  license_name?: string | null;
  license_email?: string | null;
  product_key?: string | null;
  order_number?: string | null;
  notes?: string | null;
}

export interface StockItem {
  id: number;
  name: string;
  qty: number;
  remaining_qty?: number;
  remaining?: number;
  min_qty?: number | null;
  min_amt?: number | null;
  category?: Ref | null;
  manufacturer?: Ref | null;
  location?: Ref | null;
  model_number?: string | null;
  item_no?: string | null;
}

export interface Rows<T> {
  total: number;
  rows: T[];
}

export function getBaseUrl(): string {
  const { baseUrl } = getPreferenceValues<Preferences>();
  return baseUrl.trim().replace(/\/+$/, "");
}

class SnipeError extends Error {}

/**
 * Snipe-IT API client (node:https so self-signed certificates can be allowed).
 * Snipe-IT often reports errors with HTTP 200 and {"status":"error","messages":...}.
 */
export function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { apiToken, allowInsecure } = getPreferenceValues<Preferences>();
  const url = new URL(`${getBaseUrl()}/api/v1/${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const lib = url.protocol === "http:" ? http : https;

  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiToken.trim()}`,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 20000,
        // own agent: Raycast replaces the global agent, which ignores per-request TLS options
        ...(url.protocol === "https:"
          ? { agent: new https.Agent({ rejectUnauthorized: !allowInsecure }), rejectUnauthorized: !allowInsecure }
          : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            reject(
              new SnipeError(
                status === 401 || status === 403
                  ? "Unauthorized – check the API token"
                  : `Unexpected response from Snipe-IT (${status}) – is the URL correct?`,
              ),
            );
            return;
          }
          const obj = json as { status?: string; messages?: unknown; message?: string; error?: string };
          if (status < 200 || status >= 300 || obj.status === "error") {
            reject(
              new SnipeError(
                formatMessages(obj.messages ?? obj.message ?? obj.error) || `${status} ${res.statusMessage ?? ""}`,
              ),
            );
            return;
          }
          resolve(json as T);
        });
      },
    );
    req.on("timeout", () => req.destroy(new SnipeError("Request to Snipe-IT timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function formatMessages(messages: unknown): string {
  if (!messages) return "";
  if (typeof messages === "string") return messages;
  if (Array.isArray(messages)) return messages.map(formatMessages).join(", ");
  if (typeof messages === "object") {
    return Object.entries(messages as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${formatMessages(value)}`)
      .join("; ");
  }
  return String(messages);
}

export function list<T>(path: string, params: Record<string, string | number | undefined>): Promise<Rows<T>> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return request<Rows<T>>("GET", `${path}?${search}`);
}

/** Finds an asset by exact asset tag, falling back to serial number and then free-text search. */
export async function lookupAsset(query: string): Promise<Asset[]> {
  const q = query.trim();
  try {
    const asset = await request<Asset & { rows?: Asset[] }>("GET", `hardware/bytag/${encodeURIComponent(q)}`);
    if (asset.rows) {
      if (asset.rows.length) return asset.rows;
    } else if (asset.id) {
      return [asset];
    }
  } catch {
    // not a tag
  }
  try {
    const bySerial = await request<Rows<Asset>>("GET", `hardware/byserial/${encodeURIComponent(q)}`);
    if (bySerial.rows?.length) return bySerial.rows;
  } catch {
    // not a serial
  }
  return (await list<Asset>("hardware", { search: q, limit: 50 })).rows;
}

export function checkoutAsset(
  assetId: number,
  target: { type: "user" | "location"; id: number },
  note: string,
  expectedCheckin?: Date | null,
) {
  return request("POST", `hardware/${assetId}/checkout`, {
    checkout_to_type: target.type,
    ...(target.type === "user" ? { assigned_user: target.id } : { assigned_location: target.id }),
    note,
    ...(expectedCheckin ? { expected_checkin: expectedCheckin.toISOString().slice(0, 10) } : {}),
  });
}

export function checkinAsset(assetId: number, note: string) {
  return request("POST", `hardware/${assetId}/checkin`, { note });
}

/** Snipe-IT returns HTML-escaped strings. */
export function decode(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function assetTitle(asset: Asset): string {
  return decode(asset.name) || decode(asset.model?.name) || asset.asset_tag;
}

export function assignedName(assigned?: AssignedTo | null): string {
  if (!assigned) return "";
  return (
    decode(assigned.name) ||
    [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") ||
    assigned.username ||
    ""
  );
}

export function webUrl(kind: "hardware" | "users" | "licenses" | "accessories" | "consumables", id: number): string {
  return `${getBaseUrl()}/${kind}/${id}`;
}

/** Colour for a status label based on its meta type. */
export function statusColor(status?: StatusLabel | null): Color {
  switch (status?.status_meta ?? status?.status_type) {
    case "deployed":
      return Color.Blue;
    case "deployable":
      return Color.Green;
    case "pending":
      return Color.Yellow;
    case "undeployable":
      return Color.Red;
    case "archived":
      return Color.SecondaryText;
    default:
      return Color.PrimaryText;
  }
}

export function statusText(asset: Asset): string {
  const label = decode(asset.status_label?.name);
  const meta = asset.status_label?.status_meta;
  return meta === "deployed" && asset.assigned_to ? `${label} → ${assignedName(asset.assigned_to)}` : label;
}

export function dateText(value?: DateField | null): string {
  return value?.formatted ?? value?.date ?? "";
}

export function toDate(value?: DateField | null): Date | undefined {
  const raw = value?.datetime ?? value?.date;
  if (!raw) return undefined;
  const date = new Date(raw);
  return isNaN(date.getTime()) ? undefined : date;
}

export function remaining(item: StockItem): number {
  return item.remaining_qty ?? item.remaining ?? item.qty;
}

export function minimum(item: StockItem): number {
  return Number(item.min_qty ?? item.min_amt ?? 0);
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut {
  return {
    macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
    Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
  };
}

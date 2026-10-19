import { getPreferenceValues, Keyboard } from "@raycast/api";
import http from "node:http";
import https from "node:https";

export type HostState = 0 | 1 | 2;
export type ServiceState = 0 | 1 | 2 | 3;

export interface Host {
  name: string;
  alias: string;
  address: string;
  state: HostState;
  has_been_checked: number;
  plugin_output: string;
  last_state_change: number;
  acknowledged: number;
  scheduled_downtime_depth: number;
  num_services_ok: number;
  num_services_warn: number;
  num_services_crit: number;
  num_services_unknown: number;
}

export interface Service {
  host_name: string;
  description: string;
  state: ServiceState;
  has_been_checked: number;
  plugin_output: string;
  long_plugin_output: string;
  last_state_change: number;
  last_check: number;
  acknowledged: number;
  scheduled_downtime_depth: number;
}

export const HOST_COLUMNS = [
  "name",
  "alias",
  "address",
  "state",
  "has_been_checked",
  "plugin_output",
  "last_state_change",
  "acknowledged",
  "scheduled_downtime_depth",
  "num_services_ok",
  "num_services_warn",
  "num_services_crit",
  "num_services_unknown",
];

export const SERVICE_COLUMNS = [
  "host_name",
  "description",
  "state",
  "has_been_checked",
  "plugin_output",
  "long_plugin_output",
  "last_state_change",
  "last_check",
  "acknowledged",
  "scheduled_downtime_depth",
];

/** Livestatus query expression as used by the Checkmk REST API. */
export type Query =
  { op: string; left: string; right: string } | { op: "and" | "or"; expr: Query[] } | { op: "not"; expr: Query };

export function getSiteUrl(): string {
  const { siteUrl } = getPreferenceValues<Preferences>();
  return siteUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/check_mk$/, "");
}

class CheckmkError extends Error {}

/** Minimal HTTP client (node:https) so that self-signed certificates can be allowed. */
function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { username, secret, allowInsecure } = getPreferenceValues<Preferences>();
  const url = new URL(`${getSiteUrl()}/check_mk/api/1.0/${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const lib = url.protocol === "http:" ? http : https;

  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${username.trim()} ${secret.trim()}`,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 20000,
        ...(url.protocol === "https:" && allowInsecure ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            let message = `${status} ${res.statusMessage ?? ""}`.trim();
            try {
              const err = JSON.parse(text) as { title?: string; detail?: string };
              message = [err.title, err.detail].filter(Boolean).join(": ") || message;
            } catch {
              // not JSON
            }
            reject(new CheckmkError(message));
            return;
          }
          try {
            resolve((text ? JSON.parse(text) : {}) as T);
          } catch {
            reject(new CheckmkError("Unexpected response from Checkmk – is the site URL correct?"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new CheckmkError("Request to Checkmk timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

interface Collection<T> {
  value: { extensions: T }[];
}

async function collection<T>(domainType: "host" | "service", columns: string[], query?: Query): Promise<T[]> {
  const params = new URLSearchParams();
  for (const column of columns) params.append("columns", column);
  if (query) params.set("query", JSON.stringify(query));
  const result = await request<Collection<T>>("GET", `domain-types/${domainType}/collections/all?${params}`);
  return result.value.map((item) => item.extensions);
}

export function getHosts(query?: Query) {
  return collection<Host>("host", HOST_COLUMNS, query);
}

export function getServices(query?: Query) {
  return collection<Service>("service", SERVICE_COLUMNS, query);
}

export function acknowledgeHost(hostName: string, comment: string) {
  return request("POST", "domain-types/acknowledge/collections/host", {
    acknowledge_type: "host",
    host_name: hostName,
    comment,
    sticky: true,
    persistent: false,
    notify: false,
  });
}

export function acknowledgeService(hostName: string, description: string, comment: string) {
  return request("POST", "domain-types/acknowledge/collections/service", {
    acknowledge_type: "service",
    host_name: hostName,
    service_description: description,
    comment,
    sticky: true,
    persistent: false,
    notify: false,
  });
}

export function scheduleDowntime(hostName: string, description: string | undefined, minutes: number, comment: string) {
  const start = new Date();
  const end = new Date(start.getTime() + minutes * 60_000);
  const times = { start_time: start.toISOString(), end_time: end.toISOString(), comment };
  return description
    ? request("POST", "domain-types/downtime/collections/service", {
        downtime_type: "service",
        host_name: hostName,
        service_descriptions: [description],
        ...times,
      })
    : request("POST", "domain-types/downtime/collections/host", {
        downtime_type: "host",
        host_name: hostName,
        ...times,
      });
}

/** Escapes a user search string for use in a Livestatus regular expression. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hostUrl(hostName: string): string {
  const target = `view.py?view_name=host&host=${encodeURIComponent(hostName)}`;
  return `${getSiteUrl()}/check_mk/index.py?start_url=${encodeURIComponent(target)}`;
}

export function serviceUrl(hostName: string, description: string): string {
  const target = `view.py?view_name=service&host=${encodeURIComponent(hostName)}&service=${encodeURIComponent(description)}`;
  return `${getSiteUrl()}/check_mk/index.py?start_url=${encodeURIComponent(target)}`;
}

export function isHandled(item: { acknowledged: number; scheduled_downtime_depth: number }): boolean {
  return item.acknowledged > 0 || item.scheduled_downtime_depth > 0;
}

export function formatAge(epochSeconds: number): string {
  if (!epochSeconds) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent): Keyboard.Shortcut {
  return { macOS: { modifiers: ["cmd"], key }, Windows: { modifiers: ["ctrl"], key } };
}

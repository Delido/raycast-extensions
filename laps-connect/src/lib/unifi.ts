import { getPreferenceValues } from "@raycast/api";
import https from "node:https";
import { getSecret } from "./vault";

export interface WireGuardUser {
  id: string;
  name: string;
  ip: string;
  network: string;
  online?: boolean;
}

/** GET against the UniFi gateway with the API key from the unlocked vault. */
async function get<T>(path: string): Promise<T> {
  return request<T>(path, await getSecret());
}

/** Checks an API key before it is stored (setup). */
export async function verifyUnifiKey(apiKey: string): Promise<void> {
  await request("/proxy/network/api/s/default/rest/networkconf", apiKey);
}

/** node:https so a self-signed certificate can be allowed. */
function request<T>(path: string, apiKey: string): Promise<T> {
  const { unifiUrl, unifiInsecure } = getPreferenceValues<Preferences>();
  const insecure = unifiInsecure !== false; // default on
  const base = /^https?:\/\//.test(unifiUrl.trim()) ? unifiUrl.trim() : `https://${unifiUrl.trim()}`;
  const url = new URL(`${base.replace(/\/+$/, "")}${path}`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: { "X-API-KEY": apiKey.trim(), Accept: "application/json" },
        // own agent: Raycast replaces the global agent, which ignores per-request TLS options
        agent: new https.Agent({ rejectUnauthorized: !insecure, keepAlive: false }),
        rejectUnauthorized: !insecure,
        timeout: 15_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 300) {
            reject(
              new Error(
                res.statusCode === 401 || res.statusCode === 403
                  ? "UniFi: API key rejected"
                  : `UniFi ${res.statusCode} for ${path}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error("UniFi: unexpected response (is the URL correct?)"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("UniFi: request timed out")));
    req.on("error", (e) => reject(new Error(`UniFi: ${e.message}`)));
    req.end();
  });
}

const rows = <T>(json: unknown): T[] =>
  (Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown })?.data)
      ? (json as { data: T[] }).data
      : []) as T[];

/**
 * WireGuard users from the (undocumented) v2 API of UniFi Network, with their fixed tunnel IP.
 * The WireGuard server network(s) are discovered from the network configuration.
 */
export async function getWireGuardUsers(): Promise<WireGuardUser[]> {
  const networks = rows<{ _id: string; name: string; vpn_type?: string; purpose?: string }>(
    await get("/proxy/network/api/s/default/rest/networkconf"),
  ).filter((n) => /wireguard/i.test(`${n.vpn_type ?? ""} ${n.purpose ?? ""}`) && !/client/i.test(n.vpn_type ?? ""));
  if (!networks.length) throw new Error("UniFi: no WireGuard server network found");

  const users: WireGuardUser[] = [];
  for (const net of networks) {
    const list = rows<{ _id: string; name: string; interface_ip: string }>(
      await get(`/proxy/network/v2/api/site/default/wireguard/${net._id}/users?networkId=${net._id}`),
    );
    if (!list.length && !users.length)
      throw new Error("UniFi: WireGuard user list is empty or the API changed (v2 wireguard/users)");
    for (const u of list) {
      if (u.name && u.interface_ip) users.push({ id: u._id, name: u.name, ip: u.interface_ip, network: net.name });
    }
  }

  // Active VPN peers (legacy stat API, one row per connected peer). If it fails, the status stays unknown.
  try {
    const peers = rows<{ user?: string; tunnel_ip?: string; up?: boolean; vpn_type?: string }>(
      await get("/proxy/network/api/s/default/stat/remoteuservpn"),
    ).filter((p) => p.up !== false && /wireguard/i.test(p.vpn_type ?? "wireguard"));
    const names = new Set(peers.map((p) => (p.user ?? "").toLowerCase()));
    const ips = new Set(peers.map((p) => p.tunnel_ip));
    for (const u of users) u.online = names.has(u.name.toLowerCase()) || ips.has(u.ip);
  } catch {
    // leave undefined
  }
  return users;
}

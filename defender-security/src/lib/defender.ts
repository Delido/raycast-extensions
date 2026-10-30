import { Credentials } from "./vault";

const TOKEN_SCOPE = "https://api.securitycenter.microsoft.com/.default";
export const DEFAULT_API_BASE = "https://api.security.microsoft.com";

export type Log = (line: string) => void;

export async function getToken(creds: Credentials): Promise<string> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: TOKEN_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    // Erste Zeile der Fehlerbeschreibung genügt, z. B. "AADSTS7000215: Invalid client secret provided."
    const msg = (json.error_description || json.error || res.statusText).split(/\r?\n/)[0];
    throw new Error(`Anmeldung fehlgeschlagen (${res.status}): ${msg}`);
  }
  return json.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Holt alle Seiten eines Endpunkts und reicht jede Seite an onPage weiter, damit große Exporte
 * nicht komplett im Speicher liegen. Bei optional=true wird ein Fehler nur protokolliert (Rückgabe false).
 */
export async function fetchPages(
  base: string,
  path: string,
  token: string,
  onPage: (items: unknown[]) => void,
  log: Log,
  optional = false,
): Promise<boolean> {
  let url: string | undefined = base.replace(/\/$/, "") + path;
  let total = 0;
  while (url) {
    let res: Response | undefined;
    for (let attempt = 1; ; attempt++) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
      if ((res.status === 429 || res.status >= 500) && attempt <= 5) {
        const wait = Number(res.headers.get("retry-after")) || 30 * attempt;
        log(`  API meldet ${res.status}, warte ${wait} s (Versuch ${attempt}/5) …`);
        await sleep(wait * 1000);
        continue;
      }
      break;
    }
    const json = (await res.json().catch(() => ({}))) as {
      value?: unknown[];
      "@odata.nextLink"?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg = `${res.status}: ${json.error?.message || res.statusText}`;
      if (optional) {
        log(`  ⚠ übersprungen (${msg})`);
        return false;
      }
      throw new Error(`API-Fehler bei ${path.split("?")[0]} – ${msg}`);
    }
    const items = json.value || [];
    total += items.length;
    onPage(items);
    url = json["@odata.nextLink"];
    if (url) log(`  … ${total.toLocaleString("de-DE")} Einträge`);
  }
  log(`  ${total.toLocaleString("de-DE")} Einträge`);
  return true;
}

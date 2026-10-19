import { getPreferenceValues, OAuth } from "@raycast/api";
import { OAuthService } from "@raycast/utils";
import { getSecret } from "./vault";

// Delegated only. Reading a password additionally requires an Entra role with
// microsoft.directory/deviceLocalCredentials/password/read for the signed-in admin.
const SCOPES = ["offline_access", "User.Read", "DeviceLocalCredential.Read.All"];

const client = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Microsoft Entra (LAPS)",
  providerIcon: "icon.png",
  providerId: "microsoft-laps",
  description: "Sign in with your admin account to read Windows LAPS passwords.",
});

let service: OAuthService | undefined;
let pending: Promise<string> | undefined;

function getToken(): Promise<string> {
  if (!service) {
    const { tenantId, clientId } = getPreferenceValues<Preferences>();
    const base = `https://login.microsoftonline.com/${encodeURIComponent(tenantId.trim())}/oauth2/v2.0`;
    service = new OAuthService({
      client,
      clientId: clientId.trim(),
      scope: SCOPES.join(" "),
      authorizeUrl: `${base}/authorize`,
      tokenUrl: `${base}/token`,
      bodyEncoding: "url-encoded",
    });
  }
  if (!pending) pending = service.authorize().finally(() => (pending = undefined));
  return pending;
}

export async function signOut() {
  await client.removeTokens();
}

async function graph<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // required by the deviceLocalCredentials API
      "ocp-client-name": "Raycast LAPS Connect",
      "ocp-client-version": "1.0",
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep status
    }
    if (res.status === 403) message = `No permission to read LAPS passwords (${message}). Check your Entra role.`;
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface LapsCredential {
  deviceName: string;
  deviceId: string;
  accountName: string;
  password: string;
  backupDateTime?: string;
}

/** Fetches the current LAPS password of a device by name. Every call is recorded in the Entra audit log. */
export async function getLapsPassword(deviceName: string): Promise<LapsCredential> {
  await getSecret(); // throws while LAPS Connect is locked
  const name = deviceName.replace(/'/g, "''");
  const list = await graph<{ value: { id: string; deviceName: string }[] }>(
    `directory/deviceLocalCredentials?$filter=${encodeURIComponent(`deviceName eq '${name}'`)}`,
  );
  const entry = list.value.find((d) => d.deviceName.toLowerCase() === deviceName.toLowerCase()) ?? list.value[0];
  if (!entry) throw new Error(`No LAPS password stored for ${deviceName}`);

  const detail = await graph<{
    deviceName: string;
    credentials: { accountName: string; backupDateTime?: string; passwordBase64: string }[];
  }>(`directory/deviceLocalCredentials/${entry.id}?$select=credentials,deviceName`);
  const latest = [...(detail.credentials ?? [])].sort((a, b) =>
    (b.backupDateTime ?? "").localeCompare(a.backupDateTime ?? ""),
  )[0];
  if (!latest) throw new Error(`No LAPS password stored for ${deviceName}`);
  return {
    deviceName: detail.deviceName ?? entry.deviceName,
    deviceId: entry.id,
    accountName: latest.accountName,
    password: Buffer.from(latest.passwordBase64, "base64").toString("utf8"),
    backupDateTime: latest.backupDateTime,
  };
}

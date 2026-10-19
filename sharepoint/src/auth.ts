import { getPreferenceValues, OAuth } from "@raycast/api";
import { OAuthService } from "@raycast/utils";

// Delegated, read-only permissions: results are always limited to what the signed-in user can access.
const SCOPES = ["offline_access", "User.Read", "Files.Read.All", "Sites.Read.All"];

export function getConfig() {
  const { tenantId, clientId } = getPreferenceValues<Preferences>();
  return { tenantId: tenantId?.trim() || "organizations", clientId: clientId?.trim() ?? "" };
}

export const client = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Microsoft 365",
  providerIcon: "icon.png",
  providerId: "microsoft",
  description: "Sign in with your Microsoft 365 account to search SharePoint.",
});

let service: OAuthService | undefined;

function getService() {
  if (!service) {
    const { tenantId, clientId } = getConfig();
    const base = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
    service = new OAuthService({
      client,
      clientId,
      scope: SCOPES.join(" "),
      authorizeUrl: `${base}/authorize`,
      tokenUrl: `${base}/token`,
      bodyEncoding: "url-encoded",
    });
  }
  return service;
}

let pending: Promise<string> | undefined;

/**
 * Returns a valid access token, signing in or refreshing as needed.
 * Concurrent callers share one sign-in, otherwise parallel searches would start
 * competing OAuth flows whose codes no longer match their PKCE verifiers.
 */
export function getAccessToken(): Promise<string> {
  if (!pending) {
    pending = getService()
      .authorize()
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

export async function signOut() {
  await client.removeTokens();
}

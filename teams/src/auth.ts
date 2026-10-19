import { getPreferenceValues, OAuth } from "@raycast/api";
import { OAuthService } from "@raycast/utils";

// Delegated permissions only: everything happens on behalf of the signed-in user.
const SCOPES = [
  "offline_access",
  "User.Read",
  "User.ReadBasic.All",
  "People.Read",
  "Presence.Read.All",
  "Presence.ReadWrite",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "Chat.Read",
  "Chat.Create",
  "ChatMessage.Send",
  "ChannelMessage.Read.All",
  "ChannelMessage.Send",
  "Calendars.Read",
];

export function getConfig() {
  const { tenantId, clientId } = getPreferenceValues<Preferences>();
  return { tenantId: tenantId?.trim() || "organizations", clientId: clientId?.trim() ?? "" };
}

export const client = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Microsoft Teams",
  providerIcon: "icon.png",
  providerId: "microsoft",
  description: "Sign in with your Microsoft 365 account to use Teams from Raycast.",
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
 * Concurrent callers share one sign-in so parallel requests don't start competing OAuth flows.
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

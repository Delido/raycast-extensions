import { Color, getPreferenceValues, Keyboard } from "@raycast/api";
import { getAccessToken } from "./auth";

export interface User {
  id: string;
  displayName: string;
  mail?: string | null;
  userPrincipalName?: string;
  jobTitle?: string | null;
  department?: string | null;
  officeLocation?: string | null;
  mobilePhone?: string | null;
  businessPhones?: string[];
}

export interface Presence {
  id: string;
  availability: string;
  activity: string;
  statusMessage?: { message?: { content?: string } } | null;
}

export interface Team {
  id: string;
  displayName: string;
  description?: string | null;
}

export interface Channel {
  id: string;
  displayName: string;
  description?: string | null;
  webUrl: string;
  membershipType?: string;
}

export interface ChatMember {
  displayName?: string | null;
  userId?: string;
  email?: string | null;
}

export interface Chat {
  id: string;
  topic?: string | null;
  chatType: "oneOnOne" | "group" | "meeting";
  webUrl: string;
  members?: ChatMember[];
  lastMessagePreview?: {
    createdDateTime: string;
    body?: { content?: string };
    from?: { user?: { displayName?: string } };
  } | null;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay: boolean;
  isCancelled: boolean;
  isOnlineMeeting: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string } };
  webLink: string;
}

export interface MessageHit {
  hitId: string;
  summary?: string;
  resource: {
    id: string;
    createdDateTime?: string;
    subject?: string | null;
    webLink?: string;
    chatId?: string;
    channelIdentity?: { teamId?: string; channelId?: string };
    from?: { emailAddress?: { name?: string } };
  };
}

export async function graph<T>(path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<T> {
  const token = await getAccessToken();
  const url = path.startsWith("https://") ? path : `https://graph.microsoft.com/v1.0/${path}`;
  const response = await fetch(url, {
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
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const USER_FIELDS =
  "id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,businessPhones";

type PersonResult = User & {
  scoredEmailAddresses?: { address: string }[];
  phones?: { type: string; number: string }[];
};

function fromPerson(p: PersonResult): User {
  return {
    ...p,
    mail: p.mail ?? p.scoredEmailAddresses?.[0]?.address,
    mobilePhone: p.phones?.find((ph) => ph.type === "mobile")?.number ?? null,
    businessPhones: p.phones?.filter((ph) => ph.type === "business").map((ph) => ph.number) ?? [],
  };
}

/**
 * People search: the People API (People.Read) ranks frequent contacts first and includes job
 * title, department and phones; the directory search (User.ReadBasic.All, basic fields only –
 * other fields or filters need User.Read.All) adds everyone else.
 */
export async function searchUsers(text: string): Promise<User[]> {
  const term = text.trim().replace(/"/g, "");
  const filter = "$filter=personType/subclass eq 'OrganizationUser'";
  const people = graph<{ value: PersonResult[] }>(
    term ? `me/people?$search="${encodeURIComponent(term)}"&$top=30&${filter}` : `me/people?$top=30&${filter}`,
  ).then((r) => r.value.map(fromPerson));
  if (!term) return people;

  const search = encodeURIComponent(`"displayName:${term}" OR "mail:${term}"`);
  const directory = graph<{ value: User[] }>(
    `users?$search=${search}&$select=id,displayName,mail,userPrincipalName&$top=30`,
    { headers: { ConsistencyLevel: "eventual" } },
  )
    .then((r) => r.value)
    .catch(() => [] as User[]);

  const [ranked, all] = await Promise.all([people, directory]);
  const seen = new Set(ranked.map((u) => u.id));
  return [...ranked, ...all.filter((u) => !seen.has(u.id))];
}

export async function getPresences(ids: string[]): Promise<Record<string, Presence>> {
  if (ids.length === 0) return {};
  const result = await graph<{ value: Presence[] }>("communications/getPresencesByUserId", {
    method: "POST",
    body: JSON.stringify({ ids: ids.slice(0, 650) }),
  });
  return Object.fromEntries(result.value.map((p) => [p.id, p]));
}

export async function getMe(): Promise<User> {
  return graph<User>(`me?$select=${USER_FIELDS}`);
}

/** Gets (or creates) the 1:1 chat with a user. Graph returns the existing chat if there is one. */
export async function getOneOnOneChat(userId: string): Promise<{ id: string; webUrl: string }> {
  const me = await getMe();
  return graph("chats", {
    method: "POST",
    body: JSON.stringify({
      chatType: "oneOnOne",
      members: [me.id, userId].map((id) => ({
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        roles: ["owner"],
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${id}')`,
      })),
    }),
  });
}

function messageBody(text: string) {
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  return JSON.stringify({ body: { contentType: "html", content: html } });
}

export function sendChatMessage(chatId: string, text: string) {
  return graph(`chats/${chatId}/messages`, { method: "POST", body: messageBody(text) });
}

export function sendChannelMessage(teamId: string, channelId: string, text: string) {
  return graph(`teams/${teamId}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: messageBody(text),
  });
}

export function stripHtml(html: string | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Converts search highlight markup (<c0>, <ddd/>) to plain text or Markdown. */
export function formatSummary(summary: string | undefined, markdown = false): string {
  if (!summary) return "";
  return stripHtml(summary.replace(/<c0>(.*?)<\/c0>/g, markdown ? "**$1**" : "$1").replace(/<ddd\/>/g, "…"));
}

/** Opens Teams links in the desktop app (msteams:) or browser, depending on the preference. */
export function teamsLink(url: string): string {
  const { openIn } = getPreferenceValues<Preferences>();
  if (openIn === "browser") return url;
  return url.replace(/^https:\/\/teams\.(microsoft|cloud\.microsoft)(\.com)?\//, "msteams:/");
}

export function chatWithUserLink(upn: string, message?: string) {
  const params = new URLSearchParams({ users: upn });
  if (message) params.set("message", message);
  return teamsLink(`https://teams.microsoft.com/l/chat/0/0?${params}`);
}

export function callUserLink(upn: string, video = false) {
  const params = new URLSearchParams({ users: upn });
  if (video) params.set("withVideo", "true");
  return teamsLink(`https://teams.microsoft.com/l/call/0/0?${params}`);
}

export const PRESENCE: Record<string, { label: string; color: Color }> = {
  Available: { label: "Available", color: Color.Green },
  AvailableIdle: { label: "Available (idle)", color: Color.Green },
  Busy: { label: "Busy", color: Color.Red },
  BusyIdle: { label: "Busy (idle)", color: Color.Red },
  DoNotDisturb: { label: "Do not disturb", color: Color.Red },
  BeRightBack: { label: "Be right back", color: Color.Yellow },
  Away: { label: "Away", color: Color.Yellow },
  Offline: { label: "Offline", color: Color.SecondaryText },
  PresenceUnknown: { label: "Unknown", color: Color.SecondaryText },
};

export function presenceInfo(presence?: Presence) {
  if (!presence) return undefined;
  const base = PRESENCE[presence.availability] ?? PRESENCE.PresenceUnknown;
  const activity = presence.activity && presence.activity !== presence.availability ? presence.activity : "";
  const label = activity === "InAMeeting" ? "In a meeting" : activity === "InACall" ? "In a call" : base.label;
  return { label, color: base.color };
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Cmd+key on macOS, Ctrl+key on Windows. */
export function primaryShortcut(key: Keyboard.KeyEquivalent): Keyboard.Shortcut {
  return { macOS: { modifiers: ["cmd"], key }, Windows: { modifiers: ["ctrl"], key } };
}

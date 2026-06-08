// Portal API utilities — uses portal_token (Discord JWT), separate from dashboard owner token

const BASE = "/api";

export type PortalUser = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  messageCount: number;
  lastSeen: string | null;
  nickname: string | null;
  pronouns: string | null;
  relationshipVibe: string | null;
  languageStyle: string;
  bio: string | null;
  birthday: string | null;
  emojiStyle: string;
  replyLength: string;
  topics: string[];
};

export type PortalHistoryEntry = {
  guildId: string;
  guildName: string;
  messageCount: number;
  lastMessage: string | null;
  messages: Array<{ role: string; content: string; timestamp: string }>;
};

export type PortalSettingsInput = {
  nickname?: string | null;
  pronouns?: string | null;
  relationshipVibe?: string | null;
  languageStyle?: string | null;
  bio?: string | null;
  birthday?: string | null;
  emojiStyle?: string | null;
  replyLength?: string | null;
  topics?: string[];
};

function getToken(): string {
  return localStorage.getItem("portal_token") ?? "";
}

export function setPortalToken(token: string) {
  localStorage.setItem("portal_token", token);
}

export function clearPortalToken() {
  localStorage.removeItem("portal_token");
}

export function hasPortalToken(): boolean {
  return !!localStorage.getItem("portal_token");
}

async function portalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchPortalMe(): Promise<PortalUser> {
  return portalFetch<PortalUser>("/portal/me");
}

export async function updatePortalSettings(data: PortalSettingsInput): Promise<PortalUser> {
  return portalFetch<PortalUser>("/portal/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function fetchPortalHistory(): Promise<PortalHistoryEntry[]> {
  return portalFetch<PortalHistoryEntry[]>("/portal/history");
}

export async function deletePortalHistoryGuild(guildId: string): Promise<void> {
  await portalFetch(`/portal/history/${guildId}`, { method: "DELETE" });
}

export async function deleteAllPortalHistory(): Promise<void> {
  await portalFetch("/portal/history", { method: "DELETE" });
}

export type PortalStatsServer = {
  guildId: string;
  guildName: string;
  messageCount: number;
  lastMessage: string | null;
};

export type PortalRecentMessage = {
  role: string;
  content: string;
  timestamp: string;
  guildName: string;
};

export type PortalStats = {
  servers: PortalStatsServer[];
  recentMessages: PortalRecentMessage[];
};

export async function fetchPortalStats(): Promise<PortalStats> {
  return portalFetch<PortalStats>("/portal/stats");
}

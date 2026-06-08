import { Router } from "express";
import { signPortalToken, requirePortalAuth } from "../lib/auth";
import { BotUser, ChatHistory, ServerConfig } from "../lib/models";
import { logger } from "../lib/logger";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRedirectUri(req: { get: (h: string) => string | undefined }): string {
  // Use configured override, or fall back to request host
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const host = domain ?? req.get("host") ?? "localhost";
  return `https://${host}/api/auth/discord/callback`;
}

function getFrontendBase(req: { get: (h: string) => string | undefined }): string {
  // Allow explicit override (most reliable)
  if (process.env.FRONTEND_BASE_URL) return process.env.FRONTEND_BASE_URL.replace(/\/$/, "");
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const host = domain ?? req.get("host") ?? "localhost";
  // Use BASE_PATH env var so redirect lands at the right prefix ("/dashboard" vs "/")
  const basePath = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
  return `https://${host}${basePath}`;
}

function formatPortalUser(user: InstanceType<typeof BotUser>) {
  return {
    userId: user.userId,
    username: user.username,
    avatarUrl: user.avatarUrl ?? null,
    messageCount: user.messageCount,
    lastSeen: user.lastSeen ?? null,
    nickname: user.nickname ?? null,
    pronouns: user.pronouns ?? null,
    relationshipVibe: user.relationshipVibe ?? null,
    languageStyle: user.languageStyle ?? "hinglish",
    bio: user.bio ?? null,
    birthday: user.birthday ?? null,
    emojiStyle: user.emojiStyle ?? "normal",
    replyLength: user.replyLength ?? "medium",
    topics: user.topics ?? [],
  };
}

// ─── Discord OAuth ────────────────────────────────────────────────────────────

router.get("/auth/discord", (req, res): void => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    res.status(503).json({ error: "Discord OAuth not configured. Add DISCORD_CLIENT_ID to secrets." });
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: "code",
    scope: "identify",
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get("/auth/discord/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  const frontendBase = getFrontendBase(req);

  if (!code) {
    res.redirect(`${frontendBase}/portal?error=no_code`);
    return;
  }

  try {
    const clientId = process.env.DISCORD_CLIENT_ID!;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET!;

    // Exchange code for access token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(req),
      }),
    });

    if (!tokenRes.ok) {
      let body = "";
      try { body = await tokenRes.text(); } catch { /* ignore */ }
      logger.error(
        { status: tokenRes.status, body, redirect_uri: getRedirectUri(req), clientId },
        "Discord token exchange failed — check DISCORD_CLIENT_SECRET and that the redirect URI is registered in Discord Developer Portal"
      );
      res.redirect(`${frontendBase}/portal?error=token_failed`);
      return;
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Get Discord user info
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      res.redirect(`${frontendBase}/portal?error=user_fetch_failed`);
      return;
    }

    const discordUser = (await userRes.json()) as {
      id: string;
      username: string;
      avatar: string | null;
    };

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : null;

    const token = signPortalToken({
      userId: discordUser.id,
      username: discordUser.username,
      avatarUrl,
    });

    res.redirect(`${frontendBase}/portal?token=${token}`);
  } catch (err) {
    logger.error({ err }, "Discord OAuth callback error");
    res.redirect(`${getFrontendBase(req)}/portal?error=auth_failed`);
  }
});

// ─── Portal API (Discord JWT required) ───────────────────────────────────────

router.get("/portal/me", requirePortalAuth, async (req, res): Promise<void> => {
  const { userId } = req.portalUser!;
  const user = await BotUser.findOne({ userId });
  if (!user) {
    res.status(404).json({ error: "User not found. Have you chatted with Priya yet?" });
    return;
  }
  res.json(formatPortalUser(user));
});

router.patch("/portal/settings", requirePortalAuth, async (req, res): Promise<void> => {
  const { userId } = req.portalUser!;
  const body = req.body as Record<string, unknown>;
  const { nickname, pronouns, relationshipVibe, languageStyle, bio, birthday, emojiStyle, replyLength, topics } = body as Record<string, string | string[] | null>;

  const update: Record<string, unknown> = {};
  if (nickname !== undefined) update.nickname = nickname || null;
  if (pronouns !== undefined) update.pronouns = pronouns || null;
  if (relationshipVibe !== undefined) update.relationshipVibe = relationshipVibe || null;
  if (languageStyle !== undefined) update.languageStyle = languageStyle || "hinglish";
  if (bio !== undefined) update.bio = bio || null;
  if (birthday !== undefined) update.birthday = birthday || null;
  if (emojiStyle !== undefined) update.emojiStyle = emojiStyle || "normal";
  if (replyLength !== undefined) update.replyLength = replyLength || "medium";
  if (topics !== undefined) update.topics = Array.isArray(topics) ? topics : [];

  const user = await BotUser.findOneAndUpdate(
    { userId },
    { $set: update },
    { new: true }
  );

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatPortalUser(user));
});

router.get("/portal/history", requirePortalAuth, async (req, res): Promise<void> => {
  const { userId } = req.portalUser!;
  const histories = await ChatHistory.find({ userId }).sort({ updatedAt: -1 });

  const results = await Promise.all(
    histories.map(async (h) => {
      let guildName = h.guildId === "dm" ? "Direct Messages" : h.guildId;
      if (h.guildId !== "dm") {
        const server = await ServerConfig.findOne({ guildId: h.guildId });
        if (server) guildName = server.name;
      }
      return {
        guildId: h.guildId,
        guildName,
        messageCount: h.messages.length,
        lastMessage: h.messages.at(-1)?.timestamp ?? null,
        messages: h.messages.slice(-100).map((m: { role: string; content: string; timestamp: string }) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
      };
    })
  );

  res.json(results);
});

router.delete("/portal/history/:guildId", requirePortalAuth, async (req, res): Promise<void> => {
  const { userId } = req.portalUser!;
  const { guildId } = req.params;
  await ChatHistory.updateOne({ userId, guildId }, { $set: { messages: [] } });
  res.json({ success: true, message: "Chat history cleared" });
});

router.delete("/portal/history", requirePortalAuth, async (req, res): Promise<void> => {
  const { userId } = req.portalUser!;
  await ChatHistory.updateMany({ userId }, { $set: { messages: [] } });
  res.json({ success: true, message: "All chat history cleared" });
});

router.get("/portal/stats", requirePortalAuth, async (req, res): Promise<void> => {
  const { userId } = req.portalUser!;
  const histories = await ChatHistory.find({ userId }).sort({ updatedAt: -1 });

  const servers = await Promise.all(
    histories.map(async (h) => {
      let guildName = h.guildId === "dm" ? "Direct Messages" : h.guildId;
      if (h.guildId !== "dm") {
        const server = await ServerConfig.findOne({ guildId: h.guildId });
        if (server) guildName = server.name;
      }
      const lastMsg = h.messages.at(-1);
      return {
        guildId: h.guildId,
        guildName,
        messageCount: h.messages.length,
        lastMessage: lastMsg?.timestamp ?? null,
      };
    })
  );

  // Get last 5 messages across all servers for "recent activity"
  const allMessages = histories
    .flatMap((h) => {
      const guildId = h.guildId;
      return h.messages.map((m: { role: string; content: string; timestamp: Date }) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        guildId,
      }));
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  // Resolve guild names for recent messages
  const guildNameMap: Record<string, string> = {};
  for (const s of servers) guildNameMap[s.guildId] = s.guildName;

  const recentMessages = allMessages.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    guildName: guildNameMap[m.guildId] ?? m.guildId,
  }));

  res.json({ servers, recentMessages });
});

export default router;

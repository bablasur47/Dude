import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { ServerConfig } from "../lib/models";
import { discordClient } from "../lib/bot";
import { GetServerParams, GetNsfwChannelsParams } from "@workspace/api-zod";
import { ChannelType } from "discord.js";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/servers", requireAuth, async (_req, res): Promise<void> => {
  const servers = await ServerConfig.find().sort({ totalMessages: -1 });

  // Enrich with live discord data if available
  const enriched = servers.map((s) => {
    const guild = discordClient?.guilds.cache.get(s.guildId);
    return {
      guildId: s.guildId,
      name: guild?.name ?? s.name ?? "Unknown Server",
      iconUrl: guild?.iconURL() ?? s.iconUrl ?? null,
      memberCount: guild?.memberCount ?? s.memberCount ?? 0,
      messageCount: s.totalMessages ?? 0,
      joinedAt: s.joinedAt?.toISOString() ?? new Date().toISOString(),
    };
  });

  res.json(enriched);
});

router.get("/servers/:guildId", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.guildId) ? req.params.guildId[0] : req.params.guildId;
  const params = GetServerParams.safeParse({ guildId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const server = await ServerConfig.findOne({ guildId: params.data.guildId });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const guild = discordClient?.guilds.cache.get(server.guildId);

  res.json({
    guildId: server.guildId,
    name: guild?.name ?? server.name,
    iconUrl: guild?.iconURL() ?? server.iconUrl ?? null,
    memberCount: guild?.memberCount ?? server.memberCount,
    totalMessages: server.totalMessages,
    joinedAt: server.joinedAt.toISOString(),
    nsfwChannels: server.nsfwChannels,
    activeUsers: 0,
  });
});

router.get("/servers/:guildId/channels/nsfw", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.guildId) ? req.params.guildId[0] : req.params.guildId;
  const params = GetNsfwChannelsParams.safeParse({ guildId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const server = await ServerConfig.findOne({ guildId: params.data.guildId });
  if (!server) {
    res.json([]);
    return;
  }

  const guild = discordClient?.guilds.cache.get(server.guildId);

  const channels = server.nsfwChannels.map((channelId: string) => {
    const ch = guild?.channels.cache.get(channelId);
    return {
      channelId,
      channelName: ch?.name ?? channelId,
      enabled: true,
    };
  });

  // Also include all text channels with their NSFW status
  const allChannels = guild?.channels.cache
    .filter((c) => c.type === 0)
    .map((c: { id: string; name: string }) => ({
      channelId: c.id,
      channelName: c.name,
      enabled: server.nsfwChannels.includes(c.id),
    })) ?? channels;

  res.json(allChannels);
});

router.get("/servers/:guildId/invite", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.guildId) ? req.params.guildId[0] : req.params.guildId;
  const params = GetServerParams.safeParse({ guildId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid guild ID" });
    return;
  }

  const guild = discordClient?.guilds.cache.get(params.data.guildId);
  if (!guild) {
    res.status(404).json({ error: "Guild not found in bot cache" });
    return;
  }

  try {
    // guild.members.me can be null right after bot restart — fetch it live if missing
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    const textChannel = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        me != null &&
        c.permissionsFor(me)?.has("CreateInstantInvite") === true
    );

    if (!textChannel || !("createInvite" in textChannel)) {
      res.status(403).json({ error: "No channel available to create invite — bot may need CreateInstantInvite permission" });
      return;
    }

    const invite = await (textChannel as { createInvite: (opts: object) => Promise<{ url: string }> }).createInvite({
      maxAge: 86400,
      maxUses: 1,
      unique: true,
    });

    res.json({ inviteUrl: invite.url });
  } catch (err) {
    logger.error({ err }, "Failed to create invite link");
    res.status(500).json({ error: "Failed to create invite link" });
  }
});

export default router;

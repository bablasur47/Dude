import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { discordClient, botStartTime } from "../lib/bot";
import { BotUser, ServerConfig, ChatHistory } from "../lib/models";

const router: IRouter = Router();

router.get("/bot/stats", requireAuth, async (_req, res): Promise<void> => {
  const [totalServers, totalUsers, chatDocs] = await Promise.all([
    ServerConfig.countDocuments(),
    BotUser.countDocuments(),
    ChatHistory.aggregate([
      { $unwind: "$messages" },
      { $group: { _id: null, total: { $sum: 1 } } },
    ]),
  ]);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const activeToday = await BotUser.countDocuments({ lastSeen: { $gte: oneDayAgo } });
  const totalMessages = chatDocs[0]?.total ?? 0;
  const uptime = Math.floor((Date.now() - botStartTime) / 1000);

  res.json({ totalServers, totalUsers, totalMessages, activeToday, uptime });
});

router.get("/bot/status", requireAuth, async (_req, res): Promise<void> => {
  if (!discordClient || !discordClient.isReady()) {
    res.json({
      online: false,
      username: "Priya",
      discriminator: "0000",
      avatarUrl: null,
      ping: null,
    });
    return;
  }

  const user = discordClient.user!;
  res.json({
    online: true,
    username: user.username,
    discriminator: user.discriminator,
    avatarUrl: user.displayAvatarURL(),
    ping: discordClient.ws.ping,
  });
});

export default router;

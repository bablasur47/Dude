import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { BotUser, ChatHistory } from "../lib/models";
import { GetUserParams, DeleteUserParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/users", requireAuth, async (_req, res): Promise<void> => {
  const users = await BotUser.find().sort({ messageCount: -1 }).limit(500);

  res.json(
    users.map((u) => ({
      userId: u.userId,
      username: u.username,
      discriminator: u.discriminator ?? null,
      avatarUrl: u.avatarUrl ?? null,
      messageCount: u.messageCount,
      lastSeen: u.lastSeen.toISOString(),
      servers: u.servers,
    }))
  );
});

router.get("/users/:userId", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const params = GetUserParams.safeParse({ userId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = await BotUser.findOne({ userId: params.data.userId });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const histories = await ChatHistory.find({ userId: params.data.userId });
  const allMessages = histories
    .flatMap((h) => h.messages)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 50);

  res.json({
    userId: user.userId,
    username: user.username,
    discriminator: user.discriminator ?? null,
    avatarUrl: user.avatarUrl ?? null,
    messageCount: user.messageCount,
    lastSeen: user.lastSeen.toISOString(),
    servers: user.servers,
    recentMessages: allMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
    })),
  });
});

router.delete("/users/:userId", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const params = DeleteUserParams.safeParse({ userId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await ChatHistory.deleteMany({ userId: params.data.userId });
  res.json({ success: true, message: "Chat history deleted" });
});

export default router;

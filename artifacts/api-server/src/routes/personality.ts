import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { Personality as PersonalityModel } from "../lib/models";
import { getPersonality, invalidatePersonalityCache } from "../lib/personality";
import { UpdatePersonalityBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/personality", requireAuth, async (_req, res): Promise<void> => {
  const p = await getPersonality();
  res.json({
    name: p.name,
    systemPrompt: p.systemPrompt,
    nsfwEnabled: p.nsfwEnabled,
    randomPingEnabled: p.randomPingEnabled,
    greetNewMembers: p.greetNewMembers,
    randomPingIntervalMinutes: p.randomPingIntervalMinutes,
    maxHistoryDays: p.maxHistoryDays,
    activeProvider: p.activeProvider,
  });
});

router.patch("/personality", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdatePersonalityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let p = await PersonalityModel.findOne();
  if (!p) {
    const current = await getPersonality();
    p = await PersonalityModel.findById(current._id);
  }

  Object.assign(p!, parsed.data);
  await p!.save();
  invalidatePersonalityCache();

  res.json({
    name: p!.name,
    systemPrompt: p!.systemPrompt,
    nsfwEnabled: p!.nsfwEnabled,
    randomPingEnabled: p!.randomPingEnabled,
    greetNewMembers: p!.greetNewMembers,
    randomPingIntervalMinutes: p!.randomPingIntervalMinutes,
    maxHistoryDays: p!.maxHistoryDays,
    activeProvider: p!.activeProvider,
  });
});

export default router;

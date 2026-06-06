import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { ApiKey } from "../lib/models";
import { AddApiBody, DeleteApiParams, UpdateApiParams, UpdateApiBody } from "@workspace/api-zod";

const router: IRouter = Router();

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

router.get("/apis", requireAuth, async (_req, res): Promise<void> => {
  const keys = await ApiKey.find().sort({ provider: 1, createdAt: 1 });

  res.json(
    keys.map((k) => ({
      id: (k._id as { toString(): string }).toString(),
      provider: k.provider,
      label: k.label,
      maskedKey: maskKey(k.key),
      enabled: k.enabled,
      createdAt: (k as { createdAt: Date }).createdAt.toISOString(),
      lastUsed: k.lastUsed?.toISOString() ?? null,
      errorCount: k.errorCount,
    }))
  );
});

router.post("/apis", requireAuth, async (req, res): Promise<void> => {
  const parsed = AddApiBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const key = await ApiKey.create({
    provider: parsed.data.provider,
    label: parsed.data.label,
    key: parsed.data.key,
    enabled: true,
    errorCount: 0,
  });

  res.status(201).json({
    id: (key._id as { toString(): string }).toString(),
    provider: key.provider,
    label: key.label,
    maskedKey: maskKey(key.key),
    enabled: key.enabled,
    createdAt: (key as { createdAt: Date }).createdAt.toISOString(),
    lastUsed: null,
    errorCount: 0,
  });
});

router.delete("/apis/:apiId", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.apiId) ? req.params.apiId[0] : req.params.apiId;
  const params = DeleteApiParams.safeParse({ apiId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await ApiKey.findByIdAndDelete(params.data.apiId);
  res.json({ success: true, message: null });
});

router.patch("/apis/:apiId", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.apiId) ? req.params.apiId[0] : req.params.apiId;
  const params = UpdateApiParams.safeParse({ apiId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateApiBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const key = await ApiKey.findByIdAndUpdate(
    params.data.apiId,
    { $set: parsed.data },
    { new: true }
  );

  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  res.json({
    id: (key._id as { toString(): string }).toString(),
    provider: key.provider,
    label: key.label,
    maskedKey: maskKey(key.key),
    enabled: key.enabled,
    createdAt: (key as { createdAt: Date }).createdAt.toISOString(),
    lastUsed: key.lastUsed?.toISOString() ?? null,
    errorCount: key.errorCount,
  });
});

export default router;

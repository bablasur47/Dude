import { Router, type IRouter } from "express";
import { signToken, verifyToken } from "../lib/auth";
import { LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || parsed.data.password !== expected) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const token = signToken();
  res.json({ success: true, token });
});

router.get("/auth/me", (req, res): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.json({ authenticated: false, isOwner: false });
    return;
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.json({ authenticated: false, isOwner: false });
    return;
  }
  res.json({ authenticated: true, isOwner: payload.isOwner });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ success: true });
});

export default router;

import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// ─── Type augmentation ────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      portalUser?: { userId: string; username: string; avatarUrl: string | null };
    }
  }
}

// ─── Owner dashboard auth ─────────────────────────────────────────────────────

const OWNER_SECRET = process.env.DASHBOARD_SECRET ?? "changeme";
const OWNER_ID = process.env.OWNER_DISCORD_ID ?? "";

export function signToken(): string {
  return jwt.sign({ isOwner: true, ownerId: OWNER_ID }, OWNER_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): { isOwner: boolean } | null {
  try {
    const payload = jwt.verify(token, OWNER_SECRET) as { isOwner: boolean };
    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  next();
}

// ─── Portal (Discord user) auth ───────────────────────────────────────────────

const PORTAL_SECRET = process.env.SESSION_SECRET ?? "portal-changeme";

export interface PortalTokenPayload {
  userId: string;
  username: string;
  avatarUrl: string | null;
  isPortalUser: true;
}

export function signPortalToken(data: Omit<PortalTokenPayload, "isPortalUser">): string {
  return jwt.sign({ ...data, isPortalUser: true }, PORTAL_SECRET, {
    expiresIn: "30d",
  });
}

export function verifyPortalToken(token: string): PortalTokenPayload | null {
  try {
    const payload = jwt.verify(token, PORTAL_SECRET) as PortalTokenPayload;
    if (!payload.isPortalUser) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Portal authentication required" });
    return;
  }
  const token = header.slice(7);
  const payload = verifyPortalToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired portal token" });
    return;
  }
  req.portalUser = { userId: payload.userId, username: payload.username, avatarUrl: payload.avatarUrl };
  next();
}

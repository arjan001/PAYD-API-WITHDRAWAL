import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

export const JWT_SECRET =
  process.env["JWT_SECRET"] ??
  process.env["SESSION_SECRET"] ??
  "payd-dev-secret-change-in-prod";
export const SESSION_COOKIE = "payd_session";
export const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  path: "/",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export interface SessionPayload {
  userId: number;
  email: string;
  name: string;
}

export function signToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export type AuthRequest = Request & { user: SessionPayload };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies[SESSION_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(401).json({ error: "Session expired" });
    return;
  }
  (req as AuthRequest).user = payload;
  next();
}

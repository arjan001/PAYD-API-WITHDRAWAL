import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

// JWT secret: prefer explicit JWT_SECRET, fall back to SESSION_SECRET (Replit-managed secret).
// Fail fast in production if neither is set — a missing secret means all tokens are forgeable.
const _jwtSecret =
  process.env["JWT_SECRET"] ??
  process.env["SESSION_SECRET"];

if (!_jwtSecret && process.env["NODE_ENV"] === "production") {
  throw new Error(
    "JWT_SECRET or SESSION_SECRET must be set in production. Add it as a Replit Secret.",
  );
}

export const JWT_SECRET = _jwtSecret ?? "payd-dev-only-secret-do-not-use-in-prod";

export const SESSION_COOKIE = "payd_session";

export const COOKIE_OPTS = {
  httpOnly: true,
  // Only set Secure flag in production (HTTPS). In dev the preview uses HTTP.
  secure: process.env["NODE_ENV"] === "production",
  path: "/",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
    res.status(401).json({ error: "Session expired — please log in again" });
    return;
  }
  (req as AuthRequest).user = payload;
  next();
}

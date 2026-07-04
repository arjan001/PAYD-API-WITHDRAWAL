import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

// JWT secret: SESSION_SECRET is a Replit-managed secret always present in both
// dev and production. Falls back to a dev-only string so the server can start
// locally even if the secret is not explicitly exported to the shell.
export const JWT_SECRET =
  process.env["JWT_SECRET"] ??
  process.env["SESSION_SECRET"] ??
  "payd-dev-only-not-for-production";

export const SESSION_COOKIE = "payd_session";

// Replit serves all traffic (dev preview and production) over HTTPS via its proxy.
// sameSite: "none" + secure: true is required for cookies sent through cross-origin
// iframes (Replit's preview pane).
export const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  path: "/",
  sameSite: "none" as const,
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

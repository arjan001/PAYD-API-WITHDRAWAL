import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  signToken,
  verifyToken,
  SESSION_COOKIE,
  COOKIE_OPTS,
  requireAuth,
  type AuthRequest,
} from "../middlewares/auth";

const router: IRouter = Router();

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
// Returns the currently logged-in user, or 401.
router.get("/auth/me", (req: Request, res: Response): void => {
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
  res.json({ id: payload.userId, name: payload.name, email: payload.email });
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post("/auth/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body as Record<string, unknown>;

    // Validate inputs
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing account
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [user] = await db
      .insert(usersTable)
      .values({ name: name.trim(), email: normalizedEmail, passwordHash })
      .returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email });

    if (!user) {
      res.status(500).json({ error: "Failed to create account" });
      return;
    }

    // Auto-login after registration
    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    res.status(201).json({ message: "Account created successfully", id: user.id, name: user.name, email: user.email });
  } catch (err) {
    req.log.error({ err }, "Register failed");
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as Record<string, unknown>;

    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    if (typeof password !== "string" || !password) {
      res.status(400).json({ error: "Password is required" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post("/auth/logout", (_req: Request, res: Response): void => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ message: "Logged out successfully" });
});

// ─── GET /api/auth/profile ───────────────────────────────────────────────────
// Alias for /me, requires auth middleware
router.get("/auth/profile", requireAuth, (req: Request, res: Response): void => {
  const user = (req as AuthRequest).user;
  res.json({ id: user.userId, name: user.name, email: user.email });
});

export default router;

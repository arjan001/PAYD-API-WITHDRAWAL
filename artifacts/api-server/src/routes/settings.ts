import { Router, type IRouter, type Request, type Response } from "express";
import { db, credentialsTable, ensureCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type AuthRequest } from "../middlewares/auth";
import { resolveCredentialRowForUser, getCredentialRowByUserId } from "../lib/payd";

function trimCredential(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

const router: IRouter = Router();

interface CredentialStatus {
  is_configured: boolean;
  account_username: string | null;
  payd_username: string | null;
  payd_password: string | null;
  payd_api_secret: string | null;
  is_active: boolean;
  withdrawals_enabled: boolean;
  has_api_key: boolean;
  has_password: boolean;
  has_api_secret: boolean;
}

const NOT_CONFIGURED: CredentialStatus = {
  is_configured: false,
  account_username: null,
  payd_username: null,
  payd_password: null,
  payd_api_secret: null,
  is_active: false,
  withdrawals_enabled: false,
  has_api_key: false,
  has_password: false,
  has_api_secret: false,
};

function validateInput(body: unknown): {
  payd_username: string;
  payd_password: string;
  payd_api_secret?: string | null;
  payd_account_username: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b["payd_username"] !== "string" || !b["payd_username"]) return null;
  if (typeof b["payd_password"] !== "string" || !b["payd_password"]) return null;
  if (typeof b["payd_account_username"] !== "string" || !b["payd_account_username"]) return null;
  const payd_username = trimCredential(b["payd_username"] as string);
  const payd_password = (b["payd_password"] as string).trim();
  const payd_account_username = trimCredential(b["payd_account_username"] as string);
  const payd_api_secret =
    typeof b["payd_api_secret"] === "string" && b["payd_api_secret"].trim()
      ? b["payd_api_secret"].trim()
      : null;

  if (!payd_username || !payd_password || !payd_account_username) return null;

  return { payd_username, payd_password, payd_api_secret, payd_account_username };
}

// GET /api/settings/credentials — return credentials for the logged-in user
router.get("/settings/credentials", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    let row = await resolveCredentialRowForUser(userId);

    if (row) {
      res.json({
        is_configured: true,
        account_username: row.paydAccountUsername,
        payd_username: row.paydUsername,
        payd_password: row.paydPassword,
        payd_api_secret: row.paydApiSecret,
        is_active: row.isActive,
        withdrawals_enabled: row.withdrawalsEnabled,
        has_api_key: true,
        has_password: true,
        has_api_secret: !!row.paydApiSecret,
      } satisfies CredentialStatus);
      return;
    }

    res.json(NOT_CONFIGURED);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch credential status");
    res.status(500).json({ error: "Failed to fetch credential status" });
  }
});

// POST /api/settings/credentials — upsert credentials for the logged-in user
router.post("/settings/credentials", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    const parsed = validateInput(req.body);
    if (!parsed) {
      res.status(400).json({ error: "Missing required fields: payd_username, payd_password, payd_account_username" });
      return;
    }

    await ensureCredentialsTable();

    const { payd_username, payd_password, payd_api_secret, payd_account_username } = parsed;
    const credentialPatch = {
      userId,
      paydUsername: payd_username,
      paydPassword: payd_password,
      paydApiSecret: payd_api_secret ?? null,
      paydAccountUsername: payd_account_username,
      isActive: true,
      withdrawalsEnabled: true,
      updatedAt: new Date(),
    };

    const existing = await getCredentialRowByUserId(userId);
    let saved: typeof credentialsTable.$inferSelect | undefined;

    if (existing) {
      [saved] = await db
        .update(credentialsTable)
        .set(credentialPatch)
        .where(eq(credentialsTable.userId, userId))
        .returning();
    } else {
      const insertRow = async () =>
        db.insert(credentialsTable).values(credentialPatch).returning();

      try {
        [saved] = await insertRow();
      } catch (err) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode === "23505") {
          [saved] = await insertRow();
        } else {
          throw err;
        }
      }
    }

    if (!saved) {
      res.status(500).json({ error: "Failed to save credentials" });
      return;
    }

    req.log.info({ userId, account: payd_account_username }, "Credentials saved for user");

    res.json({
      is_configured: true,
      account_username: payd_account_username,
      payd_username,
      payd_password,
      payd_api_secret: payd_api_secret ?? null,
      is_active: saved.isActive,
      withdrawals_enabled: true,
      has_api_key: true,
      has_password: true,
      has_api_secret: !!payd_api_secret,
    } satisfies CredentialStatus);
  } catch (err) {
    req.log.error({ err }, "Failed to save credentials");
    res.status(500).json({ error: "Failed to save credentials", message: String(err) });
  }
});

// PATCH /api/settings/credentials/withdrawals — toggle per-user withdrawal flag
router.patch("/settings/credentials/withdrawals", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    const body = req.body as Record<string, unknown>;
    if (typeof body["enabled"] !== "boolean") {
      res.status(400).json({ error: "Body must include { enabled: boolean }" });
      return;
    }
    const enabled = body["enabled"] as boolean;
    await ensureCredentialsTable();
    const result = await db
      .update(credentialsTable)
      .set({ withdrawalsEnabled: enabled, updatedAt: new Date() })
      .where(eq(credentialsTable.userId, userId))
      .returning();
    if (!result[0]) {
      res.status(404).json({ error: "No credentials found for this user" });
      return;
    }
    req.log.info({ userId, enabled }, "Per-user withdrawal toggle updated");
    res.json({ withdrawals_enabled: enabled });
  } catch (err) {
    req.log.error({ err }, "Failed to toggle withdrawals");
    res.status(500).json({ error: "Failed to toggle withdrawals", message: String(err) });
  }
});

// DELETE /api/settings/credentials — remove the logged-in user's credentials
router.delete("/settings/credentials", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    await ensureCredentialsTable();
    await db.delete(credentialsTable).where(eq(credentialsTable.userId, userId));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete credentials");
    res.status(500).json({ error: "Failed to delete credentials", message: String(err) });
  }
});

export default router;

import { Router, type IRouter, type Request, type Response } from "express";
import axios from "axios";
import {
  db,
  credentialsTable,
  transactionsTable,
  usersTable,
  ensureCredentialsTable,
} from "@workspace/db";
import { eq, not } from "drizzle-orm";
import { InitiatePayoutBody, InitiateP2PTransferBody } from "@workspace/api-zod";
import {
  getPaydClientForUserId,
  getCredentialRowByUserId,
  fetchAccountBalances,
  getCallbackBase,
  initiatePaydWithdrawal,
  initiatePaydP2P,
  type AccountBalance,
} from "../lib/payd";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function paydError(err: unknown): { status: number; message: string } {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 500;
    const data = err.response?.data;
    const message =
      (typeof data === "object" && data !== null && "message" in data
        ? String((data as Record<string, unknown>)["message"])
        : null) ||
      (typeof data === "object" && data !== null && "error" in data
        ? String((data as Record<string, unknown>)["error"])
        : null) ||
      (typeof data === "object" && data !== null && "error_message" in data
        ? String((data as Record<string, unknown>)["error_message"])
        : null) ||
      err.message ||
      "Unknown error";
    return { status, message };
  }
  return { status: 500, message: String(err) };
}

function balanceSummary(balances: AccountBalance[]) {
  const kes = balances.find((b) => b.currency === "KES");
  const usd = balances.find((b) => b.currency === "USD");
  return {
    kes_available: kes?.available_balance ?? 0,
    kes_ledger: kes?.ledger_balance ?? 0,
    usd_available: usd?.available_balance ?? 0,
    usd_ledger: usd?.ledger_balance ?? 0,
  };
}

function formatUser(
  r: typeof credentialsTable.$inferSelect,
  balances?: AccountBalance[] | null,
  balanceError?: string | null,
  loginUser?: { name: string; email: string } | null,
) {
  const summary = balances ? balanceSummary(balances) : null;
  return {
    primary_key: r.userId,
    id: r.id,
    user_id: r.userId,
    login_name: loginUser?.name ?? null,
    login_email: loginUser?.email ?? null,
    payd_account_username: r.paydAccountUsername,
    payd_username: r.paydUsername,
    payd_password: r.paydPassword,
    payd_api_secret: r.paydApiSecret,
    is_active: r.isActive,
    withdrawals_enabled: r.withdrawalsEnabled,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    balances: balances ?? null,
    kes_available: summary?.kes_available ?? null,
    kes_ledger: summary?.kes_ledger ?? null,
    usd_available: summary?.usd_available ?? null,
    usd_ledger: summary?.usd_ledger ?? null,
    balance_error: balanceError ?? null,
  };
}

async function fetchBalancesForUserId(userId: number) {
  const client = await getPaydClientForUserId(userId);
  if (!client) {
    return { balances: null, balanceError: "Could not build Payd client" };
  }
  try {
    const result = await fetchAccountBalances(client);
    return { balances: result.balances, balanceError: null };
  } catch (err) {
    const { message } = paydError(err);
    return { balances: null, balanceError: message };
  }
}

function parseUserIdParam(raw: string | string[] | undefined): number | null {
  const id = parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  return isNaN(id) ? null : id;
}

// GET /api/test/status — confirms admin API is public (no login)
router.get("/test/status", (_req: Request, res: Response): void => {
  res.json({ public: true, auth_required: false, panel: "/test" });
});

// GET /api/test/settings — global system settings (withdrawals always enabled now)
router.get("/test/settings", (_req: Request, res: Response): void => {
  res.json({ global_withdrawals_enabled: true });
});

// GET /api/test/credentials — all credentials keyed by user_id (fast, no Payd API)
router.get("/test/credentials", async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureCredentialsTable();
    const [rows, loginUsers] = await Promise.all([
      db.select().from(credentialsTable).orderBy(credentialsTable.userId),
      db.select().from(usersTable),
    ]);
    const userMap = new Map(loginUsers.map((u) => [u.id, u]));
    res.json(
      rows
        .filter((row) => row.userId != null)
        .map((row) => formatUser(row, null, null, userMap.get(row.userId!) ?? null)),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch credentials", message: String(err) });
  }
});

// GET /api/test/registered-users — all registered login accounts
router.get("/test/registered-users", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
    res.json(
      rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        created_at: u.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch registered users", message: String(err) });
  }
});

// GET /api/test/users — all credentials; optional live balances (?include_balances=true)
router.get("/test/users", async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureCredentialsTable();
    const rows = await db.select().from(credentialsTable).orderBy(credentialsTable.createdAt);
    const includeBalances = req.query["include_balances"] === "true";

    const loginUsers = await db.select().from(usersTable);
    const userMap = new Map(loginUsers.map((u) => [u.id, u]));

    const users = await Promise.all(
      rows
        .filter((row) => row.userId != null)
        .map(async (row) => {
          const login = userMap.get(row.userId!) ?? null;
          if (!includeBalances) return formatUser(row, null, null, login);
          const { balances, balanceError } = await fetchBalancesForUserId(row.userId!);
          return formatUser(row, balances, balanceError, login);
        }),
    );

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users", message: String(err) });
  }
});

// GET /api/test/accounts — all registered users joined with credentials (keyed by user_id)
router.get("/test/accounts", async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureCredentialsTable();
    const [loginUsers, credRows] = await Promise.all([
      db.select().from(usersTable).orderBy(usersTable.id),
      db.select().from(credentialsTable),
    ]);
    const credMap = new Map(credRows.filter((r) => r.userId != null).map((r) => [r.userId!, r]));

    res.json(
      loginUsers.map((u) => {
        const cred = credMap.get(u.id);
        return {
          user_id: u.id,
          login_name: u.name,
          login_email: u.email,
          has_credentials: !!cred,
          payd_account_username: cred?.paydAccountUsername ?? null,
          withdrawals_enabled: cred?.withdrawalsEnabled ?? false,
          is_active: cred?.isActive ?? false,
        };
      }),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch accounts", message: String(err) });
  }
});

// GET /api/test/by-user/:userId/balance — single account balance by user_id
router.get("/test/by-user/:userId/balance", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    const row = await getCredentialRowByUserId(userId);
    if (!row) { res.status(404).json({ error: "Credentials not found for this user_id" }); return; }

    const { balances, balanceError } = await fetchBalancesForUserId(userId);
    if (balanceError) {
      res.status(502).json({ error: "Failed to fetch balance", message: balanceError });
      return;
    }

    res.json({
      user_id: userId,
      payd_account_username: row.paydAccountUsername,
      balances,
      ...balanceSummary(balances ?? []),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch balance", message: String(err) });
  }
});

// GET /api/test/by-user/:userId/credentials — full credential record by user_id
router.get("/test/by-user/:userId/credentials", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    const row = await getCredentialRowByUserId(userId);
    if (!row) { res.status(404).json({ error: "Credentials not found for this user_id" }); return; }

    const [loginUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    res.json(formatUser(row, null, null, loginUser ?? null));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch credentials", message: String(err) });
  }
});

// POST /api/test/by-user/:userId/assign-credentials — copy Payd keys from another user_id
router.post("/test/by-user/:userId/assign-credentials", async (req: Request, res: Response): Promise<void> => {
  try {
    const targetUserId = parseUserIdParam(req.params["userId"]);
    if (targetUserId == null) { res.status(400).json({ error: "Invalid target user id" }); return; }

    const body = req.body as Record<string, unknown>;
    const sourceUserId =
      typeof body["source_user_id"] === "number"
        ? body["source_user_id"]
        : parseInt(String(body["source_user_id"] ?? ""), 10);
    if (isNaN(sourceUserId)) { res.status(400).json({ error: "source_user_id (number) required" }); return; }

    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId)).limit(1);
    if (!targetUser) { res.status(404).json({ error: "Target user not found" }); return; }

    const sourceRow = await getCredentialRowByUserId(sourceUserId);
    if (!sourceRow) { res.status(404).json({ error: "Source credentials not found" }); return; }

    await ensureCredentialsTable();
    const [saved] = await db
      .insert(credentialsTable)
      .values({
        userId: targetUserId,
        paydUsername: sourceRow.paydUsername,
        paydPassword: sourceRow.paydPassword,
        paydApiSecret: sourceRow.paydApiSecret,
        paydAccountUsername: sourceRow.paydAccountUsername,
        isActive: true,
        withdrawalsEnabled: true,
      })
      .onConflictDoUpdate({
        target: credentialsTable.userId,
        set: {
          paydUsername: sourceRow.paydUsername,
          paydPassword: sourceRow.paydPassword,
          paydApiSecret: sourceRow.paydApiSecret,
          paydAccountUsername: sourceRow.paydAccountUsername,
          withdrawalsEnabled: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    logger.info(
      { targetUserId, sourceUserId, account: sourceRow.paydAccountUsername },
      "Admin assigned credentials from source user to target user",
    );

    res.json(formatUser(saved, null, null, targetUser));
  } catch (err) {
    res.status(500).json({ error: "Failed to assign credentials", message: String(err) });
  }
});

// POST /api/test/by-user/:userId/payout — withdraw using credentials for this user_id
router.post("/test/by-user/:userId/payout", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    const parsed = InitiatePayoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const credRow = await getCredentialRowByUserId(userId);
    if (!credRow) {
      res.status(404).json({ error: "Credentials not found for this user_id" });
      return;
    }

    // Respect per-user withdrawal toggle
    if (!credRow.withdrawalsEnabled) {
      res.status(403).json({ error: "Withdrawals disabled", message: "Withdrawals are not enabled for this user.", success: false });
      return;
    }

    const client = await getPaydClientForUserId(userId);
    if (!client) {
      res.status(404).json({ error: "Could not build Payd client from stored credentials" });
      return;
    }

    const { phone_number, amount, currency = "KES", network_code = "MPESA", narration } = parsed.data;
    const callbackUrl = `${getCallbackBase()}/api/webhook/payd`;

    logger.info(
      {
        userId,
        account: credRow.paydAccountUsername,
        apiUser: credRow.paydUsername,
        amount,
      },
      "Admin payout using user_id credentials",
    );

    const result = await initiatePaydWithdrawal(client, {
      phone_number,
      amount,
      currency,
      network_code,
      narration: narration ?? "Admin withdrawal",
      callbackUrl,
    });

    try {
      await db.insert(transactionsTable).values({
        userId,
        reference: result.txRef ?? undefined,
        correlatorId: result.correlatorId ?? undefined,
        type: "payout",
        status: result.success ? "pending" : "failed",
        amount: String(amount),
        currency,
        phoneNumber: result.phone_number,
        narration: narration ?? "Admin withdrawal",
        channel: network_code,
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to save admin payout to DB");
    }

    if (!result.success) {
      res.status(422).json({
        success: false,
        error: "Failed to initiate payout",
        message: result.message,
        user_id: userId,
        account: result.account ?? credRow.paydAccountUsername,
        payd_account_username: credRow.paydAccountUsername,
        api_username: credRow.paydUsername,
      });
      return;
    }

    res.json({
      success: true,
      user_id: userId,
      reference: result.correlatorId ?? result.txRef ?? null,
      message: result.message,
      account: result.account ?? credRow.paydAccountUsername,
      payd_account_username: credRow.paydAccountUsername,
      api_username: credRow.paydUsername,
    });
  } catch (err) {
    const { status, message } = paydError(err);
    res.status(status).json({ error: "Failed to initiate payout", message, success: false });
  }
});

// POST /api/test/by-user/:userId/p2p — Payd-to-Payd transfer by user_id
router.post("/test/by-user/:userId/p2p", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    const parsed = InitiateP2PTransferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const credRow = await getCredentialRowByUserId(userId);
    if (!credRow) {
      res.status(404).json({ error: "Credentials not found for this user_id" });
      return;
    }

    const client = await getPaydClientForUserId(userId);
    if (!client) {
      res.status(404).json({ error: "Could not build Payd client from stored credentials" });
      return;
    }

    const { receiver_username, amount, narration, phone_number, wallet_type } = parsed.data;

    logger.info(
      {
        userId,
        sender: credRow.paydAccountUsername,
        receiver: receiver_username,
        apiUser: credRow.paydUsername,
        amount,
      },
      "Admin P2P using user_id credentials",
    );

    const result = await initiatePaydP2P(client, {
      receiver_username,
      amount,
      narration,
      phone_number,
      wallet_type,
    });

    try {
      await db.insert(transactionsTable).values({
        userId,
        reference: result.transaction_reference ?? undefined,
        type: "p2p",
        status: result.success ? "success" : "failed",
        amount: String(amount),
        currency: "KES",
        phoneNumber: result.phone_number,
        narration,
        channel: "payd",
        receiverUsername: receiver_username,
        walletType: wallet_type ?? null,
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to save admin P2P to DB");
    }

    if (!result.success) {
      res.status(422).json({
        success: false,
        error: "Failed to initiate P2P transfer",
        message: result.message,
        user_id: userId,
        account: result.account ?? credRow.paydAccountUsername,
        receiver_username: result.receiver_username,
        api_username: credRow.paydUsername,
      });
      return;
    }

    res.json({
      success: true,
      user_id: userId,
      transaction_reference: result.transaction_reference,
      message: result.message,
      account: result.account ?? credRow.paydAccountUsername,
      receiver_username: result.receiver_username,
      api_username: credRow.paydUsername,
    });
  } catch (err) {
    const { status, message } = paydError(err);
    res.status(status).json({ error: "Failed to initiate P2P transfer", message, success: false });
  }
});

// PATCH /api/test/by-user/:userId/withdrawals — toggle withdrawals_enabled by user_id
router.patch("/test/by-user/:userId/withdrawals", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    const body = req.body as Record<string, unknown>;
    const enabled = typeof body["withdrawals_enabled"] === "boolean" ? body["withdrawals_enabled"] : undefined;
    if (enabled === undefined) { res.status(400).json({ error: "withdrawals_enabled (boolean) required" }); return; }

    await ensureCredentialsTable();
    const updated = await db
      .update(credentialsTable)
      .set({ withdrawalsEnabled: enabled, updatedAt: new Date() })
      .where(eq(credentialsTable.userId, userId))
      .returning();

    if (!updated[0]) { res.status(404).json({ error: "Credentials not found for this user_id" }); return; }
    res.json(formatUser(updated[0]));
  } catch (err) {
    res.status(500).json({ error: "Failed to update withdrawals", message: String(err) });
  }
});

// PATCH /api/test/by-user/:userId/active — set as system-wide active credentials by user_id
router.patch("/test/by-user/:userId/active", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    await ensureCredentialsTable();
    await db.update(credentialsTable).set({ isActive: false }).where(not(eq(credentialsTable.userId, userId)));
    const updated = await db
      .update(credentialsTable)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(credentialsTable.userId, userId))
      .returning();

    if (!updated[0]) { res.status(404).json({ error: "Credentials not found for this user_id" }); return; }
    res.json(formatUser(updated[0]));
  } catch (err) {
    res.status(500).json({ error: "Failed to set active credentials", message: String(err) });
  }
});

// DELETE /api/test/by-user/:userId — remove credentials by user_id
router.delete("/test/by-user/:userId", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseUserIdParam(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid user id" }); return; }

    await ensureCredentialsTable();
    const deleted = await db
      .delete(credentialsTable)
      .where(eq(credentialsTable.userId, userId))
      .returning();

    if (!deleted[0]) { res.status(404).json({ error: "Credentials not found for this user_id" }); return; }
    res.json({ deleted: true, user_id: userId });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete credentials", message: String(err) });
  }
});

export default router;

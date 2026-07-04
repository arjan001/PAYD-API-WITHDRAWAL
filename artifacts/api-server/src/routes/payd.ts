import { Router, type IRouter, type Request, type Response } from "express";
import axios from "axios";
import { desc, eq, count, sum, or, and } from "drizzle-orm";
import {
  GetAccountResponse,
  GetTransactionsQueryParams,
  GetTransactionsResponse,
  InitiatePayinBody,
  InitiatePayinResponse,
  InitiatePayoutBody,
  InitiatePayoutResponse,
  GetSummaryResponse,
  InitiateMerchantPayoutBody,
  InitiateMerchantPayoutResponse,
  InitiateP2PTransferBody,
  InitiateP2PTransferResponse,
  GetTransactionStatusResponse,
} from "@workspace/api-zod";
import { db, credentialsTable, transactionsTable } from "@workspace/db";
import {
  getPaydClientForUser,
  getCredentialRowByUserId,
  getCallbackBase,
  fetchAccountBalances,
  initiatePaydWithdrawal,
  extractPaydResponseMessage,
} from "../lib/payd";
import { logger } from "../lib/logger";
import { type AuthRequest } from "../middlewares/auth";

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
      (typeof data === "object" && data !== null && "err" in data
        ? String((data as Record<string, unknown>)["err"])
        : null) ||
      (typeof data === "object" && data !== null ? extractPaydResponseMessage(data) : null) ||
      err.message ||
      "Unknown error";
    return { status, message };
  }
  return { status: 500, message: String(err) };
}

// GET /api/payd/account — fetch balances using the logged-in user's credentials
router.get("/payd/account", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    const client = await getPaydClientForUser(userId);

    if (!client) {
      res.json({
        username: null,
        email: null,
        first_name: null,
        last_name: null,
        account_id: null,
        connected: false,
        balances: [
          { currency: "KES", available_balance: 0, ledger_balance: 0 },
          { currency: "USD", available_balance: 0, ledger_balance: 0 },
        ],
      });
      return;
    }

    const username = client.accountUsername;
    const { balances } = await fetchAccountBalances(client);

    res.json(
      GetAccountResponse.parse({
        username,
        email: null,
        first_name: null,
        last_name: null,
        account_id: username,
        balances,
        connected: true,
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err, status }, "Failed to fetch Payd account");
    res.status(status).json({ error: "Failed to fetch account", message });
  }
});

// GET /api/payd/transactions — list from local DB scoped to logged-in user
router.get("/payd/transactions", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    const parsed = GetTransactionsQueryParams.safeParse(req.query);
    const page = parsed.success ? (parsed.data.page ?? 1) : 1;
    const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;
    const offset = (page - 1) * limit;

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.userId, userId))
        .orderBy(desc(transactionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: count() })
        .from(transactionsTable)
        .where(eq(transactionsTable.userId, userId)),
    ]);

    const total = Number(totalRows[0]?.value ?? 0);

    const transactions = rows.map((t) => ({
      id: String(t.id),
      type: t.type,
      amount: Number(t.amount),
      currency: t.currency,
      status: t.status,
      narration: t.narration ?? null,
      created_at: t.createdAt.toISOString(),
      reference: t.reference ?? t.correlatorId ?? null,
      channel: t.channel ?? null,
      phone_number: t.phoneNumber ?? null,
    }));

    res.json(GetTransactionsResponse.parse({ transactions, total, page, limit }));
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to fetch transactions");
    res.status(status).json({ error: "Failed to fetch transactions", message });
  }
});

// POST /api/payd/payin — M-Pesa STK push using the logged-in user's credentials
router.post("/payd/payin", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  const client = await getPaydClientForUser(userId);
  if (!client) {
    res.status(422).json({
      error: "No credentials configured",
      message: "Set up your Payd API credentials in Settings before initiating a deposit.",
    });
    return;
  }

  try {
    const parsed = InitiatePayinBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { phone_number, amount, currency = "KES", channel = "MPESA", narration } = parsed.data;
    const username = client.accountUsername;
    const callbackUrl = `${getCallbackBase()}/api/webhook/payd`;

    const rawData = await client.post<Record<string, unknown>>("/api/v2/payments", {
      username,
      channel,
      amount,
      phone_number,
      narration: narration ?? "Payment",
      currency,
      callback_url: callbackUrl,
    });

    req.log.info({ rawData }, "Payd payin response");

    const txRef = (rawData["transaction_reference"] ?? null) as string | null;
    const success = rawData["success"] !== false && rawData["status"] !== "failed";

    try {
      await db.insert(transactionsTable).values({
        userId,
        reference: txRef ?? undefined,
        type: "payin",
        status: success ? "pending" : "failed",
        amount: String(amount),
        currency,
        phoneNumber: phone_number,
        narration: narration ?? "Payment",
        channel,
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to save payin to DB");
    }

    res.json(
      InitiatePayinResponse.parse({
        success,
        reference: (rawData["transaction_reference"] ?? rawData["trackingId"] ?? null) as string | null,
        message: String(rawData["message"] ?? rawData["description"] ?? "Payin initiated"),
        transaction_reference: txRef,
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to initiate Payd payin");
    res.status(status).json({ error: "Failed to initiate payin", message });
  }
});

// POST /api/payd/payout — M-Pesa withdrawal using the logged-in user's credentials
router.post("/payd/payout", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  const client = await getPaydClientForUser(userId);
  if (!client) {
    req.log.warn({ userId }, "Payout blocked: no credentials resolved for user");
    res.status(422).json({
      error: "Credentials not configured",
      message: "No Payd credentials found for your account. Go to Settings, save your API keys, and ensure your Payd account username matches your registration.",
      success: false,
    });
    return;
  }

  try {
    const parsed = InitiatePayoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const credRow = await getCredentialRowByUserId(userId);

    const { phone_number, amount, currency = "KES", network_code = "MPESA", narration } = parsed.data;
    const callbackUrl = `${getCallbackBase(req)}/api/webhook/payd`;

    req.log.info(
      {
        userId,
        account: client.accountUsername,
        apiUsername: credRow?.paydUsername ?? null,
        amount,
        callbackUrl,
      },
      "Initiating payout with user_id credentials",
    );

    const result = await initiatePaydWithdrawal(client, {
      phone_number,
      amount,
      currency,
      network_code,
      narration: narration ?? "Withdrawal",
      callbackUrl,
    });

    req.log.info({ rawData: result.rawData, account: result.account }, "Payd payout response");

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
        narration: narration ?? "Withdrawal",
        channel: network_code,
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to save payout to DB");
    }

    if (!result.success) {
      res.status(422).json({
        error: "Failed to initiate payout",
        message: result.message,
        success: false,
        user_id: userId,
        account: result.account,
        payd_account_username: credRow?.paydAccountUsername ?? result.account,
        api_username: credRow?.paydUsername ?? null,
      });
      return;
    }

    res.json(
      InitiatePayoutResponse.parse({
        success: result.success,
        reference: (result.correlatorId ?? result.txRef ?? null) as string | null,
        message: result.message,
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to initiate Payd payout");
    res.status(status).json({ error: "Failed to initiate payout", message, success: false });
  }
});

// POST /api/payd/merchant — Pay to Paybill or Till
router.post("/payd/merchant", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  const client = await getPaydClientForUser(userId);
  if (!client) {
    res.status(422).json({
      error: "Credentials not configured",
      message: "Please set up your Payd credentials in Settings before initiating a payment.",
    });
    return;
  }

  try {
    const parsed = InitiateMerchantPayoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { amount, currency = "KES", phone_number, narration, business_account, business_number, business_type, wallet_type } = parsed.data;
    const username = client.accountUsername;
    const callbackUrl = `${getCallbackBase()}/api/webhook/payd`;

    const rawData = await client.post<Record<string, unknown>>("/api/v2/payments", {
      username,
      amount,
      currency,
      phone_number,
      narration,
      transaction_channel: "bank",
      channel: "bank",
      business_account,
      business_number: business_number ?? "0000000000000",
      callback_url: callbackUrl,
      ...(wallet_type ? { wallet_type } : {}),
    });

    req.log.info({ rawData }, "Payd merchant payout response");

    const correlatorId = (rawData["correlator_id"] ?? null) as string | null;
    const txRef = (rawData["transaction_reference"] ?? null) as string | null;
    const success = rawData["success"] !== false && rawData["status"] !== "failed";

    try {
      await db.insert(transactionsTable).values({
        userId,
        reference: txRef ?? undefined,
        correlatorId: correlatorId ?? undefined,
        type: "merchant",
        status: success ? "pending" : "failed",
        amount: String(amount),
        currency,
        phoneNumber: phone_number,
        narration,
        channel: "bank",
        businessAccount: business_account,
        businessType: business_type ?? "paybill",
        walletType: wallet_type ?? null,
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to save merchant tx to DB");
    }

    res.json(
      InitiateMerchantPayoutResponse.parse({
        success,
        correlator_id: correlatorId,
        message: String(rawData["message"] ?? rawData["description"] ?? "Merchant payment initiated"),
        status: (rawData["status"] ?? null) as string | null,
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to initiate merchant payout");
    res.status(status).json({ error: "Failed to initiate merchant payment", message });
  }
});

// POST /api/payd/p2p — Payd-to-Payd transfer
router.post("/payd/p2p", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  const client = await getPaydClientForUser(userId);
  if (!client) {
    res.status(422).json({
      error: "Credentials not configured",
      message: "Please set up your Payd credentials in Settings before initiating a transfer.",
    });
    return;
  }

  try {
    const parsed = InitiateP2PTransferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { receiver_username, amount, narration, phone_number, wallet_type } = parsed.data;

    const rawData = await client.post<Record<string, unknown>>("/api/v2/p2p", {
      receiver_username,
      amount,
      narration,
      phone_number,
      ...(wallet_type ? { wallet_type } : {}),
    });

    req.log.info({ rawData }, "Payd P2P transfer response");

    const txRef = (rawData["transaction_reference"] ?? null) as string | null;
    const success = rawData["success"] !== false;

    try {
      await db.insert(transactionsTable).values({
        userId,
        reference: txRef ?? undefined,
        type: "p2p",
        status: success ? "success" : "failed",
        amount: String(amount),
        currency: "KES",
        phoneNumber: phone_number,
        narration,
        channel: "payd",
        receiverUsername: receiver_username,
        walletType: wallet_type ?? null,
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to save P2P tx to DB");
    }

    res.json(
      InitiateP2PTransferResponse.parse({
        success,
        transaction_reference: txRef,
        message: String(rawData["message"] ?? rawData["description"] ?? "Transfer completed"),
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to initiate P2P transfer");
    res.status(status).json({ error: "Failed to initiate transfer", message });
  }
});

// GET /api/payd/tx-status/:reference
router.get("/payd/tx-status/:reference", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  const client = await getPaydClientForUser(userId);
  if (!client) {
    res.status(422).json({ error: "Credentials not configured", message: "Please set up your credentials in Settings." });
    return;
  }

  try {
    const referenceRaw = req.params["reference"];
    const reference = Array.isArray(referenceRaw) ? referenceRaw[0] : referenceRaw;
    if (!reference) {
      res.status(400).json({ error: "Transaction reference is required" });
      return;
    }

    const rawData = await client.get<Record<string, unknown>>(`/api/v1/status/${reference}`);
    req.log.debug({ rawData }, "Payd tx-status raw response");

    const details = rawData["transaction_details"] as Record<string, unknown> | undefined;
    const detailStatus = (details?.["status"] ?? null) as string | null;

    if (detailStatus === "success" || detailStatus === "failed") {
      try {
        await db
          .update(transactionsTable)
          .set({ status: detailStatus, remarks: (details?.["reason"] ?? null) as string | null })
          .where(
            and(
              eq(transactionsTable.userId, userId),
              or(
                eq(transactionsTable.reference, reference),
                eq(transactionsTable.correlatorId, reference),
              ),
            ),
          );
      } catch (dbErr) {
        logger.warn({ dbErr }, "Failed to update tx status in DB");
      }
    }

    res.json(
      GetTransactionStatusResponse.parse({
        id: String(rawData["id"] ?? reference),
        code: String(rawData["code"] ?? reference),
        currency: String(rawData["currency"] ?? "KES"),
        amount: Number(rawData["amount"] ?? 0),
        balance: Number(rawData["balance"] ?? 0),
        type: String(rawData["type"] ?? "unknown"),
        transaction_category: (rawData["transaction_category"] ?? null) as string | null,
        created_at: String(rawData["created_at"] ?? new Date().toISOString()),
        transaction_details: details
          ? {
              status: detailStatus,
              payer: (details["payer"] ?? null) as string | null,
              receiver: (details["receiver"] ?? null) as string | null,
              phone_number: (details["phone_number"] ?? null) as string | null,
              channel: (details["channel"] ?? null) as string | null,
              reason: (details["reason"] ?? null) as string | null,
              merchant_id: (details["merchant_id"] ?? null) as string | null,
              account_number: (details["account_number"] ?? null) as string | null,
              email_address: (details["email_address"] ?? null) as string | null,
            }
          : undefined,
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to fetch transaction status");
    res.status(status).json({ error: "Failed to fetch transaction status", message });
  }
});

// GET /api/payd/summary — derived from logged-in user's transactions only
router.get("/payd/summary", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthRequest).user.userId;
  try {
    const [payinStats, payoutStats, totalCount] = await Promise.all([
      db
        .select({ total: sum(transactionsTable.amount), cnt: count() })
        .from(transactionsTable)
        .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, "payin"))),
      db
        .select({ total: sum(transactionsTable.amount), cnt: count() })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.userId, userId),
            or(
              eq(transactionsTable.type, "payout"),
              eq(transactionsTable.type, "merchant"),
              eq(transactionsTable.type, "p2p"),
            ),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(transactionsTable)
        .where(eq(transactionsTable.userId, userId)),
    ]);

    res.json(
      GetSummaryResponse.parse({
        total_payin: Number(payinStats[0]?.total ?? 0),
        total_payout: Number(payoutStats[0]?.total ?? 0),
        payin_count: Number(payinStats[0]?.cnt ?? 0),
        payout_count: Number(payoutStats[0]?.cnt ?? 0),
        currency: "KES",
        recent_activity_count: Number(totalCount[0]?.cnt ?? 0),
      }),
    );
  } catch (err) {
    const { status, message } = paydError(err);
    req.log.error({ err }, "Failed to fetch Payd summary");
    res.status(status).json({ error: "Failed to fetch summary", message });
  }
});

// POST /api/webhook/payd — receive Payd transaction webhooks (public, no auth)
router.post("/webhook/payd", async (_req: Request, res: Response): Promise<void> => {
  const payload = _req.body as Record<string, unknown>;
  logger.info({ payload }, "Payd webhook received");

  const txRef = (payload["transaction_reference"] ?? null) as string | null;
  const resultCode = payload["result_code"];
  const success = resultCode === 0 || payload["success"] === true;
  const status = success ? "success" : "failed";
  const remarks = (payload["remarks"] ?? null) as string | null;
  const thirdPartyTransId = (payload["third_party_trans_id"] ?? null) as string | null;

  if (txRef) {
    try {
      await db
        .update(transactionsTable)
        .set({ status, remarks, thirdPartyTransId })
        .where(
          or(
            eq(transactionsTable.reference, txRef),
            eq(transactionsTable.correlatorId, txRef),
          ),
        );
      logger.info({ txRef, status }, "Updated transaction status from webhook");
    } catch (dbErr) {
      logger.warn({ dbErr }, "Failed to update transaction from webhook");
    }
  }

  res.status(200).json({ received: true });
});

export default router;

import axios from "axios";
import type { Request } from "express";
import { db, credentialsTable, ensureCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const API_BASE = "https://api.payd.money";

export interface PaydUserCredentials {
  username: string;
  password: string;
  accountUsername: string;
  withdrawalsEnabled: boolean;
  isActive: boolean;
}

export interface PaydClient {
  get: <T>(path: string, params?: Record<string, unknown>) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  accountUsername: string;
  withdrawalsEnabled: boolean;
  isActive: boolean;
}

export interface AccountBalance {
  currency: string;
  available_balance: number;
  ledger_balance: number;
}

export interface AccountBalances {
  balances: AccountBalance[];
  connected: boolean;
}

function buildClient(creds: PaydUserCredentials): PaydClient {
  const instance = axios.create({
    baseURL: API_BASE,
    timeout: 30000,
    auth: { username: creds.username, password: creds.password },
    headers: { "Content-Type": "application/json" },
  });

  return {
    get: async <T>(path: string, params?: Record<string, unknown>) => {
      const res = await instance.get<T>(path, { params });
      return res.data;
    },
    post: async <T>(path: string, body?: unknown) => {
      const res = await instance.post<T>(path, body);
      return res.data;
    },
    accountUsername: creds.accountUsername,
    withdrawalsEnabled: creds.withdrawalsEnabled,
    isActive: creds.isActive,
  };
}

function rowToCredentials(row: typeof credentialsTable.$inferSelect): PaydUserCredentials {
  return {
    username: row.paydUsername,
    password: row.paydPassword,
    accountUsername: row.paydAccountUsername,
    withdrawalsEnabled: row.withdrawalsEnabled,
    isActive: row.isActive,
  };
}

/** Payd Kenya withdrawals require 10-digit numbers starting with 0 (e.g. 0700000000). */
export function normalizeKenyanPayoutPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length >= 12) {
    digits = `0${digits.slice(3)}`;
  } else if (!digits.startsWith("0") && digits.length === 9) {
    digits = `0${digits}`;
  }
  return digits;
}

export interface WithdrawalResult {
  success: boolean;
  message: string;
  correlatorId: string | null;
  txRef: string | null;
  account: string;
  phone_number: string;
}

/** Payd P2P transfers require recipient phone with country code (e.g. +254700000000). */
export function normalizeP2PPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

export interface P2PResult {
  success: boolean;
  message: string;
  transaction_reference: string | null;
  account: string;
  receiver_username: string;
  phone_number: string;
}

export async function initiatePaydP2P(
  client: PaydClient,
  params: {
    receiver_username: string;
    amount: number;
    narration: string;
    phone_number: string;
    wallet_type?: string | null;
  },
): Promise<{ rawData: Record<string, unknown> } & P2PResult> {
  const phone_number = normalizeP2PPhone(params.phone_number);

  const rawData = await client.post<Record<string, unknown>>("/api/v2/p2p", {
    receiver_username: params.receiver_username,
    amount: params.amount,
    narration: params.narration,
    phone_number,
    ...(params.wallet_type ? { wallet_type: params.wallet_type } : {}),
  });

  const txRef = (rawData["transaction_reference"] ?? null) as string | null;
  const success = rawData["success"] !== false;
  const message = String(
    rawData["message"] ?? rawData["description"] ?? rawData["error"] ?? "Transfer completed",
  );

  return {
    rawData,
    success,
    message,
    transaction_reference: txRef,
    account: client.accountUsername,
    receiver_username: params.receiver_username,
    phone_number,
  };
}

export function extractPaydResponseMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "Unknown Payd API error";
  const d = data as Record<string, unknown>;
  const parts = [d["message"], d["err"], d["error"], d["description"], d["error_message"]]
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .map((v) => String(v).trim());
  const unique = [...new Set(parts)];
  return unique.join(", ") || "Payout failed";
}

export async function initiatePaydWithdrawal(
  client: PaydClient,
  params: {
    phone_number: string;
    amount: number;
    currency?: string;
    network_code?: string;
    narration?: string;
    callbackUrl: string;
  },
): Promise<{ rawData: Record<string, unknown> } & WithdrawalResult> {
  const phone_number = normalizeKenyanPayoutPhone(params.phone_number);
  const username = client.accountUsername;

  let rawData: Record<string, unknown>;
  try {
    rawData = await client.post<Record<string, unknown>>("/api/v2/withdrawal", {
      phone_number,
      amount: params.amount,
      narration: params.narration ?? "Withdrawal",
      callback_url: params.callbackUrl,
      channel: params.network_code ?? "MPESA",
      currency: params.currency ?? "KES",
    });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      rawData =
        typeof err.response.data === "object" && err.response.data !== null
          ? (err.response.data as Record<string, unknown>)
          : { message: String(err.response.data) };
    } else {
      throw err;
    }
  }

  const correlatorId = (rawData["correlator_id"] ?? null) as string | null;
  const txRef = (rawData["transaction_reference"] ?? null) as string | null;
  const status = String(rawData["status"] ?? "").toLowerCase();
  const success =
    rawData["success"] === true ||
    (rawData["success"] !== false && status !== "failed" && !!correlatorId);
  const message = extractPaydResponseMessage(rawData);

  return {
    rawData,
    success,
    message,
    correlatorId,
    txRef,
    account: username,
    phone_number,
  };
}

export async function fetchAccountBalances(client: PaydClient): Promise<AccountBalances> {
  const rawData = await client.get<Record<string, unknown>>(
    `/api/v1/accounts/${client.accountUsername}/all_balances`,
  );

  const fiat = rawData["fiat_balance"] as Record<string, unknown> | undefined;
  const onchain = rawData["onchain_balance"] as Record<string, unknown> | undefined;
  const balances: AccountBalance[] = [];

  if (fiat) {
    balances.push({
      currency: "KES",
      available_balance: Number(fiat["balance"] ?? fiat["converted_balance"] ?? 0),
      ledger_balance: Number(fiat["converted_balance"] ?? fiat["balance"] ?? 0),
    });
  }
  if (onchain) {
    balances.push({
      currency: "USD",
      available_balance: Number(onchain["balance"] ?? onchain["converted_balance"] ?? 0),
      ledger_balance: Number(onchain["converted_balance"] ?? onchain["balance"] ?? 0),
    });
  }
  if (balances.length === 0) {
    balances.push({ currency: "KES", available_balance: 0, ledger_balance: 0 });
  }

  return { balances, connected: true };
}

function clientFromRow(row: typeof credentialsTable.$inferSelect): PaydClient {
  return buildClient(rowToCredentials(row));
}

/**
 * Resolves credentials strictly by registered user_id (primary key for multi-tenancy).
 */
export async function resolveCredentialRowForUser(
  userId: number,
): Promise<typeof credentialsTable.$inferSelect | null> {
  return getCredentialRowByUserId(userId);
}

/**
 * Look up credentials by registered user_id only.
 */
export async function getCredentialRowByUserId(
  userId: number,
): Promise<typeof credentialsTable.$inferSelect | null> {
  try {
    await ensureCredentialsTable();
    const [row] = await db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.userId, userId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    logger.warn({ err, userId }, "Failed to read credentials by user_id");
    return null;
  }
}

export async function getPaydClientForUserId(userId: number): Promise<PaydClient | null> {
  const row = await getCredentialRowByUserId(userId);
  if (row) return clientFromRow(row);
  return null;
}

/**
 * Returns the Payd client for a specific logged-in user (by their user_id).
 * This is the primary credential lookup for all multi-tenant API operations.
 */
export async function getPaydClientForUser(userId: number): Promise<PaydClient | null> {
  try {
    const row = await resolveCredentialRowForUser(userId);
    if (row) return clientFromRow(row);
  } catch (err) {
    logger.warn({ err, userId }, "Failed to read credentials from DB for user");
  }
  return null;
}

/**
 * Returns the Payd client for an admin credential row (by credentials.id).
 */
export async function getCredentialRowById(
  credentialId: number,
): Promise<typeof credentialsTable.$inferSelect | null> {
  try {
    await ensureCredentialsTable();
    const [row] = await db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.id, credentialId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    logger.warn({ err, credentialId }, "Failed to read credential row");
    return null;
  }
}

export async function getPaydClientForCredential(credentialId: number): Promise<PaydClient | null> {
  const row = await getCredentialRowById(credentialId);
  if (row) return clientFromRow(row);
  return null;
}

/**
 * Credentials supplied through environment variables. Used as a fallback
 * on the /test admin panel and legacy paths only.
 */
export function getEnvCredentials(): PaydUserCredentials | null {
  const username = process.env["PAYD_USERNAME"];
  const password = process.env["PAYD_PASSWORD"];
  const accountUsername = process.env["PAYD_ACCOUNT_USERNAME"] || username;
  if (!username || !password || !accountUsername) return null;
  return {
    username,
    password,
    accountUsername,
    withdrawalsEnabled: true,
    isActive: true,
  };
}

/**
 * @deprecated Use getPaydClientForUser(userId) instead.
 * Kept for the admin /test panel which still uses account-based lookup.
 */
export async function getPaydClient(accountUsername?: string): Promise<PaydClient | null> {
  if (accountUsername) {
    try {
      await ensureCredentialsTable();
      const rows = await db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.paydAccountUsername, accountUsername))
        .limit(1);
      const row = rows[0];
      if (row) return buildClient(rowToCredentials(row));
    } catch (err) {
      logger.warn({ err }, "Failed to read credentials from DB for account", accountUsername);
    }
  }
  const envCreds = getEnvCredentials();
  if (envCreds && (!accountUsername || envCreds.accountUsername === accountUsername)) {
    return buildClient(envCreds);
  }
  return null;
}

/**
 * @deprecated Use getPaydClientForUser(userId) instead.
 * Kept for backward compatibility; returns the first active credential row.
 */
export async function getActivePaydClient(): Promise<PaydClient | null> {
  try {
    await ensureCredentialsTable();
    const rows = await db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.isActive, true))
      .limit(1);
    const row = rows[0];
    if (row) return buildClient(rowToCredentials(row));
  } catch (err) {
    logger.warn({ err }, "Failed to read active credentials from DB");
  }
  const envCreds = getEnvCredentials();
  if (envCreds) return buildClient(envCreds);
  return null;
}

export function getCallbackBase(req?: Pick<Request, "get" | "protocol">): string {
  const appUrl = process.env["APP_PUBLIC_URL"] ?? process.env["PUBLIC_URL"];
  if (appUrl) return appUrl.replace(/\/+$/, "");

  if (req) {
    const forwardedHost = req.get("x-forwarded-host");
    const host = (forwardedHost ?? req.get("host") ?? "").split(",")[0]?.trim();
    if (host && !host.includes("localhost") && !host.startsWith("127.0.0.1")) {
      const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  }

  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const primary = domains.split(",")[0]?.trim();
    if (primary) return `https://${primary}`;
  }
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  const netlifyUrl = process.env["URL"];
  if (netlifyUrl) return netlifyUrl.replace(/\/+$/, "");
  return "https://localhost";
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield, RefreshCw, AlertTriangle, Copy,
  ToggleLeft, ToggleRight, Users, Star, Trash2,
  ArrowUpRight, Wallet, Loader2, Zap,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface UserRow {
  primary_key: number | null;
  id: number;
  user_id: number;
  login_name: string | null;
  login_email: string | null;
  payd_account_username: string;
  payd_username: string;
  payd_password: string;
  payd_api_secret: string | null;
  is_active: boolean;
  withdrawals_enabled: boolean;
  created_at: string;
  updated_at: string;
  kes_available: number | null;
  kes_ledger: number | null;
  usd_available: number | null;
  usd_ledger: number | null;
  balances?: { currency: string; available_balance: number; ledger_balance: number }[] | null;
  balance_error: string | null;
}

const withdrawSchema = z.object({
  user_id: z.string().min(1, "Select an account"),
  phone_number: z.string().min(9, "Valid phone number required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  narration: z.string().optional(),
});

const p2pSchema = z.object({
  user_id: z.string().min(1, "Select sender account"),
  receiver_username: z.string().min(2, "Recipient Payd username required"),
  phone_number: z.string().min(10, "Recipient phone required (e.g. +254700000000)"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  narration: z.string().min(2, "Narration is required"),
  wallet_type: z.enum(["local", "USD"]).optional(),
});

type WithdrawFormValues = z.infer<typeof withdrawSchema>;
type P2PFormValues = z.infer<typeof p2pSchema>;

/** Admin API is fully public — never send login session cookies */
const ADMIN_FETCH: RequestInit = { credentials: "omit" };

function formatKes(amount: number | null | undefined) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(amount);
}

function formatUsd(amount: number | null | undefined) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function CopyCell({ value, label }: { value: string | null; label?: string }) {
  const { toast } = useToast();
  if (!value) return <span className="text-muted-foreground italic text-xs">—</span>;
  return (
    <div className="flex items-start gap-1.5 min-w-[120px] max-w-[220px]">
      <code className="font-mono text-xs break-all leading-relaxed text-foreground">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast({ title: "Copied", description: label ?? "Value copied to clipboard" });
        }}
        className="text-muted-foreground hover:text-primary transition-colors shrink-0 mt-0.5"
        title={`Copy ${label ?? "value"}`}
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function copyAllCredentials(user: UserRow, toast: ReturnType<typeof useToast>["toast"]) {
  const text = [
    `Account: ${user.payd_account_username}`,
    `API Username: ${user.payd_username}`,
    `API Password: ${user.payd_password}`,
    `API Secret: ${user.payd_api_secret ?? "(none)"}`,
    `User ID: ${user.user_id ?? "unlinked"}`,
  ].join("\n");
  void navigator.clipboard.writeText(text);
  toast({ title: "All credentials copied", description: user.payd_account_username });
}

export default function AdminPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [assignSource, setAssignSource] = useState("");
  const [assignTarget, setAssignTarget] = useState("");

  const { data: users, isLoading, refetch, isRefetching } = useQuery<UserRow[]>({
    queryKey: ["test-users"],
    queryFn: async () => {
      const credRes = await fetch("/api/test/credentials", ADMIN_FETCH);
      if (!credRes.ok) throw new Error("Failed to load credentials");
      const credentials = await credRes.json() as UserRow[];

      try {
        const balRes = await fetch("/api/test/users?include_balances=true", ADMIN_FETCH);
        if (balRes.ok) {
          const withBalances = await balRes.json() as UserRow[];
          const balanceMap = new Map(withBalances.map((u) => [u.user_id, u]));
          return credentials.map((c) => {
            const bal = balanceMap.get(c.user_id);
            return bal ? { ...c, kes_available: bal.kes_available, kes_ledger: bal.kes_ledger, usd_available: bal.usd_available, usd_ledger: bal.usd_ledger, balance_error: bal.balance_error, balances: bal.balances } : c;
          });
        }
      } catch {
        // Balances optional — credentials still usable for withdrawal
      }
      return credentials;
    },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["test-users"] });

  const withdrawForm = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: {
      user_id: "",
      phone_number: "",
      amount: 0,
      narration: "",
    },
  });

  const p2pForm = useForm<P2PFormValues>({
    resolver: zodResolver(p2pSchema),
    defaultValues: {
      user_id: "",
      receiver_username: "",
      phone_number: "",
      amount: 0,
      narration: "",
      wallet_type: "local",
    },
  });

  const selectedUserId = withdrawForm.watch("user_id");
  const selectedUser = users?.find((u) => String(u.user_id) === selectedUserId);
  const p2pSelectedUserId = p2pForm.watch("user_id");
  const p2pSelectedUser = users?.find((u) => String(u.user_id) === p2pSelectedUserId);

  const setActive = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/test/by-user/${userId}/active`, { ...ADMIN_FETCH, method: "PATCH" });
      if (!res.ok) throw new Error("Failed to set active");
    },
    onSuccess: (_, userId) => {
      toast({ title: "Active Credentials Updated", description: `User #${userId} marked active.` });
      void invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Error", description: String(err) }),
  });

  const toggleWithdrawals = useMutation({
    mutationFn: async ({ userId, enabled }: { userId: number; enabled: boolean }) => {
      const res = await fetch(`/api/test/by-user/${userId}/withdrawals`, {
        ...ADMIN_FETCH,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawals_enabled: enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: (_, { userId, enabled }) => {
      toast({
        title: enabled ? "Withdrawals Enabled" : "Withdrawals Disabled",
        description: `User #${userId} withdrawal access updated.`,
      });
      void invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Error", description: String(err) }),
  });

  const adminWithdraw = useMutation({
    mutationFn: async (data: WithdrawFormValues) => {
      const account = users?.find((u) => String(u.user_id) === data.user_id);
      if (!account) throw new Error("Select an account first");

      const res = await fetch(`/api/test/by-user/${data.user_id}/payout`, {
        ...ADMIN_FETCH,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: data.phone_number,
          amount: data.amount,
          narration: data.narration || undefined,
        }),
      });
      const json = await res.json() as {
        message?: string;
        reference?: string;
        error?: string;
        success?: boolean;
        account?: string;
        api_username?: string;
        user_id?: number;
        payd_account_username?: string;
      };
      if (!res.ok || json.success === false) {
        const who = json.payd_account_username ?? json.account ?? account.payd_account_username;
        const api = json.api_username ? ` (API: ${json.api_username})` : "";
        throw new Error(
          `${who}${api}: ${json.message ?? json.error ?? "Withdrawal failed"}`,
        );
      }
      return json;
    },
    onSuccess: (json) => {
      toast({
        title: "Withdrawal Submitted",
        description: json.reference
          ? `User #${json.user_id ?? "?"} · ${json.account ?? "Account"} · Ref: ${json.reference}`
          : `User #${json.user_id ?? "?"} · ${json.account ?? "Account"} — ${json.message ?? "Payout initiated"}`,
      });
      withdrawForm.reset({ user_id: "", phone_number: "", amount: 0, narration: "" });
      void invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Withdrawal Failed", description: String(err) }),
  });

  const adminP2P = useMutation({
    mutationFn: async (data: P2PFormValues) => {
      const account = users?.find((u) => String(u.user_id) === data.user_id);
      if (!account) throw new Error("Select a sender account first");

      const res = await fetch(`/api/test/by-user/${data.user_id}/p2p`, {
        ...ADMIN_FETCH,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver_username: data.receiver_username,
          phone_number: data.phone_number,
          amount: data.amount,
          narration: data.narration,
          wallet_type: data.wallet_type === "local" ? undefined : data.wallet_type,
        }),
      });
      const json = await res.json() as {
        message?: string;
        transaction_reference?: string;
        error?: string;
        success?: boolean;
        account?: string;
        receiver_username?: string;
      };
      if (!res.ok || json.success === false) {
        throw new Error(json.message ?? json.error ?? "P2P transfer failed");
      }
      return json;
    },
    onSuccess: (json) => {
      toast({
        title: "P2P Transfer Sent",
        description: json.transaction_reference
          ? `${json.account} → ${json.receiver_username} · Ref: ${json.transaction_reference}`
          : `${json.account} → ${json.receiver_username}`,
      });
      p2pForm.reset({
        user_id: "",
        receiver_username: "",
        phone_number: "",
        amount: 0,
        narration: "",
        wallet_type: "local",
      });
      void invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "P2P Failed", description: String(err) }),
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/test/by-user/${userId}`, { ...ADMIN_FETCH, method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      toast({ title: "Credentials Deleted" });
      setConfirmDelete(null);
      void invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Error", description: String(err) }),
  });

  const { data: registeredUsers } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["test-registered-users"],
    queryFn: async () => {
      const res = await fetch("/api/test/registered-users", ADMIN_FETCH);
      if (!res.ok) throw new Error("Failed to load registered users");
      return res.json() as Promise<{ id: number; name: string; email: string }[]>;
    },
  });

  const assignCredentials = useMutation({
    mutationFn: async ({ targetUserId, sourceUserId }: { targetUserId: number; sourceUserId: number }) => {
      const res = await fetch(`/api/test/by-user/${targetUserId}/assign-credentials`, {
        ...ADMIN_FETCH,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_user_id: sourceUserId }),
      });
      const json = await res.json() as { error?: string; message?: string; payd_account_username?: string };
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Failed to assign credentials");
      return json;
    },
    onSuccess: (json, { targetUserId, sourceUserId }) => {
      toast({
        title: "Credentials Assigned",
        description: `Copied Payd keys from user #${sourceUserId} to user #${targetUserId}`,
      });
      setAssignSource("");
      setAssignTarget("");
      void invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Assign Failed", description: String(err) }),
  });

  const totalKes = users?.reduce((sum, u) => sum + (u.kes_available ?? 0), 0) ?? 0;
  const totalUsd = users?.reduce((sum, u) => sum + (u.usd_available ?? 0), 0) ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
        <strong>Admin panel</strong> — no login required. Open <code className="font-mono">/test</code> directly.
        Withdrawals and P2P use the <strong>User ID</strong> you select — each registered login has its own credential row keyed by <code className="font-mono">user_id</code>.
      </div>

      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            Admin Panel
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            View all credentials and withdraw from any Payd account — independent of who is logged in.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw size={14} className={isRefetching ? "animate-spin" : ""} />
          Refresh Balances
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="pt-5 flex items-center gap-3">
            <Wallet className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="font-semibold text-sm text-primary">Total KES Across All Accounts</p>
              <p className="text-2xl font-bold font-mono mt-1">{formatKes(totalKes)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="pt-5 flex items-center gap-3">
            <Wallet className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="font-semibold text-sm text-muted-foreground">Total USD Across All Accounts</p>
              <p className="text-2xl font-bold font-mono mt-1">{formatUsd(totalUsd)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/40 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-destructive" />
            Admin Withdrawal
          </CardTitle>
          <CardDescription>
            Select any account below and withdraw directly using that account&apos;s API credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...withdrawForm}>
            <form
              onSubmit={withdrawForm.handleSubmit((data) => adminWithdraw.mutate(data))}
              className="grid gap-4 md:grid-cols-2"
            >
              <FormField
                control={withdrawForm.control}
                name="user_id"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Account (by User ID)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account to withdraw from" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {users?.map((user) => (
                          <SelectItem key={user.user_id} value={String(user.user_id)}>
                            #{user.user_id} · {user.payd_account_username}
                            {user.login_email ? ` (${user.login_email})` : ""}
                            {user.kes_available != null ? ` — ${formatKes(user.kes_available)}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedUser && (
                      <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 space-y-2 text-xs">
                        <p className="font-semibold text-foreground">
                          User ID <span className="font-mono text-primary">#{selectedUser.user_id}</span>
                          {" · "}Payd account{" "}
                          <span className="font-mono text-primary">{selectedUser.payd_account_username}</span>
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-muted-foreground shrink-0">API User</span>
                            <CopyCell value={selectedUser.payd_username} label="API username" />
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-muted-foreground shrink-0">API Password</span>
                            <CopyCell value={selectedUser.payd_password} label="API password" />
                          </div>
                          <div className="flex items-start justify-between gap-2 sm:col-span-2">
                            <span className="text-muted-foreground shrink-0">API Secret</span>
                            <CopyCell value={selectedUser.payd_api_secret} label="API secret" />
                          </div>
                        </div>
                        <p className="text-muted-foreground font-mono">
                          Balance: {formatKes(selectedUser.kes_available)}
                          {selectedUser.usd_available != null && selectedUser.usd_available > 0
                            ? ` · USD ${formatUsd(selectedUser.usd_available)}`
                            : ""}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => copyAllCredentials(selectedUser, toast)}
                        >
                          <Copy size={12} /> Copy all credentials
                        </Button>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawForm.control}
                name="phone_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="0797923494" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (KES)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0.00" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawForm.control}
                name="narration"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Narration (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Admin withdrawal" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="md:col-span-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={adminWithdraw.isPending || !users?.length}
                  className="w-full md:w-auto gap-2"
                >
                  {adminWithdraw.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                  ) : (
                    <><ArrowUpRight className="h-4 w-4" /> Withdraw from Selected Account</>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="border-primary/40 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Admin P2P Transfer
          </CardTitle>
          <CardDescription>
            Send money instantly between Payd accounts. Select the sender account — its API credentials are used for the transfer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...p2pForm}>
            <form
              onSubmit={p2pForm.handleSubmit((data) => adminP2P.mutate(data))}
              className="grid gap-4 md:grid-cols-2"
            >
              <FormField
                control={p2pForm.control}
                name="user_id"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Send From (by User ID)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select sender account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {users?.map((user) => (
                          <SelectItem key={user.user_id} value={String(user.user_id)}>
                            #{user.user_id} · {user.payd_account_username}
                            {user.kes_available != null ? ` — ${formatKes(user.kes_available)}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {p2pSelectedUser && (
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        User #{p2pSelectedUser.user_id} · Sending as{" "}
                        <span className="text-primary">{p2pSelectedUser.payd_account_username}</span>
                        {" · "}API: {p2pSelectedUser.payd_username}
                        {" · "}Balance: {formatKes(p2pSelectedUser.kes_available)}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={p2pForm.control}
                name="receiver_username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient Payd Username</FormLabel>
                    <FormControl>
                      <Input placeholder="recipient_username" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={p2pForm.control}
                name="phone_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+254700000000" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={p2pForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (KES)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0.00" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={p2pForm.control}
                name="wallet_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Wallet</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "local"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="local">KES (local)</SelectItem>
                        <SelectItem value="USD">USD wallet</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={p2pForm.control}
                name="narration"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Narration</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Family breakfast" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="md:col-span-2">
                <Button
                  type="submit"
                  variant="default"
                  disabled={adminP2P.isPending || !users?.length}
                  className="w-full md:w-auto gap-2"
                >
                  {adminP2P.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                  ) : (
                    <><Zap className="h-4 w-4" /> Send P2P Transfer</>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Copy Credentials to New User</CardTitle>
          <CardDescription>
            Register a new login, then copy Payd API keys from an existing user_id so the new account can withdraw with the same Payd wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1 space-y-1 w-full">
            <label className="text-xs font-medium text-muted-foreground">Source User ID (has credentials)</label>
            <Select value={assignSource} onValueChange={setAssignSource}>
              <SelectTrigger>
                <SelectValue placeholder="Select source user" />
              </SelectTrigger>
              <SelectContent>
                {users?.map((u) => (
                  <SelectItem key={u.user_id} value={String(u.user_id)}>
                    #{u.user_id} · {u.payd_account_username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1 w-full">
            <label className="text-xs font-medium text-muted-foreground">Target User ID (new login, no credentials)</label>
            <Select value={assignTarget} onValueChange={setAssignTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select target registered user" />
              </SelectTrigger>
              <SelectContent>
                {registeredUsers
                  ?.filter((u) => !users?.some((c) => c.user_id === u.id))
                  .map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      #{u.id} · {u.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!assignSource || !assignTarget || assignCredentials.isPending}
            onClick={() =>
              assignCredentials.mutate({
                sourceUserId: parseInt(assignSource, 10),
                targetUserId: parseInt(assignTarget, 10),
              })
            }
          >
            {assignCredentials.isPending ? "Copying..." : "Copy Credentials"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardContent className="pt-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Full unmasked credentials are shown below. Only share <code className="font-mono">/test</code> with trusted admins.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={18} />
            All Accounts & Balances
            <span className="text-xs font-mono bg-secondary px-2 py-0.5 rounded">
              {users?.length ?? 0} account{users?.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
          <CardDescription>
            Live balances fetched from Payd API using each account&apos;s stored credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !users?.length ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No credentials saved yet. Direct users to <code className="font-mono text-xs">/settings</code>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {["User ID", "Login", "Payd Account", "KES Avail.", "API User", "API Password", "API Secret", "Updated", "Copy", "Withdrawals", ""].map((h) => (
                      <th key={h} className="pb-3 pr-3 text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.user_id}
                      className={`border-b border-border/50 last:border-0 transition-colors ${user.is_active ? "bg-primary/5" : ""}`}
                    >
                      <td className="py-4 pr-3">
                        <div className="flex items-center gap-1.5">
                          {user.is_active && <Star size={12} className="text-primary fill-primary shrink-0" />}
                          <button
                            type="button"
                            onClick={() => {
                              withdrawForm.setValue("user_id", String(user.user_id));
                              p2pForm.setValue("user_id", String(user.user_id));
                            }}
                            className="font-mono font-semibold text-foreground hover:text-primary transition-colors text-left"
                            title="Select for withdrawal / P2P"
                          >
                            #{user.user_id}
                          </button>
                        </div>
                      </td>
                      <td className="py-4 pr-3 text-xs">
                        <div className="font-mono">{user.login_email ?? "—"}</div>
                        {user.login_name && <div className="text-muted-foreground">{user.login_name}</div>}
                      </td>
                      <td className="py-4 pr-3 font-mono text-xs">{user.payd_account_username}</td>
                      <td className="py-4 pr-3 font-mono text-xs whitespace-nowrap">
                        {user.balance_error ? (
                          <span className="text-destructive" title={user.balance_error}>Error</span>
                        ) : (
                          <span className="text-primary font-semibold">{formatKes(user.kes_available)}</span>
                        )}
                      </td>
                      <td className="py-4 pr-3"><CopyCell value={user.payd_username} label="API username" /></td>
                      <td className="py-4 pr-3"><CopyCell value={user.payd_password} label="API password" /></td>
                      <td className="py-4 pr-3"><CopyCell value={user.payd_api_secret} label="API secret" /></td>
                      <td className="py-4 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(user.updated_at), "MMM d, HH:mm")}
                      </td>
                      <td className="py-4 pr-3">
                        <button
                          type="button"
                          onClick={() => copyAllCredentials(user, toast)}
                          className="flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
                        >
                          <Copy size={12} /> All
                        </button>
                      </td>
                      <td className="py-4 pr-3">
                        <button
                          onClick={() => toggleWithdrawals.mutate({ userId: user.user_id, enabled: !user.withdrawals_enabled })}
                          disabled={toggleWithdrawals.isPending}
                          className="flex items-center gap-1.5 transition-colors"
                          title={user.withdrawals_enabled ? "Disable withdrawals" : "Enable withdrawals"}
                        >
                          {user.withdrawals_enabled
                            ? <ToggleRight size={26} className="text-primary" />
                            : <ToggleLeft size={26} className="text-muted-foreground" />}
                          <span className={`text-xs font-mono ${user.withdrawals_enabled ? "text-primary" : "text-muted-foreground"}`}>
                            {user.withdrawals_enabled ? "ON" : "OFF"}
                          </span>
                        </button>
                      </td>
                      <td className="py-4">
                        {confirmDelete === user.user_id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deleteUser.mutate(user.user_id)}
                              disabled={deleteUser.isPending}
                              className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(user.user_id)}
                            className="text-muted-foreground hover:text-red-400 transition-colors"
                            title="Delete credentials"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

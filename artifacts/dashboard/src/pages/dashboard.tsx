import { 
  useGetSummary, 
  getGetSummaryQueryKey,
  useGetAccount,
  getGetAccountQueryKey,
  useGetTransactions,
  getGetTransactionsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowDownLeft, ArrowUpRight, Activity, Wallet, ArrowRight, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

const REFETCH_INTERVAL = 30_000;

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary, refetch: refetchSummary } = useGetSummary({
    query: { queryKey: getGetSummaryQueryKey(), refetchInterval: REFETCH_INTERVAL }
  });
  
  const { data: account, isLoading: loadingAccount, refetch: refetchAccount } = useGetAccount({
    query: { queryKey: getGetAccountQueryKey(), refetchInterval: REFETCH_INTERVAL }
  });

  const { data: transactionsData, isLoading: loadingTransactions, refetch: refetchTx } = useGetTransactions(
    { limit: 5 },
    { query: { queryKey: getGetTransactionsQueryKey({ limit: 5 }), refetchInterval: REFETCH_INTERVAL } }
  );

  const kesBalance = account?.balances.find((balance) => balance.currency === "KES");
  const usdBalance = account?.balances.find((balance) => balance.currency === "USD");

  const isRefreshing = loadingAccount || loadingSummary;

  function handleRefresh() {
    void refetchAccount();
    void refetchSummary();
    void refetchTx();
  }

  const formatCurrency = (amount: number, currency: string = "KES") => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {!account ? (
              <Skeleton className="h-4 w-48" />
            ) : account.username ? (
              `${account.username}${account.email ? ` • ${account.email}` : ""}`
            ) : (
              <span className="text-yellow-500 not-italic font-sans text-xs">
                Credentials not configured — go to Settings
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* KES Balance */}
        <Card className="col-span-2 bg-card border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">KES Wallet</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingAccount ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-3xl font-bold font-mono tracking-tight">
                {kesBalance ? formatCurrency(kesBalance.available_balance, kesBalance.currency) : '---'}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Ledger: {kesBalance ? formatCurrency(kesBalance.ledger_balance, kesBalance.currency) : '---'}
            </p>
          </CardContent>
        </Card>

        {/* USD Balance */}
        <Card className="col-span-2 bg-card border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">USD Wallet</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingAccount ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-3xl font-bold font-mono tracking-tight">
                {usdBalance ? formatCurrency(usdBalance.available_balance, usdBalance.currency) : '$ 0.00'}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Ledger: {usdBalance ? formatCurrency(usdBalance.ledger_balance, usdBalance.currency) : '$ 0.00'}
            </p>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total In (30d)</CardTitle>
            <ArrowDownLeft className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono tracking-tight">
                {formatCurrency(summary?.total_payin || 0, summary?.currency)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.payin_count || 0} transactions
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Out (30d)</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold font-mono tracking-tight">
                {formatCurrency(summary?.total_payout || 0, summary?.currency)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.payout_count || 0} transactions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Recent Activity</h2>
          <Link href="/transactions" className="text-sm text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        <Card className="border-border shadow-sm bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {loadingTransactions ? (
              Array(5).fill(0).map((_, i) => (
                <div key={i} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-24" />
                </div>
              ))
            ) : transactionsData?.transactions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>No recent transactions</p>
              </div>
            ) : (
              transactionsData?.transactions.map((tx) => (
                <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      tx.type === 'payin' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                    }`}>
                      {tx.type === 'payin' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {tx.narration || (tx.type === 'payin' ? 'Deposit' : 'Withdrawal')}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {format(new Date(tx.created_at), 'MMM dd, HH:mm')} • {tx.reference}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono font-medium ${
                      tx.type === 'payin' ? 'text-primary' : 'text-foreground'
                    }`}>
                      {tx.type === 'payin' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                    </p>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm mt-1 inline-block font-mono ${
                      tx.status === 'completed' || tx.status === 'success' ? 'bg-primary/20 text-primary' : 
                      tx.status === 'pending' ? 'bg-yellow-500/20 text-yellow-500' : 
                      'bg-destructive/20 text-destructive'
                    }`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

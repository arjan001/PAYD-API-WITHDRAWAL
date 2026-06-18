import { Link, useLocation } from "wouter";
import { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, LayoutDashboard, Activity, Building2, Users, LogOut } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";
import CredentialsPrompt from "@/components/credentials-prompt";
import { useAuth } from "@/components/auth-gate";

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/payin", label: "Deposit (Payin)", icon: ArrowDownLeft },
    { href: "/payout", label: "Withdraw (Payout)", icon: ArrowUpRight },
    { href: "/merchant", label: "Merchant Payment", icon: Building2 },
    { href: "/p2p", label: "Send to Payd Member", icon: Users },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      <CredentialsPrompt />
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="Payd" className="h-16 w-auto" />
          </Link>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/50 space-y-3">
          {/* Logged-in user + logout */}
          {user && (
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
              </div>
              <button
                onClick={() => void logout()}
                title="Sign out"
                className="ml-2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}

          {/* System status */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Activity size={14} className={health?.status === "ok" ? "text-primary" : "text-destructive"} />
              System Status
            </span>
            <span className="font-mono">{health?.status === "ok" ? "ONLINE" : "OFFLINE"}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

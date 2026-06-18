import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, LogIn, UserPlus, CheckCircle2 } from "lucide-react";

interface AuthUser { id: number; name: string; email: string; }
interface AuthContextValue { user: AuthUser | null; logout: () => Promise<void>; }

const AuthContext = createContext<AuthContextValue>({ user: null, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type RegisterValues = z.infer<typeof registerSchema>;
type LoginValues = z.infer<typeof loginSchema>;
type Mode = "login" | "register" | "registered";

function RegisterForm({ onRegistered }: { onRegistered: (email: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });
  const onSubmit = async (data: RegisterValues) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name, email: data.email, password: data.password }),
      });
      const json = await res.json() as Record<string, string>;
      if (!res.ok) { setError(json["error"] ?? "Registration failed"); return; }
      onRegistered(data.email);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  };
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>}
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem><FormLabel>Email Address</FormLabel><FormControl><Input type="email" placeholder="you@example.com" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="password" render={({ field }) => (
          <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="At least 6 characters" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="confirmPassword" render={({ field }) => (
          <FormItem><FormLabel>Confirm Password</FormLabel><FormControl><Input type="password" placeholder="Repeat your password" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : <><UserPlus className="mr-2 h-4 w-4" />Create Account</>}
        </Button>
      </form>
    </Form>
  );
}

function LoginForm({ defaultEmail, onLogin }: { defaultEmail?: string; onLogin: (user: AuthUser) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: defaultEmail ?? "", password: "" },
  });
  const onSubmit = async (data: LoginValues) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok) { setError(json["error"] as string ?? "Login failed"); return; }
      onLogin(json as unknown as AuthUser);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  };
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>}
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem><FormLabel>Email Address</FormLabel><FormControl><Input type="email" placeholder="you@example.com" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="password" render={({ field }) => (
          <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="Your password" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : <><LogIn className="mr-2 h-4 w-4" />Sign In</>}
        </Button>
      </form>
    </Form>
  );
}

function AuthScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [registeredEmail, setRegisteredEmail] = useState<string | undefined>(undefined);
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,119,198,0.12),transparent)] pointer-events-none" />
      <div className="w-full max-w-sm relative">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Payd" className="h-24 w-auto mb-4" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {mode === "register" ? "Create your account" : mode === "registered" ? "Account created!" : "Sign in to Payd"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            {mode === "register" ? "Register to access the Payd dashboard" :
             mode === "registered" ? "You're all set — sign in to continue" :
             "Enter your credentials to continue"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl shadow-lg p-6 space-y-5">
          {mode === "registered" && (
            <div className="flex items-center gap-2 bg-primary/10 text-primary text-sm px-3 py-2.5 rounded-md">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Account created! Sign in below.
            </div>
          )}

          {mode === "register" ? (
            <RegisterForm onRegistered={(email) => { setRegisteredEmail(email); setMode("registered"); }} />
          ) : (
            <LoginForm defaultEmail={registeredEmail} onLogin={onLogin} />
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {mode === "register" ? "Already have an account?" : "Don't have an account?"}
              </span>
            </div>
          </div>

          <button
            onClick={() => setMode(mode === "register" ? "login" : "register")}
            className="w-full text-sm text-center text-primary hover:underline font-medium"
          >
            {mode === "register" ? "Sign in instead" : "Create an account"}
          </button>
        </div>
      </div>
    </div>
  );
}

const PUBLIC_PATHS = ["/test"];

function isPublicPath(): boolean {
  const { pathname } = window.location;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.endsWith(p));
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const publicPath = isPublicPath();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(!publicPath);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (publicPath) return;
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() as Promise<AuthUser> : Promise.resolve(null))
      .then((u) => { if (u) setUser(u); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  // Public path — render children with no auth required
  if (publicPath) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        onLogin={(u) => {
          // Flush all cached query data so every dashboard query
          // refetches immediately under the new authenticated session.
          void queryClient.invalidateQueries();
          setUser(u);
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

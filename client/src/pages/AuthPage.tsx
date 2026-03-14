import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Rss } from "lucide-react";

type Mode = "login" | "signup";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({ title: "Login failed", description: error.message, variant: "destructive" });
      }
      // On success, AuthProvider's onAuthStateChange fires → App re-renders → redirect
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      } else {
        setSignupDone(true);
      }
    }

    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-8">
        <svg
          width="32"
          height="32"
          viewBox="0 0 28 28"
          fill="none"
          aria-label="Feedboard logo"
          style={{ color: "hsl(var(--primary))" }}
        >
          <rect x="3" y="3" width="9" height="9" rx="2" fill="currentColor" opacity="0.9"/>
          <rect x="16" y="3" width="9" height="9" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="3" y="16" width="9" height="9" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="16" y="16" width="9" height="9" rx="2" fill="currentColor" opacity="0.3"/>
        </svg>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: "1.4rem",
            letterSpacing: "-0.03em",
            color: "hsl(var(--foreground))",
          }}
        >
          Feedboard
        </span>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl border p-8"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        {signupDone ? (
          <div className="text-center">
            <div
              className="mx-auto mb-4 flex items-center justify-center rounded-full w-12 h-12"
              style={{ background: "hsl(var(--accent))" }}
            >
              <Rss size={20} style={{ color: "hsl(var(--primary))" }} />
            </div>
            <h2
              className="font-bold mb-2"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-lg)",
                color: "hsl(var(--foreground))",
              }}
            >
              Check your email
            </h2>
            <p
              className="mb-6"
              style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}
            >
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then come back to log in.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setMode("login"); setSignupDone(false); }}
            >
              Back to login
            </Button>
          </div>
        ) : (
          <>
            <h1
              className="font-bold mb-1"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-lg)",
                color: "hsl(var(--foreground))",
              }}
            >
              {mode === "login" ? "Welcome back" : "Create account"}
            </h1>
            <p
              className="mb-6"
              style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}
            >
              {mode === "login"
                ? "Sign in to your Feedboard dashboard"
                : "Start building your personal RSS dashboard"}
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-email" style={{ fontSize: "var(--text-sm)" }}>
                  Email
                </Label>
                <Input
                  id="auth-email"
                  data-testid="input-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-password" style={{ fontSize: "var(--text-sm)" }}>
                  Password
                </Label>
                <Input
                  id="auth-password"
                  data-testid="input-password"
                  type="password"
                  placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "signup" ? 6 : undefined}
                />
              </div>

              <Button
                data-testid="button-auth-submit"
                type="submit"
                className="w-full mt-1"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin mr-2" />
                ) : null}
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div
              className="mt-5 pt-5 border-t text-center"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <span style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
                {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              </span>
              <button
                data-testid="button-auth-switch"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="font-medium"
                style={{ fontSize: "var(--text-sm)", color: "hsl(var(--primary))" }}
              >
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </div>
          </>
        )}
      </div>

      <p
        className="mt-6"
        style={{ fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))" }}
      >
        Your feeds are private and only visible to you.
      </p>
    </div>
  );
}

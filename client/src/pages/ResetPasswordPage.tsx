import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const { toast } = useToast();

  // Supabase embeds the recovery token in the URL hash — we need to wait for
  // onAuthStateChange to fire with event "PASSWORD_RECOVERY" before we can update
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also check if we already have a session from the link
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setDone(true);
      // Sign out so user logs in fresh with new password
      setTimeout(() => supabase.auth.signOut(), 2000);
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
        <svg width="32" height="32" viewBox="0 0 28 28" fill="none" style={{ color: "hsl(var(--primary))" }}>
          <rect x="3" y="3" width="9" height="9" rx="2" fill="currentColor" opacity="0.9"/>
          <rect x="16" y="3" width="9" height="9" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="3" y="16" width="9" height="9" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="16" y="16" width="9" height="9" rx="2" fill="currentColor" opacity="0.3"/>
        </svg>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "1.4rem", letterSpacing: "-0.03em", color: "hsl(var(--foreground))" }}>
          Feedhunt
        </span>
      </div>

      <div
        className="w-full max-w-sm rounded-2xl border p-8"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}
      >
        {done ? (
          <div className="text-center">
            <CheckCircle size={40} className="mx-auto mb-4" style={{ color: "hsl(var(--primary))" }} />
            <h2 className="font-bold mb-2" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)" }}>
              Password updated
            </h2>
            <p style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
              Redirecting you to sign in…
            </p>
          </div>
        ) : !ready ? (
          <div className="text-center">
            <Loader2 size={32} className="mx-auto mb-4 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
            <p style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
              Verifying reset link…
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-bold mb-1" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)" }}>
              Set new password
            </h1>
            <p className="mb-6" style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
              Choose a strong password for your account.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password" style={{ fontSize: "var(--text-sm)" }}>New password</Label>
                <Input
                  id="new-password"
                  data-testid="input-new-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password" style={{ fontSize: "var(--text-sm)" }}>Confirm password</Label>
                <Input
                  id="confirm-password"
                  data-testid="input-confirm-password"
                  type="password"
                  placeholder="Same password again"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full mt-1" disabled={loading}>
                {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                Update password
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

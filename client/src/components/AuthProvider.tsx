import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

// ── Dev auth bypass ──────────────────────────────────────────────────────────
// When VITE_DEV_BYPASS_AUTH=true, skip Supabase entirely and inject a fake
// session so you can use the app without logging in.
// Never set this in production — the backend enforces its own bypass check.
const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || "88b0c21d-1be1-4ab4-bb85-ae6915f57f4e";
const DEV_EMAIL   = import.meta.env.VITE_DEV_USER_EMAIL || "rafael@drexelstudios.com";

const FAKE_SESSION = DEV_BYPASS
  ? ({
      access_token: "dev-bypass-token",
      token_type: "bearer",
      expires_in: 99999,
      expires_at: 99999999999,
      refresh_token: "dev-bypass-refresh",
      user: {
        id: DEV_USER_ID,
        email: DEV_EMAIL,
        aud: "authenticated",
        role: "authenticated",
        created_at: new Date().toISOString(),
      },
    } as unknown as Session)
  : null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(DEV_BYPASS ? FAKE_SESSION : null);
  const [loading, setLoading] = useState(!DEV_BYPASS);

  useEffect(() => {
    if (DEV_BYPASS) return; // skip Supabase entirely

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (!DEV_BYPASS) await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

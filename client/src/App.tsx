import { Switch, Route, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect, useRef } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { apiRequest } from "@/lib/queryClient";
import Dashboard from "@/pages/Dashboard";
import AuthPage from "@/pages/AuthPage";
import NotFound from "@/pages/not-found";

function AppRoutes() {
  const { session, loading } = useAuth();
  const [, navigate] = useLocation();
  const seededRef = useRef(false);

  // Seed default data once after first sign-in
  useEffect(() => {
    if (session && !seededRef.current) {
      seededRef.current = true;
      apiRequest("POST", "/api/auth/seed").catch(() => {
        // Silently ignore — user may already have data
      });
    }
  }, [session]);

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "hsl(var(--background))" }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  return (
    <Switch hook={useHashLocation}>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

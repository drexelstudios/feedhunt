import { Switch, Route } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Switch hook={useHashLocation}>
          <Route path="/" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

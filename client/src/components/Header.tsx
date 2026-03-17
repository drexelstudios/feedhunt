import { useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Plus, RefreshCw, LogOut, Sparkles, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Feed } from "@shared/schema";
import SettingsPanel from "@/components/SettingsPanel";

interface HeaderProps {
  onAddFeed: () => void;
  onCreateFeed: () => void;
}

export default function Header({ onAddFeed, onCreateFeed }: HeaderProps) {
  const { theme, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: feeds = [] } = useQuery<Feed[]>({ queryKey: ["/api/feeds"] });

  const handleRefreshAll = async () => {
    setRefreshing(true);
    await Promise.all(
      feeds.map((f) =>
        queryClient.invalidateQueries({ queryKey: [`/api/feeds/${f.id}/items`] })
      )
    );
    setTimeout(() => setRefreshing(false), 800);
  };

  // Get initials from email for avatar
  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  return (
    <>
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="flex items-center justify-between px-4 sm:px-6 h-14"
          style={{ maxWidth: "var(--content-wide)", margin: "0 auto" }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <svg
              width="28"
              height="28"
              viewBox="0 0 28 28"
              fill="none"
              aria-label="Feedhunt logo"
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
                fontSize: "calc(1.1rem * var(--font-scale, 1))",
                letterSpacing: "-0.03em",
                color: "hsl(var(--foreground))",
              }}
            >
              Feedhunt
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              data-testid="button-refresh-all"
              onClick={handleRefreshAll}
              className="p-2 rounded-lg transition-all"
              style={{ color: "hsl(var(--muted-foreground))" }}
              title="Refresh all feeds"
            >
              <RefreshCw
                size={16}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>

            <button
              data-testid="button-theme-toggle"
              onClick={toggle}
              className="p-2 rounded-lg transition-all"
              style={{ color: "hsl(var(--muted-foreground))" }}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button
              data-testid="button-settings"
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-lg transition-all"
              style={{ color: "hsl(var(--muted-foreground))" }}
              title="Display settings"
            >
              <Settings size={16} />
            </button>

            <Button
              data-testid="button-create-feed"
              onClick={onCreateFeed}
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs font-semibold flex"
            >
              <Sparkles size={13} />
              <span className="hidden sm:inline">Create Feed</span>
            </Button>

            <Button
              data-testid="button-add-feed"
              onClick={onAddFeed}
              size="sm"
              className="gap-1.5 h-8 text-xs font-semibold"
            >
              <Plus size={14} />
              Add Feed
            </Button>

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  data-testid="button-user-menu"
                  className="flex items-center justify-center rounded-full text-xs font-bold transition-all hover:opacity-80" style={{ width: "var(--btn-height-sm, 30px)", height: "var(--btn-height-sm, 30px)" }}
                  style={{
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    fontFamily: "var(--font-display)",
                  }}
                  title={user?.email}
                >
                  {initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <p
                    className="text-xs font-medium truncate"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {user?.email}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Signed in
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="button-sign-out"
                  onClick={signOut}
                  className="gap-2 cursor-pointer"
                  style={{ color: "hsl(var(--destructive))" }}
                >
                  <LogOut size={14} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

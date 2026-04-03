import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, RefreshCw, LogOut, Sparkles, Settings, Search, Rss } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Feed } from "@shared/schema";
import SettingsPanel from "@/components/SettingsPanel";

interface HeaderProps {
  onAddFeed: () => void;
  onCreateFeed: () => void;
  onSearchFeed: () => void;
}

export default function Header({ onAddFeed, onCreateFeed, onSearchFeed }: HeaderProps) {
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
    ? user.email.slice(0, 1).toUpperCase()
    : "?";

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
              data-testid="button-settings"
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-lg transition-all"
              style={{ color: "hsl(var(--muted-foreground))" }}
              title="Display settings"
            >
              <Settings size={16} />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid="button-add-feed"
                  size="sm"
                  className="gap-1.5 text-xs font-semibold"
                >
                  <Plus size={14} />
                  <span className="hidden sm:inline">Add Feed</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  data-testid="menu-add-rss"
                  className="gap-2 cursor-pointer text-xs"
                  onClick={onAddFeed}
                >
                  <Rss size={14} />
                  Add RSS Feed
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-search-feed"
                  className="gap-2 cursor-pointer text-xs"
                  onClick={onSearchFeed}
                >
                  <Search size={14} />
                  Search by Keyword
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="menu-create-feed"
                  className="gap-2 cursor-pointer text-xs"
                  onClick={onCreateFeed}
                >
                  <Sparkles size={14} />
                  Create with AI
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  data-testid="button-user-menu"
                  className="flex items-center justify-center rounded-full font-bold transition-all hover:opacity-80"
                  style={{
                    width: 36,
                    height: 36,
                    minWidth: 36,
                    flexShrink: 0,
                    fontSize: "0.75rem",
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

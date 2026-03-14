import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Feed, Category } from "@shared/schema";
import { useTheme } from "@/components/ThemeProvider";
import FeedWidget from "@/components/FeedWidget";
import AddFeedDialog from "@/components/AddFeedDialog";
import Header from "@/components/Header";
import PerplexityAttribution from "@/components/PerplexityAttribution";
import { Button } from "@/components/ui/button";
import { Plus, LayoutGrid, Columns, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Layout = "grid" | "columns";

export default function Dashboard() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout>("grid");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [showAddFeed, setShowAddFeed] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const { data: feeds = [], isLoading: feedsLoading } = useQuery<Feed[]>({
    queryKey: ["/api/feeds"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest("POST", "/api/feeds/reorder", { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feeds"] }),
  });

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id));
  };

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = feeds.findIndex((f) => f.id === Number(active.id));
      const newIndex = feeds.findIndex((f) => f.id === Number(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(feeds, oldIndex, newIndex);
      queryClient.setQueryData(["/api/feeds"], reordered);
      reorderMutation.mutate(reordered.map((f) => f.id));
    },
    [feeds, reorderMutation]
  );

  // Build category tabs
  const allCategories = ["All", ...Array.from(new Set(feeds.map((f) => f.category).filter(Boolean)))];

  const filteredFeeds =
    activeCategory === "All"
      ? feeds
      : feeds.filter((f) => f.category === activeCategory);

  const activeItem = activeId ? feeds.find((f) => f.id === activeId) : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "hsl(var(--background))" }}>
      <Header onAddFeed={() => setShowAddFeed(true)} />

      {/* Category tabs + layout toggle */}
      <div
        className="sticky top-[57px] z-30 border-b"
        style={{
          background: "hsl(var(--background))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 sm:px-6"
          style={{ maxWidth: "var(--content-wide)", margin: "0 auto" }}
        >
          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto py-2 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
            {allCategories.map((cat) => (
              <button
                key={cat}
                data-testid={`tab-${cat.toLowerCase()}`}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                style={
                  activeCategory === cat
                    ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
                    : {}
                }
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Layout toggle */}
          <div
            className="flex items-center rounded-lg p-0.5 flex-shrink-0"
            style={{ background: "hsl(var(--muted))" }}
          >
            <button
              data-testid="layout-grid"
              onClick={() => setLayout("grid")}
              className={cn(
                "p-1.5 rounded-md transition-all",
                layout === "grid"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Grid layout"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              data-testid="layout-columns"
              onClick={() => setLayout("columns")}
              className={cn(
                "p-1.5 rounded-md transition-all",
                layout === "columns"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Columns layout"
            >
              <Columns size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main
        className="flex-1 px-4 sm:px-6 py-6"
        style={{ maxWidth: "var(--content-wide)", margin: "0 auto", width: "100%" }}
      >
        {feedsLoading ? (
          <SkeletonGrid />
        ) : filteredFeeds.length === 0 ? (
          <EmptyState onAdd={() => setShowAddFeed(true)} />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredFeeds.map((f) => f.id)}
              strategy={rectSortingStrategy}
            >
              <div
                className={cn(
                  layout === "grid"
                    ? "feed-grid"
                    : "grid gap-4"
                )}
                style={
                  layout === "columns"
                    ? { gridTemplateColumns: "repeat(3, 1fr)" }
                    : undefined
                }
              >
                {filteredFeeds.map((feed, i) => (
                  <div
                    key={feed.id}
                    className="animate-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <FeedWidget
                      feed={feed}
                      isDragging={activeId === feed.id}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeItem ? (
                <div className="feed-widget dragging" style={{ width: 340, opacity: 0.9 }}>
                  <div className="widget-header">
                    <span className="feed-title">{activeItem.title}</span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {/* Footer */}
      <footer
        className="border-t py-4 px-6 flex items-center justify-between"
        style={{
          borderColor: "hsl(var(--border))",
          background: "hsl(var(--background))",
        }}
      >
        <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
          {feeds.length} feed{feeds.length !== 1 ? "s" : ""} · refreshes every 5 min
        </span>
        <PerplexityAttribution />
      </footer>

      <AddFeedDialog
        open={showAddFeed}
        onOpenChange={setShowAddFeed}
        categories={categories.map((c) => c.name)}
      />
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="feed-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="feed-widget"
          style={{ height: 280 }}
        >
          <div
            className="widget-header"
            style={{ borderBottom: "1px solid hsl(var(--border))" }}
          >
            <div className="skeleton" style={{ width: 16, height: 16, borderRadius: 3 }} />
            <div className="skeleton" style={{ flex: 1, height: 14 }} />
          </div>
          <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="skeleton" style={{ height: 13, width: "90%" }} />
                <div className="skeleton" style={{ height: 13, width: "65%" }} />
                <div className="skeleton" style={{ height: 11, width: "40%", marginTop: 2 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: "var(--space-16) var(--space-8)" }}
    >
      <div
        className="mb-6 rounded-2xl p-5"
        style={{ background: "hsl(var(--accent))" }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          style={{ color: "hsl(var(--primary))" }}
        >
          <rect x="4" y="8" width="12" height="2" rx="1" fill="currentColor" opacity="0.4"/>
          <rect x="4" y="14" width="32" height="2" rx="1" fill="currentColor" opacity="0.4"/>
          <rect x="4" y="20" width="24" height="2" rx="1" fill="currentColor" opacity="0.3"/>
          <rect x="4" y="26" width="28" height="2" rx="1" fill="currentColor" opacity="0.2"/>
          <circle cx="32" cy="28" r="8" fill="none" stroke="currentColor" strokeWidth="2"/>
          <line x1="29" y1="28" x2="35" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <line x1="32" y1="25" x2="32" y2="31" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <h2
        className="mb-2 font-bold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-lg)",
          color: "hsl(var(--foreground))",
        }}
      >
        No feeds yet
      </h2>
      <p
        className="mb-6 max-w-xs"
        style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}
      >
        Add RSS feeds to start building your personal news dashboard.
      </p>
      <Button
        data-testid="empty-add-feed"
        onClick={onAdd}
        className="gap-2"
      >
        <Plus size={16} />
        Add your first feed
      </Button>
    </div>
  );
}

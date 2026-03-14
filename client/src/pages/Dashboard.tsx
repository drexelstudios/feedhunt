import { useState, useCallback, useRef, useEffect } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Feed, Category } from "@shared/schema";
import FeedWidget from "@/components/FeedWidget";
import AddFeedDialog from "@/components/AddFeedDialog";
import Header from "@/components/Header";
import PerplexityAttribution from "@/components/PerplexityAttribution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, LayoutGrid, Columns, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Layout = "grid" | "columns";

export default function Dashboard() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout>("grid");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [showAddFeed, setShowAddFeed] = useState(false);
  // Inline rename state
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // New tab inline input
  const [showNewTab, setShowNewTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const newTabInputRef = useRef<HTMLInputElement>(null);
  // Delete confirm
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const { data: feeds = [], isLoading: feedsLoading } = useQuery<Feed[]>({
    queryKey: ["/api/feeds"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest("POST", "/api/feeds/reorder", { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feeds"] }),
  });

  const createCategoryMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/categories", { name, position: categories.length }),
    onSuccess: async (res) => {
      const cat = await (res as Response).json();
      await queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setActiveCategory(cat.name);
      setShowNewTab(false);
      setNewTabName("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const renameCategoryMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/categories/${id}`, { name }),
    onSuccess: async (res, { name }) => {
      const cat = await (res as Response).json();
      await queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      setActiveCategory(cat.name);
      setRenamingId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/categories/${id}`, { replaceName: "General" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      setActiveCategory("All");
      setDeletingCategory(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId !== null) renameInputRef.current?.focus();
  }, [renamingId]);

  // Focus new tab input when it appears
  useEffect(() => {
    if (showNewTab) newTabInputRef.current?.focus();
  }, [showNewTab]);

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));

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

  // ── Tab helpers ──────────────────────────────────────────────────────────────
  // Use categories from DB (user-managed) for the tab list
  const categoryNames = categories.map((c) => c.name);
  const allTabs = ["All", ...categoryNames];

  const filteredFeeds =
    activeCategory === "All"
      ? feeds
      : feeds.filter((f) => f.category === activeCategory);

  const activeItem = activeId ? feeds.find((f) => f.id === activeId) : null;

  const startRename = (cat: Category) => {
    setRenamingId(cat.id);
    setRenameValue(cat.name);
  };

  const commitRename = () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    renameCategoryMutation.mutate({ id: renamingId, name: renameValue.trim() });
  };

  const commitNewTab = () => {
    if (!newTabName.trim()) { setShowNewTab(false); return; }
    createCategoryMutation.mutate(newTabName.trim());
  };

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
          <div className="flex items-center gap-1 overflow-x-auto py-2" style={{ scrollbarWidth: "none" }}>
            {/* "All" tab — never editable */}
            <button
              key="All"
              data-testid="tab-all"
              onClick={() => setActiveCategory("All")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                activeCategory === "All"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              style={
                activeCategory === "All"
                  ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
                  : {}
              }
            >
              All
            </button>

            {/* User-managed category tabs */}
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center group relative">
                {renamingId === cat.id ? (
                  // Inline rename input
                  <div className="flex items-center gap-1 px-1">
                    <Input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-6 text-xs px-2 w-24"
                      style={{ fontSize: "var(--text-xs)" }}
                    />
                    <button
                      onClick={commitRename}
                      className="p-0.5 rounded"
                      style={{ color: "hsl(var(--primary))" }}
                      title="Save"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="p-0.5 rounded"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  // Normal tab with hover menu
                  <div className="flex items-center">
                    <button
                      data-testid={`tab-${cat.name.toLowerCase()}`}
                      onClick={() => setActiveCategory(cat.name)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                        activeCategory === cat.name
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                      style={
                        activeCategory === cat.name
                          ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
                          : {}
                      }
                    >
                      {cat.name}
                    </button>

                    {/* Context menu trigger — visible on hover */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          data-testid={`tab-menu-${cat.name.toLowerCase()}`}
                          className="opacity-0 group-hover:opacity-100 ml-0.5 p-0.5 rounded transition-opacity"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal size={12} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-36">
                        <DropdownMenuItem
                          className="gap-2 cursor-pointer text-xs"
                          onClick={() => startRename(cat)}
                        >
                          <Pencil size={12} />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 cursor-pointer text-xs"
                          style={{ color: "hsl(var(--destructive))" }}
                          onClick={() => setDeletingCategory(cat)}
                        >
                          <Trash2 size={12} />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            ))}

            {/* New tab inline input */}
            {showNewTab ? (
              <div className="flex items-center gap-1 px-1">
                <Input
                  ref={newTabInputRef}
                  placeholder="Tab name"
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNewTab();
                    if (e.key === "Escape") { setShowNewTab(false); setNewTabName(""); }
                  }}
                  className="h-6 text-xs px-2 w-24"
                />
                <button
                  onClick={commitNewTab}
                  className="p-0.5 rounded"
                  style={{ color: "hsl(var(--primary))" }}
                  title="Create"
                  disabled={createCategoryMutation.isPending}
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={() => { setShowNewTab(false); setNewTabName(""); }}
                  className="p-0.5 rounded"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                data-testid="button-new-tab"
                onClick={() => setShowNewTab(true)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs whitespace-nowrap transition-all"
                style={{ color: "hsl(var(--muted-foreground))" }}
                title="New tab"
              >
                <Plus size={12} />
                New tab
              </button>
            )}
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
          <EmptyState onAdd={() => setShowAddFeed(true)} activeCategory={activeCategory} />
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
        categories={categoryNames}
      />

      {/* Delete category confirmation */}
      <AlertDialog
        open={!!deletingCategory}
        onOpenChange={(open) => { if (!open) setDeletingCategory(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
            >
              Delete "{deletingCategory?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All feeds in this tab will be moved to <strong>General</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingCategory && deleteCategoryMutation.mutate(deletingCategory.id)}
              style={{ background: "hsl(var(--destructive))", color: "white" }}
            >
              Delete tab
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function EmptyState({ onAdd, activeCategory }: { onAdd: () => void; activeCategory: string }) {
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
        {activeCategory === "All" ? "No feeds yet" : `No feeds in "${activeCategory}"`}
      </h2>
      <p
        className="mb-6 max-w-xs"
        style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}
      >
        {activeCategory === "All"
          ? "Add RSS feeds to start building your personal news dashboard."
          : `Add a feed and assign it to the "${activeCategory}" category.`}
      </p>
      <Button
        data-testid="empty-add-feed"
        onClick={onAdd}
        className="gap-2"
      >
        <Plus size={16} />
        Add {activeCategory === "All" ? "your first feed" : "a feed"}
      </Button>
    </div>
  );
}

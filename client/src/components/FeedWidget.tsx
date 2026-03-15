import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Feed } from "@shared/schema";
import { timeAgo, getFaviconUrl, getCategoryColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Trash2,
  ExternalLink,
  GripVertical,
  Settings,
  Mail,
} from "lucide-react";
import EditFeedDialog from "@/components/EditFeedDialog";

interface FeedWidgetProps {
  feed: Feed;
  isDragging?: boolean;
  // Reading pane props (Phase 4/6)
  selectedItemId?: string | null;
  onItemClick?: (item: EnrichedFeedItem) => void;
}

export interface FeedItem {
  title: string;
  link: string;
  pubDate: string;
  summary: string;
  author: string;
  thumbnail: string | null;
  guid: string;
  // Newsletter-specific (present when sourceType === 'newsletter')
  sourceType?: "rss" | "newsletter";
  emailFrom?: string | null;
  viewOnlineUrl?: string | null;
}

// FeedItem enriched with Supabase metadata (id, thumbnail override, etc.)
export interface EnrichedFeedItem extends FeedItem {
  itemId: string | null;       // Supabase feed_items.id (UUID) — null until upserted
  thumbnailUrl: string | null; // From Supabase (may differ from RSS thumbnail)
  hasBody: boolean;
  readingTimeMinutes: number | null;
  feedTitle: string;
  feedId: number;
  // Newsletter-specific (passed through from FeedItem)
  sourceType?: "rss" | "newsletter";
  emailFrom?: string | null;
  viewOnlineUrl?: string | null;
}

// Item metadata map returned by /api/feeds/:id/item-meta
interface ItemMeta {
  id: string;
  thumbnail_url: string | null;
  has_body: boolean;
  reading_time_minutes: number | null;
}

export default function FeedWidget({ feed, isDragging, selectedItemId, onItemClick }: FeedWidgetProps) {
  const [showEdit, setShowEdit] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } =
    useSortable({ id: feed.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  };

  const { data, isLoading, isError } = useQuery<{ items: FeedItem[]; cached: boolean }>({
    queryKey: [`/api/feeds/${feed.id}/items`],
    staleTime: 4 * 60 * 1000,
  });

  // Detect feed type from first item (newsletter items have sourceType set)
  const isNewsletterFeed = (data?.items ?? []).some((item) => item.sourceType === "newsletter");

  // Item metadata from Supabase (stable IDs + thumbnails) — only for RSS feeds
  const { data: itemMeta } = useQuery<Record<string, ItemMeta>>({
    queryKey: [`/api/feeds/${feed.id}/item-meta`],
    // Newsletter items arrive pre-enriched; skip the item-meta query for them
    enabled: !!data?.items?.length && !isNewsletterFeed,
    staleTime: 5 * 60 * 1000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/feeds/${feed.id}/refresh`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/feeds/${feed.id}/items`] });
      queryClient.invalidateQueries({ queryKey: [`/api/feeds/${feed.id}/item-meta`] });
    },
  });

  const toggleCollapseMutation = useMutation({
    mutationFn: (collapsed: boolean) =>
      apiRequest("PATCH", `/api/feeds/${feed.id}`, { collapsed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feeds"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/feeds/${feed.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feeds"] }),
  });

  const faviconUrl = feed.favicon || getFaviconUrl(feed.url);
  const categoryColor = getCategoryColor(feed.category);
  const items = data?.items || [];

  // Enrich items with Supabase metadata
  const enrichedItems: EnrichedFeedItem[] = items.map((item) => {
    if (item.sourceType === "newsletter") {
      // Newsletter items arrive fully enriched from the API — no item-meta needed
      return {
        ...item,
        itemId: item.guid ?? null,   // guid IS the Supabase UUID for newsletter items
        thumbnailUrl: item.thumbnail ?? null,
        hasBody: true,               // newsletters always have body_html
        readingTimeMinutes: null,
        feedTitle: feed.title,
        feedId: feed.id,
        sourceType: "newsletter",
        emailFrom: item.emailFrom ?? null,
        viewOnlineUrl: item.viewOnlineUrl ?? null,
      };
    }

    // RSS path — merge item-meta as before
    const meta = itemMeta?.[item.guid];
    return {
      ...item,
      itemId: meta?.id ?? null,
      thumbnailUrl: meta?.thumbnail_url ?? item.thumbnail ?? null,
      hasBody: meta?.has_body ?? false,
      readingTimeMinutes: meta?.reading_time_minutes ?? null,
      feedTitle: feed.title,
      feedId: feed.id,
      sourceType: "rss",
    };
  });

  const handleItemClick = useCallback(
    (e: React.MouseEvent, item: EnrichedFeedItem) => {
      if (!onItemClick) return;
      // Only intercept if we have a reading pane handler
      e.preventDefault();
      onItemClick(item);
    },
    [onItemClick]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("feed-widget", isDragging && "dragging")}
      data-testid={`widget-feed-${feed.id}`}
    >
      {/* Widget header */}
      <div className="widget-header" {...attributes} {...listeners}>
        <GripVertical size={12} className="text-muted-foreground flex-shrink-0 opacity-40" />

        {/* Favicon */}
        <img
          src={faviconUrl}
          alt=""
          className="favicon"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        {/* Category dot */}
        <div
          className="category-dot flex-shrink-0"
          style={{ background: categoryColor }}
          title={feed.category}
        />

        <span className="feed-title">{feed.title}</span>

        {/* Actions */}
        <div className="widget-actions">
          {/* Refresh button — RSS only; newsletters sync via IMAP */}
          {!isNewsletterFeed && (
            <button
              data-testid={`button-refresh-${feed.id}`}
              onClick={(e) => { e.stopPropagation(); refreshMutation.mutate(); }}
              className="p-1 rounded transition-colors hover:bg-accent"
              style={{ color: "hsl(var(--muted-foreground))" }}
              title="Refresh"
            >
              <RefreshCw
                size={12}
                className={refreshMutation.isPending ? "animate-spin" : ""}
              />
            </button>
          )}
          <button
            data-testid={`button-settings-${feed.id}`}
            onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}
            className="p-1 rounded transition-colors hover:bg-accent"
            style={{ color: "hsl(var(--muted-foreground))" }}
            title="Settings"
          >
            <Settings size={12} />
          </button>
          <button
            data-testid={`button-collapse-${feed.id}`}
            onClick={(e) => { e.stopPropagation(); toggleCollapseMutation.mutate(!feed.collapsed); }}
            className="p-1 rounded transition-colors hover:bg-accent"
            style={{ color: "hsl(var(--muted-foreground))" }}
            title={feed.collapsed ? "Expand" : "Collapse"}
          >
            {feed.collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            data-testid={`button-delete-${feed.id}`}
            onClick={(e) => { e.stopPropagation(); if (confirm(`Remove "${feed.title}"?`)) deleteMutation.mutate(); }}
            className="p-1 rounded transition-colors hover:bg-destructive/20"
            style={{ color: "hsl(var(--muted-foreground))" }}
            title="Remove feed"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      {!feed.collapsed && (
        <div>
          {isLoading ? (
            <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div className="skeleton" style={{ height: 13, width: "88%" }} />
                  <div className="skeleton" style={{ height: 13, width: "60%" }} />
                  <div className="skeleton" style={{ height: 11, width: "35%", marginTop: 2 }} />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div
              style={{ padding: "1.5rem 1rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "var(--text-xs)" }}
            >
              <p>Could not load feed.</p>
              <button
                onClick={() => refreshMutation.mutate()}
                className="mt-2 underline"
                style={{ color: "hsl(var(--primary))" }}
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <div
              style={{ padding: "1.5rem 1rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "var(--text-xs)" }}
            >
              No items found in this feed.
            </div>
          ) : (
            <ul className="feed-items">
              {enrichedItems.map((item, i) => {
                const isActive = item.itemId != null && item.itemId === selectedItemId;
                const thumb = item.thumbnailUrl;
                const isNewsletter = item.sourceType === "newsletter";

                return (
                  <li
                    key={i}
                    className={cn("feed-item", isActive && "feed-item--active")}
                  >
                    {/* Phase 4: Thumbnail — only render if present, no placeholder */}
                    {thumb && (
                      <div className="feed-item-thumb">
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            // Hide container on error — no broken icon, no layout shift
                            const parent = (e.target as HTMLImageElement).closest(".feed-item-thumb") as HTMLElement | null;
                            if (parent) parent.style.display = "none";
                          }}
                        />
                      </div>
                    )}

                    <a
                      href={item.link}
                      target={onItemClick ? undefined : "_blank"}
                      rel="noopener noreferrer"
                      data-testid={`item-link-${feed.id}-${i}`}
                      onClick={onItemClick ? (e) => handleItemClick(e, item) : undefined}
                    >
                      <div className="feed-item-title">{item.title}</div>
                      {item.summary && (
                        <div className="feed-item-summary">{item.summary}</div>
                      )}
                      <div className="feed-item-meta">
                        {/* Newsletter: show sender instead of author */}
                        {isNewsletter && item.emailFrom ? (
                          <span
                            className="flex items-center gap-1"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            <Mail size={9} aria-hidden />
                            {item.emailFrom}
                          </span>
                        ) : (
                          item.author && <span>{item.author}</span>
                        )}
                        {((isNewsletter && item.emailFrom) || (!isNewsletter && item.author)) && item.pubDate && (
                          <span>·</span>
                        )}
                        {item.pubDate && <span>{timeAgo(item.pubDate)}</span>}
                        {!isNewsletter && item.readingTimeMinutes && (
                          <>
                            <span>·</span>
                            <span>{item.readingTimeMinutes} min read</span>
                          </>
                        )}
                        {!isNewsletter && (
                          <ExternalLink size={9} className="ml-auto opacity-40" />
                        )}
                        {isNewsletter && (
                          <Mail size={9} className="ml-auto opacity-30" aria-label="Newsletter" />
                        )}
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer with feed URL */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{
              borderTop: "1px solid hsl(var(--border))",
              background: "hsl(var(--muted) / 0.4)",
            }}
          >
            <a
              href={feed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs truncate max-w-[200px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {feed.category}
            </a>
            {data?.cached === false && (
              <span className="text-xs" style={{ color: "hsl(var(--success, 142 60% 45%))" }}>
                live
              </span>
            )}
          </div>
        </div>
      )}

      <EditFeedDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        feed={feed}
      />
    </div>
  );
}

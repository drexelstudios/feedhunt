/**
 * ReadingPane — Phases 5, 7, 8
 *
 * A single component that renders as:
 *   - Desktop (>1024px): fixed 480px side pane sliding in from the right
 *   - Tablet (768–1024px): fixed 420px side pane
 *   - Mobile (<768px): full-screen push view (role="dialog")
 *
 * Content is loaded on demand via /api/extract, then cached in Supabase feed_items.
 * DOMPurify already ran server-side before body_html was stored — noted in comment.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { EnrichedFeedItem } from "@/components/FeedWidget";
import { X, ExternalLink, ArrowLeft, Share2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFaviconUrl } from "@/lib/utils";

interface ReadingPaneProps {
  item: EnrichedFeedItem | null;
  isOpen: boolean;
  onClose: () => void;
}

interface ExtractResult {
  title?: string;
  byline?: string;
  content?: string;
  excerpt?: string;
  hero_image_url?: string | null;
  reading_time_minutes?: number;
  fallback: boolean;
  error?: string;
}

export default function ReadingPane({ item, isOpen, onClose }: ReadingPaneProps) {
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastItemIdRef = useRef<string | null>(null);

  // Mobile swipe tracking
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchCurrentX = useRef(0);
  const swipeActive = useRef(false);

  // ── Content loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !item) return;

    // Same item already shown — don't re-fetch
    if (item.itemId === lastItemIdRef.current && extractResult && !extractResult.fallback) return;
    lastItemIdRef.current = item.itemId;
    setExtractResult(null);

    if (!item.itemId) {
      // Not upserted yet — fallback
      setExtractResult({ fallback: true, error: "Article not yet indexed" });
      return;
    }

    // If body already extracted, fetch cached version
    if (item.hasBody) {
      setLoading(true);
      apiRequest("GET", `/api/feed-items/${item.itemId}`)
        .then((r) => (r as Response).json())
        .then((data) => {
          setExtractResult({
            title: data.title,
            byline: data.author,
            content: data.body_html,
            excerpt: data.summary,
            hero_image_url: data.thumbnail_url,
            reading_time_minutes: data.reading_time_minutes,
            fallback: false,
          });
        })
        .catch(() => setExtractResult({ fallback: true, error: "Failed to load cached content" }))
        .finally(() => setLoading(false));
      return;
    }

    // Otherwise extract via Readability
    if (!item.link) {
      setExtractResult({ fallback: true, error: "No article URL" });
      return;
    }

    setLoading(true);
    apiRequest("POST", "/api/extract", { url: item.link, item_id: item.itemId })
      .then((r) => (r as Response).json())
      .then((data: ExtractResult) => setExtractResult(data))
      .catch(() => setExtractResult({ fallback: true, error: "Extraction failed" }))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.itemId, item?.link]);

  // ── Focus management ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setTimeout(() => closeButtonRef.current?.focus(), 60);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // ── Keyboard: Escape closes ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // ── Mobile swipe-to-close (touch events on the pane) ─────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchCurrentX.current = e.touches[0].clientX;
    swipeActive.current = false;
    if (paneRef.current) paneRef.current.style.transition = "none";
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    touchCurrentX.current = e.touches[0].clientX;

    // Only track rightward horizontal swipe, abort if vertical scroll detected
    if (dy < 40 && dx > 0) {
      swipeActive.current = true;
      if (paneRef.current) {
        paneRef.current.style.transform = `translateX(${dx}px)`;
      }
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const dx = touchCurrentX.current - touchStartX.current;
    const dy = Math.abs(touchCurrentX.current - touchStartY.current);
    if (paneRef.current) {
      paneRef.current.style.transition = "transform 200ms ease";
      if (swipeActive.current && dx > 80 && dy < 40) {
        paneRef.current.style.transform = "translateX(100%)";
        setTimeout(onClose, 200);
      } else {
        paneRef.current.style.transform = "";
      }
    }
    swipeActive.current = false;
  }, [onClose]);

  // ── Share ────────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    const url = item?.link || "";
    const title = item?.title || "";
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2000);
    } catch { /* silent */ }
  }, [item]);

  if (!item) return null;

  const heroUrl = extractResult?.hero_image_url ?? item.thumbnailUrl ?? null;
  const displayTitle = extractResult?.title || item.title;
  const displayByline = extractResult?.byline || item.author || null;
  const readingTime = extractResult?.reading_time_minutes ?? item.readingTimeMinutes ?? null;
  const faviconUrl = getFaviconUrl(item.link);
  const formattedDate = item.pubDate
    ? new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <>
      {/* Scrim — dims the card grid on mobile when pane is open */}
      {isOpen && (
        <div
          className="reading-pane-scrim"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        ref={paneRef}
        // Desktop/tablet: complementary landmark; mobile: dialog
        role={isOpen ? "dialog" : "complementary"}
        aria-modal={isOpen ? "true" : undefined}
        aria-label="Article reader"
        className={cn("reading-pane", isOpen && "reading-pane--open")}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* ── Fixed header ────────────────────────────────────────────────── */}
        <div className="reading-pane__header">
          {/* Mobile: back chevron. Desktop: X close. CSS hides/shows each. */}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close reading pane"
            className="reading-pane__close reading-pane__close--desktop"
          >
            <X size={16} />
          </button>
          <button
            onClick={onClose}
            aria-label="Back to feed"
            className="reading-pane__close reading-pane__close--mobile"
          >
            <ArrowLeft size={18} />
            <span>Feed</span>
          </button>

          {/* Feed identity — centered */}
          <div className="reading-pane__feed-name">
            <img
              src={faviconUrl}
              alt=""
              width={14}
              height={14}
              style={{ borderRadius: 3, flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span>{item.feedTitle}</span>
          </div>

          {/* Desktop: open original. Mobile: share. */}
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open original article"
            className="reading-pane__external reading-pane__external--desktop"
          >
            <ExternalLink size={15} />
          </a>
          <button
            onClick={handleShare}
            aria-label="Share article"
            className="reading-pane__external reading-pane__external--mobile"
          >
            <Share2 size={16} />
          </button>
        </div>

        {/* ── Hero image ──────────────────────────────────────────────────── */}
        {heroUrl && (
          <div className="reading-pane__hero">
            <img
              src={heroUrl}
              alt=""
              loading="lazy"
              onError={(e) => {
                const el = (e.target as HTMLImageElement).closest(".reading-pane__hero") as HTMLElement | null;
                if (el) el.style.display = "none";
              }}
            />
          </div>
        )}

        {/* ── Scrollable content ───────────────────────────────────────────── */}
        <div className="reading-pane__scroll">
          <div className="reading-pane__inner">

            {/* Article header */}
            <h1 className="reading-pane__title">{displayTitle}</h1>

            <div className="reading-pane__meta">
              {displayByline && <span>{displayByline}</span>}
              {displayByline && formattedDate && <span aria-hidden>·</span>}
              {formattedDate && <span>{formattedDate}</span>}
              {readingTime && (
                <>
                  <span aria-hidden>·</span>
                  <span className="reading-pane__reading-time">
                    <Clock size={10} aria-hidden />
                    {readingTime} min read
                  </span>
                </>
              )}
            </div>

            {/* RSS description as preview while loading */}
            {loading && item.summary && (
              <p className="reading-pane__excerpt">{item.summary}</p>
            )}

            {/* Loading skeleton */}
            {loading && <ReadingSkeleton />}

            {/* Fallback */}
            {!loading && extractResult?.fallback && (
              <FallbackState url={item.link} />
            )}

            {/* Article body
                NOTE: DOMPurify sanitized server-side in /api/extract before Supabase storage.
                This is safe to render as HTML. */}
            {!loading && extractResult && !extractResult.fallback && extractResult.content && (
              <div
                className="reading-pane__body"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: extractResult.content }}
              />
            )}

            {/* Footer */}
            {!loading && (
              <div className="reading-pane__footer">
                <a href={item.link} target="_blank" rel="noopener noreferrer">
                  Read original article →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* "Link copied" toast */}
      <div
        className={cn("reading-pane__toast", toastVisible && "reading-pane__toast--visible")}
        role="status"
        aria-live="polite"
      >
        Link copied
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ReadingSkeleton() {
  return (
    <div className="reading-skeleton" aria-hidden="true">
      {[100, 85, 100, 60].map((w, i) => (
        <div
          key={i}
          className="skeleton reading-skeleton__line"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

function FallbackState({ url }: { url: string }) {
  return (
    <div className="reading-fallback">
      <p className="reading-fallback__message">
        This article couldn't be loaded in reader mode.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="reading-fallback__cta"
      >
        Open in browser →
      </a>
    </div>
  );
}

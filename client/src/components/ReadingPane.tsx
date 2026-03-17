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
 *
 * Newsletter items: body_html is pre-stored at IMAP fetch time. When item.sourceType
 * === 'newsletter' and item.hasBody === true, we serve the cached body directly from
 * /api/feed-items/:id without calling /api/extract at all.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { EnrichedFeedItem } from "@/components/FeedWidget";
import { X, ExternalLink, ArrowLeft, Share2, Clock, Mail } from "lucide-react";
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

/**
 * Wraps raw email HTML in a minimal document so the iframe renders correctly.
 * Injects an img-constrain style to prevent wide images from causing horizontal scroll.
 * The sandbox="allow-same-origin allow-popups" attribute means:
 *   - Links open in a new tab (allow-popups)
 *   - The srcdoc can read its own DOM (allow-same-origin, needed for resize)
 *   - Scripts are blocked (no allow-scripts) — intentional security boundary
 */
function buildNewsletterSrcdoc(html: string): string {
  // If the email already has a full <html> document, inject our style into <head>.
  // Otherwise wrap the fragment in a minimal document.
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const styleTag = `<style>
    img { max-width: 100% !important; height: auto !important; }
    body { margin: 0; padding: 0; }
  </style>`;

  if (hasHtmlTag) {
    // Inject before </head> if present, else right after <html>
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${styleTag}</head>`);
    }
    return html.replace(/<html[\s>][^>]*>/i, (m) => `${m}${styleTag}`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${styleTag}</head><body>${html}</body></html>`;
}

export default function ReadingPane({ item, isOpen, onClose }: ReadingPaneProps) {
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastItemIdRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Mobile swipe tracking
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchCurrentX = useRef(0);
  const swipeActive = useRef(false);

  // ── Content loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !item) return;

    // Same item already shown with good content — don't re-fetch.
    // Use link as the stable key since itemId may be null on first open.
    const itemKey = item.itemId ?? item.link;
    if (itemKey === lastItemIdRef.current && extractResult && !extractResult.fallback) return;
    lastItemIdRef.current = itemKey;
    setExtractResult(null);

    const isNewsletter = item.sourceType === "newsletter";

    // ── Newsletter path ──────────────────────────────────────────────────────
    // Newsletters have body_html stored at IMAP fetch time. Run it through
    // /api/extract with item_id so Readability cleans it up, same as RSS.
    // The server detects source_type='newsletter' and skips the HTTP fetch.
    if (isNewsletter && item.itemId) {
      setLoading(true);
      apiRequest("POST", "/api/extract", {
        url: item.viewOnlineUrl || item.link || `newsletter:${item.itemId}`,
        item_id: item.itemId,
      })
        .then((r) => (r as Response).json())
        .then((data: ExtractResult) => setExtractResult(data))
        .catch(() => setExtractResult({ fallback: true, error: "Failed to load newsletter content" }))
        .finally(() => setLoading(false));
      return;
    }

    // ── RSS path (existing logic) ─────────────────────────────────────────────

    // If body already extracted and we have a stable DB id, serve from cache
    if (item.hasBody && item.itemId) {
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

    // No URL means we truly can't do anything
    if (!item.link) {
      setExtractResult({ fallback: true, error: "No article URL" });
      return;
    }

    // Extract via Readability. item_id may be null if the upsert hasn't completed yet —
    // the server handles this gracefully (extracts but skips the DB persist).
    setLoading(true);
    apiRequest("POST", "/api/extract", {
      url: item.link,
      ...(item.itemId ? { item_id: item.itemId } : {}),
    })
      .then((r) => (r as Response).json())
      .then((data: ExtractResult) => setExtractResult(data))
      .catch((e: any) => setExtractResult({ fallback: true, error: e?.message || "Extraction failed" }))
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
    const url = item?.viewOnlineUrl || item?.link || "";
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

  // ── iframe scale-to-fit + auto-height ───────────────────────────────────────
  // Email HTML is designed for ~600px wide viewports. When the reading pane is
  // narrower (tablet/mobile), we scale the iframe down proportionally using
  // CSS transform — the same technique Gmail mobile uses. This preserves the
  // email's intended layout without reflowing its table-based structure.
  //
  // Steps:
  //   1. Let the iframe render at its natural content width
  //   2. Compute scale = pane width / content width  (≤ 1 — never upscale)
  //   3. Apply transform: scale(scale) with transform-origin: top left
  //   4. Set the wrapper height to contentHeight * scale so no gap appears below
  const resizeIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const fit = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc || !doc.body) return;

        // Reset transform so we read the true natural dimensions
        iframe.style.transform = "";
        iframe.style.width = "100%";

        // Natural content width (the email's own layout width, often 600px)
        const naturalW = doc.documentElement.scrollWidth || doc.body.scrollWidth || 600;
        // Container (pane) width
        const containerW = iframe.parentElement?.clientWidth || naturalW;

        const scale = containerW >= naturalW ? 1 : containerW / naturalW;

        // Pin iframe to its natural width so the email doesn't reflow
        iframe.style.width = `${naturalW}px`;

        // Natural content height at full width
        const naturalH = doc.documentElement.scrollHeight || doc.body.scrollHeight || 0;

        // Apply proportional scale from the top-left corner
        iframe.style.transform = `scale(${scale})`;
        iframe.style.transformOrigin = "top left";
        iframe.style.height = `${naturalH}px`;

        // Collapse the wrapper to the visually-scaled height so no blank gap below
        const wrapper = iframe.parentElement as HTMLElement | null;
        if (wrapper) wrapper.style.height = `${Math.ceil(naturalH * scale)}px`;
      } catch {
        // Cross-origin guard — shouldn't happen with srcdoc but be safe
      }
    };

    fit();
    // Re-run after images/fonts finish loading
    setTimeout(fit, 300);
    setTimeout(fit, 1200);
  }, []);

  if (!item) return null;

  const isNewsletter = item.sourceType === "newsletter";
  // Newsletters render their own header images inline in the email HTML,
  // so suppress the extracted hero to avoid showing it twice.
  const heroUrl = isNewsletter ? null : (extractResult?.hero_image_url ?? item.thumbnailUrl ?? null);
  const displayTitle = extractResult?.title || item.title;
  const displayByline = extractResult?.byline || item.author || null;
  const readingTime = extractResult?.reading_time_minutes ?? item.readingTimeMinutes ?? null;
  const faviconUrl = getFaviconUrl(item.link);
  const formattedDate = item.pubDate
    ? new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  // For newsletters: "Open original" uses viewOnlineUrl if available; hide if absent
  const externalUrl = isNewsletter
    ? (item.viewOnlineUrl || null)
    : item.link;

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
            {isNewsletter ? (
              <Mail
                size={14}
                style={{ flexShrink: 0, color: "hsl(var(--muted-foreground))" }}
                aria-hidden
              />
            ) : (
              <img
                src={faviconUrl}
                alt=""
                width={14}
                height={14}
                style={{ borderRadius: 3, flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span>{item.feedTitle}</span>
          </div>

          {/* Desktop: open original (hidden for newsletters without viewOnlineUrl).
              Mobile: share button. */}
          {externalUrl ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open original article"
              className="reading-pane__external reading-pane__external--desktop"
            >
              <ExternalLink size={15} />
            </a>
          ) : (
            /* Placeholder to keep header layout balanced when no external link */
            <span className="reading-pane__external reading-pane__external--desktop" aria-hidden style={{ visibility: "hidden" }}>
              <ExternalLink size={15} />
            </span>
          )}
          <button
            onClick={handleShare}
            aria-label="Share article"
            className="reading-pane__external reading-pane__external--mobile"
          >
            <Share2 size={16} />
          </button>
        </div>

        {/* ── Scrollable content ───────────────────────────────────────────── */}
        <div className="reading-pane__scroll">
          {/* ── Hero image (scrolls with content) ──────────────────────────── */}
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
          <div className={cn("reading-pane__inner", isNewsletter && "reading-pane__inner--newsletter")}>

            {/* Article header */}
            <h1 className="reading-pane__title">{displayTitle}</h1>

            <div className="reading-pane__meta">
              {/* Newsletter: show "From: sender" line */}
              {isNewsletter && item.emailFrom && (
                <span
                  className="flex items-center gap-1"
                  style={{ color: "hsl(var(--muted-foreground))", fontSize: "var(--text-xs)" }}
                >
                  <Mail size={10} aria-hidden />
                  {item.emailFrom}
                </span>
              )}
              {isNewsletter && item.emailFrom && formattedDate && (
                <span aria-hidden>·</span>
              )}
              {/* RSS: show byline */}
              {!isNewsletter && displayByline && <span>{displayByline}</span>}
              {!isNewsletter && displayByline && formattedDate && <span aria-hidden>·</span>}
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
              <FallbackState url={externalUrl || item.link} error={extractResult.error} />
            )}

            {/* Article body — RSS only (newsletters render outside __inner below) */}
            {!isNewsletter && !loading && extractResult && !extractResult.fallback && extractResult.content && (
              <div
                className="reading-pane__body"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: extractResult.content }}
              />
            )}

            {/* Footer — only show "Read original" when there's an external URL (RSS only) */}
            {!isNewsletter && !loading && externalUrl && (
              <div className="reading-pane__footer">
                <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                  Read original article →
                </a>
              </div>
            )}
          </div>

          {/* Newsletter body — sandboxed iframe so the app's CSS never bleeds in.
              srcdoc receives the full email HTML (already DOMPurify-sanitized server-side).
              sandbox="allow-same-origin allow-popups":
                - allow-same-origin: lets us read scrollWidth/scrollHeight for scaling
                - allow-popups: lets links open in a new tab
                - scripts intentionally blocked (no allow-scripts)
              The wrapper div receives a dynamic height from resizeIframe so the
              scaled-down content doesn't leave a blank gap below it. */}
          {isNewsletter && !loading && extractResult && !extractResult.fallback && extractResult.content && (
            <div
              style={{
                width: "100%",
                overflow: "hidden",
                // Height set dynamically by resizeIframe to match the scaled content
                height: "0px",
              }}
            >
              <iframe
                ref={iframeRef}
                title="Newsletter content"
                sandbox="allow-same-origin allow-popups"
                srcDoc={buildNewsletterSrcdoc(extractResult.content)}
                style={{
                  border: "none",
                  display: "block",
                  // width, height, transform all set dynamically by resizeIframe
                  transformOrigin: "top left",
                }}
                onLoad={resizeIframe}
              />
            </div>
          )}

          {/* Newsletter footer */}
          {isNewsletter && !loading && externalUrl && (
            <div className="reading-pane__footer" style={{ padding: "var(--space-4) var(--space-6)" }}>
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                View online →
              </a>
            </div>
          )}
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

function FallbackState({ url, error }: { url: string; error?: string }) {
  return (
    <div className="reading-fallback">
      <p className="reading-fallback__message">
        This article couldn't be loaded in reader mode.
      </p>
      {error && (
        <p style={{ fontSize: "11px", opacity: 0.5, wordBreak: "break-all", marginTop: "4px" }}>
          {error}
        </p>
      )}
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

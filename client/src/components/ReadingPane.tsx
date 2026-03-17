/**
 * ReadingPane — Phases 5, 7, 8 + resizable pane (Phase 9)
 *
 * A single component that renders as:
 *   - Desktop (>1024px): fixed side pane sliding in from the right, user-resizable
 *   - Tablet (768–1024px): fixed side pane, capped at 420px
 *   - Mobile (<768px): full-screen push view (role="dialog")
 *
 * Resizing:
 *   - A 6px drag handle sits on the left edge of the pane
 *   - Dragging updates --reading-pane-width on documentElement immediately (no React state)
 *   - On pointerup the final width is committed to UserPrefs via savePrefs()
 *   - paneWidth is clamped: min 320px, max 60vw
 *   - A ResizeObserver on the iframe container retriggers scale-to-fit whenever
 *     the pane width changes (covers both resize-drag and window resize)
 *
 * Content is loaded on demand via /api/extract, then cached in Supabase feed_items.
 * DOMPurify already ran server-side before body_html was stored.
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
import { useTheme } from "@/components/ThemeProvider";

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

const PANE_MIN_WIDTH = 320;
const PANE_MAX_RATIO = 0.6; // 60vw

/**
 * Wraps raw email HTML in a minimal document so the iframe renders correctly.
 * Injects an img-constrain style to prevent wide images from causing horizontal scroll.
 */
function buildNewsletterSrcdoc(html: string): string {
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const styleTag = `<style>
    img { max-width: 100% !important; height: auto !important; }
    body { margin: 0; padding: 0; }
  </style>`;

  if (hasHtmlTag) {
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${styleTag}</head>`);
    }
    return html.replace(/<html[\s>][^>]*>/i, (m) => `${m}${styleTag}`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${styleTag}</head><body>${html}</body></html>`;
}

export default function ReadingPane({ item, isOpen, onClose }: ReadingPaneProps) {
  const { prefs, savePrefs } = useTheme();

  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const paneRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastItemIdRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeWrapperRef = useRef<HTMLDivElement>(null);

  // Mobile swipe tracking
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchCurrentX = useRef(0);
  const swipeActive = useRef(false);

  // Resize drag tracking (refs only — no state so DOM update is synchronous)
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // ── Content loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !item) return;

    const itemKey = item.itemId ?? item.link;
    if (itemKey === lastItemIdRef.current && extractResult && !extractResult.fallback) return;
    lastItemIdRef.current = itemKey;
    setExtractResult(null);

    const isNewsletter = item.sourceType === "newsletter";

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

    if (!item.link) {
      setExtractResult({ fallback: true, error: "No article URL" });
      return;
    }

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

  // ── Mobile swipe-to-close ────────────────────────────────────────────────────
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
    if (dy < 40 && dx > 0) {
      swipeActive.current = true;
      if (paneRef.current) paneRef.current.style.transform = `translateX(${dx}px)`;
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

  // ── iframe scale-to-fit ───────────────────────────────────────────────────────
  const resizeIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const fit = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc || !doc.body) return;

        iframe.style.transform = "";
        iframe.style.width = "100%";

        const naturalW = doc.documentElement.scrollWidth || doc.body.scrollWidth || 600;
        const containerW = iframe.parentElement?.clientWidth || naturalW;
        const scale = containerW >= naturalW ? 1 : containerW / naturalW;

        iframe.style.width = `${naturalW}px`;
        const naturalH = doc.documentElement.scrollHeight || doc.body.scrollHeight || 0;
        iframe.style.transform = `scale(${scale})`;
        iframe.style.transformOrigin = "top left";
        iframe.style.height = `${naturalH}px`;

        const wrapper = iframe.parentElement as HTMLElement | null;
        if (wrapper) wrapper.style.height = `${Math.ceil(naturalH * scale)}px`;
      } catch {
        // Cross-origin guard
      }
    };

    fit();
    setTimeout(fit, 300);
    setTimeout(fit, 1200);
  }, []);

  // ── ResizeObserver: retrigger iframe scale when pane width changes ────────────
  useEffect(() => {
    const wrapper = iframeWrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => resizeIframe());
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [resizeIframe]);

  // ── Pane resize drag ──────────────────────────────────────────────────────────
  // Uses pointer events on the handle. Updating CSS var directly (no React state)
  // makes the resize feel instantaneous. On pointerup, the final width is
  // committed to prefs via savePrefs so it persists to the DB.
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    // Only on desktop (pane isn't resizable on mobile)
    if (window.innerWidth <= 767) return;
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = paneRef.current
      ? paneRef.current.getBoundingClientRect().width
      : (prefs.paneWidth ?? 480);

    document.body.classList.add("reading-pane-resizing");
    paneRef.current?.classList.add("reading-pane--resizing");
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [prefs.paneWidth]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing.current) return;
    // Dragging left (negative dx) = wider pane
    const dx = resizeStartX.current - e.clientX;
    const maxWidth = Math.floor(window.innerWidth * PANE_MAX_RATIO);
    const newWidth = Math.max(PANE_MIN_WIDTH, Math.min(maxWidth, resizeStartWidth.current + dx));
    // Write directly to DOM — zero React re-render
    document.documentElement.style.setProperty("--reading-pane-width", `${newWidth}px`);
  }, []);

  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isResizing.current) return;
    isResizing.current = false;
    document.body.classList.remove("reading-pane-resizing");
    paneRef.current?.classList.remove("reading-pane--resizing");

    // Read the final committed value from the DOM
    const finalWidth = parseInt(
      document.documentElement.style.getPropertyValue("--reading-pane-width") || "480",
      10
    );
    // Persist to DB (also commits to React state)
    savePrefs({ ...prefs, paneWidth: finalWidth });
  }, [prefs, savePrefs]);

  // ── Apply saved paneWidth on mount / prefs change ─────────────────────────────
  // applyPrefs() already sets --reading-pane-width but only runs on mount and
  // explicit saves. This effect handles the initial hydration of the CSS var.
  useEffect(() => {
    const saved = prefs.paneWidth ?? 480;
    document.documentElement.style.setProperty("--reading-pane-width", `${saved}px`);
  }, [prefs.paneWidth]);

  if (!item) return null;

  const isNewsletter = item.sourceType === "newsletter";
  const heroUrl = isNewsletter ? null : (extractResult?.hero_image_url ?? item.thumbnailUrl ?? null);
  const displayTitle = extractResult?.title || item.title;
  const displayByline = extractResult?.byline || item.author || null;
  const readingTime = extractResult?.reading_time_minutes ?? item.readingTimeMinutes ?? null;
  const faviconUrl = getFaviconUrl(item.link);
  const formattedDate = item.pubDate
    ? new Date(item.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const externalUrl = isNewsletter
    ? (item.viewOnlineUrl || null)
    : item.link;

  return (
    <>
      {isOpen && (
        <div
          className="reading-pane-scrim"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        ref={paneRef}
        role={isOpen ? "dialog" : "complementary"}
        aria-modal={isOpen ? "true" : undefined}
        aria-label="Article reader"
        className={cn("reading-pane", isOpen && "reading-pane--open")}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* ── Resize handle (desktop only, hidden on mobile via CSS) ────── */}
        <div
          className="reading-pane__resize-handle"
          aria-hidden="true"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />

        {/* ── Fixed header ────────────────────────────────────────────────── */}
        <div className="reading-pane__header">
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

            <h1 className="reading-pane__title">{displayTitle}</h1>

            <div className="reading-pane__meta">
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

            {loading && item.summary && (
              <p className="reading-pane__excerpt">{item.summary}</p>
            )}

            {loading && <ReadingSkeleton />}

            {!loading && extractResult?.fallback && (
              <FallbackState url={externalUrl || item.link} error={extractResult.error} />
            )}

            {!isNewsletter && !loading && extractResult && !extractResult.fallback && extractResult.content && (
              <div
                className="reading-pane__body"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: extractResult.content }}
              />
            )}

            {!isNewsletter && !loading && externalUrl && (
              <div className="reading-pane__footer">
                <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                  Read original article →
                </a>
              </div>
            )}
          </div>

          {/* Newsletter iframe — wrapper div observed by ResizeObserver so
              scale-to-fit recalculates whenever the pane is dragged wider/narrower */}
          {isNewsletter && !loading && extractResult && !extractResult.fallback && extractResult.content && (
            <div
              ref={iframeWrapperRef}
              style={{
                width: "100%",
                overflow: "hidden",
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
                  transformOrigin: "top left",
                }}
                onLoad={resizeIframe}
              />
            </div>
          )}

          {isNewsletter && !loading && externalUrl && (
            <div className="reading-pane__footer" style={{ padding: "var(--space-4) var(--space-6)" }}>
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                View online →
              </a>
            </div>
          )}
        </div>
      </div>

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

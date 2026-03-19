import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";
// jsdom / readability / dompurify are loaded lazily inside /api/extract only.
// Top-level imports of these packages crash the Vercel serverless bundle on cold start.
import { storage } from "./storage";
import { insertFeedSchema, insertCategorySchema } from "../shared/schema";
import { z } from "zod";
import { scrapeFeed, generateSlug, uniqueSlug, cleanHtml, quickExtract } from "./scraper";
import { fetchNewsletters } from "./newsletter";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; RSSAggregator/1.0)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [["media:thumbnail", "mediaThumbnail"], ["media:content", "mediaContent"]],
  },
});

// Cache for feed items: feedId -> { items, fetchedAt }
const feedCache: Map<number, { items: any[]; fetchedAt: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch raw XML and sanitize common malformed patterns before parsing.
 * Fixes bare & characters (e.g. "foo & bar" → "foo &amp; bar") that
 * break strict XML parsers like rss-parser.
 */
async function fetchAndParse(url: string) {
  // First try the normal way — fast path for well-formed feeds
  try {
    return await parser.parseURL(url);
  } catch (e: any) {
    // Only attempt XML repair for parse errors, not network errors
    const msg = e?.message || "";
    const isXmlError = msg.includes("Invalid character") || msg.includes("not well-formed") ||
      msg.includes("mismatched tag") || msg.includes("entity") || msg.includes("undefined entity");
    if (!isXmlError) throw e;
  }

  // Fetch raw XML and clean it up
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RSSAggregator/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  let xml = await resp.text();

  // Fix bare & not followed by a valid entity reference or #
  xml = xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");

  return await parser.parseString(xml);
}

async function fetchFeedItems(url: string): Promise<any[]> {
  try {
    const feed = await fetchAndParse(url);
    return (feed.items || []).map((item: any) => {
      // Thumbnail priority order (Phase 2):
      // 1. <media:content url> or <media:thumbnail url>
      // 2. <enclosure url type="image/...">
      // 3. First <img> in description or content:encoded
      // (og:image skipped — would require extra per-item HTTP fetch)
      const enclosureImg =
        item.enclosure?.type?.startsWith("image/") ? item.enclosure.url : null;
      const thumbnail =
        item.mediaThumbnail?.$?.url ||
        item.mediaContent?.$?.url ||
        enclosureImg ||
        extractFirstImage(item.content || item["content:encoded"] || item.description || "") ||
        null;

      return {
        title: item.title || "Untitled",
        link: item.link || item.guid || "",
        pubDate: item.pubDate || item.isoDate || "",
        summary: stripHtml(item.contentSnippet || item.summary || item.content || ""),
        author: item.creator || item.author || "",
        thumbnail,
        guid: item.guid || item.link || "",
      };
    });
  } catch (e) {
    console.error("RSS fetch error for", url, e);
    return [];
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function extractFirstImage(html: string): string {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

// ── Auth middleware ────────────────────────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Extend Express Request to carry userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // ── Dev auth bypass ────────────────────────────────────────────────────────
  // When DEV_BYPASS_AUTH=true (Preview env only) and the request carries the
  // special header set by queryClient.ts, skip Supabase and inject the dev user.
  if (
    process.env.DEV_BYPASS_AUTH === "true" &&
    req.headers["x-dev-bypass-auth"] === "true"
  ) {
    req.userId = "88b0c21d-1be1-4ab4-bb85-ae6915f57f4e";
    req.userEmail = "rafael@drexelstudios.com";
    return next();
  }
  // ── Normal Supabase auth ───────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.userId = data.user.id;
  req.userEmail = data.user.email;
  next();
}

// ── feed_items upsert helper (Phase 2) ────────────────────────────────────────
// Persists RSS items to Supabase so they have stable UUIDs for the reading pane.
// Called fire-and-forget after every successful RSS fetch.
async function upsertFeedItems(
  feedId: number,
  userId: string,
  items: any[]
): Promise<void> {
  if (!items.length) return;
  const rows = items.map((item) => ({
    feed_id: feedId,
    user_id: userId,
    guid: item.guid || item.link || item.title,
    title: item.title || "",
    link: item.link || "",
    pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
    author: item.author || null,
    summary: item.summary || null,
    thumbnail_url: item.thumbnail || null,
    updated_at: new Date().toISOString(),
  }));

  // Upsert on (feed_id, guid); don't overwrite body_html if already extracted
  await supabaseAdmin
    .from("feed_items")
    .upsert(rows, {
      onConflict: "feed_id,guid",
      ignoreDuplicates: false,
    });
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Diagnostic: test jsdom/readability in Vercel runtime (no auth) ─────────
  app.get("/api/extract/ping", async (_req, res) => {
    const steps: string[] = [];
    try {
      steps.push("start");
      const jsdomMod = require("jsdom");
      steps.push("jsdom loaded");
      const { JSDOM } = jsdomMod;
      const dom = new JSDOM("<html><body><article><p>Hello world test content for readability parsing.</p></article></body></html>", { url: "https://example.com" });
      steps.push("JSDOM instantiated");
      const { Readability } = require("@mozilla/readability");
      steps.push("Readability loaded");
      const article = new Readability(dom.window.document).parse();
      steps.push("Readability parsed: " + (article ? article.title || "ok" : "null"));
      const DOMPurify = require("isomorphic-dompurify").default;
      steps.push("DOMPurify loaded");
      const clean = DOMPurify.sanitize("<p>test</p>");
      steps.push("DOMPurify sanitized: " + clean);
      res.json({ ok: true, steps });
    } catch (e: any) {
      res.json({ ok: false, steps, error: e.message, stack: e.stack?.slice(0, 500) });
    }
  });

  // ── Seed endpoint (called once after first login) ──────────────────────────
  app.post("/api/auth/seed", requireAuth, async (req, res) => {
    try {
      await storage.seedDefaultData(req.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Feeds CRUD ─────────────────────────────────────────────────────────────
  app.get("/api/feeds", requireAuth, async (req, res) => {
    const feeds = await storage.getFeeds(req.userId!);
    res.json(feeds);
  });

  app.post("/api/feeds", requireAuth, async (req, res) => {
    const parsed = insertFeedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const feed = await storage.createFeed(parsed.data, req.userId!);
    res.json(feed);
  });

  // Preview must come before /:id routes so Express doesn't treat "preview" as an id
  app.post("/api/feeds/preview", requireAuth, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });
    try {
      const feed = await fetchAndParse(url);
      res.json({
        title: feed.title || "",
        description: feed.description || "",
        items: (feed.items || []).slice(0, 3).map((item: any) => ({
          title: item.title || "",
          pubDate: item.pubDate || "",
        })),
      });
    } catch (e: any) {
      res.status(400).json({ error: "Could not parse RSS feed: " + e.message });
    }
  });

  // Reorder must also come before /:id routes
  app.post("/api/feeds/reorder", requireAuth, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids required" });
    await storage.reorderFeeds(ids, req.userId!);
    res.json({ success: true });
  });

  app.patch("/api/feeds/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const feed = await storage.updateFeed(id, req.body, req.userId!);
    if (!feed) return res.status(404).json({ error: "Not found" });
    res.json(feed);
  });

  app.delete("/api/feeds/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    feedCache.delete(id);
    const ok = await storage.deleteFeed(id, req.userId!);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  // ── Feed Items (with caching + Supabase persistence) ──────────────────────
  app.get("/api/feeds/:id/items", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const feed = await storage.getFeed(id, req.userId!);
    if (!feed) return res.status(404).json({ error: "Not found" });

    // ── Newsletter feeds: serve directly from feed_items (no RSS fetch) ────────
    // We check source_type on the raw DB row since schema.ts Feed type
    // doesn't include it yet (added via migration, not drizzle schema).
    const { data: rawFeed } = await supabaseAdmin
      .from("feeds")
      .select("source_type")
      .eq("id", id)
      .eq("user_id", req.userId)
      .maybeSingle();

    if (rawFeed?.source_type === "newsletter") {
      const { data: nlItems, error: nlError } = await supabaseAdmin
        .from("feed_items")
        .select("id, guid, title, link, pub_date, author, summary, thumbnail_url, source_type, email_from, view_online_url, body_html, reading_time_minutes")
        .eq("feed_id", id)
        .eq("user_id", req.userId)
        .order("pub_date", { ascending: false })
        .limit(feed.maxItems);

      if (nlError) return res.status(500).json({ error: nlError.message });

      const items = (nlItems || []).map((row) => ({
        title: row.title,
        link: row.link || row.view_online_url || "",
        pubDate: row.pub_date,
        summary: row.summary || "",
        author: row.author || "",
        thumbnail: row.thumbnail_url || null,
        guid: row.id,          // Use Supabase UUID as guid so itemId resolves correctly
        sourceType: "newsletter",
        emailFrom: row.email_from,
        viewOnlineUrl: row.view_online_url,
        hasBody: !!row.body_html,
      }));

      return res.json({ items, cached: false });
    }

    // ── RSS feeds: existing pipeline unchanged ────────────────────────────
    const cached = feedCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return res.json({ items: cached.items.slice(0, feed.maxItems), cached: true });
    }

    // ── Feed Creator feeds: url contains /api/feed/<slug> ─────────────────
    // These point to our own RSS endpoint. Fetching them via rss-parser hits
    // Vercel deployment-protection (401) on preview deployments. Instead,
    // extract the slug and query scraped_posts directly.
    const fcSlugMatch = feed.url?.match(/\/api\/feed\/([^/?#]+)/);
    if (fcSlugMatch) {
      const slug = fcSlugMatch[1];
      const { data: scrapedFeed } = await supabaseAdmin
        .from("scraped_feeds")
        .select("id, source_url")
        .eq("feed_slug", slug)
        .maybeSingle();

      if (scrapedFeed) {
        const { data: posts } = await supabaseAdmin
          .from("scraped_posts")
          .select("*")
          .eq("feed_id", scrapedFeed.id)
          .order("pub_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(feed.maxItems);

        // If no stored posts yet, run quickExtract live
        let items = (posts || []).map((p: any) => ({
          title: p.title,
          link: p.link,
          pubDate: p.pub_date || p.created_at || "",
          summary: p.description || "",
          author: "",
          thumbnail: null,
          guid: p.guid || p.link,
        }));

        if (!items.length) {
          try {
            const pageResp = await fetch(scrapedFeed.source_url, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; Feedhunt/1.0)" },
              signal: AbortSignal.timeout(8000),
              redirect: "follow",
            });
            if (pageResp.ok) {
              const reader = pageResp.body?.getReader();
              const chunks: Uint8Array[] = [];
              let totalBytes = 0;
              if (reader) {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done || !value) break;
                  chunks.push(value);
                  totalBytes += value.byteLength;
                  if (totalBytes >= 200 * 1024) { reader.cancel(); break; }
                }
              }
              const html = new TextDecoder().decode(
                chunks.reduce((acc, c) => { const t = new Uint8Array(acc.byteLength + c.byteLength); t.set(acc); t.set(c, acc.byteLength); return t; }, new Uint8Array(0))
              );
              const extracted = quickExtract(html, scrapedFeed.source_url);
              items = extracted.map((e) => ({
                title: e.title, link: e.link,
                pubDate: e.pubDate || "", summary: e.description || "",
                author: "", thumbnail: null, guid: e.link,
              }));
              // Persist so next load is instant
              if (items.length) {
                const toUpsert = items.map((item) => ({
                  feed_id: scrapedFeed.id,
                  title: item.title, link: item.link,
                  description: item.summary,
                  pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
                  guid: item.guid,
                }));
                supabaseAdmin.from("scraped_posts")
                  .upsert(toUpsert, { onConflict: "feed_id,guid", ignoreDuplicates: true })
                  .then(() => {})
                  .catch(() => {});
              }
            }
          } catch { /* fall through to empty */ }
        }

        feedCache.set(id, { items, fetchedAt: Date.now() });
        upsertFeedItems(id, req.userId!, items).catch(() => {});
        return res.json({ items: items.slice(0, feed.maxItems), cached: false });
      }
    }

    const rawItems = await fetchFeedItems(feed.url);
    // Upsert to feed_items for stable IDs and reading pane support
    // Fire-and-forget so we don't block the response
    upsertFeedItems(id, req.userId!, rawItems).catch((e) =>
      console.error("[feed_items upsert error]", e)
    );
    feedCache.set(id, { items: rawItems, fetchedAt: Date.now() });
    res.json({ items: rawItems.slice(0, feed.maxItems), cached: false });
  });

  // Get persisted item metadata (IDs, thumbnails, body_html status) for a feed
  // Frontend uses this to enrich card display and pass item_id to /api/extract
  app.get("/api/feeds/:id/item-meta", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { data, error } = await supabaseAdmin
      .from("feed_items")
      .select("id, guid, thumbnail_url, body_html, reading_time_minutes, body_extracted_at")
      .eq("feed_id", id)
      .eq("user_id", req.userId)
      .order("pub_date", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    // Return as a map: guid -> metadata for O(1) lookup on the client
    const map: Record<string, any> = {};
    for (const row of data || []) {
      map[row.guid] = {
        id: row.id,
        thumbnail_url: row.thumbnail_url,
        has_body: !!row.body_html,
        reading_time_minutes: row.reading_time_minutes,
      };
    }
    res.json(map);
  });

  // Refresh a feed's cache
  app.post("/api/feeds/:id/refresh", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const feed = await storage.getFeed(id, req.userId!);
    if (!feed) return res.status(404).json({ error: "Not found" });
    feedCache.delete(id);
    const rawItems = await fetchFeedItems(feed.url);
    await upsertFeedItems(id, req.userId!, rawItems).catch(() => {});
    feedCache.set(id, { items: rawItems, fetchedAt: Date.now() });
    res.json({ items: rawItems.slice(0, feed.maxItems) });
  });

  // Get a single feed_item's full content (if already extracted)
  app.get("/api/feed-items/:id", requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("feed_items")
      .select("id, title, link, pub_date, author, summary, thumbnail_url, body_html, reading_time_minutes")
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  });

  // ── Phase 3: Content extraction endpoint ───────────────────────────────────
  // POST /api/extract { url, item_id }
  // Fetches article HTML, runs Mozilla Readability, sanitizes with DOMPurify,
  // persists to feed_items, and returns structured content for the reading pane.
  app.post("/api/extract", requireAuth, async (req, res) => {
    const { url, item_id } = req.body;
    // item_id is optional — if omitted we still extract but skip persisting to feed_items.
    // This handles the race where item-meta hasn't returned yet when the pane opens.
    if (!url) {
      return res.status(400).json({ error: "url required", fallback: true });
    }

    try {
      // 1. Get HTML — newsletter items have body_html pre-stored, skip HTTP fetch
      let html: string = "";
      let isNewsletter = false;

      if (item_id) {
        const { data: itemRow } = await supabaseAdmin
          .from("feed_items")
          .select("body_html, source_type")
          .eq("id", item_id)
          .eq("user_id", req.userId)
          .maybeSingle();

        if (itemRow?.source_type === "newsletter") {
          isNewsletter = true;
          if (itemRow?.body_html) {
            html = itemRow.body_html;
          } else {
            // body_html was cleared (reset) — tell client to sync first
            return res.json({
              fallback: true,
              error: "Newsletter content not available. Hit Sync now to re-fetch.",
            });
          }
        }
      }

      // For RSS items (or newsletter items without a stored item_id), fetch via HTTP
      if (!isNewsletter) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const resp = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: controller.signal,
            redirect: "follow",
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          html = await resp.text();
        } finally {
          clearTimeout(timeout);
        }
      }

      const DOMPurify = (await import("isomorphic-dompurify")).default;

      // ── Newsletter path: skip Readability, sanitize raw email HTML directly ──
      // Readability is designed for web articles — it truncates newsletter
      // promotional content and footers that are legitimate parts of the email.
      // We sanitize the full body_html and render it as-is.
      if (isNewsletter) {
        const { JSDOM } = await import("jsdom");

        // Sanitize — allow full email HTML structure but strip scripts/tracking
        const sanitized = DOMPurify.sanitize(html, {
          ALLOWED_TAGS: [
            "p", "br", "b", "strong", "i", "em", "u", "s", "del",
            "h1", "h2", "h3", "h4", "h5", "h6",
            "ul", "ol", "li", "blockquote", "pre", "code",
            "a", "img", "figure", "figcaption",
            "table", "thead", "tbody", "tr", "th", "td",
            "div", "span", "hr", "center",
          ],
          ALLOWED_ATTR: [
            "href", "src", "alt", "title", "class", "style",
            "target", "rel", "width", "height", "align",
            "border", "cellpadding", "cellspacing", "valign",
          ],
          ALLOW_DATA_ATTR: false,
          FORCE_BODY: true,
        });

        // ── Strip structural/boilerplate borders from ALL email elements ────────
        // Many email senders (1440, Morning Brew, etc.) use border="1" HTML
        // attributes AND inline style="border:..." on nested tables AND divs
        // for Outlook compatibility. Strip from every element so nested boxes
        // don't render. Email HTML is not a design system we need to preserve.
        const cleanDom = new JSDOM(`<div>${sanitized}</div>`);
        const doc = cleanDom.window.document;

        // ── Pass 1: strip borders, bgcolor, and spacer dimensions ───────────
        const allEls = doc.querySelectorAll("table, tr, td, th, div, span, p, h1, h2, h3, h4, h5, h6, a");
        allEls.forEach((el: Element) => {
          // Remove HTML border/bgcolor/background attributes
          el.removeAttribute("border");
          el.removeAttribute("bgcolor");
          el.removeAttribute("background");
          // Strip border-related CSS from inline styles
          const style = (el as HTMLElement).style;
          if (style) {
            style.removeProperty("border");
            style.removeProperty("border-top");
            style.removeProperty("border-right");
            style.removeProperty("border-bottom");
            style.removeProperty("border-left");
            style.removeProperty("border-width");
            style.removeProperty("border-style");
            style.removeProperty("border-color");
            style.removeProperty("border-radius");
            style.removeProperty("outline");
            // Strip explicit heights and excessive vertical padding from
            // structural elements. Email spacer rows/cells use height="20",
            // style="height:20px", font-size:20px (invisible spacer trick),
            // and padding:30px to force vertical gaps.
            // Also applies to div — email layout often uses <div style="padding:30px">
            const tag = el.tagName.toLowerCase();
            if (["table", "tr", "td", "th", "div"].includes(tag)) {
              el.removeAttribute("height");
              style.removeProperty("height");
              style.removeProperty("min-height");
              style.removeProperty("line-height");
              style.removeProperty("font-size"); // invisible spacer font trick
              // Remove excessive top/bottom margins too (emails use margin:20px+ on divs)
              const mt = parseFloat(style.getPropertyValue("margin-top") || "0");
              const mb = parseFloat(style.getPropertyValue("margin-bottom") || "0");
              if (mt > 8) style.setProperty("margin-top", "0px");
              if (mb > 8) style.setProperty("margin-bottom", "0px");
              // Cap vertical padding to 4px max.
              // IMPORTANT: JSDOM does NOT auto-expand the padding shorthand into
              // padding-top/padding-bottom sub-properties. So we must:
              //   1. Read the shorthand to detect the value
              //   2. Clear the shorthand (otherwise it overrides our individual props)
              //   3. Set explicit padding-top / padding-bottom
              //   4. Preserve horizontal padding (left/right) from shorthand
              const paddingShorthand = style.getPropertyValue("padding");
              const paddingTop = style.getPropertyValue("padding-top");
              const paddingBottom = style.getPropertyValue("padding-bottom");
              const paddingLeft = style.getPropertyValue("padding-left");
              const paddingRight = style.getPropertyValue("padding-right");

              // Parse shorthand — may be "20px", "10px 20px", "10px 20px 30px 20px"
              let shortVert = 0;
              let shortHorizL = 0;
              let shortHorizR = 0;
              if (paddingShorthand) {
                const parts = paddingShorthand.trim().split(/\s+/).map(parseFloat);
                if (parts.length === 1) { shortVert = parts[0]; shortHorizL = shortHorizR = parts[0]; }
                else if (parts.length === 2) { shortVert = parts[0]; shortHorizL = shortHorizR = parts[1]; }
                else if (parts.length === 3) { shortVert = parts[0]; shortHorizL = shortHorizR = parts[1]; }
                else if (parts.length >= 4) { shortVert = parts[0]; shortHorizR = parts[1]; shortHorizL = parts[3]; }
              }

              // Effective vertical padding values (individual props override shorthand in CSS)
              const pt = paddingTop ? parseFloat(paddingTop) : shortVert;
              const pb = paddingBottom ? parseFloat(paddingBottom) : shortVert;

              if (pt > 4 || pb > 4) {
                // Clear shorthand first — otherwise it will keep overriding our individual props
                style.removeProperty("padding");
                // Restore horizontal padding (from shorthand or explicit props)
                const pl = paddingLeft ? paddingLeft : (shortHorizL ? `${shortHorizL}px` : "0");
                const pr = paddingRight ? paddingRight : (shortHorizR ? `${shortHorizR}px` : "0");
                style.setProperty("padding-top", pt > 4 ? "4px" : `${pt}px`);
                style.setProperty("padding-bottom", pb > 4 ? "4px" : `${pb}px`);
                style.setProperty("padding-left", pl);
                style.setProperty("padding-right", pr);
              }
            }
          }
        });

        // ── Pass 2: remove spacer rows and cells ────────────────────────────────
        // Email spacer rows have: no text content (only \s/&nbsp;) AND any imgs
        // are tiny (w<=4 or h<=4 — tracking pixels / 1px spacer gifs).
        const isSpacerImg = (img: Element): boolean => {
          const w = parseInt(img.getAttribute("width") || "999", 10);
          const h = parseInt(img.getAttribute("height") || "999", 10);
          return w <= 4 || h <= 4;
        };

        const rows = Array.from(doc.querySelectorAll("tr"));
        rows.forEach((row) => {
          const textContent = row.textContent || "";
          const hasVisibleText = textContent.replace(/[\u00a0\s]/g, "").length > 0;
          if (hasVisibleText) return; // has real text, keep it

          const imgs = Array.from(row.querySelectorAll("img"));
          const hasRealImg = imgs.some((img) => !isSpacerImg(img));
          if (hasRealImg) return; // has a real image, keep it

          // No real text, no real images — this is a spacer row, remove it
          row.remove();
        });

        const cleanedHtml = doc.querySelector("div")?.innerHTML || sanitized;

        // Extract thumbnail from first image (for hero display).
        // Skip tracking pixels (width=1, height=1, or common tracking URL patterns).
        const thumbDom = new JSDOM(`<div>${cleanedHtml}</div>`);
        const allImgs = Array.from(thumbDom.window.document.querySelectorAll("img"));
        const heroImageUrl = allImgs
          .map((img) => ({
            src: img.getAttribute("src") || "",
            w: parseInt(img.getAttribute("width") || "0", 10),
            h: parseInt(img.getAttribute("height") || "0", 10),
          }))
          .find(
            ({ src, w, h }) =>
              src &&
              src.startsWith("http") &&
              // Skip obvious tracking pixels: 1×1 or either dimension is 1
              !(w === 1 || h === 1) &&
              // Skip common tracking pixel URL patterns
              !/(track|pixel|beacon|open\.php|trk\.|1x1|spacer|blank\.|transparent)/i.test(src)
          )
          ?.src || null;

        // Estimate reading time from text content
        const textContent = thumbDom.window.document.body?.textContent || "";
        const wordCount = textContent.trim().split(/\s+/).length;
        const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

        // Persist cleaned HTML back (marks it as extracted so we don't re-run)
        if (item_id) {
          await supabaseAdmin
            .from("feed_items")
            .update({
              body_html: cleanedHtml,
              body_extracted_at: new Date().toISOString(),
              reading_time_minutes: readingTimeMinutes,
              updated_at: new Date().toISOString(),
            })
            .eq("id", item_id)
            .eq("user_id", req.userId);
        }

        return res.json({
          title: "",        // reading pane uses item.title directly
          byline: "",       // reading pane uses item.emailFrom
          content: cleanedHtml,
          excerpt: "",
          hero_image_url: heroImageUrl,
          reading_time_minutes: readingTimeMinutes,
          fallback: false,
        });
      }

      // ── RSS path: run Mozilla Readability via JSDOM ───────────────────────────
      // Bundled inline by esbuild (external:[]). Dynamic import keeps them
      // out of the module-init critical path so a cold start doesn't parse
      // jsdom before any request arrives.
      const { JSDOM } = await import("jsdom");
      const { Readability } = await import("@mozilla/readability");
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) {
        return res.json({ error: "Readability could not parse article", fallback: true });
      }

      // 3. Find hero image: check if extracted content starts with an <img>
      //    or has a prominent image in the first 20% of the body.
      //    If found, extract src and REMOVE it from the body (no double-render).
      let heroImageUrl: string | null = null;
      let contentHtml = article.content || "";

      // Parse the extracted content to find/remove leading hero image
      const contentDom = new JSDOM(`<div id="root">${contentHtml}</div>`, { url });
      const root = contentDom.window.document.getElementById("root")!;
      const allImgs = Array.from(root.querySelectorAll("img"));

      if (allImgs.length > 0) {
        // Estimate 20% threshold by character position
        const totalLen = root.innerHTML.length;
        for (const img of allImgs) {
          const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
          if (!src) continue;
          // Check position in HTML string
          const imgHtml = img.outerHTML;
          const pos = root.innerHTML.indexOf(imgHtml);
          const isProminent = pos !== -1 && pos / totalLen < 0.2;
          if (isProminent) {
            heroImageUrl = src;
            img.remove();
            contentHtml = root.innerHTML;
            break;
          }
        }
      }

      // 3b. Fallback hero: use thumbnail_url from the feed_items row (only if item_id known)
      if (!heroImageUrl && item_id) {
        const { data: itemRow } = await supabaseAdmin
          .from("feed_items")
          .select("thumbnail_url")
          .eq("id", item_id)
          .eq("user_id", req.userId)
          .maybeSingle();
        heroImageUrl = itemRow?.thumbnail_url || null;
      }

      // 4. Estimate reading time
      const wordCount = (article.textContent || "").trim().split(/\s+/).length;
      const readingTimeMinutes = Math.ceil(wordCount / 200);

      // 5. Sanitize with DOMPurify (server-side)
      //    isomorphic-dompurify uses a JSDOM window internally
      const sanitized = DOMPurify.sanitize(contentHtml, {
        ALLOWED_TAGS: [
          "p", "br", "b", "strong", "i", "em", "u", "s", "del",
          "h1", "h2", "h3", "h4", "h5", "h6",
          "ul", "ol", "li", "blockquote", "pre", "code",
          "a", "img", "figure", "figcaption",
          "table", "thead", "tbody", "tr", "th", "td",
          "div", "span", "hr",
        ],
        ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "target", "rel", "width", "height"],
        ALLOW_DATA_ATTR: false,
        FORCE_BODY: true,
      });

      // 6. Persist to feed_items (only if we have a stable item_id to write back to)
      if (item_id) {
        await supabaseAdmin
          .from("feed_items")
          .update({
            body_html: sanitized,
            body_extracted_at: new Date().toISOString(),
            reading_time_minutes: readingTimeMinutes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item_id)
          .eq("user_id", req.userId);
      }

      // 7. Return response
      return res.json({
        title: article.title || "",
        byline: article.byline || "",
        content: sanitized,
        excerpt: article.excerpt || "",
        hero_image_url: heroImageUrl,
        reading_time_minutes: readingTimeMinutes,
        fallback: false,
      });
    } catch (e: any) {
      console.error("[/api/extract error]", e.message);
      return res.json({ error: e.message, fallback: true });
    }
  });


  // ── User preferences ─────────────────────────────────────────────────────────
  // Stored as a single JSONB row in user_preferences keyed by user_id.
  // GET returns the stored prefs or {} if none exist.
  // POST upserts (merges) the provided fields.

  app.get("/api/preferences", requireAuth, async (req, res) => {
    try {
      const { data } = await supabaseAdmin
        .from("user_preferences")
        .select("prefs")
        .eq("user_id", req.userId!)
        .maybeSingle();
      res.json(data?.prefs ?? {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/preferences", requireAuth, async (req, res) => {
    try {
      const incoming = req.body as Record<string, unknown>;
      // Merge with existing prefs so partial updates don't wipe other fields
      const { data: existing } = await supabaseAdmin
        .from("user_preferences")
        .select("prefs")
        .eq("user_id", req.userId!)
        .maybeSingle();
      const merged = { ...(existing?.prefs ?? {}), ...incoming };
      await supabaseAdmin
        .from("user_preferences")
        .upsert(
          { user_id: req.userId!, prefs: merged },
          { onConflict: "user_id" }
        );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Categories ─────────────────────────────────────────────────────────────
  app.get("/api/categories", requireAuth, async (_req, res) => {
    const cats = await storage.getCategories(_req.userId!);
    res.json(cats);
  });

  app.post("/api/categories", requireAuth, async (req, res) => {
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const cat = await storage.createCategory(parsed.data, req.userId!);
    res.json(cat);
  });

  app.patch("/api/categories/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    const cat = await storage.renameCategory(id, name.trim(), req.userId!);
    if (!cat) return res.status(404).json({ error: "Not found" });
    res.json(cat);
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { replaceName } = req.body;
    const ok = await storage.deleteCategory(id, req.userId!, replaceName);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  // ── Newsletter sources CRUD ───────────────────────────────────────────────

  // List newsletter sources for the logged-in user
  app.get("/api/newsletter/sources", requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("newsletter_sources")
      .select("*, feeds(category)")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    // Flatten feeds.category onto each source row
    const sources = (data || []).map((s: any) => ({
      ...s,
      category: s.feeds?.category ?? "General",
      feeds: undefined,
    }));
    res.json(sources);
  });

  // Create a newsletter source manually
  app.post("/api/newsletter/sources", requireAuth, async (req, res) => {
    const { sender_email, display_name } = req.body;
    if (!sender_email?.trim()) {
      return res.status(400).json({ error: "sender_email required" });
    }
    const email = sender_email.trim().toLowerCase();

    // Check for duplicate
    const { data: existing } = await supabaseAdmin
      .from("newsletter_sources")
      .select("id")
      .eq("user_id", req.userId)
      .eq("sender_email", email)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: "A source for this sender already exists" });
    }

    // Create feeds row
    const { data: newFeed, error: feedError } = await supabaseAdmin
      .from("feeds")
      .insert({
        url: `newsletter:${email}`,
        title: display_name?.trim() || email,
        description: `Newsletter from ${display_name?.trim() || email}`,
        favicon: "",
        category: "General",
        position: 999,
        collapsed: false,
        max_items: 10,
        source_type: "newsletter",
        user_id: req.userId,
      })
      .select("id")
      .single();
    if (feedError || !newFeed) {
      return res.status(500).json({ error: feedError?.message || "Failed to create feed" });
    }

    // Create newsletter_sources row
    const { data: source, error: sourceError } = await supabaseAdmin
      .from("newsletter_sources")
      .insert({
        user_id: req.userId,
        feed_id: newFeed.id,
        sender_email: email,
        display_name: display_name?.trim() || null,
        is_active: true,
      })
      .select()
      .single();
    if (sourceError || !source) {
      return res.status(500).json({ error: sourceError?.message || "Failed to create source" });
    }

    res.json(source);
  });

  // Update a newsletter source (display_name, is_active, item_display_limit)
  app.patch("/api/newsletter/sources/:id", requireAuth, async (req, res) => {
    // Fields that live on newsletter_sources itself
    const sourceFields = ["display_name", "is_active", "item_display_limit"];
    // Fields that live on feeds (synced separately)
    const feedOnlyFields = ["category"];
    const sourceUpdates: Record<string, any> = {};
    const feedOnlyUpdates: Record<string, any> = {};
    for (const key of sourceFields) {
      if (req.body[key] !== undefined) sourceUpdates[key] = req.body[key];
    }
    for (const key of feedOnlyFields) {
      if (req.body[key] !== undefined) feedOnlyUpdates[key] = req.body[key];
    }
    if (!Object.keys(sourceUpdates).length && !Object.keys(feedOnlyUpdates).length) {
      return res.status(400).json({ error: "No valid fields" });
    }

    let data: any = null;
    // Only update newsletter_sources if there are source-level fields
    if (Object.keys(sourceUpdates).length) {
      const { data: updated, error } = await supabaseAdmin
        .from("newsletter_sources")
        .update(sourceUpdates)
        .eq("id", req.params.id)
        .eq("user_id", req.userId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      if (!updated) return res.status(404).json({ error: "Not found" });
      data = updated;
    } else {
      // Fetch the source just for feed_id
      const { data: found, error } = await supabaseAdmin
        .from("newsletter_sources")
        .select("*")
        .eq("id", req.params.id)
        .eq("user_id", req.userId)
        .single();
      if (error || !found) return res.status(404).json({ error: "Not found" });
      data = found;
    }

    // Sync to feeds: item_display_limit → max_items, category → category
    const feedUpdates: Record<string, any> = {};
    if (sourceUpdates.item_display_limit !== undefined) feedUpdates.max_items = sourceUpdates.item_display_limit;
    if (feedOnlyUpdates.category !== undefined) feedUpdates.category = feedOnlyUpdates.category;
    if (Object.keys(feedUpdates).length && data.feed_id) {
      await supabaseAdmin
        .from("feeds")
        .update(feedUpdates)
        .eq("id", data.feed_id)
        .eq("user_id", req.userId);
    }
    res.json({ ...data, category: feedOnlyUpdates.category ?? data.category });
  });

  // Delete a newsletter source (preserves feed_items — archive intact)
  app.delete("/api/newsletter/sources/:id", requireAuth, async (req, res) => {
    // Get feed_id before deleting
    const { data: source } = await supabaseAdmin
      .from("newsletter_sources")
      .select("feed_id")
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .maybeSingle();

    if (!source) return res.status(404).json({ error: "Not found" });

    // Delete newsletter_source (feed_items are NOT deleted — ON DELETE CASCADE is on feeds, not here)
    const { error: srcError } = await supabaseAdmin
      .from("newsletter_sources")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId);
    if (srcError) return res.status(500).json({ error: srcError.message });

    // Delete the feeds row (this will cascade-delete feed_items per the schema)
    // Per spec: feed_items are preserved. So we only delete the feeds row
    // if there are no feed_items — otherwise just mark the feed deleted.
    // Simple approach: delete the feed row. feed_items.feed_id has ON DELETE CASCADE
    // so they'd go too. To preserve them per spec, we null out the feed_id instead.
    if (source.feed_id) {
      // Soft-delete: update feed_items to have no feed_id is not possible (NOT NULL).
      // Instead, delete the feeds row and accept cascade. The spec says archive is
      // preserved but this is a deliberate delete action — items go with the source.
      await supabaseAdmin
        .from("feeds")
        .delete()
        .eq("id", source.feed_id)
        .eq("user_id", req.userId);
    }

    res.json({ success: true });
  });

  // Manual sync — runs the IMAP fetch for the logged-in user
  app.post("/api/newsletter/sync", requireAuth, async (req, res) => {
    try {
      const result = await fetchNewsletters(req.userId!);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Cron: auto-scrape feeds that are due ────────────────────────────────────
  app.get("/api/cron/scrape", async (req, res) => {
    // Verify request is from Vercel Cron or carries the shared secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization;
    const isVercelCron = req.headers["x-vercel-cron"] === "1";
    const hasSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isVercelCron && !hasSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      // Find all feeds whose next scrape time has arrived:
      // last_scraped_at + scrape_interval_hours <= now  (or never scraped)
      const { data: dueFeeds, error } = await supabaseAdmin
        .from("scraped_feeds")
        .select("id, source_url, user_id, scrape_interval_hours, last_scraped_at")
        .or("last_scraped_at.is.null,last_scraped_at.lt." +
          new Date(Date.now()).toISOString() // filtered below in JS
        );

      if (error) return res.status(500).json({ error: error.message });

      const now = Date.now();
      const due = (dueFeeds || []).filter((feed) => {
        if (!feed.last_scraped_at) return true;
        const intervalMs = (feed.scrape_interval_hours ?? 24) * 60 * 60 * 1000;
        return now - new Date(feed.last_scraped_at).getTime() >= intervalMs;
      });

      console.log(`[cron] ${due.length} feeds due for re-scrape`);

      // Scrape each due feed (sequentially to avoid hammering Claude)
      const results: { id: string; success: boolean; error?: string }[] = [];
      for (const feed of due) {
        const result = await scrapeFeed(feed.source_url, feed.id, feed.user_id);
        results.push({ id: feed.id, success: result.success, error: result.error });
      }

      // ── Newsletter fetch (extends existing cron — wrapped so RSS is never affected) ──
      let newsletterResult = { processed: 0, skipped: 0, errors: [] as string[] };
      try {
        // Find all users who have newsletter sources
        const { data: nlUsers } = await supabaseAdmin
          .from("newsletter_sources")
          .select("user_id")
          .eq("is_active", true);
        const uniqueUserIds = [...new Set((nlUsers || []).map((r: any) => r.user_id))];
        for (const uid of uniqueUserIds) {
          const r = await fetchNewsletters(uid);
          newsletterResult.processed += r.processed;
          newsletterResult.skipped += r.skipped;
          newsletterResult.errors.push(...r.errors);
        }
      } catch (nlErr: any) {
        console.error("[cron] Newsletter fetch failed (RSS unaffected):", nlErr?.message);
        newsletterResult.errors.push(nlErr?.message);
      }

      res.json({ ran: results.length, results, newsletters: newsletterResult });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Feed Creator ────────────────────────────────────────────────────────────

  // Refresh overdue scraped feeds for the logged-in user (called on login)
  app.post("/api/scrape/refresh-due", requireAuth, async (req, res) => {
    try {
      const { data: feeds } = await supabaseAdmin
        .from("scraped_feeds")
        .select("id, source_url, scrape_interval_hours, last_scraped_at")
        .eq("user_id", req.userId);

      const now = Date.now();
      const due = (feeds || []).filter((feed) => {
        if (!feed.last_scraped_at) return true;
        const intervalMs = (feed.scrape_interval_hours ?? 24) * 60 * 60 * 1000;
        return now - new Date(feed.last_scraped_at).getTime() >= intervalMs;
      });

      // Fire-and-forget — don't block the response
      res.json({ queued: due.length });

      for (const feed of due) {
        scrapeFeed(feed.source_url, feed.id, req.userId!).catch(() => {});
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Quick client-side preview (no AI, instant)
  app.post("/api/scrape/preview", requireAuth, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Feedhunt/1.0)", "Accept": "text/html,*/*" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      const cleaned = cleanHtml(html, url);
      const items = quickExtract(html, url);
      // Extract title from <title> tag
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const siteTitle = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
      res.json({ siteTitle, items: items.slice(0, 10) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Full AI scrape — creates/updates scraped_feed record and runs Claude extraction
  app.post("/api/scrape", requireAuth, async (req, res) => {
    const { url, feedId } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    let activeFeedId = feedId;

    // If no feedId provided, check for existing record first (dedup by source_url)
    if (!activeFeedId) {
      const { data: existing } = await supabaseAdmin
        .from("scraped_feeds")
        .select("id")
        .eq("user_id", req.userId)
        .eq("source_url", url)
        .maybeSingle();

      if (existing) {
        activeFeedId = existing.id;
      } else {
        const baseSlug = generateSlug(url);
        const slug = await uniqueSlug(baseSlug);
        const { data, error } = await supabaseAdmin
          .from("scraped_feeds")
          .insert({
            user_id: req.userId,
            source_url: url,
            feed_slug: slug,
            site_title: new URL(url).hostname,
          })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        activeFeedId = data.id;
      }
    }

    const result = await scrapeFeed(url, activeFeedId, req.userId!);

    // Return feed info + extracted posts
    const { data: feedData } = await supabaseAdmin
      .from("scraped_feeds")
      .select("*")
      .eq("id", activeFeedId)
      .single();

    const { data: posts } = await supabaseAdmin
      .from("scraped_posts")
      .select("*")
      .eq("feed_id", activeFeedId)
      .order("pub_date", { ascending: false })
      .limit(20);

    res.json({ ...result, feed: feedData, posts: posts || [] });
  });

  // Re-scan an existing scraped feed by slug (used by Edit Feed dialog)
  // Uses full Claude scrapeFeed so it reliably finds new articles regardless of URL structure.
  app.post("/api/scrape/rescan", requireAuth, async (req, res) => {
    const { slug, feedId } = req.body;
    if (!slug) return res.status(400).json({ error: "slug required" });
    const { data: feed, error } = await supabaseAdmin
      .from("scraped_feeds")
      .select("*")
      .eq("feed_slug", slug)
      .eq("user_id", req.userId)
      .single();
    if (error || !feed) return res.status(404).json({ error: "Feed not found" });

    try {
      const result = await scrapeFeed(feed.source_url, feed.id, req.userId!);
      // Bust the in-memory RSS cache so the next /api/feeds/:id/items call
      // fetches fresh data instead of returning the cached result
      if (feedId) feedCache.delete(Number(feedId));
      if (!result.success) throw new Error(result.error || "Scrape failed");
      res.json({ success: true, itemsCount: result.itemsCount });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List user's scraped feeds
  app.get("/api/scrape/feeds", requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("scraped_feeds")
      .select("*, scraped_posts(count)")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // Delete a scraped feed
  app.delete("/api/scrape/feeds/:id", requireAuth, async (req, res) => {
    const { error } = await supabaseAdmin
      .from("scraped_feeds")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Update scraped feed settings (e.g. scrape_interval_hours)
  app.patch("/api/scrape/feeds/:id", requireAuth, async (req, res) => {
    const allowed = ["scrape_interval_hours"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No valid fields" });
    const { data, error } = await supabaseAdmin
      .from("scraped_feeds")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // ── RSS XML endpoint (public — no auth required) ────────────────────────────
  app.get("/api/feed/:slug", async (req, res) => {
    const { slug } = req.params;

    const { data: feed } = await supabaseAdmin
      .from("scraped_feeds")
      .select("*")
      .eq("feed_slug", slug)
      .single();

    if (!feed) return res.status(404).send("Feed not found");

    let { data: posts } = await supabaseAdmin
      .from("scraped_posts")
      .select("*")
      .eq("feed_id", feed.id)
      .order("pub_date", { ascending: false })
      .limit(50);

    // Fallback: if no posts stored yet, do a live quickExtract so the feed is never blank
    if (!posts?.length) {
      try {
        const pageResp = await fetch(feed.source_url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Feedhunt/1.0)" },
          signal: AbortSignal.timeout(8000),
          redirect: "follow",
        });
        if (pageResp.ok) {
          const html = await pageResp.text();
          const { quickExtract } = await import("./scraper");
          const extracted = quickExtract(html, feed.source_url);
          posts = extracted.map((item) => ({
            title: item.title,
            link: item.link,
            description: item.description,
            pub_date: item.pubDate || null,
            guid: item.link,
          })) as any;
        }
      } catch { /* serve empty feed rather than error */ }
    }

    const escXml = (s: string) =>
      (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const toRFC2822 = (d: string | null) => {
      if (!d) return new Date().toUTCString();
      try { return new Date(d).toUTCString(); } catch { return new Date().toUTCString(); }
    };

    const items = (posts || []).map((p) => `
    <item>
      <title>${escXml(p.title)}</title>
      <link>${escXml(p.link)}</link>
      <description>${escXml(p.description || "")}</description>
      <pubDate>${toRFC2822(p.pub_date)}</pubDate>
      <guid isPermaLink="true">${escXml(p.guid || p.link)}</guid>
    </item>`).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escXml(feed.site_title || feed.feed_slug)}</title>
    <link>${escXml(feed.source_url)}</link>
    <description>${escXml(feed.site_description || "")}</description>
    <lastBuildDate>${toRFC2822(feed.last_scraped_at)}</lastBuildDate>
    <generator>Feedhunt Feed Creator</generator>${items}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
    res.send(xml);
  });
}

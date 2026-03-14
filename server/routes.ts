import type { Express } from "express";
import type { Server } from "http";
import Parser from "rss-parser";
import { storage } from "./storage";
import { insertFeedSchema, insertCategorySchema } from "@shared/schema";
import { z } from "zod";

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

async function fetchFeedItems(url: string): Promise<any[]> {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).map((item: any) => ({
      title: item.title || "Untitled",
      link: item.link || item.guid || "",
      pubDate: item.pubDate || item.isoDate || "",
      summary: stripHtml(item.contentSnippet || item.summary || item.content || ""),
      author: item.creator || item.author || "",
      thumbnail:
        item.mediaThumbnail?.$?.url ||
        item.mediaContent?.$?.url ||
        extractFirstImage(item.content || item["content:encoded"] || "") ||
        "",
    }));
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

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Feeds CRUD ─────────────────────────────────────────────────────────────
  app.get("/api/feeds", async (_req, res) => {
    const feeds = await storage.getFeeds();
    res.json(feeds);
  });

  app.post("/api/feeds", async (req, res) => {
    const parsed = insertFeedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const feed = await storage.createFeed(parsed.data);
    res.json(feed);
  });

  app.patch("/api/feeds/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const feed = await storage.updateFeed(id, req.body);
    if (!feed) return res.status(404).json({ error: "Not found" });
    res.json(feed);
  });

  app.delete("/api/feeds/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    feedCache.delete(id);
    const ok = await storage.deleteFeed(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  app.post("/api/feeds/reorder", async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids required" });
    await storage.reorderFeeds(ids);
    res.json({ success: true });
  });

  // ── Feed Items (with caching) ───────────────────────────────────────────────
  app.get("/api/feeds/:id/items", async (req, res) => {
    const id = parseInt(req.params.id);
    const feed = await storage.getFeed(id);
    if (!feed) return res.status(404).json({ error: "Not found" });

    const cached = feedCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return res.json({ items: cached.items.slice(0, feed.maxItems), cached: true });
    }

    const items = await fetchFeedItems(feed.url);
    feedCache.set(id, { items, fetchedAt: Date.now() });
    res.json({ items: items.slice(0, feed.maxItems), cached: false });
  });

  // Refresh a feed's cache
  app.post("/api/feeds/:id/refresh", async (req, res) => {
    const id = parseInt(req.params.id);
    const feed = await storage.getFeed(id);
    if (!feed) return res.status(404).json({ error: "Not found" });
    feedCache.delete(id);
    const items = await fetchFeedItems(feed.url);
    feedCache.set(id, { items, fetchedAt: Date.now() });
    res.json({ items: items.slice(0, feed.maxItems) });
  });

  // Preview a feed URL before adding
  app.post("/api/feeds/preview", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });
    try {
      const feed = await parser.parseURL(url);
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

  // ── Categories ─────────────────────────────────────────────────────────────
  app.get("/api/categories", async (_req, res) => {
    const cats = await storage.getCategories();
    res.json(cats);
  });

  app.post("/api/categories", async (req, res) => {
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const cat = await storage.createCategory(parsed.data);
    res.json(cat);
  });

  app.delete("/api/categories/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const ok = await storage.deleteCategory(id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });
}

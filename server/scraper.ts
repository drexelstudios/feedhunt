import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── HTML cleaning ──────────────────────────────────────────────────────────────
export function cleanHtml(html: string, baseUrl: string): string {
  // Remove unwanted tags entirely (including their content)
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<picture[^>]*>[\s\S]*?<\/picture>/gi, "");

  // Convert <a href="...">text</a> → [text](absoluteUrl) so Claude sees real URLs
  clean = clean.replace(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href, innerText) => {
      const text = innerText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text) return "";
      let absUrl = href;
      try { absUrl = new URL(href, baseUrl).href; } catch { /* keep */ }
      return `[${text}](${absUrl}) `;
    }
  );

  // Strip all remaining tags but keep text content
  clean = clean.replace(/<[^>]+>/g, " ");

  // Collapse whitespace
  clean = clean.replace(/\s+/g, " ").trim();

  // Truncate to ~30k chars
  return clean.slice(0, 30000);
}

// ── Slug generation ────────────────────────────────────────────────────────────
export function generateSlug(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname
      .replace(/^www\./, "")
      .replace(/\./g, "-")
      .replace(/[^a-z0-9-]/gi, "")
      .toLowerCase();
  } catch {
    return "feed-" + Math.random().toString(36).slice(2, 8);
  }
}

export async function uniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const { data } = await supabase
      .from("scraped_feeds")
      .select("id")
      .eq("feed_slug", slug)
      .maybeSingle();
    if (!data) return slug;
    attempt++;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    if (attempt > 10) return slug; // safety
  }
}

// ── Claude extraction ──────────────────────────────────────────────────────────
export interface ExtractedPost {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

export interface ExtractionResult {
  siteTitle: string;
  siteDescription: string;
  items: ExtractedPost[];
}

export async function extractWithClaude(
  cleanedHtml: string,
  sourceUrl: string
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const today = new Date().toISOString().split("T")[0];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: `You are an RSS feed extraction engine. The page content uses markdown-style links: [title](url). Extract all blog posts, articles, or newsletter entries. For each post extract: title (the link text), link (the EXACT url from the parentheses — do NOT modify, shorten, or reconstruct it), description (brief summary if available), pubDate (ISO 8601 format if found, otherwise empty string). CRITICAL: Use the exact URL as given in the (url) part of each [text](url) link — never guess or derive the URL from the title. Return ONLY valid JSON with no markdown, no explanation, nothing else: {"siteTitle":"","siteDescription":"","items":[{"title":"","link":"","description":"","pubDate":""}]}. Today's date: ${today}.`,
      messages: [
        {
          role: "user",
          content: `Base URL: ${sourceUrl}\n\nPage content:\n${cleanedHtml}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  // Strip any accidental markdown fences
  const jsonText = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  try {
    return JSON.parse(jsonText) as ExtractionResult;
  } catch {
    throw new Error(`Failed to parse Claude response: ${jsonText.slice(0, 200)}`);
  }
}

// ── Client-side fast extractor (regex-based, no AI) ───────────────────────────
export function quickExtract(html: string, baseUrl: string): ExtractedPost[] {
  const items: ExtractedPost[] = [];
  const seen = new Set<string>();

  // Extract <a href> tags with article-like paths
  const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    let href = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (!text || text.length < 10 || text.length > 200) continue;
    if (!/\/(p|post|posts|blog|article|articles|newsletter|issue|entry)\//.test(href) &&
        !/\/\d{4}\//.test(href)) continue;

    // Make absolute
    try {
      href = new URL(href, baseUrl).href;
    } catch { continue; }

    if (seen.has(href)) continue;
    seen.add(href);

    items.push({ title: text, link: href, description: "", pubDate: "" });
    if (items.length >= 20) break;
  }

  return items;
}

// ── Core scrape function ───────────────────────────────────────────────────────
export async function scrapeFeed(
  sourceUrl: string,
  feedId: string,
  userId: string
): Promise<{ success: boolean; itemsCount: number; feedId: string; error?: string }> {
  try {
    // Fetch page
    const resp = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Feedhunt/1.0; +https://feedhunt.app)",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const cleaned = cleanHtml(html, sourceUrl);

    // Extract with Claude
    const result = await extractWithClaude(cleaned, sourceUrl);

    // Update feed metadata
    await supabase
      .from("scraped_feeds")
      .update({
        site_title: result.siteTitle || new URL(sourceUrl).hostname,
        site_description: result.siteDescription || "",
        last_scraped_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", feedId);

    // Upsert posts
    if (result.items?.length) {
      const posts = result.items
        .filter((item) => item.title && item.link)
        .map((item) => {
          // Resolve relative links to absolute URLs
          let link = item.link;
          try {
            link = new URL(item.link, sourceUrl).href;
          } catch { /* keep as-is */ }
          return {
            feed_id: feedId,
            title: item.title,
            link,
            description: item.description || "",
            pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            guid: link,
          };
        });

      await supabase
        .from("scraped_posts")
        .upsert(posts, { onConflict: "feed_id,guid", ignoreDuplicates: true });

      // Prune posts older than 90 days
      await supabase
        .from("scraped_posts")
        .delete()
        .eq("feed_id", feedId)
        .lt("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    }

    return { success: true, itemsCount: result.items?.length ?? 0, feedId };
  } catch (e: any) {
    // Store error on the feed record
    await supabase
      .from("scraped_feeds")
      .update({ last_error: e.message, updated_at: new Date().toISOString() })
      .eq("id", feedId);

    return { success: false, itemsCount: 0, feedId, error: e.message };
  }
}

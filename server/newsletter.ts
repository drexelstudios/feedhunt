/**
 * newsletter.ts — IMAP fetch pipeline for newsletter sources
 *
 * Strategy: lazy extraction (same as RSS)
 *   - IMAP fetch stores raw email HTML in feed_items.body_html
 *   - Readability runs lazily when the reading pane opens via /api/extract
 *   - /api/extract detects source_type='newsletter' and skips the HTTP fetch,
 *     reading body_html from feed_items instead
 *
 * Batch cap: max 20 emails per invocation to stay well within Vercel's 30s limit.
 */

import { createClient } from "@supabase/supabase-js";
// imapflow and mailparser are plain CJS — no bundling patches needed
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const BATCH_SIZE = 20;

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract "view online" URL from email HTML — common newsletter pattern */
function extractViewOnlineUrl(html: string): string | null {
  // Match anchor tags whose text content contains view-online variants
  const pattern =
    /<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:[^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>\s*)*)?(?:view\s+(?:this\s+)?(?:email|newsletter|online|in\s+browser)|read\s+online|open\s+in\s+browser|view\s+in\s+your\s+browser)[^<]*<\/a>/gi;
  const match = pattern.exec(html);
  if (match) return match[1];
  return null;
}

/** Extract first <img src> from HTML */
function extractFirstImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/** Strip HTML tags for plain-text summary */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")   // remove <style> blocks + contents
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")  // remove <script> blocks + contents
    .replace(/<!--[\s\S]*?-->/g, " ")                    // remove HTML comments
    .replace(/<[^>]*>/g, " ")                            // strip remaining tags
    // Named entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&ldquo;/gi, "\u201C")
    // Numeric entities (decimal: &#8217; and hex: &#x2019;)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      // Drop zero-width / invisible control characters
      if (cp === 0x200C || cp === 0x200B || cp === 0x200D || cp === 0xFEFF) return "";
      return String.fromCodePoint(cp);
    })
    .replace(/&#([0-9]+);/gi, (_, dec) => {
      const cp = parseInt(dec, 10);
      // Drop zero-width / invisible control characters
      if (cp === 8204 || cp === 8203 || cp === 8205 || cp === 65279) return "";
      return String.fromCodePoint(cp);
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Parse sender name + email from a From header string */
function parseSender(from: string): { name: string | null; email: string } {
  // Formats: "Name <email>" or just "email"
  const match = from.match(/^(.+?)\s*<([^>]+)>/);
  if (match) {
    return { name: match[1].trim().replace(/^["']|["']$/g, ""), email: match[2].trim().toLowerCase() };
  }
  return { name: null, email: from.trim().toLowerCase() };
}

// ── Feed/source resolution ────────────────────────────────────────────────────

interface ResolvedSource {
  feedId: number;
  newsletterSourceId: string;
  isActive: boolean;
}

/**
 * Look up or create a newsletter_sources + feeds row for a given sender.
 * Auto-created sources are is_active=true (user subscribed intentionally).
 */
async function resolveOrCreateSource(
  userId: string,
  senderEmail: string,
  senderName: string | null
): Promise<ResolvedSource | null> {
  // 1. Look up existing source
  const { data: existing } = await supabaseAdmin
    .from("newsletter_sources")
    .select("id, feed_id, is_active")
    .eq("user_id", userId)
    .eq("sender_email", senderEmail)
    .maybeSingle();

  if (existing) {
    return {
      feedId: existing.feed_id,
      newsletterSourceId: existing.id,
      isActive: existing.is_active,
    };
  }

  // 2. Create a feeds row first
  const { data: newFeed, error: feedError } = await supabaseAdmin
    .from("feeds")
    .insert({
      url: `newsletter:${senderEmail}`,
      title: senderName || senderEmail,
      description: `Newsletter from ${senderName || senderEmail}`,
      favicon: "",
      category: "General",
      position: 999,
      collapsed: false,
      max_items: 10,
      source_type: "newsletter",
      user_id: userId,
    })
    .select("id")
    .single();

  if (feedError || !newFeed) {
    console.error("[newsletter] Failed to create feed for", senderEmail, feedError);
    return null;
  }

  // 3. Create newsletter_sources row
  const { data: newSource, error: sourceError } = await supabaseAdmin
    .from("newsletter_sources")
    .insert({
      user_id: userId,
      feed_id: newFeed.id,
      sender_email: senderEmail,
      sender_name: senderName,
      display_name: senderName || senderEmail,
      is_active: true,
    })
    .select("id")
    .single();

  if (sourceError || !newSource) {
    console.error("[newsletter] Failed to create newsletter_source for", senderEmail, sourceError);
    return null;
  }

  return { feedId: newFeed.id, newsletterSourceId: newSource.id, isActive: true };
}

// ── Main fetch function ───────────────────────────────────────────────────────

export interface NewsletterFetchResult {
  processed: number;
  skipped: number;
  errors: string[];
}

/**
 * Connects to the configured IMAP inbox, processes up to BATCH_SIZE unread
 * emails, stores raw HTML in feed_items, and marks each as SEEN.
 *
 * Also runs a recovery pass: any feed_items row with body_html IS NULL is
 * re-fetched from IMAP (even if SEEN) so that DB resets don't brick the inbox.
 *
 * Called by:
 *   - POST /api/newsletter/sync (manual)
 *   - GET /api/cron/scrape (daily, wrapped in try/catch)
 *
 * userId: the Feedhunt user who owns this inbox connection.
 */
export async function fetchNewsletters(userId: string): Promise<NewsletterFetchResult> {
  const result: NewsletterFetchResult = { processed: 0, skipped: 0, errors: [] };

  const host = process.env.NEWSLETTER_IMAP_HOST;
  const port = parseInt(process.env.NEWSLETTER_IMAP_PORT || "993");
  const user = process.env.NEWSLETTER_IMAP_USER;
  const password = process.env.NEWSLETTER_IMAP_PASSWORD;
  const tls = process.env.NEWSLETTER_IMAP_TLS !== "false";

  if (!host || !user || !password) {
    result.errors.push("IMAP credentials not configured");
    return result;
  }

  // ── Recovery pass: find DB rows where body_html is NULL ───────────────────
  // These are items that were previously stored but had their content cleared
  // (e.g., via a SQL reset). We collect their email_message_ids so we can
  // re-fetch them from IMAP even though they're already SEEN.
  const { data: nullBodyItems } = await supabaseAdmin
    .from("feed_items")
    .select("id, email_message_id")
    .eq("user_id", userId)
    .eq("source_type", "newsletter")
    .is("body_html", null)
    .not("email_message_id", "is", null)
    .limit(BATCH_SIZE);

  const recoveryMessageIds = new Set(
    (nullBodyItems || []).map((r) => r.email_message_id as string).filter(Boolean)
  );

  const client = new ImapFlow({
    host,
    port,
    secure: tls,
    auth: { user, pass: password },
    logger: false, // suppress verbose imapflow logs
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Build UID list:
      //   1. All unseen messages (normal new-mail flow)
      //   2. Any seen messages that match a recovery message-id
      const uids: number[] = [];
      const seenUidsForRecovery: number[] = [];

      // Pass 1: collect unseen UIDs
      for await (const msg of client.fetch(
        { seen: false },
        { uid: true, envelope: true },
        { uid: true }
      )) {
        uids.push(msg.uid);
        if (uids.length >= BATCH_SIZE) break;
      }

      // Pass 2: if we have recovery targets, scan ALL messages for matching message-ids
      if (recoveryMessageIds.size > 0) {
        for await (const msg of client.fetch(
          { seen: true },
          { uid: true, envelope: true },
          { uid: true }
        )) {
          const mid = msg.envelope?.messageId;
          if (mid && recoveryMessageIds.has(mid) && !uids.includes(msg.uid)) {
            seenUidsForRecovery.push(msg.uid);
          }
          // Stop early once we've matched everything we need
          if (seenUidsForRecovery.length >= recoveryMessageIds.size) break;
        }
      }

      const allUids = [...uids, ...seenUidsForRecovery];

      if (allUids.length === 0) {
        return result; // nothing to process
      }

      // ── Process each UID ────────────────────────────────────────────────────
      for (const uid of allUids) {
        const isRecovery = seenUidsForRecovery.includes(uid);
        try {
          // Fetch full message
          const msg = await client.fetchOne(
            String(uid),
            { source: true },
            { uid: true }
          );

          if (!msg?.source) {
            result.skipped++;
            continue;
          }

          // Parse with mailparser
          const parsed = await simpleParser(msg.source);

          const messageId = parsed.messageId || `uid-${uid}-${Date.now()}`;
          const subject = parsed.subject || "(No subject)";
          const dateReceived = parsed.date || new Date();

          // Extract sender
          const fromAddress = parsed.from?.value?.[0];
          const senderEmail = fromAddress?.address?.toLowerCase() || "";
          const senderName = fromAddress?.name || null;

          if (!senderEmail) {
            result.skipped++;
            continue;
          }

          // Duplicate check by message-id — but skip check for recovery UIDs
          // (those rows already exist with body_html=NULL, that's why we're here)
          if (!isRecovery) {
            const { data: existing } = await supabaseAdmin
              .from("feed_items")
              .select("id")
              .eq("email_message_id", messageId)
              .maybeSingle();

            if (existing) {
              // Already stored — mark as seen and skip
              await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
              result.skipped++;
              continue;
            }
          }

          // Resolve or create feed + newsletter_source
          const source = await resolveOrCreateSource(userId, senderEmail, senderName);
          if (!source || !source.isActive) {
            result.skipped++;
            continue;
          }

          // Prefer HTML body, fall back to plain text wrapped in <p> tags
          const rawHtml = parsed.html
            ? parsed.html
            : parsed.textAsHtml || (parsed.text ? `<p>${parsed.text.replace(/\n/g, "<br>")}</p>` : "");

          // Extract view-online URL
          const viewOnlineUrl = rawHtml ? extractViewOnlineUrl(rawHtml) : null;

          // Extract thumbnail from first image in email
          const thumbnailUrl = rawHtml ? extractFirstImage(rawHtml) : null;

          // Plain-text summary from first ~300 chars
          const summary = stripHtml(rawHtml).slice(0, 300);

          // Upsert — always write body_html (new insert or recovery overwrite)
          const guid = messageId;
          const { error: upsertError } = await supabaseAdmin
            .from("feed_items")
            .upsert(
              {
                feed_id: source.feedId,
                user_id: userId,
                guid,
                title: subject,
                link: viewOnlineUrl || "",
                pub_date: dateReceived.toISOString(),
                author: senderName || senderEmail,
                summary,
                source_type: "newsletter",
                email_message_id: messageId,
                email_from: parsed.from?.text || senderEmail,
                email_received_at: dateReceived.toISOString(),
                view_online_url: viewOnlineUrl,
                thumbnail_url: thumbnailUrl,
                // Store raw HTML — reading pane extracts lazily via /api/extract
                body_html: rawHtml,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "feed_id,guid", ignoreDuplicates: false }
            );

          if (upsertError) {
            result.errors.push(`Failed to store ${subject}: ${upsertError.message}`);
            continue;
          }

          // Update newsletter_sources stats (skip for recovery — count already correct)
          if (!isRecovery) {
            await supabaseAdmin
              .from("newsletter_sources")
              .update({
                last_received_at: dateReceived.toISOString(),
                item_count: supabaseAdmin.rpc("increment_item_count", {
                  source_id: source.newsletterSourceId,
                }),
              })
              .eq("id", source.newsletterSourceId);

            // Mark as SEEN in IMAP — only after successful DB insert (new emails only)
            await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
          }

          result.processed++;
        } catch (emailErr: any) {
          // One bad email must never abort the batch
          console.error("[newsletter] Error processing email uid", uid, emailErr?.message);
          result.errors.push(`uid ${uid}: ${emailErr?.message || "unknown error"}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (connectErr: any) {
    console.error("[newsletter] IMAP connection error:", connectErr?.message);
    result.errors.push(`IMAP connection failed: ${connectErr?.message}`);
  } finally {
    try { await client.logout(); } catch {}
  }

  return result;
}

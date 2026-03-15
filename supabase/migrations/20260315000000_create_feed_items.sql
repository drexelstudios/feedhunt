-- Migration: create feed_items table
-- This is the unified item storage layer for both RSS and newsletter feeds.
-- RSS items are upserted here when a widget loads.
-- Newsletter items will be upserted here from IMAP when that feature ships.
-- The reading pane uses body_html (populated lazily by /api/extract) for both.
--
-- NOTE: Run this migration manually in the Supabase SQL editor.
-- DO NOT run via drizzle-kit push — this table is managed by Supabase.

CREATE TABLE IF NOT EXISTS feed_items (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id               INTEGER       NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  user_id               UUID          NOT NULL,
  guid                  TEXT          NOT NULL,
  title                 TEXT          NOT NULL DEFAULT '',
  link                  TEXT          NOT NULL DEFAULT '',
  pub_date              TIMESTAMPTZ,
  author                TEXT,
  summary               TEXT,

  -- Phase 2: thumbnail extracted from RSS media tags or first <img>
  thumbnail_url         TEXT,

  -- Phase 3: article body extracted via Mozilla Readability
  body_html             TEXT,
  body_extracted_at     TIMESTAMPTZ,
  reading_time_minutes  INTEGER,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One item per feed per guid (handles re-fetches cleanly)
  UNIQUE (feed_id, guid)
);

-- Index for fast per-feed item queries (ordered by date)
CREATE INDEX IF NOT EXISTS feed_items_feed_id_pub_date_idx
  ON feed_items (feed_id, pub_date DESC NULLS LAST);

-- Index for reading pane lookups by id
CREATE INDEX IF NOT EXISTS feed_items_id_idx
  ON feed_items (id);

-- RLS: users can only access their own items
ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feed_items_select" ON feed_items;
CREATE POLICY "feed_items_select"
  ON feed_items FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "feed_items_insert" ON feed_items;
CREATE POLICY "feed_items_insert"
  ON feed_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "feed_items_update" ON feed_items;
CREATE POLICY "feed_items_update"
  ON feed_items FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "feed_items_delete" ON feed_items;
CREATE POLICY "feed_items_delete"
  ON feed_items FOR DELETE
  USING (auth.uid() = user_id);

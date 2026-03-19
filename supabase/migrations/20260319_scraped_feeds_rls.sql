-- ─────────────────────────────────────────────────────────────────────────────
-- RLS for scraped_feeds and scraped_posts
--
-- scraped_feeds: users can only access their own feeds (user_id = auth.uid())
-- scraped_posts: users can only access posts belonging to their own feeds
--                (via join through scraped_feeds)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── scraped_feeds ─────────────────────────────────────────────────────────────
ALTER TABLE scraped_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scraped_feeds_select" ON scraped_feeds;
CREATE POLICY "scraped_feeds_select"
  ON scraped_feeds FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "scraped_feeds_insert" ON scraped_feeds;
CREATE POLICY "scraped_feeds_insert"
  ON scraped_feeds FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "scraped_feeds_update" ON scraped_feeds;
CREATE POLICY "scraped_feeds_update"
  ON scraped_feeds FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "scraped_feeds_delete" ON scraped_feeds;
CREATE POLICY "scraped_feeds_delete"
  ON scraped_feeds FOR DELETE
  USING (user_id = auth.uid());

-- ── scraped_posts ─────────────────────────────────────────────────────────────
-- Posts are owned transitively — a post belongs to a user if its feed does.
ALTER TABLE scraped_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scraped_posts_select" ON scraped_posts;
CREATE POLICY "scraped_posts_select"
  ON scraped_posts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scraped_feeds
      WHERE scraped_feeds.id = scraped_posts.feed_id
        AND scraped_feeds.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scraped_posts_insert" ON scraped_posts;
CREATE POLICY "scraped_posts_insert"
  ON scraped_posts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scraped_feeds
      WHERE scraped_feeds.id = scraped_posts.feed_id
        AND scraped_feeds.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scraped_posts_update" ON scraped_posts;
CREATE POLICY "scraped_posts_update"
  ON scraped_posts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM scraped_feeds
      WHERE scraped_feeds.id = scraped_posts.feed_id
        AND scraped_feeds.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "scraped_posts_delete" ON scraped_posts;
CREATE POLICY "scraped_posts_delete"
  ON scraped_posts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM scraped_feeds
      WHERE scraped_feeds.id = scraped_posts.feed_id
        AND scraped_feeds.user_id = auth.uid()
    )
  );

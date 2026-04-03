// ─────────────────────────────────────────────────────────────────────────────
// Demo feeds — static curated list shown to unauthenticated visitors.
// No DB rows, no user ownership. Fetched live, cached 30 min server-side.
// ─────────────────────────────────────────────────────────────────────────────

export interface DemoFeed {
  id: number;        // Synthetic negative IDs to avoid collisions with real feeds
  title: string;
  url: string;
  category: string;
  maxItems: number;
}

export const DEMO_CATEGORIES = [
  "World News",
  "Technology",
  "Politics",
  "Sports",
  "Finance",
  "Entertainment",
];

export const DEMO_FEEDS: DemoFeed[] = [
  // ── World News ───────────────────────────────────────────────────────────
  { id: -1,  title: "BBC News",         url: "https://feeds.bbci.co.uk/news/rss.xml",                       category: "World News",    maxItems: 10 },
  { id: -2,  title: "Reuters",          url: "https://news.google.com/rss/search?q=site:reuters.com&hl=en-US&gl=US&ceid=US:en", category: "World News", maxItems: 10 },
  { id: -3,  title: "AP News",          url: "https://news.google.com/rss/search?q=source:Associated+Press&hl=en-US&gl=US&ceid=US:en", category: "World News", maxItems: 10 },
  { id: -4,  title: "Al Jazeera",       url: "https://www.aljazeera.com/xml/rss/all.xml",                  category: "World News",    maxItems: 10 },

  // ── Technology ───────────────────────────────────────────────────────────
  { id: -5,  title: "The Verge",        url: "https://www.theverge.com/rss/index.xml",                     category: "Technology",    maxItems: 10 },
  { id: -6,  title: "Ars Technica",     url: "https://feeds.arstechnica.com/arstechnica/index",            category: "Technology",    maxItems: 10 },
  { id: -7,  title: "Wired",            url: "https://www.wired.com/feed/rss",                             category: "Technology",    maxItems: 10 },
  { id: -8,  title: "Lifehacker",       url: "https://lifehacker.com/rss",                                 category: "Technology",    maxItems: 10 },

  // ── Politics ─────────────────────────────────────────────────────────────
  { id: -9,  title: "Politico",         url: "https://www.politico.com/rss/politicopicks.xml",             category: "Politics",      maxItems: 10 },
  { id: -10, title: "NPR Politics",     url: "https://feeds.npr.org/1014/rss.xml",                        category: "Politics",      maxItems: 10 },
  { id: -11, title: "The Hill",         url: "https://thehill.com/rss/syndicator/19109",                  category: "Politics",      maxItems: 10 },
  { id: -12, title: "RealClearPolitics",url: "https://www.realclearpolitics.com/xml/politics.xml",        category: "Politics",      maxItems: 10 },

  // ── Sports ───────────────────────────────────────────────────────────────
  { id: -13, title: "ESPN Top News",    url: "https://www.espn.com/espn/rss/news",                        category: "Sports",        maxItems: 10 },
  { id: -14, title: "Bleacher Report",  url: "https://bleacherreport.com/articles/feed",                  category: "Sports",        maxItems: 10 },
  { id: -15, title: "CBS Sports",       url: "https://www.cbssports.com/rss/headlines/",                  category: "Sports",        maxItems: 10 },
  { id: -16, title: "Sports Illustrated",url: "https://www.si.com/rss/si_topstories.rss",                 category: "Sports",        maxItems: 10 },

  // ── Finance ──────────────────────────────────────────────────────────────
  { id: -17, title: "CNBC",             url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",     category: "Finance",       maxItems: 10 },
  { id: -18, title: "MarketWatch",      url: "https://feeds.marketwatch.com/marketwatch/topstories/",     category: "Finance",       maxItems: 10 },
  { id: -19, title: "Investopedia",     url: "https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline", category: "Finance", maxItems: 10 },
  { id: -20, title: "Yahoo Finance",    url: "https://finance.yahoo.com/rss/",                            category: "Finance",       maxItems: 10 },

  // ── Entertainment ────────────────────────────────────────────────────────
  { id: -21, title: "Variety",          url: "https://variety.com/feed/",                                 category: "Entertainment", maxItems: 10 },
  { id: -22, title: "Deadline",         url: "https://deadline.com/feed/",                                category: "Entertainment", maxItems: 10 },
  { id: -23, title: "Rolling Stone",    url: "https://www.rollingstone.com/feed/",                        category: "Entertainment", maxItems: 10 },
  { id: -24, title: "The A.V. Club",    url: "https://www.avclub.com/rss",                                category: "Entertainment", maxItems: 10 },
];

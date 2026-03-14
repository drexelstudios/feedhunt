import { createClient } from "@supabase/supabase-js";
import { Feed, InsertFeed, Category, InsertCategory } from "../shared/schema";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Storage interface ─────────────────────────────────────────────────────────
export interface IStorage {
  getFeeds(userId: string): Promise<Feed[]>;
  getFeed(id: number, userId: string): Promise<Feed | undefined>;
  createFeed(feed: InsertFeed, userId: string): Promise<Feed>;
  updateFeed(id: number, feed: Partial<InsertFeed>, userId: string): Promise<Feed | undefined>;
  deleteFeed(id: number, userId: string): Promise<boolean>;
  reorderFeeds(ids: number[], userId: string): Promise<void>;
  getCategories(userId: string): Promise<Category[]>;
  createCategory(cat: InsertCategory, userId: string): Promise<Category>;
  deleteCategory(id: number, userId: string): Promise<boolean>;
  seedDefaultData(userId: string): Promise<void>;
}

// Default feeds seeded for new users
const DEFAULT_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/rss.xml", title: "BBC World News", category: "News", position: 0 },
  { url: "https://techcrunch.com/feed/", title: "TechCrunch", category: "Tech", position: 1 },
  { url: "https://www.theverge.com/rss/index.xml", title: "The Verge", category: "Tech", position: 2 },
  { url: "https://hnrss.org/frontpage", title: "Hacker News", category: "Tech", position: 3 },
  { url: "https://www.designernews.co/?format=rss", title: "Designer News", category: "Design", position: 4 },
];

const DEFAULT_CATEGORIES = [
  { name: "News", position: 0 },
  { name: "Tech", position: 1 },
  { name: "Design", position: 2 },
  { name: "General", position: 3 },
];

// ── Supabase-backed storage ───────────────────────────────────────────────────
export class SupabaseStorage implements IStorage {
  async getFeeds(userId: string): Promise<Feed[]> {
    const { data, error } = await supabase
      .from("feeds")
      .select("*")
      .eq("user_id", userId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapFeed);
  }

  async getFeed(id: number, userId: string): Promise<Feed | undefined> {
    const { data, error } = await supabase
      .from("feeds")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (error) return undefined;
    return data ? mapFeed(data) : undefined;
  }

  async createFeed(feed: InsertFeed, userId: string): Promise<Feed> {
    const { data, error } = await supabase
      .from("feeds")
      .insert({
        url: feed.url,
        title: feed.title,
        description: feed.description ?? "",
        favicon: feed.favicon ?? "",
        category: feed.category ?? "General",
        position: feed.position ?? 999,
        collapsed: feed.collapsed ?? false,
        max_items: feed.maxItems ?? 10,
        user_id: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapFeed(data);
  }

  async updateFeed(id: number, update: Partial<InsertFeed>, userId: string): Promise<Feed | undefined> {
    const patch: Record<string, unknown> = {};
    if (update.title !== undefined) patch.title = update.title;
    if (update.url !== undefined) patch.url = update.url;
    if (update.description !== undefined) patch.description = update.description;
    if (update.favicon !== undefined) patch.favicon = update.favicon;
    if (update.category !== undefined) patch.category = update.category;
    if (update.position !== undefined) patch.position = update.position;
    if (update.collapsed !== undefined) patch.collapsed = update.collapsed;
    if (update.maxItems !== undefined) patch.max_items = update.maxItems;

    const { data, error } = await supabase
      .from("feeds")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data ? mapFeed(data) : undefined;
  }

  async deleteFeed(id: number, userId: string): Promise<boolean> {
    const { error } = await supabase.from("feeds").delete().eq("id", id).eq("user_id", userId);
    return !error;
  }

  async reorderFeeds(ids: number[], userId: string): Promise<void> {
    await Promise.all(
      ids.map((id, i) =>
        supabase.from("feeds").update({ position: i }).eq("id", id).eq("user_id", userId)
      )
    );
  }

  async getCategories(userId: string): Promise<Category[]> {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", userId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapCategory);
  }

  async createCategory(cat: InsertCategory, userId: string): Promise<Category> {
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: cat.name, position: cat.position ?? 99, user_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapCategory(data);
  }

  async deleteCategory(id: number, userId: string): Promise<boolean> {
    const { error } = await supabase.from("categories").delete().eq("id", id).eq("user_id", userId);
    return !error;
  }

  async seedDefaultData(userId: string): Promise<void> {
    // Check if user already has data
    const { count } = await supabase
      .from("feeds")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (count && count > 0) return; // already seeded

    // Insert default categories
    for (const cat of DEFAULT_CATEGORIES) {
      await supabase
        .from("categories")
        .insert({ name: cat.name, position: cat.position, user_id: userId });
    }

    // Insert default feeds
    for (const feed of DEFAULT_FEEDS) {
      await supabase.from("feeds").insert({
        url: feed.url,
        title: feed.title,
        description: "",
        favicon: "",
        category: feed.category,
        position: feed.position,
        collapsed: false,
        max_items: 10,
        user_id: userId,
      });
    }
  }
}

// ── Row mappers (snake_case DB → camelCase app) ───────────────────────────────
function mapFeed(row: any): Feed {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description ?? "",
    favicon: row.favicon ?? "",
    category: row.category ?? "General",
    position: row.position ?? 0,
    collapsed: row.collapsed ?? false,
    maxItems: row.max_items ?? 10,
  };
}

function mapCategory(row: any): Category {
  return {
    id: row.id,
    name: row.name,
    position: row.position ?? 0,
  };
}

export const storage = new SupabaseStorage();

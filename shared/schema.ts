import { pgTable, text, integer, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Feeds ────────────────────────────────────────────────────────────────────
export const feeds = pgTable("feeds", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  favicon: text("favicon").notNull().default(""),
  category: text("category").notNull().default("General"),
  position: integer("position").notNull().default(0),
  collapsed: boolean("collapsed").notNull().default(false),
  maxItems: integer("max_items").notNull().default(10),
});

export const insertFeedSchema = createInsertSchema(feeds).omit({ id: true });
export type InsertFeed = z.infer<typeof insertFeedSchema>;
export type Feed = typeof feeds.$inferSelect;

// ── Categories ───────────────────────────────────────────────────────────────
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

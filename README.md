# Feedboard

A personal RSS aggregator dashboard — like iGoogle or MyYahoo, rebuilt for modern use.

## Features

- Multi-column widget grid with live RSS feeds
- Add any RSS/Atom feed via URL with preview
- Category tabs to filter your view
- Drag-and-drop reordering
- Collapse/expand individual feed widgets
- Per-feed refresh + global refresh
- Dark/light mode
- Fully persistent via Supabase
- Responsive — works on mobile

## Stack

- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Express.js (RSS proxy + CRUD API)
- **Database:** Supabase (PostgreSQL)
- **Drag & Drop:** dnd-kit
- **RSS Parsing:** rss-parser

## Getting Started

```bash
npm install
npm run dev
```

Server runs on `http://localhost:5000`.

## Database Setup

Create the following tables in your Supabase project:

```sql
create table categories (
  id serial primary key,
  name text not null,
  position integer not null default 0
);

create table feeds (
  id serial primary key,
  url text not null,
  title text not null,
  description text not null default '',
  favicon text not null default '',
  category text not null default 'General',
  position integer not null default 0,
  collapsed boolean not null default false,
  max_items integer not null default 10
);
```

Built with [Perplexity Computer](https://www.perplexity.ai/computer).

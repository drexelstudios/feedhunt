-- Migration: user_preferences table
-- Stores per-user display preferences as a single JSONB blob.
-- One row per user, upserted by the /api/preferences endpoint.

create table if not exists public.user_preferences (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  prefs    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS: users can only read/write their own row
alter table public.user_preferences enable row level security;

create policy "users can read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "users can upsert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "users can update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);

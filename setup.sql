-- ============================================================
-- MOAR Account Tracker — Supabase Setup
-- Paste this entire block into Supabase → SQL Editor → Run
-- ============================================================

-- 1. Create the table (single-row store — same pattern as JSONBin)
create table if not exists app_data (
  id            integer      primary key default 1,
  accounts      jsonb        not null default '[]',
  prospects     jsonb        not null default '[]',
  meta          jsonb        not null default '{"month":"","weekStarts":["—","—","—","—"]}',
  activity_log  jsonb        not null default '[]',
  input_history jsonb        not null default '[]',
  updated_at    timestamptz  not null default now()
);

-- 2. Seed the one row the app reads/writes
insert into app_data (id) values (1)
  on conflict (id) do nothing;

-- 3. Enable Row Level Security (RLS) — required for Supabase
alter table app_data enable row level security;

-- 4. Allow the anon key to read and update (the app uses PATCH)
--    The app has its own admin password layer so public read is fine
create policy "allow_read"   on app_data for select using (true);
create policy "allow_update" on app_data for update using (true);

-- Done. Your database is ready.
-- Copy your Project URL and anon key from:
-- Supabase Dashboard → Settings → API
-- and paste them into index.html where it says REPLACE_WITH_SUPABASE_URL
-- and REPLACE_WITH_SUPABASE_ANON_KEY

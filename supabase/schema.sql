-- ───────────────────────────────────────────────────────────────────────────
-- AURA — Supabase schema for realtime guest requests + stay sessions.
-- Run this in the Supabase SQL editor (or `supabase db execute`).
--
-- Design notes:
--  • Ids are TEXT and reuse the ids the app already generates (gr_…, gs_…), so
--    localStorage rows and cloud rows stay interchangeable.
--  • Rows are NEVER deleted by the app: "Concludi Soggiorno" sets closed_at on
--    guest_sessions and archived = true on guest_requests. Revenue reporting
--    counts every row, archived included.
--  • The PIN is never stored here (never sent to the server at all): the PIN
--    check stays client-side against src/data/config.ts.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.guest_requests (
  id                text primary key,
  villa_id          text not null,
  villa_name        text,
  guest_session_id  text not null,
  guest_name        text not null,
  service_label     text,
  price             numeric null,
  status            text not null check (
                      status in ('received', 'in_progress', 'confirmed', 'completed', 'cancelled')
                    ),
  supplier_id       text null,
  supplier_name     text null,
  replies           jsonb not null default '[]'::jsonb,
  archived          boolean not null default false,
  -- Extra columns that keep the app's own request shape lossless on round-trip.
  details           text not null default '',
  agency_pct        numeric,
  aura_pct          numeric,
  staff_note        text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists guest_requests_villa_idx on public.guest_requests (villa_id);
create index if not exists guest_requests_session_idx on public.guest_requests (guest_session_id);
create index if not exists guest_requests_created_idx on public.guest_requests (created_at desc);

create table if not exists public.guest_sessions (
  id          text primary key,
  villa_id    text not null,
  guest_name  text not null,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz null
);

create index if not exists guest_sessions_villa_idx on public.guest_sessions (villa_id);

-- ── Row level security ──────────────────────────────────────────────────────
-- DEMO-PERMISSIVE POLICIES: anon can read and write both tables so the demo
-- works without an auth flow. This is NOT safe for real production traffic —
-- before going live, replace these with policies that scope rows to an
-- authenticated guest session / staff role (and move the PIN check server-side).
alter table public.guest_requests enable row level security;
alter table public.guest_sessions enable row level security;

drop policy if exists "demo anon read requests" on public.guest_requests;
drop policy if exists "demo anon insert requests" on public.guest_requests;
drop policy if exists "demo anon update requests" on public.guest_requests;
create policy "demo anon read requests" on public.guest_requests
  for select to anon using (true);
create policy "demo anon insert requests" on public.guest_requests
  for insert to anon with check (true);
create policy "demo anon update requests" on public.guest_requests
  for update to anon using (true) with check (true);

drop policy if exists "demo anon read sessions" on public.guest_sessions;
drop policy if exists "demo anon insert sessions" on public.guest_sessions;
drop policy if exists "demo anon update sessions" on public.guest_sessions;
create policy "demo anon read sessions" on public.guest_sessions
  for select to anon using (true);
create policy "demo anon insert sessions" on public.guest_sessions
  for insert to anon with check (true);
create policy "demo anon update sessions" on public.guest_sessions
  for update to anon using (true) with check (true);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Both tables join the realtime publication so postgres_changes fires.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'guest_requests'
  ) then
    alter publication supabase_realtime add table public.guest_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'guest_sessions'
  ) then
    alter publication supabase_realtime add table public.guest_sessions;
  end if;
end $$;

-- Full row payloads on update events (needed to react to closed_at / archived).
alter table public.guest_requests replica identity full;
alter table public.guest_sessions replica identity full;

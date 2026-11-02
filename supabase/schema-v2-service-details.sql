-- ───────────────────────────────────────────────────────────────────────────
-- AURA — schema v2: structured service details + recorded commissions
--
-- Run this in the Supabase SQL editor AFTER supabase/schema.sql.
-- It is IDEMPOTENT: every statement is guarded, so running it twice (or on a
-- database that already has the columns) changes nothing.
--
-- Why: the Services tab now opens a specific modal per service category
-- (Boat Charter, Private Chef, Luxury Transfer / Helicopter, Wellness & Spa).
-- On "Conferma e Invia Richiesta" the app records
--   • price               — the live estimated total (existing column)
--   • details             — the guest's choices, as jsonb
--   • agency_commission   — round2(price × agencyCommissionPct / 100)
--   • platform_commission — round2(price × platformCommissionPct / 100)
-- The app keeps working BEFORE this migration runs: an insert that trips over
-- these columns is retried once without them (src/lib/realtime.ts), so the
-- request — including its price — is still stored.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. details: TEXT note → jsonb object ───────────────────────────────────
-- schema.sql created `details` as `text not null default ''` (a free-text
-- note). v2 stores a jsonb object. On a database that still has the text
-- column the block below converts it losslessly:
--   • '' (or null)      → '{}'      (legacy rows simply carry no details)
--   • any other text    → a jsonb string, so nothing is lost
-- On a fresh database the column is created straight as jsonb.
alter table public.guest_requests
  add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guest_requests'
      and column_name = 'details'
      and data_type <> 'jsonb'
  ) then
    alter table public.guest_requests
      alter column details drop default;

    alter table public.guest_requests
      alter column details type jsonb
      using (
        case
          when details is null or btrim(details::text) = '' then '{}'::jsonb
          else to_jsonb(details::text)
        end
      );

    update public.guest_requests set details = '{}'::jsonb where details is null;

    alter table public.guest_requests
      alter column details set default '{}'::jsonb;
    alter table public.guest_requests
      alter column details set not null;
  end if;
end $$;

-- ── 2. Recorded commission amounts ─────────────────────────────────────────
-- Both are nullable: rows created before this migration (and rows without a
-- recorded price) legitimately have no commission. The staff dashboard falls
-- back to deriving them from `price` when they are null.
alter table public.guest_requests
  add column if not exists agency_commission numeric null;

alter table public.guest_requests
  add column if not exists platform_commission numeric null;
-- The percentages applied when the request was submitted, recorded for audit:
-- if the configured rates change later, older rows keep the rate they used.
-- Nullable - legacy rows have no recorded rate and the app falls back to the
-- current config when reading them.
alter table public.guest_requests
  add column if not exists agency_pct numeric null;
alter table public.guest_requests
  add column if not exists aura_pct numeric null;

comment on column public.guest_requests.details is
  'Guest choices from the Services modals as jsonb, e.g. {"category":"yacht","duration":"full-day","departureTime":"10:00","skipper":true,"fuel":true,"total":3200}.';
comment on column public.guest_requests.agency_commission is
  'Agency commission recorded with the request: round(price * agencyCommissionPct / 100, 2). Null when no price was recorded.';
comment on column public.guest_requests.platform_commission is
  'AURA platform commission recorded with the request: round(price * platformCommissionPct / 100, 2). Null when no price was recorded.';

-- ── 3. Lookup index ────────────────────────────────────────────────────────
-- Filtering the staff views by service category ("show me every yacht request")
-- reads details->>'category'.
create index if not exists guest_requests_details_category_idx
  on public.guest_requests ((details ->> 'category'));

-- ── 4. Realtime ────────────────────────────────────────────────────────────
-- guest_requests is already in the realtime publication (schema.sql); the new
-- columns ride along with the row payload, so nothing else is needed here.

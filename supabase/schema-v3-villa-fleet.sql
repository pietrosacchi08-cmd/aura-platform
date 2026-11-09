-- ============================================================================
-- AURA — Schema v3: flotta veicoli e trasferimenti legata alla singola villa
-- ============================================================================
--
-- COSA FA
--   1. public.suppliers   → i fornitori di trasporto (SUV, van, sedan, supercar,
--                           elicottero).
--   2. public.villa_fleet → il listino veicoli di UNA villa: ogni riga è un
--                           veicolo attivo per quella villa, con prezzi in EUR.
--
-- PERCHÉ
--   La chat e il modal Trasferimenti non devono più conoscere prezzi scritti nel
--   codice: leggono queste due tabelle con la publishable key (SELECT anon) e
--   mostrano solo ciò che la villa ha davvero. Se la tabella non esiste ancora,
--   l'app usa un listino di fallback (src/lib/fleet.ts) e continua a funzionare.
--
-- COME SI ESEGUE
--   Supabase → SQL Editor → incolla tutto il file → Run.
--   È IDEMPOTENTE: si può rieseguire senza errori e senza duplicare righe
--   (create table if not exists + on conflict (id) do update).
--
-- FORMULA DI PREZZO (l'unica usata dall'app, in calculate_service_quote)
--   totale = base_price
--          + unit_price * unità
--          + luggage_surcharge   * max(0, bagagli    - 2)   -- 2 bagagli inclusi
--          + extra_pax_surcharge * max(0, passeggeri - 2)   -- 2 passeggeri inclusi
--   dove unità = km   se unit = 'km'
--              = ore  se unit = 'hour'
--              = 1    se unit = 'fixed'   (una corsa: unit_price è il prezzo della corsa)
--   Le percentuali di riparto (agenzia 12%, AURA 3%) NON stanno qui: restano in
--   src/data/config.ts (revenueConfig) e vengono applicate al totale.
--
-- ============================================================================


-- ── 1. Fornitori ────────────────────────────────────────────────────────────

create table if not exists public.suppliers (
  id       text primary key,
  name     text not null,
  category text not null,
  active   boolean not null default true
);

-- Vincolo di categoria: aggiunto solo se non esiste già (rieseguibile).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suppliers_category_check'
  ) then
    alter table public.suppliers
      add constraint suppliers_category_check
      check (category in ('suv', 'van', 'sedan', 'supercar', 'helicopter'));
  end if;
end $$;

comment on table public.suppliers is
  'AURA — fornitori di trasporto (veicoli con autista ed elicotteri).';


-- ── 2. Flotta per villa ─────────────────────────────────────────────────────

create table if not exists public.villa_fleet (
  id                  text primary key,
  villa_id            text not null,
  supplier_id         text not null references public.suppliers (id),
  category            text not null,
  label               text not null,
  base_price          numeric not null default 0,
  unit_price          numeric not null default 0,
  unit                text    not null default 'km',
  luggage_surcharge   numeric not null default 0,
  extra_pax_surcharge numeric not null default 0,
  max_pax             integer not null default 4,
  active              boolean not null default true
);

-- Colonne aggiunte in seguito: presenti anche su una tabella già creata.
alter table public.villa_fleet add column if not exists supplier_id         text;
alter table public.villa_fleet add column if not exists category            text;
alter table public.villa_fleet add column if not exists label               text;
alter table public.villa_fleet add column if not exists base_price          numeric not null default 0;
alter table public.villa_fleet add column if not exists unit_price          numeric not null default 0;
alter table public.villa_fleet add column if not exists unit                text    not null default 'km';
alter table public.villa_fleet add column if not exists luggage_surcharge   numeric not null default 0;
alter table public.villa_fleet add column if not exists extra_pax_surcharge numeric not null default 0;
alter table public.villa_fleet add column if not exists max_pax             integer not null default 4;
alter table public.villa_fleet add column if not exists active              boolean not null default true;

-- Vincoli: creati una sola volta.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'villa_fleet_category_check'
  ) then
    alter table public.villa_fleet
      add constraint villa_fleet_category_check
      check (category in ('suv', 'van', 'sedan', 'supercar', 'helicopter'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'villa_fleet_unit_check'
  ) then
    alter table public.villa_fleet
      add constraint villa_fleet_unit_check
      check (unit in ('km', 'hour', 'fixed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'villa_fleet_max_pax_check'
  ) then
    alter table public.villa_fleet
      add constraint villa_fleet_max_pax_check
      check (max_pax between 1 and 16);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'villa_fleet_prices_check'
  ) then
    alter table public.villa_fleet
      add constraint villa_fleet_prices_check
      check (base_price >= 0 and unit_price >= 0
             and luggage_surcharge >= 0 and extra_pax_surcharge >= 0);
  end if;
end $$;

comment on table public.villa_fleet is
  'AURA — listino veicoli di una villa: una riga = un veicolo prenotabile.';

comment on column public.villa_fleet.villa_id is
  'id della villa in src/data/properties.ts (ref-6291, ref-14828, ref-15864, ref-20417).';
comment on column public.villa_fleet.unit is
  'Unità di tariffa: km (percorrenza), hour (durata), fixed (corsa a prezzo fisso).';
comment on column public.villa_fleet.luggage_surcharge is
  'Supplemento per bagaglio oltre i 2 inclusi.';
comment on column public.villa_fleet.extra_pax_surcharge is
  'Supplemento per passeggero oltre i 2 inclusi.';

-- Lettura per villa / categoria: le due query che fa l'app.
create index if not exists villa_fleet_villa_id_idx
  on public.villa_fleet (villa_id) where active;
create index if not exists villa_fleet_supplier_id_idx
  on public.villa_fleet (supplier_id);


-- ── 3. Sicurezza: sola lettura per il client ────────────────────────────────
-- L'app legge con la publishable (anon) key: SELECT sì, scrittura no.
-- Nessuna policy di INSERT/UPDATE/DELETE per anon → le modifiche passano solo
-- dal SQL editor dell'owner.

alter table public.suppliers   enable row level security;
alter table public.villa_fleet enable row level security;

drop policy if exists "suppliers_read" on public.suppliers;
create policy "suppliers_read"
  on public.suppliers for select
  to anon, authenticated
  using (true);

drop policy if exists "villa_fleet_read" on public.villa_fleet;
create policy "villa_fleet_read"
  on public.villa_fleet for select
  to anon, authenticated
  using (true);

grant select on public.suppliers   to anon, authenticated;
grant select on public.villa_fleet to anon, authenticated;


-- ── 4. Seed fornitori ───────────────────────────────────────────────────────

insert into public.suppliers (id, name, category, active) values
  ('sup-versilia-drive',        'Versilia Drive',        'suv',        true),
  ('sup-costa-chauffeurs',      'Costa Chauffeurs',      'sedan',      true),
  ('sup-toscana-luxury-van',    'Toscana Luxury Van',    'van',        true),
  ('sup-forte-prestige',        'Forte Prestige Cars',   'supercar',   true),
  ('sup-elite-air-versilia',    'Elite Air Versilia',    'helicopter', true),
  ('sup-monaco-elite-aviation', 'Monaco Elite Aviation', 'helicopter', true)
on conflict (id) do update set
  name     = excluded.name,
  category = excluded.category,
  active   = excluded.active;


-- ── 5. Seed flotta ──────────────────────────────────────────────────────────
-- Quattro flotte DIVERSE, una per villa:
--   ref-6291  Forte dei Marmi     SUV, sedan, van, supercar        — NIENTE elicottero
--   ref-14828 Pietrasanta Hills   SUV, sedan, supercar, elicottero — van presente ma non attivo
--   ref-15864 Pietrasanta Tennis  SUV, sedan, van, elicottero      — NIENTE supercar
--   ref-20417 Residenza Alpemare  SUV, sedan, van                  — NIENTE supercar, NIENTE elicottero
-- Così si può verificare che una categoria assente non compaia nel modal.

insert into public.villa_fleet (
  id, villa_id, supplier_id, category, label,
  base_price, unit_price, unit, luggage_surcharge, extra_pax_surcharge, max_pax, active
) values

  -- ── ref-6291 · Villa Forte dei Marmi ──────────────────────────────────────
  ('flt-6291-suv-gls',          'ref-6291', 'sup-versilia-drive',     'suv',
   'Mercedes GLS 450',              180,   2.80, 'km',    25,   0, 6, true),
  ('flt-6291-suv-rangerover',   'ref-6291', 'sup-versilia-drive',     'suv',
   'Range Rover Autobiography',     200,   3.00, 'km',    25,   0, 5, true),
  ('flt-6291-sedan-sclass',     'ref-6291', 'sup-costa-chauffeurs',   'sedan',
   'Mercedes Classe S 580',         160,   2.60, 'km',    20,  90, 3, true),
  ('flt-6291-van-vclass',       'ref-6291', 'sup-toscana-luxury-van', 'van',
   'Mercedes V-Class Exclusive',    230,   3.20, 'km',     0,   0, 7, true),
  ('flt-6291-supercar-roma',    'ref-6291', 'sup-forte-prestige',     'supercar',
   'Ferrari Roma',                  900,   6.50, 'km',    60,   0, 2, true),
  ('flt-6291-supercar-huracan', 'ref-6291', 'sup-forte-prestige',     'supercar',
   'Lamborghini Huracán EVO',       950,   7.00, 'km',    60,   0, 2, true),

  -- ── ref-14828 · Pietrasanta Hills ─────────────────────────────────────────
  ('flt-14828-suv-gls',         'ref-14828', 'sup-versilia-drive',     'suv',
   'Mercedes GLS 450',              190,   2.90, 'km',    25,   0, 6, true),
  ('flt-14828-suv-levante',     'ref-14828', 'sup-versilia-drive',     'suv',
   'Maserati Levante Trofeo',       210,   3.10, 'km',    25,   0, 5, true),
  ('flt-14828-sedan-quattroporte', 'ref-14828', 'sup-costa-chauffeurs', 'sedan',
   'Maserati Quattroporte',         190,   2.90, 'km',    20,  90, 4, true),
  ('flt-14828-supercar-911',    'ref-14828', 'sup-forte-prestige',     'supercar',
   'Porsche 911 Carrera 4S',        780,   5.80, 'km',    60,   0, 2, true),
  ('flt-14828-heli-h130',       'ref-14828', 'sup-elite-air-versilia', 'helicopter',
   'Airbus H130',                  2400, 1450.00, 'hour',  40, 320, 6, true),
  -- presente in tabella ma NON prenotabile: serve a verificare il filtro active
  ('flt-14828-van-vclass',      'ref-14828', 'sup-toscana-luxury-van', 'van',
   'Mercedes V-Class (non disponibile)', 240, 3.40, 'km',  0,   0, 7, false),

  -- ── ref-15864 · Pietrasanta Tennis ────────────────────────────────────────
  ('flt-15864-suv-levante',     'ref-15864', 'sup-versilia-drive',     'suv',
   'Maserati Levante',              200,   3.00, 'km',    25,   0, 5, true),
  ('flt-15864-sedan-quattroporte', 'ref-15864', 'sup-costa-chauffeurs', 'sedan',
   'Maserati Quattroporte',         180,   2.80, 'km',    20,  80, 4, true),
  ('flt-15864-van-vclass',      'ref-15864', 'sup-toscana-luxury-van', 'van',
   'Mercedes V-Class',              220,   3.10, 'km',     0,   0, 7, true),
  ('flt-15864-heli-h145',       'ref-15864', 'sup-monaco-elite-aviation', 'helicopter',
   'Airbus H145',                  2900, 1650.00, 'hour',  40, 350, 7, true),

  -- ── ref-20417 · Residenza Alpemare ────────────────────────────────────────
  ('flt-20417-suv-gls',         'ref-20417', 'sup-versilia-drive',     'suv',
   'Mercedes GLS 450',              190,   2.90, 'km',    25,   0, 6, true),
  ('flt-20417-van-vclass',      'ref-20417', 'sup-toscana-luxury-van', 'van',
   'Mercedes V-Class Exclusive',    260,   3.60, 'km',     0,   0, 6, true),
  ('flt-20417-sedan-ghost',     'ref-20417', 'sup-costa-chauffeurs',   'sedan',
   'Rolls-Royce Ghost',             350, 620.00, 'fixed', 40, 120, 3, true)

on conflict (id) do update set
  villa_id            = excluded.villa_id,
  supplier_id         = excluded.supplier_id,
  category            = excluded.category,
  label               = excluded.label,
  base_price          = excluded.base_price,
  unit_price          = excluded.unit_price,
  unit                = excluded.unit,
  luggage_surcharge   = excluded.luggage_surcharge,
  extra_pax_surcharge = excluded.extra_pax_surcharge,
  max_pax             = excluded.max_pax,
  active              = excluded.active;


-- ── 6. Verifica (facoltativa, da eseguire a mano) ───────────────────────────
--
-- select f.villa_id, f.category, f.label, s.name as fornitore,
--        f.base_price, f.unit_price, f.unit, f.max_pax
--   from public.villa_fleet f
--   join public.suppliers s on s.id = f.supplier_id
--  where f.active
--  order by f.villa_id, f.category, f.label;
--
-- Atteso: ref-6291 senza elicottero, ref-15864 e ref-20417 senza supercar,
--         ref-20417 senza elicottero, e 0 righe con active = false.

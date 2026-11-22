-- ============================================================================
-- AURA — Schema v4: capienza reale per veicolo (passeggeri e bagagli inclusi)
-- ============================================================================
--
-- COSA FA
--   Aggiunge a public.villa_fleet le due soglie che il preventivo usava come
--   costanti nel codice (2 passeggeri / 2 bagagli inclusi):
--     • included_pax  → passeggeri già compresi nel prezzo base
--     • included_bags → bagagli già compresi nel prezzo base
--   e le valorizza per categoria, così un van da 6 posti non fa scattare il
--   supplemento al terzo passeggero.
--
-- PERCHÉ
--   `calculate_service_quote` (src/lib/fleet.ts) applicava
--     extra_pax_surcharge * max(0, pax    - 2)
--     luggage_surcharge    * max(0, bagagli - 2)
--   a qualunque veicolo. Con questa migrazione le soglie diventano dati:
--     extra_pax_surcharge * max(0, pax    - included_pax)
--     luggage_surcharge   * max(0, bagagli - included_bags)
--   Se le colonne non esistono ancora (SQL non eseguito) l'app ricade sulle
--   soglie prudenti 2 / 2 e continua a funzionare identica.
--
-- COME SI ESEGUE
--   Supabase → SQL Editor → incolla tutto il file → Run.
--   È IDEMPOTENTE: `add column if not exists`, vincoli creati solo se assenti,
--   update per categoria con WHERE che salta le righe già corrette. Nessuna
--   distruzione di dati, nessuna riga aggiunta o rimossa.
--
-- ============================================================================


-- ── 1. Colonne ──────────────────────────────────────────────────────────────
-- Default prudente 2 / 2 = comportamento storico finché non si aggiornano i
-- record (e per le righe nuove inserite senza capienza esplicita).

alter table public.villa_fleet
  add column if not exists included_pax  integer not null default 2;
alter table public.villa_fleet
  add column if not exists included_bags integer not null default 2;

comment on column public.villa_fleet.included_pax is
  'Passeggeri inclusi nel prezzo base: oltre questa soglia scatta extra_pax_surcharge.';
comment on column public.villa_fleet.included_bags is
  'Bagagli inclusi nel prezzo base: oltre questa soglia scatta luggage_surcharge.';


-- ── 2. Vincoli di sanità (creati una sola volta) ────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'villa_fleet_included_pax_check'
  ) then
    alter table public.villa_fleet
      add constraint villa_fleet_included_pax_check
      check (included_pax between 1 and 16);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'villa_fleet_included_bags_check'
  ) then
    alter table public.villa_fleet
      add constraint villa_fleet_included_bags_check
      check (included_bags between 0 and 16);
  end if;
end $$;


-- ── 3. Capienza per categoria ───────────────────────────────────────────────
-- Criterio: `category` (vincolo villa_fleet_category_check). L'update tocca
-- solo le righe ancora da allineare, quindi rieseguire lo script è un no-op.

-- Van: 6 posti, 6 bagagli
update public.villa_fleet
   set included_pax = 6, included_bags = 6
 where category = 'van'
   and (included_pax <> 6 or included_bags <> 6);

-- SUV: 4 / 4
update public.villa_fleet
   set included_pax = 4, included_bags = 4
 where category = 'suv'
   and (included_pax <> 4 or included_bags <> 4);

-- Berlina con autista: 3 / 3
update public.villa_fleet
   set included_pax = 3, included_bags = 3
 where category = 'sedan'
   and (included_pax <> 3 or included_bags <> 3);

-- Supercar: 2 posti, 1 bagaglio
update public.villa_fleet
   set included_pax = 2, included_bags = 1
 where category = 'supercar'
   and (included_pax <> 2 or included_bags <> 1);

-- Elicottero: non citato dalla direttiva → si resta sul default prudente 2 / 2
-- (cabina piccola: meglio un supplemento in più che un preventivo sbagliato).
update public.villa_fleet
   set included_pax = 2, included_bags = 2
 where category = 'helicopter'
   and (included_pax <> 2 or included_bags <> 2);


-- ── 4. Sicurezza: RLS invariata ─────────────────────────────────────────────
-- Le policy esistenti sono a livello di TABELLA (using (true) in SELECT per
-- anon/authenticated): le due colonne nuove sono quindi già leggibili dal
-- client, senza bisogno di nuove policy. Qui si riasserisce lo stato atteso,
-- in modo idempotente, così lo script è autosufficiente anche su un DB che
-- avesse perso le policy.

alter table public.villa_fleet enable row level security;

drop policy if exists "villa_fleet_read" on public.villa_fleet;
create policy "villa_fleet_read"
  on public.villa_fleet for select
  to anon, authenticated
  using (true);

grant select on public.villa_fleet to anon, authenticated;
-- Nessuna policy di INSERT/UPDATE/DELETE per anon: le modifiche passano solo
-- dal SQL editor dell'owner.


-- ── 5. Verifica (facoltativa, da eseguire a mano) ───────────────────────────
--
-- select category,
--        min(included_pax)  as pax_min,  max(included_pax)  as pax_max,
--        min(included_bags) as bags_min, max(included_bags) as bags_max,
--        count(*)           as veicoli
--   from public.villa_fleet
--  group by category
--  order by category;
--
-- Atteso: helicopter 2/2 · sedan 3/3 · supercar 2/1 · suv 4/4 · van 6/6.

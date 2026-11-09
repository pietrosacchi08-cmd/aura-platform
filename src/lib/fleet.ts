/**
 * AURA — Fleet tool layer (deterministico, zero LLM).
 *
 * Questo file è l'UNICO posto in cui si decide "quali veicoli ha questa villa" e
 * "quanto costa questo trasferimento". Lo usano oggi il modal Trasferimenti
 * (src/components/service-modals.tsx) e domani la chat: entrambi chiamano gli
 * stessi due tool, quindi i numeri non possono divergere.
 *
 *   • get_available_services(villaId)          → catalogo della villa (DB-first)
 *   • calculate_service_quote(id|categoria, p) → preventivo esatto, con riparto
 *
 * Regole:
 *   1. DB-first: si legge `villa_fleet` (join `suppliers`) via REST Supabase con
 *      la publishable key. Se la tabella non esiste / è vuota / la rete è giù si
 *      usa il listino di fallback derivato da `servicePricing` in
 *      src/data/config.ts: l'app funziona identica prima e dopo lo SQL.
 *   2. Nessun prezzo viene mai scritto a mano nel testo generato: il totale
 *      nasce SOLO da calculate_service_quote.
 *   3. Le percentuali di riparto vivono in `revenueConfig` (config.ts), non qui.
 *
 * Schema di riferimento: supabase/schema-v3-villa-fleet.sql
 */
import { revenueConfig, round2, servicePricing } from "../data/config";

// ── Tipi pubblici (riusati dal modal e, in futuro, dalla chat) ──────────────

/** Le categorie ammesse da `villa_fleet.category`. */
export type FleetCategory = "suv" | "van" | "sedan" | "supercar" | "helicopter";

/** Unità di tariffa: per km, per ora, oppure a corsa (fixed). */
export type FleetUnit = "km" | "hour" | "fixed";

/** Un veicolo prenotabile di una villa (una riga di `villa_fleet`). */
export interface FleetVehicle {
  id: string;
  villaId: string;
  supplierId: string;
  /** Nome del fornitore (join su `suppliers.name`). */
  supplierName: string;
  category: FleetCategory;
  /** Etichetta mostrata al guest, es. "Mercedes GLS 450". */
  label: string;
  basePrice: number;
  unitPrice: number;
  unit: FleetUnit;
  /** Supplemento per bagaglio oltre i 2 inclusi. */
  luggageSurcharge: number;
  /** Supplemento per passeggero oltre i 2 inclusi. */
  extraPaxSurcharge: number;
  maxPax: number;
  active: boolean;
}

/** I veicoli di una categoria, raggruppati per il selettore del modal. */
export interface FleetCategoryGroup {
  category: FleetCategory;
  /** Etichetta italiana della categoria, es. "SUV con autista". */
  label: string;
  vehicles: FleetVehicle[];
}

/** Il catalogo di una villa: solo categorie e veicoli ATTIVI. */
export interface FleetCatalog {
  villaId: string;
  /** Da dove arrivano i dati: tabella Supabase o listino di fallback. */
  source: "db" | "fallback";
  /** Categorie non vuote, in ordine di presentazione. */
  categories: FleetCategoryGroup[];
  /** Tutti i veicoli attivi, appiattiti (comodo per i lookup). */
  vehicles: FleetVehicle[];
}

/** Parametri di preventivazione: gli stessi campi del modal. */
export interface FleetQuoteParams {
  pax: number;
  luggage?: number;
  /** Solo per i veicoli con unit = "hour". */
  hours?: number;
  /** Solo per i veicoli con unit = "km". */
  km?: number;
}

/** Una riga leggibile del preventivo (base, km/ore, supplementi). */
export interface FleetQuoteLine {
  label: string;
  detail?: string;
  amount: number;
}

/** Il preventivo completo: totale + riparto commissionale. */
export interface FleetQuote {
  vehicleId: string;
  vehicleLabel: string;
  category: FleetCategory;
  supplierName: string;
  pax: number;
  luggage: number;
  unit: FleetUnit;
  /** Etichetta dell'unità in italiano: "km" / "ore" / "corsa". */
  unitLabel: string;
  /** Unità fatturate: km, ore, oppure 1 per le tariffe a corsa. */
  units: number;
  unitPrice: number;
  basePrice: number;
  /** Tariffe unitarie del veicolo, fotografate nel preventivo. */
  luggageSurcharge: number;
  extraPaxSurcharge: number;
  unitsAmount: number;
  luggageAmount: number;
  extraPaxAmount: number;
  total: number;
  agencyCommission: number;
  platformCommission: number;
  /** Quota fornitore = resto (totale − agenzia − AURA), come in computeSplit. */
  supplierShare: number;
  lines: FleetQuoteLine[];
}

// ── Costanti di dominio ─────────────────────────────────────────────────────

/** Passeggeri inclusi nel prezzo base: oltre, scatta extraPaxSurcharge. */
export const FLEET_INCLUDED_PAX = 2;
/** Bagagli inclusi nel prezzo base: oltre, scatta luggageSurcharge. */
export const FLEET_INCLUDED_LUGGAGE = 2;

/** Ordine di presentazione delle categorie nel modal. */
export const FLEET_CATEGORY_ORDER: FleetCategory[] = [
  "suv",
  "sedan",
  "van",
  "supercar",
  "helicopter",
];

/** Etichette italiane delle categorie. */
export const FLEET_CATEGORY_LABELS: Record<FleetCategory, string> = {
  suv: "SUV con autista",
  sedan: "Berlina con autista",
  van: "Van con autista",
  supercar: "Supercar",
  helicopter: "Elicottero",
};

/** Etichette italiane delle unità di tariffa. */
export const FLEET_UNIT_LABELS: Record<FleetUnit, string> = {
  km: "km",
  hour: "ore",
  fixed: "corsa",
};

const isFleetCategory = (value: unknown): value is FleetCategory =>
  typeof value === "string" &&
  (FLEET_CATEGORY_ORDER as string[]).includes(value);

const isFleetUnit = (value: unknown): value is FleetUnit =>
  value === "km" || value === "hour" || value === "fixed";

/** Numero finito e non negativo, altrimenti 0 (righe DB sempre sane). */
const safeNumber = (value: unknown): number => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
};

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
};

// ── Ambiente (stesso pattern di src/lib/realtime.ts) ────────────────────────

function readEnv(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** Letto pigramente: importare questo modulo non tocca l'ambiente. */
function supabaseConfig(): { url: string; key: string } {
  return {
    url: readEnv(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, ""),
    key: readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY),
  };
}

/** Oltre questo tempo si smette di aspettare il DB e si usa il fallback. */
const FETCH_TIMEOUT_MS = 4000;

// ── Listino di fallback (prima che lo SQL venga eseguito) ───────────────────
/**
 * Derivato da `servicePricing`: nessun prezzo nuovo, solo gli stessi importi
 * che il modal usava prima, riletti nella forma della flotta. Vale per ogni
 * villa finché `villa_fleet` non esiste.
 */
function fallbackFleet(villaId: string): FleetVehicle[] {
  const { transfer, helicopter } = servicePricing;
  const supplierName = "Fornitore della villa";
  const make = (
    suffix: string,
    category: FleetCategory,
    label: string,
    basePrice: number,
    extraPaxSurcharge: number,
    maxPax: number,
  ): FleetVehicle => ({
    id: `fallback-${villaId}-${suffix}`,
    villaId,
    supplierId: "fallback",
    supplierName,
    category,
    label,
    basePrice,
    unitPrice: 0,
    unit: "fixed",
    luggageSurcharge: 0,
    extraPaxSurcharge,
    maxPax,
    active: true,
  });

  return [
    make(
      "suv",
      "suv",
      "SUV con autista",
      transfer.base,
      transfer.perPassenger,
      transfer.maxPassengers,
    ),
    make(
      "sedan",
      "sedan",
      "Berlina con autista",
      transfer.base,
      transfer.perPassenger,
      transfer.maxPassengers,
    ),
    make(
      "helicopter",
      "helicopter",
      "Elicottero",
      helicopter.base,
      helicopter.perPassenger,
      helicopter.maxPassengers,
    ),
  ];
}

// ── Raggruppamento ──────────────────────────────────────────────────────────

/** Veicoli attivi → categorie non vuote, in ordine di presentazione. */
export function groupFleet(vehicles: FleetVehicle[]): FleetCategoryGroup[] {
  const active = vehicles.filter((v) => v.active);
  return FLEET_CATEGORY_ORDER.map((category) => ({
    category,
    label: FLEET_CATEGORY_LABELS[category],
    vehicles: active
      .filter((v) => v.category === category)
      .sort((a, b) => a.basePrice - b.basePrice || a.label.localeCompare(b.label)),
  })).filter((group) => group.vehicles.length > 0);
}

function buildCatalog(villaId: string, vehicles: FleetVehicle[], source: "db" | "fallback"): FleetCatalog {
  const active = vehicles.filter((v) => v.active);
  return {
    villaId,
    source,
    categories: groupFleet(active),
    vehicles: active,
  };
}

// ── TOOL 1 — get_available_services ─────────────────────────────────────────

type Row = Record<string, unknown>;

/** Riga REST → FleetVehicle; null se la riga non è utilizzabile. */
function toVehicle(row: Row, fallbackVillaId: string): FleetVehicle | null {
  const id = typeof row.id === "string" ? row.id : "";
  const category = row.category;
  if (!id || !isFleetCategory(category)) return null;
  // PostgREST annida la join many-to-one come oggetto; un array resta gestito
  // per robustezza (stessa lettura, primo elemento).
  const embedded = row.suppliers;
  const supplier = (
    Array.isArray(embedded) ? embedded[0] : embedded
  ) as { name?: unknown } | null | undefined;
  return {
    id,
    villaId: typeof row.villa_id === "string" ? row.villa_id : fallbackVillaId,
    supplierId: typeof row.supplier_id === "string" ? row.supplier_id : "",
    supplierName:
      typeof supplier?.name === "string" && supplier.name.trim()
        ? supplier.name.trim()
        : "Fornitore della villa",
    category,
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : "Veicolo",
    basePrice: safeNumber(row.base_price),
    unitPrice: safeNumber(row.unit_price),
    unit: isFleetUnit(row.unit) ? row.unit : "fixed",
    luggageSurcharge: safeNumber(row.luggage_surcharge),
    extraPaxSurcharge: safeNumber(row.extra_pax_surcharge),
    maxPax: Math.max(1, clampInt(safeNumber(row.max_pax) || 4, 1, 16)),
    active: row.active !== false,
  };
}

/**
 * Legge la flotta della villa da Supabase (REST, publishable key).
 * Ritorna null quando non si può leggere: nessuna env, errore HTTP, timeout,
 * tabella mancante o zero righe attive. Non lancia mai.
 */
async function fetchFleetFromDb(villaId: string): Promise<FleetVehicle[] | null> {
  const { url: baseUrl, key: anonKey } = supabaseConfig();
  if (!baseUrl || !anonKey || !villaId) return null;

  const query = [
    "select=id,villa_id,supplier_id,category,label,base_price,unit_price,unit,luggage_surcharge,extra_pax_surcharge,max_pax,active,suppliers(name)",
    `villa_id=eq.${encodeURIComponent(villaId)}`,
    "active=eq.true",
    "order=category.asc,base_price.asc",
  ].join("&");
  const url = `${baseUrl}/rest/v1/villa_fleet?${query}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      // 404 = tabella non ancora creata (SQL v3 non eseguito): caso atteso.
      console.info(
        `[AURA fleet] villa_fleet non disponibile per ${villaId} (HTTP ${response.status}) — uso il listino di fallback`,
      );
      return null;
    }
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    const vehicles = rows
      .filter((row): row is Row => typeof row === "object" && row !== null)
      .map((row) => toVehicle(row, villaId))
      .filter((vehicle): vehicle is FleetVehicle => vehicle !== null);
    if (vehicles.length === 0) {
      console.info(
        `[AURA fleet] villa_fleet vuota per ${villaId} — uso il listino di fallback`,
      );
      return null;
    }
    return vehicles;
  } catch {
    console.info(
      `[AURA fleet] lettura di villa_fleet fallita per ${villaId} — uso il listino di fallback`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cache per villa: il modal può aprirsi e chiudersi senza rifare la fetch. */
const catalogCache = new Map<string, FleetCatalog>();
const inflight = new Map<string, Promise<FleetCatalog>>();

/**
 * TOOL — I servizi disponibili per una villa.
 *
 * DB-first: legge `villa_fleet` (solo righe attive) e ritorna SOLO le categorie
 * e i veicoli che quella villa ha davvero. Se il DB non risponde o la tabella
 * non esiste ancora, ritorna il listino di fallback (source: "fallback") e lo
 * segnala in console, senza rompere nulla.
 *
 * Non lancia mai: qualunque problema → catalogo di fallback.
 */
export function get_available_services(villaId: string): Promise<FleetCatalog> {
  const key = villaId || "default";
  const cached = catalogCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async (): Promise<FleetCatalog> => {
    const fromDb = await fetchFleetFromDb(villaId);
    const catalog = fromDb
      ? buildCatalog(villaId, fromDb, "db")
      : buildCatalog(villaId, fallbackFleet(villaId), "fallback");
    catalogCache.set(key, catalog);
    inflight.delete(key);
    return catalog;
  })();

  inflight.set(key, request);
  return request;
}

/**
 * Versione sincrona: il catalogo già in cache, altrimenti il fallback.
 * Serve al primo render del modal, che non può aspettare la rete.
 */
export function getAvailableServicesSync(villaId: string): FleetCatalog {
  const key = villaId || "default";
  return catalogCache.get(key) ?? buildCatalog(villaId, fallbackFleet(villaId), "fallback");
}

/** Svuota la cache (utile dopo aver eseguito lo SQL o cambiato i prezzi). */
export function clearFleetCache(): void {
  catalogCache.clear();
  inflight.clear();
}

// ── TOOL 2 — calculate_service_quote ────────────────────────────────────────

/** Trova un veicolo per id, oppure il più economico di una categoria. */
function resolveVehicle(
  selector: string,
  fleet: FleetVehicle[] | undefined,
): FleetVehicle | null {
  const pool = (fleet && fleet.length > 0 ? fleet : fallbackFleet("default")).filter(
    (v) => v.active,
  );
  const byId = pool.find((v) => v.id === selector);
  if (byId) return byId;
  if (isFleetCategory(selector)) {
    const inCategory = pool.filter((v) => v.category === selector);
    if (inCategory.length > 0) {
      return inCategory.reduce((cheapest, v) =>
        v.basePrice < cheapest.basePrice ? v : cheapest,
      );
    }
  }
  return null;
}

/** Unità fatturate: km, ore, oppure 1 corsa per le tariffe fisse. */
function billableUnits(vehicle: FleetVehicle, params: FleetQuoteParams): number {
  if (vehicle.unit === "km") return clampInt(params.km ?? 0, 0, 2000);
  if (vehicle.unit === "hour") return clampInt(params.hours ?? 0, 0, 24);
  return 1;
}

/**
 * TOOL — Preventivo esatto e deterministico per un veicolo.
 *
 *   totale = base_price
 *          + unit_price × unità
 *          + luggage_surcharge   × max(0, bagagli    − 2)
 *          + extra_pax_surcharge × max(0, passeggeri − 2)
 *
 * Il riparto usa le percentuali di `revenueConfig` (agenzia 12%, AURA 3%) e la
 * quota fornitore è il resto, così le tre parti sommano sempre al totale.
 * `selector` accetta un id veicolo oppure una categoria (prende il più
 * economico di quella categoria). Ritorna null se non c'è nulla da quotare:
 * nessun numero inventato, nessuna eccezione.
 */
export function calculate_service_quote(
  selector: string | FleetVehicle,
  params: FleetQuoteParams,
  fleet?: FleetVehicle[],
): FleetQuote | null {
  const vehicle =
    typeof selector === "string" ? resolveVehicle(selector, fleet) : selector;
  if (!vehicle) return null;

  const pax = clampInt(params.pax, 1, Math.max(1, vehicle.maxPax));
  const luggage = clampInt(params.luggage ?? 0, 0, 99);
  const units = billableUnits(vehicle, params);

  const basePrice = round2(vehicle.basePrice);
  const unitsAmount = round2(vehicle.unitPrice * units);
  const luggageAmount = round2(
    vehicle.luggageSurcharge * Math.max(0, luggage - FLEET_INCLUDED_LUGGAGE),
  );
  const extraPaxAmount = round2(
    vehicle.extraPaxSurcharge * Math.max(0, pax - FLEET_INCLUDED_PAX),
  );
  const total = round2(basePrice + unitsAmount + luggageAmount + extraPaxAmount);

  const agencyCommission = round2(
    (total * revenueConfig.agencyCommissionPct) / 100,
  );
  const platformCommission = round2(
    (total * revenueConfig.platformCommissionPct) / 100,
  );
  const supplierShare = round2(total - agencyCommission - platformCommission);

  const unitLabel = FLEET_UNIT_LABELS[vehicle.unit];
  const lines: FleetQuoteLine[] = [
    { label: "Base", detail: vehicle.label, amount: basePrice },
  ];
  if (vehicle.unit === "fixed") {
    // Tariffa a corsa: la riga esiste solo se il prezzo della corsa è > 0,
    // così il riepilogo somma sempre esattamente al totale.
    if (unitsAmount > 0) {
      lines.push({ label: "Corsa", detail: "tariffa fissa", amount: unitsAmount });
    }
  } else {
    lines.push({
      label: vehicle.unit === "km" ? "Percorrenza" : "Durata",
      detail: `${units} ${unitLabel} × ${formatAmount(vehicle.unitPrice)} /${unitLabel}`,
      amount: unitsAmount,
    });
  }
  if (luggageAmount > 0) {
    lines.push({
      label: "Supplemento bagagli",
      detail: `${luggage - FLEET_INCLUDED_LUGGAGE} oltre i ${FLEET_INCLUDED_LUGGAGE} inclusi`,
      amount: luggageAmount,
    });
  }
  if (extraPaxAmount > 0) {
    lines.push({
      label: "Supplemento passeggeri",
      detail: `${pax - FLEET_INCLUDED_PAX} oltre i ${FLEET_INCLUDED_PAX} inclusi`,
      amount: extraPaxAmount,
    });
  }

  return {
    vehicleId: vehicle.id,
    vehicleLabel: vehicle.label,
    category: vehicle.category,
    supplierName: vehicle.supplierName,
    pax,
    luggage,
    unit: vehicle.unit,
    unitLabel,
    units,
    unitPrice: round2(vehicle.unitPrice),
    basePrice,
    luggageSurcharge: round2(vehicle.luggageSurcharge),
    extraPaxSurcharge: round2(vehicle.extraPaxSurcharge),
    unitsAmount,
    luggageAmount,
    extraPaxAmount,
    total,
    agencyCommission,
    platformCommission,
    supplierShare,
    lines,
  };
}

/** "€ 2,80" — formattazione compatta per i dettagli delle righe. */
function formatAmount(amount: number): string {
  return `€ ${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

/** Etichetta italiana di una categoria (per il testo salvato nei details). */
export function fleetCategoryLabel(category: FleetCategory): string {
  return FLEET_CATEGORY_LABELS[category];
}

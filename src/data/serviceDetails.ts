/**
 * AURA service request details — the pure logic behind the four interactive
 * Services-tab modals.
 *
 * Everything here is framework-free: the modals (src/components/service-modals.tsx)
 * hold the form state, these functions turn it into
 *   • a live quote (labelled lines + total) shown BEFORE the guest confirms, and
 *   • the `details` object that is stored as jsonb on the request.
 *
 * All rates come from `servicePricing` in src/data/config.ts — nothing here is
 * a hard-coded price. The exception is the transfer/helicopter quote: since
 * schema v3 that price comes from the villa's own fleet
 * (`calculate_service_quote` in src/lib/fleet.ts), and `fleetTransferDetails`
 * below only packages that quote for storage.
 */
import { servicePricing, round2 } from "./config";
import {
  FLEET_CATEGORY_LABELS,
  type FleetCategory,
  type FleetQuote,
} from "../lib/fleet";

// ── Stored shape (jsonb column `details`) ────────────────────────────────────

export type ServiceCategory = "yacht" | "chef" | "transfer" | "wellness";

export type YachtDuration = "half-day" | "full-day";
export type ChefMeal = "breakfast" | "lunch" | "dinner";
export type TransferMode = "transfer" | "helicopter";

/** Boat charter / private yacht. */
export interface YachtDetails {
  category: "yacht";
  /** half-day = Mezza Giornata, full-day = Giornata Intera. */
  duration: YachtDuration;
  /** Italian label shown to staff: "Mezza Giornata" / "Giornata Intera". */
  durationLabel: string;
  /** Departure time, HH:MM (24h). */
  departureTime: string;
  skipper: boolean;
  fuel: boolean;
  /** Config values used at submit time, so a recorded request is auditable. */
  prices: { base: number; skipper: number; fuel: number };
  total: number;
}

/** Private chef. */
export interface ChefDetails {
  category: "chef";
  meal: ChefMeal;
  /** Italian label: "Colazione" / "Pranzo" / "Cena". */
  mealLabel: string;
  guests: number;
  /** Free text: allergies / intolerances. */
  dietary: string;
  pricePerGuest: number;
  total: number;
}

/** Luxury transfer / helicopter. */
export interface TransferDetails {
  category: "transfer";
  mode: TransferMode;
  /** Italian label: "Luxury Transfer" / "Helicopter". */
  modeLabel: string;
  from: string;
  to: string;
  /** Pickup time, HH:MM (24h). */
  time: string;
  passengers: number;
  luggage: number;
  base: number;
  perPassenger: number;
  total: number;
  // ── Veicolo del listino della villa (schema v3) ──────────────────────────
  // Tutti opzionali: le richieste registrate prima della flotta restano valide
  // e si leggono esattamente come prima.
  /** id della riga `villa_fleet` scelta. */
  vehicleId?: string;
  /** Etichetta del veicolo, es. "Mercedes GLS 450". */
  vehicleLabel?: string;
  /** Categoria del veicolo (suv / van / sedan / supercar / helicopter). */
  vehicleCategory?: FleetCategory;
  /** Etichetta italiana della categoria, salvata per non doverla ricalcolare. */
  vehicleCategoryLabel?: string;
  /** Nome del fornitore che eroga il servizio. */
  vehicleSupplier?: string;
  /**
   * Preventivo completo di `calculate_service_quote`: è la fotografia del
   * calcolo (base, unità, supplementi, totale, riparto) al momento dell'invio.
   */
  vehicleQuote?: FleetQuote;
}

/** Wellness & spa / personal training. */
export interface WellnessDetails {
  category: "wellness";
  treatmentId: string;
  treatmentLabel: string;
  /** Preferred date, YYYY-MM-DD. */
  date: string;
  /** Preferred time, HH:MM. */
  time: string;
  price: number;
  total: number;
}

export type ServiceDetails =
  | YachtDetails
  | ChefDetails
  | TransferDetails
  | WellnessDetails;

// ── Labels ──────────────────────────────────────────────────────────────────

/** Italian duration labels — literal, used in the modal and on the request. */
export const YACHT_DURATION_LABELS: Record<YachtDuration, string> = {
  "half-day": "Mezza Giornata",
  "full-day": "Giornata Intera",
};

/** Italian meal labels — literal, used in the modal and on the request. */
export const CHEF_MEAL_LABELS: Record<ChefMeal, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
};

/** Italian transport mode labels. */
export const TRANSFER_MODE_LABELS: Record<TransferMode, string> = {
  transfer: "Luxury Transfer",
  helicopter: "Helicopter",
};

/** The one disclaimer every estimate carries. */
export const ESTIMATE_DISCLAIMER = "Stima — confermata dallo staff";

// ── Currency formatting ─────────────────────────────────────────────────────

const euroFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "€ 1.400,00" — the Italian money format used by the modals and staff views. */
export function formatEuroIt(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `€ ${euroFormatter.format(amount)}`;
}

// ── Service catalogue → modal category ──────────────────────────────────────

export interface ServiceCategoryMatch {
  category: ServiceCategory;
  /** Only meaningful for category "transfer": which rate card to open with. */
  transferMode?: TransferMode;
}

/**
 * Which modal a catalogue service opens. The current catalogue maps as:
 *   yacht       → Boat Charter
 *   catering    → Private Chef
 *   chauffeur   → Luxury Transfer
 *   aviation    → Helicopter (same rate-card modal, helicopter mode)
 *   wellness    → Wellness & Spa
 * Anything else returns null and keeps the generic request flow.
 */
export function matchServiceCategory(service: {
  id: string;
  title?: string;
  icon?: string;
}): ServiceCategoryMatch | null {
  const keys = [service.id, service.icon ?? "", service.title ?? ""].map((v) =>
    v.toLowerCase(),
  );
  const has = (...needles: string[]): boolean =>
    keys.some((key) => needles.some((needle) => key.includes(needle)));

  if (has("yacht", "boat", "charter")) return { category: "yacht" };
  if (has("chef", "catering", "dining")) return { category: "chef" };
  if (has("helicopter", "aviation", "flight", "jet")) {
    return { category: "transfer", transferMode: "helicopter" };
  }
  if (has("transfer", "chauffeur", "driver", "car")) {
    return { category: "transfer", transferMode: "transfer" };
  }
  if (has("wellness", "spa", "massage", "trainer", "fitness")) {
    return { category: "wellness" };
  }
  return null;
}

// ── Quotes (live, before the guest confirms) ────────────────────────────────

/** One labelled line of the cost summary. */
export interface QuoteLine {
  label: string;
  /** Optional secondary note, e.g. "€ 45,00 per ospite". */
  detail?: string;
  amount: number;
}

export interface Quote {
  lines: QuoteLine[];
  total: number;
}

const sumLines = (lines: QuoteLine[]): number =>
  round2(lines.reduce((sum, line) => sum + line.amount, 0));

/** Boat charter quote: charter price + the optional extras. */
export function yachtQuote(input: {
  duration: YachtDuration;
  skipper: boolean;
  fuel: boolean;
}): Quote {
  const { yacht } = servicePricing;
  const base = input.duration === "full-day" ? yacht.fullDay : yacht.halfDay;
  const lines: QuoteLine[] = [
    {
      label: YACHT_DURATION_LABELS[input.duration],
      detail: "charter",
      amount: base,
    },
  ];
  if (input.skipper) lines.push({ label: "Skipper incluso", amount: yacht.skipper });
  if (input.fuel) lines.push({ label: "Carburante incluso", amount: yacht.fuel });
  return { lines, total: sumLines(lines) };
}

/** Private chef quote: meal price per guest × guests. */
export function chefQuote(input: { meal: ChefMeal; guests: number }): Quote {
  const { chef } = servicePricing;
  const perGuest =
    input.meal === "breakfast"
      ? chef.breakfast
      : input.meal === "lunch"
        ? chef.lunch
        : chef.dinner;
  const guests = clampInt(input.guests, chef.minGuests, chef.maxGuests);
  const amount = round2(perGuest * guests);
  return {
    lines: [
      {
        label: `${CHEF_MEAL_LABELS[input.meal]} × ${guests} ${guests === 1 ? "ospite" : "ospiti"}`,
        detail: `${formatEuroIt(perGuest)} per ospite`,
        amount,
      },
    ],
    total: amount,
  };
}

/** Transfer / helicopter quote: base + a supplement per passenger. */
export function transferQuote(input: {
  mode: TransferMode;
  passengers: number;
}): Quote {
  const card =
    input.mode === "helicopter" ? servicePricing.helicopter : servicePricing.transfer;
  const passengers = clampInt(input.passengers, 1, card.maxPassengers);
  const supplement = round2(card.perPassenger * passengers);
  const lines: QuoteLine[] = [
    { label: "Base", detail: TRANSFER_MODE_LABELS[input.mode], amount: card.base },
    {
      label: `Supplemento passeggeri (${passengers} × ${formatEuroIt(card.perPassenger)})`,
      amount: supplement,
    },
  ];
  return { lines, total: sumLines(lines) };
}

/** Wellness quote: the selected treatment only. */
export function wellnessQuote(treatmentId: string): Quote {
  const treatment = findTreatment(treatmentId);
  return {
    lines: [{ label: treatment.label, detail: "trattamento", amount: treatment.price }],
    total: treatment.price,
  };
}

/** The configured treatment, falling back to the default when unknown. */
export function findTreatment(treatmentId: string) {
  const { treatments, defaultTreatmentId } = servicePricing.wellness;
  return (
    treatments.find((t) => t.id === treatmentId) ??
    treatments.find((t) => t.id === defaultTreatmentId) ??
    treatments[0]
  );
}

/** Clamp a number to an integer range (shared by the steppers and quotes). */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ── Details builders (what gets stored) ─────────────────────────────────────

export function yachtDetails(input: {
  duration: YachtDuration;
  departureTime: string;
  skipper: boolean;
  fuel: boolean;
}): YachtDetails {
  const quote = yachtQuote(input);
  const { yacht } = servicePricing;
  return {
    category: "yacht",
    duration: input.duration,
    durationLabel: YACHT_DURATION_LABELS[input.duration],
    departureTime: input.departureTime,
    skipper: input.skipper,
    fuel: input.fuel,
    prices: {
      base: input.duration === "full-day" ? yacht.fullDay : yacht.halfDay,
      skipper: yacht.skipper,
      fuel: yacht.fuel,
    },
    total: quote.total,
  };
}

export function chefDetails(input: {
  meal: ChefMeal;
  guests: number;
  dietary: string;
}): ChefDetails {
  const { chef } = servicePricing;
  const guests = clampInt(input.guests, chef.minGuests, chef.maxGuests);
  const pricePerGuest =
    input.meal === "breakfast"
      ? chef.breakfast
      : input.meal === "lunch"
        ? chef.lunch
        : chef.dinner;
  return {
    category: "chef",
    meal: input.meal,
    mealLabel: CHEF_MEAL_LABELS[input.meal],
    guests,
    dietary: input.dietary.trim(),
    pricePerGuest,
    total: round2(pricePerGuest * guests),
  };
}

export function transferDetails(input: {
  mode: TransferMode;
  from: string;
  to: string;
  time: string;
  passengers: number;
  luggage: number;
}): TransferDetails {
  const card =
    input.mode === "helicopter" ? servicePricing.helicopter : servicePricing.transfer;
  const passengers = clampInt(input.passengers, 1, card.maxPassengers);
  const luggage = clampInt(input.luggage, 0, card.maxLuggage);
  return {
    category: "transfer",
    mode: input.mode,
    modeLabel: TRANSFER_MODE_LABELS[input.mode],
    from: input.from.trim(),
    to: input.to.trim(),
    time: input.time,
    passengers,
    luggage,
    base: card.base,
    perPassenger: card.perPassenger,
    total: round2(card.base + card.perPassenger * passengers),
  };
}

/**
 * Trasferimento/elicottero quotato dal listino DELLA VILLA (schema v3).
 *
 * Il totale non viene ricalcolato qui: arriva già pronto da
 * `calculate_service_quote` (src/lib/fleet.ts), l'unica funzione che fa i conti.
 * Questo builder si limita a impacchettare i campi del form e a fotografare il
 * preventivo dentro `vehicleQuote`, così la richiesta registrata è verificabile.
 */
export function fleetTransferDetails(input: {
  from: string;
  to: string;
  time: string;
  passengers: number;
  luggage: number;
  quote: FleetQuote;
}): TransferDetails {
  const quote = input.quote;
  const mode: TransferMode =
    quote.category === "helicopter" ? "helicopter" : "transfer";
  return {
    category: "transfer",
    mode,
    modeLabel: TRANSFER_MODE_LABELS[mode],
    from: input.from.trim(),
    to: input.to.trim(),
    time: input.time,
    passengers: quote.pax,
    luggage: quote.luggage,
    // Base + percorrenza/durata: la parte "veicolo" del totale.
    base: round2(quote.basePrice + quote.unitsAmount),
    perPassenger: quote.extraPaxSurcharge,
    total: quote.total,
    vehicleId: quote.vehicleId,
    vehicleLabel: quote.vehicleLabel,
    vehicleCategory: quote.category,
    vehicleCategoryLabel: FLEET_CATEGORY_LABELS[quote.category],
    vehicleSupplier: quote.supplierName,
    vehicleQuote: quote,
  };
}

export function wellnessDetails(input: {
  treatmentId: string;
  date: string;
  time: string;
}): WellnessDetails {
  const treatment = findTreatment(input.treatmentId);
  return {
    category: "wellness",
    treatmentId: treatment.id,
    treatmentLabel: treatment.label,
    date: input.date,
    time: input.time,
    price: treatment.price,
    total: treatment.price,
  };
}

// ── Reading a stored value back ─────────────────────────────────────────────

/**
 * Validate a stored `details` value (from jsonb or from localStorage) and
 * return it as ServiceDetails, or null when it is not a shape this app wrote.
 * Legacy text-only details (a plain string) are ignored, never rendered.
 */
export function parseServiceDetails(raw: unknown): ServiceDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const category = row.category;
  const n = (value: unknown, fallback = 0): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const s = (value: unknown, fallback = ""): string =>
    typeof value === "string" ? value : fallback;
  const b = (value: unknown): boolean => value === true;

  if (category === "yacht") {
    const duration: YachtDuration = row.duration === "full-day" ? "full-day" : "half-day";
    const prices = (row.prices ?? {}) as Record<string, unknown>;
    return {
      category: "yacht",
      duration,
      durationLabel: s(row.durationLabel, YACHT_DURATION_LABELS[duration]),
      departureTime: s(row.departureTime),
      skipper: b(row.skipper),
      fuel: b(row.fuel),
      prices: {
        base: n(prices.base),
        skipper: n(prices.skipper),
        fuel: n(prices.fuel),
      },
      total: n(row.total),
    };
  }
  if (category === "chef") {
    const meal: ChefMeal =
      row.meal === "breakfast" ? "breakfast" : row.meal === "lunch" ? "lunch" : "dinner";
    return {
      category: "chef",
      meal,
      mealLabel: s(row.mealLabel, CHEF_MEAL_LABELS[meal]),
      guests: n(row.guests),
      dietary: s(row.dietary),
      pricePerGuest: n(row.pricePerGuest),
      total: n(row.total),
    };
  }
  if (category === "transfer") {
    const mode: TransferMode = row.mode === "helicopter" ? "helicopter" : "transfer";
    return {
      category: "transfer",
      mode,
      modeLabel: s(row.modeLabel, TRANSFER_MODE_LABELS[mode]),
      from: s(row.from),
      to: s(row.to),
      time: s(row.time),
      passengers: n(row.passengers),
      luggage: n(row.luggage),
      base: n(row.base),
      perPassenger: n(row.perPassenger),
      total: n(row.total),
    };
  }
  if (category === "wellness") {
    return {
      category: "wellness",
      treatmentId: s(row.treatmentId),
      treatmentLabel: s(row.treatmentLabel),
      date: s(row.date),
      time: s(row.time),
      price: n(row.price),
      total: n(row.total),
    };
  }
  return null;
}

// ── Staff-facing rendering ──────────────────────────────────────────────────

/** One labelled line of the "Dettagli richiesta" panel. */
export interface DetailRow {
  label: string;
  value: string;
}

/** YYYY-MM-DD → DD/MM/YYYY (unchanged when the value is not a date). */
export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

const yesNo = (value: boolean): string => (value ? "Incluso" : "Non incluso");
const orDash = (value: string): string => (value.trim() ? value : "—");

/**
 * The guest's choices, labelled in Italian, for the staff "Dettagli richiesta"
 * panel. Empty values render as "—" so a row never looks half-filled.
 */
export function formatServiceDetails(details: ServiceDetails | null): DetailRow[] {
  if (!details) return [];
  switch (details.category) {
    case "yacht":
      return [
        { label: "Durata", value: details.durationLabel },
        { label: "Orario di partenza", value: orDash(details.departureTime) },
        { label: "Skipper", value: yesNo(details.skipper) },
        { label: "Carburante", value: yesNo(details.fuel) },
      ];
    case "chef":
      return [
        { label: "Pasto", value: details.mealLabel },
        { label: "Numero di ospiti", value: String(details.guests) },
        {
          label: "Preferenze alimentari",
          value: orDash(details.dietary),
        },
      ];
    case "transfer":
      return [
        { label: "Servizio", value: details.modeLabel },
        ...(details.vehicleLabel
          ? [
              {
                label: "Veicolo",
                value: details.vehicleCategoryLabel
                  ? `${details.vehicleLabel} · ${details.vehicleCategoryLabel}`
                  : details.vehicleLabel,
              },
            ]
          : []),
        ...(details.vehicleSupplier
          ? [{ label: "Fornitore", value: details.vehicleSupplier }]
          : []),
        ...(details.vehicleQuote && details.vehicleQuote.unit !== "fixed"
          ? [
              {
                label:
                  details.vehicleQuote.unit === "km" ? "Percorrenza" : "Durata",
                value: `${details.vehicleQuote.units} ${details.vehicleQuote.unitLabel}`,
              },
            ]
          : []),
        { label: "Partenza", value: orDash(details.from) },
        { label: "Destinazione", value: orDash(details.to) },
        { label: "Orario", value: orDash(details.time) },
        { label: "Passeggeri", value: String(details.passengers) },
        { label: "Bagagli", value: String(details.luggage) },
      ];
    case "wellness":
      return [
        { label: "Trattamento", value: orDash(details.treatmentLabel) },
        { label: "Data", value: orDash(formatIsoDate(details.date)) },
        { label: "Orario", value: orDash(details.time) },
      ];
    default:
      return [];
  }
}

/** One-line summary for the staff task feed / toast. */
export function serviceDetailsSummary(details: ServiceDetails | null): string {
  if (!details) return "";
  switch (details.category) {
    case "yacht":
      return [
        details.durationLabel,
        details.departureTime && `partenza ${details.departureTime}`,
        details.skipper && "skipper incluso",
        details.fuel && "carburante incluso",
      ]
        .filter(Boolean)
        .join(" · ");
    case "chef":
      return [
        details.mealLabel,
        `${details.guests} ospiti`,
        details.dietary && `preferenze: ${details.dietary}`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "transfer":
      return [
        details.vehicleLabel ?? details.modeLabel,
        [details.from, details.to].filter(Boolean).join(" → "),
        details.time && `ore ${details.time}`,
        `${details.passengers} passeggeri`,
        `${details.luggage} bagagli`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "wellness":
      return [
        details.treatmentLabel,
        formatIsoDate(details.date),
        details.time,
      ]
        .filter(Boolean)
        .join(" · ");
    default:
      return "";
  }
}

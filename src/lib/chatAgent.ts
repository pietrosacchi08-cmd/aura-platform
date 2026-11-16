/**
 * AURA — Concierge chat agent (deterministico, zero LLM).
 *
 * La chat del tab Concierge non inventa nulla: legge l'inventario REALE della
 * villa (`get_available_services` in src/lib/fleet.ts), interpreta la richiesta
 * con regole deterministiche (keyword italiane + numeri) e produce il prezzo
 * SOLO tramite `calculate_service_quote`.
 *
 *   parseBookingIntent(text, catalog) → cosa ha chiesto l'ospite
 *   planBookingReply(intent, catalog) → cosa rispondere (nessuna card inventata)
 *   buildChatBookingPayload(quote)    → i campi esatti dell'INSERT
 *
 * Tutto qui è puro e sincrono: nessuna rete, nessun DOM. Il pannello passa il
 * catalogo già caricato, così i test (scripts/test-chat-agent.ts) girano su
 * fixture senza browser.
 *
 * Regole:
 *   1. Una categoria assente dal catalogo della villa non si prenota: si dice
 *      che non è disponibile e si elencano le alternative reali.
 *   2. Nessun totale compare in testo libero: le cifre vivono nella bookingCard
 *      e vengono da `calculate_service_quote`.
 *   3. Il payload della conferma ha la stessa forma dei modal (TransferDetails
 *      via `fleetTransferDetails`), più `channel: "chat"`.
 */
import { revenueConfig, round2 } from "../data/config";
import { fleetTransferDetails, type TransferDetails } from "../data/serviceDetails";
import {
  FLEET_CATEGORY_LABELS,
  calculate_service_quote,
  type FleetCatalog,
  type FleetCategory,
  type FleetQuote,
  type FleetVehicle,
} from "./fleet";

// ── Tipi pubblici ───────────────────────────────────────────────────────────

/** Quando il trasferimento è richiesto: campi vuoti = non specificato. */
export interface BookingTrip {
  /** YYYY-MM-DD, oppure "" se l'ospite non ha indicato una data. */
  date: string;
  /** Etichetta umana: "domani", "12/07/2026", "" se non nota. */
  dateLabel: string;
  /** HH:MM, oppure "" se l'ospite non ha indicato un orario. */
  time: string;
}

/** Ciò che l'ospite ha chiesto, letto dall'inventario della villa. */
export interface BookingIntent {
  raw: string;
  /** true quando il messaggio riguarda un servizio a catalogo (flotta). */
  isBooking: boolean;
  /** Veicolo riconosciuto per etichetta; null se non ne ha nominato uno. */
  vehicle: FleetVehicle | null;
  /** Categoria nominata (anche se la villa non la possiede). */
  requestedCategory: FleetCategory | null;
  requestedCategoryLabel: string | null;
  pax: number | null;
  luggage: number | null;
  trip: BookingTrip;
}

/** Cosa manca per poter generare una card. */
export type BookingMissing = "vehicle" | "pax";

/** Esito deterministico della chat: una sola risposta possibile per input. */
export type BookingPlan =
  | { kind: "none" }
  | { kind: "unavailable"; content: string; alternatives: string[] }
  | { kind: "clarify"; content: string; missing: BookingMissing[] }
  | { kind: "booking"; content: string; quote: FleetQuote; trip: BookingTrip };

/** La bookingCard mostrata in chat: totale e righe vengono dal preventivo. */
export interface ChatBookingCard {
  quote: FleetQuote;
  trip: BookingTrip;
  status: "pending" | "confirmed" | "cancelled";
}

/** I campi esatti che finiscono nella richiesta (stessa forma dei modal). */
export interface ChatBookingDetails extends TransferDetails {
  channel: "chat";
  /** Passeggeri (mirror di `passengers`, come da contratto della chat). */
  pax: number;
  /** Data richiesta, YYYY-MM-DD ("" se non indicata). */
  date: string;
  /** Etichetta umana della data ("domani", "12/07/2026"). */
  dateLabel: string;
}

/** Tutto ciò che serve all'INSERT, già calcolato e verificabile. */
export interface ChatBookingPayload {
  /** Valore della colonna `service_label`. */
  serviceLabel: string;
  price: number;
  agencyCommission: number;
  platformCommission: number;
  agencyPct: number;
  auraPct: number;
  details: ChatBookingDetails;
}

// ── Normalizzazione e keyword ───────────────────────────────────────────────

/** Minuscolo, senza accenti, spazi singoli: la base di ogni confronto. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parole che nominano una categoria della flotta. */
const CATEGORY_KEYWORDS: Record<FleetCategory, string[]> = {
  suv: [
    "suv", "fuoristrada", "gle", "gls", "glc", "x5", "x7", "cayenne", "macan",
    "range rover", "land rover", "defender", "q7", "q8", "urus",
  ],
  sedan: [
    "berlina", "sedan", "limousine", "classe s", "classe e", "s class",
    "e class", "maybach", "ghost", "phantom", "panamera", "serie 7", "serie 5",
  ],
  van: [
    "van", "classe v", "v class", "minivan", "monovolume", "sprinter",
    "viano", "navetta", "shuttle", "multivan",
  ],
  supercar: [
    "supercar", "super car", "ferrari", "lamborghini", "mclaren", "bugatti",
    "huracan", "aventador", "812", "488", "sf90", "gt3", "sportiva",
  ],
  helicopter: [
    "elicottero", "helicopter", "helo", "aviation", "aviazione", "volo",
    "flight", "jet privato",
  ],
};

/** Parole che indicano un trasferimento / un veicolo con autista. */
const TRANSFER_WORDS = [
  "transfer", "trasferimento", "trasferirmi", "auto", "autista", "chauffeur",
  "driver", "macchina", "car", "pickup", "pick up", "aeroporto", "airport",
  "porto", "stazione", "station", "portami", "accompagnami", "ride",
  "veicolo", "vehicle", "limo", "ncc", "conducente",
];

/** Verbi/forme che rendono la frase una richiesta di servizio. */
const BOOKING_VERBS = [
  "prenota", "prenotami", "prenotare", "prenotazione", "book", "booking",
  "reserve", "riserva", "voglio", "vorrei", "need", "serve", "servirebbe",
  "organizza", "arrange", "request", "richiedo", "disponibile", "disponibili",
  "costa", "preventivo", "quanto", "mi porta", "accompagna", "would like",
  "want", "like to",
];

/** true se una delle parole compare come parola intera nel testo normalizzato. */
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

/** La prima categoria nominata, in ordine di presentazione della flotta. */
function detectCategory(text: string): FleetCategory | null {
  for (const category of Object.keys(CATEGORY_KEYWORDS) as FleetCategory[]) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => hasWord(text, keyword))) {
      return category;
    }
  }
  return null;
}

/** Parole troppo generiche per identificare un veicolo. */
const VEHICLE_STOPWORDS = new Set([
  "con", "autista", "driver", "luxury", "privato", "private", "the", "and",
  "del", "della", "conducente", "transfer",
]);

/**
 * Veicolo riconosciuto per etichetta: vince la corrispondenza più lunga
 * ("classe v" batte il solo "mercedes"). null se nessuna etichetta compare.
 */
export function matchVehicleByLabel(
  text: string,
  vehicles: FleetVehicle[],
): FleetVehicle | null {
  const haystack = normalize(text);
  let best: { vehicle: FleetVehicle; score: number } | null = null;
  for (const vehicle of vehicles) {
    const label = normalize(vehicle.label);
    if (!label) continue;
    let score = 0;
    if (label.length >= 3 && haystack.includes(label)) {
      score = 1000 + label.length;
    } else {
      const words = label.split(" ").filter(Boolean);
      for (let size = Math.min(3, words.length); size >= 2; size -= 1) {
        for (let i = 0; i + size <= words.length; i += 1) {
          const phrase = words.slice(i, i + size).join(" ");
          if (phrase.length >= 3 && haystack.includes(phrase)) {
            score = Math.max(score, size * 100);
          }
        }
      }
      if (score === 0) {
        const distinctive = words.filter(
          (word) => word.length >= 3 && !VEHICLE_STOPWORDS.has(word),
        );
        const hits = distinctive.filter((word) => hasWord(haystack, word)).length;
        if (hits > 0) score = hits * 10;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { vehicle, score };
  }
  return best?.vehicle ?? null;
}

// ── Numeri: passeggeri, bagagli ─────────────────────────────────────────────

const PAX_PATTERNS = [
  /(\d{1,2})\s*(?:persone|persona|pax|passeggeri|passeggero|ospiti|ospite|adulti|passengers|people|guests)\b/i,
  /\bper\s+(\d{1,2})\b/i,
  /\bsiamo\s+(?:in\s+)?(\d{1,2})\b/i,
  /\b(\d{1,2})\s*(?:di\s+noi|of\s+us)\b/i,
];

const LUGGAGE_PATTERNS = [
  /(\d{1,2})\s*(?:bagagli|bagaglio|valigie|valigia|bag|bags|suitcases?)\b/i,
  /\b(?:un|uno|una|one)\s+(?:bagaglio|valigia|bag|suitcase)\b/i,
];

const clampCount = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/** Passeggeri dichiarati (null se non citati). */
function detectPax(text: string): number | null {
  for (const pattern of PAX_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 1) return clampCount(value, 1, 16);
    }
  }
  return null;
}

/** Bagagli dichiarati (null se non citati). */
function detectLuggage(text: string): number | null {
  if (hasWord(text, "senza bagagli") || hasWord(text, "no luggage")) return 0;
  for (const pattern of LUGGAGE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (/^(un|uno|una|one)$/i.test(match[1])) return 1;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0) return clampCount(value, 0, 12);
  }
  return null;
}

// ── Data e ora ──────────────────────────────────────────────────────────────

interface TimeHit {
  time: string;
  rest: string;
}

/** Orario in HH:MM; `rest` è il testo senza l'orario (per non leggerlo come pax). */
function extractTime(text: string): TimeHit {
  const ampm = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i.exec(text);
  const explicit = /\b(\d{1,2})[:.](\d{2})\b/.exec(text);
  const labelled = /\b(?:alle|ore|at|h)\s*(\d{1,2})(?:[:.,](\d{2}))?\b/i.exec(text);

  let hit: { hour: number; minutes: number; raw: string } | null = null;
  if (ampm) {
    let hour = Number(ampm[1]);
    const minutes = ampm[2] ? Number(ampm[2]) : 0;
    if (/pm/i.test(ampm[3]) && hour < 12) hour += 12;
    if (/am/i.test(ampm[3]) && hour === 12) hour = 0;
    hit = { hour, minutes, raw: ampm[0] };
  } else if (explicit) {
    hit = {
      hour: Number(explicit[1]),
      minutes: Number(explicit[2]),
      raw: explicit[0],
    };
  } else if (labelled) {
    hit = {
      hour: Number(labelled[1]),
      minutes: labelled[2] ? Number(labelled[2]) : 0,
      raw: labelled[0],
    };
  }
  if (!hit || hit.hour > 23 || hit.minutes > 59) return { time: "", rest: text };
  const time = `${String(hit.hour).padStart(2, "0")}:${String(hit.minutes).padStart(2, "0")}`;
  return { time, rest: text.replace(hit.raw, " ".repeat(hit.raw.length)) };
}

const MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7,
  agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

const WEEKDAYS: Record<string, number> = {
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5,
  sabato: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6,
};

const isoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const italianDate = (iso: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
};

const shiftDays = (now: Date, days: number): string => {
  const copy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  copy.setDate(copy.getDate() + days);
  return isoDate(copy);
};

/** Data richiesta: relativa ("domani"), numerica (12/07) o per nome mese. */
function detectDate(text: string, now: Date): BookingTrip {
  if (hasWord(text, "dopodomani")) {
    return { date: shiftDays(now, 2), dateLabel: "dopodomani", time: "" };
  }
  if (hasWord(text, "domani") || hasWord(text, "tomorrow")) {
    return { date: shiftDays(now, 1), dateLabel: "domani", time: "" };
  }
  if (
    hasWord(text, "oggi") ||
    hasWord(text, "today") ||
    hasWord(text, "stasera") ||
    hasWord(text, "stamattina")
  ) {
    return { date: shiftDays(now, 0), dateLabel: "oggi", time: "" };
  }

  const numeric = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : now.getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { date: iso, dateLabel: italianDate(iso), time: "" };
    }
  }

  const monthName = new RegExp(
    `\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join("|")})\\b`,
    "i",
  ).exec(text);
  if (monthName) {
    const day = Number(monthName[1]);
    const month = MONTHS[monthName[2].toLowerCase()];
    if (day >= 1 && day <= 31) {
      const iso = `${now.getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { date: iso, dateLabel: italianDate(iso), time: "" };
    }
  }

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (!hasWord(text, name)) continue;
    const today = now.getDay();
    const ahead = ((weekday - today + 7) % 7) || 7;
    return { date: shiftDays(now, ahead), dateLabel: name, time: "" };
  }

  return { date: "", dateLabel: "", time: "" };
}

// ── Intent ──────────────────────────────────────────────────────────────────

/**
 * Interpreta il messaggio dell'ospite contro l'inventario della villa.
 * Deterministico: stesso testo + stesso catalogo + stessa data → stesso esito.
 */
export function parseBookingIntent(
  text: string,
  catalog: FleetCatalog,
  now: Date = new Date(),
): BookingIntent {
  const normalized = normalize(text);
  const category = detectCategory(normalized);
  const vehicle = matchVehicleByLabel(normalized, catalog.vehicles);
  const hasTransferWord = TRANSFER_WORDS.some((word) => hasWord(normalized, word));
  const hasBookingVerb = BOOKING_VERBS.some((word) => hasWord(normalized, word));
  const time = extractTime(normalized);

  const isBooking =
    category !== null ||
    vehicle !== null ||
    (hasTransferWord && (hasBookingVerb || time.time !== ""));

  const date = detectDate(normalized, now);
  const trip: BookingTrip = {
    date: date.date,
    dateLabel: date.dateLabel,
    time: time.time,
  };

  return {
    raw: text,
    isBooking,
    vehicle,
    requestedCategory: category,
    requestedCategoryLabel: category ? FLEET_CATEGORY_LABELS[category] : null,
    pax: detectPax(time.rest),
    luggage: detectLuggage(time.rest),
    trip,
  };
}

// ── Risposte deterministiche ────────────────────────────────────────────────

/** "Mercedes Classe V (Van con autista)" — le alternative reali della villa. */
export function alternativeLines(catalog: FleetCatalog): string[] {
  return catalog.vehicles.map(
    (vehicle) => `${vehicle.label} (${FLEET_CATEGORY_LABELS[vehicle.category]})`,
  );
}

/** Le opzioni prenotabili, con capienza reale: serve a chiedere cosa manca. */
function vehicleOptions(catalog: FleetCatalog): string {
  return catalog.vehicles
    .map(
      (vehicle) =>
        `${vehicle.label} — ${FLEET_CATEGORY_LABELS[vehicle.category]}, fino a ${vehicle.maxPax} passeggeri`,
    )
    .join("; ");
}

const cheapestIn = (vehicles: FleetVehicle[]): FleetVehicle =>
  vehicles.reduce((cheapest, vehicle) =>
    vehicle.basePrice < cheapest.basePrice ? vehicle : cheapest,
  );

/**
 * Il piano di risposta. Ordine delle regole:
 *   categoria assente → "non disponibile" + alternative, nessuna card
 *   veicolo mancante   → chiedi solo il veicolo, elencando le opzioni reali
 *   pax mancanti       → chiedi solo i passeggeri
 *   altrimenti         → card con il preventivo di `calculate_service_quote`
 */
export function planBookingReply(
  intent: BookingIntent,
  catalog: FleetCatalog,
): BookingPlan {
  if (!intent.isBooking) return { kind: "none" };

  const category = intent.requestedCategory;
  const inCategory = category
    ? catalog.vehicles.filter((vehicle) => vehicle.category === category)
    : [];

  if (category && inCategory.length === 0) {
    const alternatives = alternativeLines(catalog);
    return {
      kind: "unavailable",
      content: `La ${FLEET_CATEGORY_LABELS[category]} non è disponibile per questa villa. Le alternative reali disponibili sono: ${alternatives.join("; ")}. Posso preparare il preventivo per una di queste.`,
      alternatives,
    };
  }

  const vehicle = intent.vehicle ?? (inCategory.length > 0 ? cheapestIn(inCategory) : null);

  if (!vehicle) {
    return {
      kind: "clarify",
      content: `Con piacere. Per questa villa posso predisporre: ${vehicleOptions(catalog)}. Quale veicolo preferisce?`,
      missing: ["vehicle"],
    };
  }

  if (intent.pax === null) {
    return {
      kind: "clarify",
      content: `${vehicle.label} è disponibile fino a ${vehicle.maxPax} passeggeri. Quante persone viaggeranno?`,
      missing: ["pax"],
    };
  }

  if (intent.pax > vehicle.maxPax) {
    const fitting = catalog.vehicles.filter((other) => other.maxPax >= (intent.pax ?? 0));
    if (fitting.length === 0) {
      const maxPax = catalog.vehicles.reduce(
        (max, other) => Math.max(max, other.maxPax),
        0,
      );
      return {
        kind: "clarify",
        content: `${vehicle.label} accoglie fino a ${vehicle.maxPax} passeggeri e la villa non ha veicoli per ${intent.pax} persone (massimo ${maxPax}). Posso organizzare più corse: mi dica come preferisce procedere.`,
        missing: ["vehicle"],
      };
    }
    return {
      kind: "clarify",
      content: `Per ${intent.pax} passeggeri il ${vehicle.label} non basta. Posso proporre: ${fitting
        .map((other) => `${other.label} (fino a ${other.maxPax} passeggeri)`)
        .join("; ")}. Quale preferisce?`,
      missing: ["vehicle"],
    };
  }

  const quote = calculate_service_quote(
    vehicle.id,
    { pax: intent.pax, luggage: intent.luggage ?? 0 },
    catalog.vehicles,
  );
  if (!quote) {
    return {
      kind: "clarify",
      content: `Non riesco a quotare ${vehicle.label} con questi parametri. Quale veicolo preferisce fra: ${vehicleOptions(catalog)}?`,
      missing: ["vehicle"],
    };
  }

  const luggageLine =
    quote.luggage > 0 ? `, ${quote.luggage} ${quote.luggage === 1 ? "bagaglio" : "bagagli"}` : "";
  return {
    kind: "booking",
    content: `Ecco la proposta: ${quote.vehicleLabel} di ${quote.supplierName}, ${quote.pax} passeggeri${luggageLine}. Il totale stimato è nella card qui sotto — confermi e invio la richiesta al nostro staff?`,
    quote,
    trip: intent.trip,
  };
}

// ── Payload dell'INSERT ─────────────────────────────────────────────────────

/**
 * I campi della richiesta creata dalla chat. `details` passa da
 * `fleetTransferDetails` (la stessa funzione del modal Trasferimenti) e porta
 * in più `channel: "chat"` + la data richiesta, così staff e "I Miei Servizi"
 * leggono la richiesta senza logica nuova.
 */
export function buildChatBookingPayload(
  quote: FleetQuote,
  trip: BookingTrip,
): ChatBookingPayload {
  const details = fleetTransferDetails({
    from: "",
    to: "",
    time: trip.time,
    passengers: quote.pax,
    luggage: quote.luggage,
    quote,
  });
  const mode = quote.category === "helicopter" ? "helicopter" : "transfer";
  return {
    serviceLabel: `${mode === "helicopter" ? "Elicottero" : "Trasferimento"} — ${quote.vehicleLabel}`,
    price: quote.total,
    agencyCommission: round2((quote.total * revenueConfig.agencyCommissionPct) / 100),
    platformCommission: round2(
      (quote.total * revenueConfig.platformCommissionPct) / 100,
    ),
    agencyPct: revenueConfig.agencyCommissionPct,
    auraPct: revenueConfig.auraFeePct,
    details: {
      ...details,
      channel: "chat",
      pax: quote.pax,
      date: trip.date,
      dateLabel: trip.dateLabel,
    },
  };
}

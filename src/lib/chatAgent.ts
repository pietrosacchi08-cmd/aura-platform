/**
 * AURA — Concierge chat agent (deterministico, zero LLM).
 *
 * La chat del tab Concierge non inventa nulla: legge l'inventario REALE della
 * villa (`get_available_services` in src/lib/fleet.ts per i transfer,
 * `conciergeServices` in src/data/config.ts per gli altri servizi), interpreta
 * la richiesta con regole deterministiche (keyword italiane + numeri) e produce
 * il prezzo SOLO tramite i calcolatori che usano i modal:
 *
 *   • transfer / aviation → `calculate_service_quote` (flotta della villa)
 *   • chef, yacht, wellness → `chefQuote` / `yachtQuote` / `wellnessQuote`
 *     (src/data/serviceDetails.ts, tariffe di `servicePricing`)
 *
 *   parseBookingIntent(text, catalog)     → cosa ha chiesto l'ospite
 *   planBookingReply(intent, catalog)     → cosa rispondere (nessuna card inventata)
 *   buildChatBookingPayload(quote, trip)  → i campi esatti dell'INSERT
 *
 * Tutto qui è puro e sincrono: nessuna rete, nessun DOM. Il pannello passa il
 * catalogo già caricato, così i test (scripts/test-chat-agent.ts) girano su
 * fixture senza browser.
 *
 * Regole:
 *   1. Un servizio che la villa non offre non si prenota: si dice che non è
 *      disponibile e si elencano le alternative reali.
 *   2. Nessun parametro mancante viene sostituito da un default: l'agente
 *      chiede SOLO i parametri che mancano e non mostra nessuna card.
 *   3. Nessun totale compare in testo libero: le cifre vivono nella bookingCard
 *      e vengono dai calcolatori reali.
 *   4. Ogni frase con un nome di servizio/categoria passa da `withArticle`
 *      (src/lib/grammar.ts): mai "La Elicottero".
 *   5. Il payload della conferma ha la stessa forma dei modal (ServiceDetails
 *      via i builder di serviceDetails.ts), più `channel: "chat"`.
 */
import {
  conciergeServices,
  revenueConfig,
  round2,
  servicePricing,
  type ConciergeService,
} from "../data/config";
import {
  CHEF_MEAL_LABELS,
  chefDetails,
  chefQuote,
  fleetTransferDetails,
  matchServiceCategory,
  wellnessDetails,
  wellnessQuote,
  yachtDetails,
  yachtQuote,
  type ChefMeal,
  type QuoteLine,
  type ServiceDetails,
  type YachtDuration,
} from "../data/serviceDetails";
import {
  FLEET_CATEGORY_LABELS,
  calculate_service_quote,
  type FleetCatalog,
  type FleetCategory,
  type FleetQuote,
  type FleetVehicle,
} from "./fleet";
import { joinItalian, withArticle } from "./grammar";

// ── Tipi pubblici ───────────────────────────────────────────────────────────

/** I servizi che l'agente sa prenotare: tutta la villa. */
export type ChatServiceKind =
  | "transfer"
  | "aviation"
  | "chef"
  | "yacht"
  | "wellness";

/** Quando il servizio è richiesto: campi vuoti = non specificato. */
export interface BookingTrip {
  /** YYYY-MM-DD, oppure "" se l'ospite non ha indicato una data. */
  date: string;
  /** Etichetta umana: "domani", "12/07/2026", "" se non nota. */
  dateLabel: string;
  /** HH:MM, oppure "" se l'ospite non ha indicato un orario. */
  time: string;
}

/** Tratta dichiarata per l'aviazione privata. */
export interface BookingRoute {
  /** Località di partenza ("" se non indicata). */
  from: string;
  /** Località di arrivo ("" se non indicata). */
  to: string;
  /** Distanza dichiarata in km, quando l'ospite la cita. */
  km: number | null;
}

/** Ciò che l'ospite ha chiesto, letto dall'inventario della villa. */
export interface BookingIntent {
  raw: string;
  /** true quando il messaggio riguarda un servizio a catalogo. */
  isBooking: boolean;
  /** Il servizio richiesto; null quando il messaggio non chiede un servizio. */
  service: ChatServiceKind | null;
  /** Veicolo riconosciuto per etichetta; null se non ne ha nominato uno. */
  vehicle: FleetVehicle | null;
  /** Categoria nominata (anche se la villa non la possiede). */
  requestedCategory: FleetCategory | null;
  requestedCategoryLabel: string | null;
  pax: number | null;
  luggage: number | null;
  trip: BookingTrip;
  // ── Parametri per servizio (null = l'ospite non li ha indicati) ──────────
  /** Pasto richiesto (chef). */
  meal: ChefMeal | null;
  /** Ospiti dichiarati (chef). */
  guests: number | null;
  /** Preferenze alimentari, pass-through facoltativo (chef). */
  dietary: string;
  /** Durata del charter (yacht). */
  duration: YachtDuration | null;
  /** Skipper richiesto (yacht) — opzione, non parametro essenziale. */
  skipper: boolean;
  /** Carburante incluso (yacht) — opzione, non parametro essenziale. */
  fuel: boolean;
  /** Trattamento scelto (wellness). */
  treatmentId: string | null;
  /** Tratta dichiarata (aviation). */
  route: BookingRoute;
}

/** Cosa manca per poter generare una card. */
export type BookingMissing =
  | "vehicle"
  | "pax"
  | "meal"
  | "guests"
  | "duration"
  | "treatment"
  | "route"
  | "date"
  | "time";

/** Una riga chiave/valore della card (parametri reali della richiesta). */
export interface ChatQuoteRow {
  label: string;
  value: string;
}

/**
 * Il preventivo della chat, normalizzato su tutti i servizi.
 * `lines` e `total` arrivano SEMPRE da un calcolatore reale (flotta o
 * servicePricing): qui non si fa alcun conto.
 */
export interface ChatQuote {
  service: ChatServiceKind;
  /** Valore della colonna `service_label`. */
  serviceLabel: string;
  /** Titolo della card. */
  title: string;
  /** Riga secondaria della card (fornitore / provenienza del servizio). */
  subtitle: string;
  /** Parametri della richiesta, come li leggerà lo staff. */
  rows: ChatQuoteRow[];
  /** Righe del preventivo, dal calcolatore del modal. */
  lines: QuoteLine[];
  total: number;
  /** Frase con cui l'agente presenta la proposta (nessun prezzo: è nella card). */
  summary: string;
  /** Dettagli per il JSONB `details`, stessa forma dei modal. */
  details: ServiceDetails;
  /** Passeggeri, quando il servizio ne ha (mirror di `details.passengers`). */
  pax?: number;
}

/** Esito deterministico della chat: una sola risposta possibile per input. */
export type BookingPlan =
  | { kind: "none" }
  | { kind: "unavailable"; content: string; alternatives: string[] }
  | { kind: "clarify"; content: string; missing: BookingMissing[] }
  | { kind: "booking"; content: string; quote: ChatQuote; trip: BookingTrip };

/** La bookingCard mostrata in chat: totale e righe vengono dal preventivo. */
export interface ChatBookingCard {
  quote: ChatQuote;
  trip: BookingTrip;
  status: "pending" | "confirmed" | "cancelled";
}

/** I campi esatti che finiscono nella richiesta (stessa forma dei modal). */
export type ChatBookingDetails = ServiceDetails & {
  channel: "chat";
  /** Data richiesta, YYYY-MM-DD ("" se non indicata). */
  date: string;
  /** Etichetta umana della data ("domani", "12/07/2026"). */
  dateLabel: string;
  /** Passeggeri (mirror di `passengers`, solo transfer / aviation). */
  pax?: number;
};

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

/** Parole che nominano un servizio di villa (non-flotta). */
const SERVICE_KEYWORDS: Array<[Exclude<ChatServiceKind, "transfer">, string[]]> = [
  [
    "aviation",
    [
      "elicottero", "helicopter", "helo", "aviation", "aviazione", "volo",
      "flight", "jet privato", "private jet", "aereo privato", "jet",
    ],
  ],
  ["chef", ["chef", "cuoco", "cuoca", "catering", "private chef"]],
  [
    "yacht",
    [
      "yacht", "barca", "boat", "charter", "gommone", "vela", "motoscafo",
      "gita in barca", "boat charter", "superyacht",
    ],
  ],
  [
    "wellness",
    [
      "wellness", "spa", "massaggio", "massaggi", "trattamento",
      "personal trainer", "fitness", "yoga", "sauna", "hammam", "bagno turco",
    ],
  ],
];

/** true se una delle parole compare come parola intera nel testo normalizzato. */
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

const hasAnyWord = (text: string, words: string[]): boolean =>
  words.some((word) => hasWord(text, word));

/** La prima categoria della flotta nominata, in ordine di presentazione. */
function detectCategory(text: string): FleetCategory | null {
  for (const category of Object.keys(CATEGORY_KEYWORDS) as FleetCategory[]) {
    if (hasAnyWord(text, CATEGORY_KEYWORDS[category])) return category;
  }
  return null;
}

/** Il servizio di villa nominato (aviation, chef, yacht, wellness). */
function detectVillaService(
  text: string,
): Exclude<ChatServiceKind, "transfer"> | null {
  for (const [service, keywords] of SERVICE_KEYWORDS) {
    if (hasAnyWord(text, keywords)) return service;
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

// ── Numeri: passeggeri, bagagli, ospiti ─────────────────────────────────────

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

/** Numero dichiarato con una delle formule note (null se non citato). */
function detectCount(text: string, patterns: RegExp[], max: number): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 1) return clampCount(value, 1, max);
    }
  }
  return null;
}

/** Passeggeri dichiarati (null se non citati). */
function detectPax(text: string): number | null {
  return detectCount(text, PAX_PATTERNS, 24);
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

// ── Parametri per servizio ──────────────────────────────────────────────────

/** Pasto richiesto allo chef. */
function detectMeal(text: string): ChefMeal | null {
  if (hasAnyWord(text, ["colazione", "breakfast", "brunch"])) return "breakfast";
  if (hasAnyWord(text, ["pranzo", "lunch"])) return "lunch";
  if (hasAnyWord(text, ["cena", "cenare", "dinner"])) return "dinner";
  return null;
}

/** Preferenze alimentari citate (facoltative, pass-through allo staff). */
const DIETARY_PATTERNS = [
  /\b(?:vegetarian[oaie]?|vegan[oaie]?|vegano|celiac[oa]|senza glutine|gluten[- ]free)\b/i,
  /\b(?:allergi[ac]|intolleran[tz][a-z]*)\s+(?:a|al|ai|alle|agli)?\s*[a-z]{3,20}/i,
];

function detectDietary(raw: string): string {
  for (const pattern of DIETARY_PATTERNS) {
    const match = pattern.exec(raw);
    if (match) return match[0].trim();
  }
  return "";
}

/** Durata del charter in barca. */
function detectDuration(text: string): YachtDuration | null {
  if (
    hasAnyWord(text, [
      "mezza giornata", "mezza-giornata", "half day", "half-day", "mezzo giorno",
    ])
  ) {
    return "half-day";
  }
  if (
    hasAnyWord(text, [
      "giornata intera", "intera giornata", "tutto il giorno", "full day",
      "full-day", "giornata", "tutto il giorno",
    ])
  ) {
    return "full-day";
  }
  return null;
}

/** Parole chiave dei trattamenti wellness (oltre alle etichette di servicePricing). */
const TREATMENT_KEYWORDS: Record<string, string[]> = {
  "massage-relax": ["massaggio relax", "rilassante", "relax", "decontratturante"],
  "massage-sport": ["massaggio sportivo", "sportivo", "sport"],
  facial: ["trattamento viso", "viso", "facciale", "facial"],
  "personal-trainer": ["personal trainer", "trainer", "allenamento", "fitness"],
};

/** Trattamento wellness scelto (id di servicePricing.wellness.treatments). */
function detectTreatment(text: string): string | null {
  for (const treatment of servicePricing.wellness.treatments) {
    if (text.includes(normalize(treatment.label))) return treatment.id;
  }
  for (const [id, keywords] of Object.entries(TREATMENT_KEYWORDS)) {
    if (hasAnyWord(text, keywords)) return id;
  }
  return null;
}

/** Tratta "da X a Y", "X → Y" oppure una distanza in km. */
function detectRoute(raw: string): BookingRoute {
  const km = /\b(\d{1,4})\s*(?:km|chilometri|kilometers?|kilometres?)\b/i.exec(raw);
  const kmValue = km ? Number(km[1]) : null;

  const place = "([A-Za-zÀ-ÿ'’][A-Za-zÀ-ÿ'’ ]{1,29}?)";
  const stop = "(?=$|[,.!?;]|\\s+(?:domani|oggi|dopodomani|alle|ore|per|con|il|in|e)\\b)";
  const patterns = [
    new RegExp(`\\bda\\s+${place}\\s+a\\s+${place}${stop}`, "i"),
    new RegExp(`\\bfrom\\s+${place}\\s+to\\s+${place}${stop}`, "i"),
    new RegExp(`${place}\\s*(?:→|->|–)\\s*${place}${stop}`, "i"),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (!match) continue;
    const from = titleCase(match[1]);
    const to = titleCase(match[2]);
    if (from && to) return { from, to, km: kmValue };
  }
  return { from: "", to: "", km: kmValue };
}

const titleCase = (value: string): string => {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

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
  const villaService = detectVillaService(normalized);
  const category = detectCategory(normalized);
  const vehicle = matchVehicleByLabel(normalized, catalog.vehicles);
  const hasTransferWord = hasAnyWord(normalized, TRANSFER_WORDS);
  const hasBookingVerb = hasAnyWord(normalized, BOOKING_VERBS);
  const time = extractTime(normalized);

  // Priorità: servizio nominato → categoria flotta → veicolo → parole di
  // trasferimento. L'elicottero è sempre aviazione privata.
  let service: ChatServiceKind | null = villaService;
  if (!service) {
    const fleetCategory = category ?? vehicle?.category ?? null;
    if (fleetCategory) service = fleetCategory === "helicopter" ? "aviation" : "transfer";
    else if (hasTransferWord && (hasBookingVerb || time.time !== "")) service = "transfer";
  }

  const date = detectDate(normalized, now);
  const trip: BookingTrip = {
    date: date.date,
    dateLabel: date.dateLabel,
    time: time.time,
  };

  return {
    raw: text,
    isBooking: service !== null,
    service,
    vehicle,
    requestedCategory: category,
    requestedCategoryLabel: category ? FLEET_CATEGORY_LABELS[category] : null,
    pax: detectPax(time.rest),
    luggage: detectLuggage(time.rest),
    trip,
    meal: detectMeal(normalized),
    guests: detectCount(time.rest, PAX_PATTERNS, 24),
    dietary: detectDietary(text),
    duration: detectDuration(normalized),
    skipper: hasAnyWord(normalized, ["skipper", "equipaggio", "crew"]),
    fuel: hasAnyWord(normalized, ["carburante", "benzina", "fuel"]),
    treatmentId: detectTreatment(normalized),
    route: detectRoute(text),
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

/** Come si chiede ogni parametro mancante: solo la domanda, nessun default. */
const MISSING_QUESTIONS: Record<BookingMissing, string> = {
  vehicle: `${withArticle("veicolo")} preferito`,
  pax: "il numero di passeggeri",
  meal: "il pasto (colazione, pranzo o cena)",
  guests: "il numero di ospiti",
  duration: "la durata (mezza giornata o giornata intera)",
  treatment: "il trattamento desiderato",
  route: "la tratta (da dove a dove, oppure i km)",
  date: "il giorno",
  time: "l'orario",
};

/**
 * La frase con cui si chiedono i parametri mancanti: breve, elegante e con la
 * sola domanda utile. `context` aggiunge un'informazione reale (es. le opzioni
 * disponibili in villa).
 */
function askMissing(missing: BookingMissing[], context = ""): string {
  const questions = missing.map((key) => MISSING_QUESTIONS[key]);
  const body =
    questions.length === 1
      ? `Mi serve ${questions[0]}.`
      : `Per completare la proposta mi servono ${joinItalian(questions)}.`;
  return [context.trim(), body].filter(Boolean).join(" ");
}

/** " — domani alle 10:00" / " — domani" / " alle 10:00" / "". */
function tripPhrase(trip: BookingTrip): string {
  if (trip.dateLabel && trip.time) return ` — ${trip.dateLabel} alle ${trip.time}`;
  if (trip.dateLabel) return ` — ${trip.dateLabel}`;
  if (trip.time) return ` alle ${trip.time}`;
  return "";
}

const BOOKING_CTA =
  "Il totale stimato è nella card qui sotto — confermi e invio la richiesta al nostro staff?";

// ── Preventivi per servizio (stessi calcolatori dei modal) ──────────────────

/** Chef: preventivo di `chefQuote`, dettagli di `chefDetails`. */
function chefChatQuote(intent: BookingIntent, trip: BookingTrip): ChatQuote | null {
  const meal = intent.meal;
  const guests = intent.guests;
  if (!meal || guests === null) return null;
  const details = chefDetails({ meal, guests, dietary: intent.dietary });
  const quote = chefQuote({ meal, guests });
  const mealLabel = CHEF_MEAL_LABELS[meal];
  const rows: ChatQuoteRow[] = [
    { label: "Pasto", value: mealLabel },
    { label: "Ospiti", value: String(details.guests) },
  ];
  if (trip.dateLabel) rows.push({ label: "Data", value: trip.dateLabel });
  if (trip.time) rows.push({ label: "Orario", value: trip.time });
  if (details.dietary) rows.push({ label: "Preferenze", value: details.dietary });

  return {
    service: "chef",
    serviceLabel: `Private Chef — ${mealLabel}`,
    title: `${mealLabel} · ${details.guests} ${details.guests === 1 ? "ospite" : "ospiti"}`,
    subtitle: `${withArticle("servizio chef di villa", { sentenceStart: true })}`,
    rows,
    lines: quote.lines,
    total: quote.total,
    summary: `Ecco la proposta: ${withArticle("servizio chef di villa")} per ${mealLabel.toLowerCase()} di ${details.guests} ${
      details.guests === 1 ? "ospite" : "ospiti"
    }${tripPhrase(trip)}. ${BOOKING_CTA}`,
    details,
  };
}

/** Yacht: preventivo di `yachtQuote`, dettagli di `yachtDetails`. */
function yachtChatQuote(intent: BookingIntent, trip: BookingTrip): ChatQuote | null {
  const duration = intent.duration;
  if (!duration) return null;
  const details = yachtDetails({
    duration,
    departureTime: trip.time,
    skipper: intent.skipper,
    fuel: intent.fuel,
  });
  const quote = yachtQuote({ duration, skipper: intent.skipper, fuel: intent.fuel });
  const rows: ChatQuoteRow[] = [{ label: "Durata", value: details.durationLabel }];
  if (trip.dateLabel) rows.push({ label: "Data", value: trip.dateLabel });
  if (trip.time) rows.push({ label: "Partenza", value: trip.time });
  rows.push({ label: "Skipper", value: details.skipper ? "Incluso" : "Non incluso" });
  rows.push({ label: "Carburante", value: details.fuel ? "Incluso" : "Non incluso" });

  return {
    service: "yacht",
    serviceLabel: `Yacht & Boat Charter — ${details.durationLabel}`,
    title: details.durationLabel,
    subtitle: withArticle("charter in barca", { sentenceStart: true }),
    rows,
    lines: quote.lines,
    total: quote.total,
    summary: `Ecco la proposta: ${withArticle("charter in barca")} di ${details.durationLabel}${
      details.skipper ? " con skipper" : ""
    }${details.fuel ? " e carburante incluso" : ""}${tripPhrase(trip)}. ${BOOKING_CTA}`,
    details,
  };
}

/** Wellness: preventivo di `wellnessQuote`, dettagli di `wellnessDetails`. */
function wellnessChatQuote(
  intent: BookingIntent,
  trip: BookingTrip,
): ChatQuote | null {
  if (!intent.treatmentId) return null;
  const details = wellnessDetails({
    treatmentId: intent.treatmentId,
    date: trip.date,
    time: trip.time,
  });
  const quote = wellnessQuote(details.treatmentId);
  const rows: ChatQuoteRow[] = [{ label: "Trattamento", value: details.treatmentLabel }];
  if (trip.dateLabel) rows.push({ label: "Data", value: trip.dateLabel });
  if (trip.time) rows.push({ label: "Orario", value: trip.time });

  return {
    service: "wellness",
    serviceLabel: `Wellness & Spa — ${details.treatmentLabel}`,
    title: details.treatmentLabel,
    subtitle: withArticle("wellness", { sentenceStart: true }),
    rows,
    lines: quote.lines,
    total: quote.total,
    summary: `Ecco la proposta: ${details.treatmentLabel} in villa${tripPhrase(trip)}. ${BOOKING_CTA}`,
    details,
  };
}

/** Il preventivo del servizio di villa richiesto (null se manca un parametro). */
function villaServiceQuote(
  intent: BookingIntent,
  trip: BookingTrip,
): ChatQuote | null {
  switch (intent.service) {
    case "chef":
      return chefChatQuote(intent, trip);
    case "yacht":
      return yachtChatQuote(intent, trip);
    case "wellness":
      return wellnessChatQuote(intent, trip);
    default:
      return null;
  }
}

/**
 * Transfer / aviation: preventivo del tool flotta della villa.
 * `quote` è la fotografia di `calculate_service_quote`, il totale non si tocca.
 */
function fleetChatQuote(
  quote: FleetQuote,
  intent: BookingIntent,
  trip: BookingTrip,
  aviation: boolean,
): ChatQuote {
  const route = intent.route;
  const details = fleetTransferDetails({
    from: aviation ? route.from : "",
    to: aviation ? route.to : "",
    time: trip.time,
    passengers: quote.pax,
    luggage: quote.luggage,
    quote,
  });
  const rows: ChatQuoteRow[] = [];
  if (aviation && (route.from || route.to)) {
    rows.push({ label: "Tratta", value: `${route.from} → ${route.to}` });
  } else if (aviation && route.km !== null) {
    rows.push({ label: "Tratta", value: `${route.km} km` });
  }
  rows.push({
    label: "Passeggeri",
    value: `${quote.pax} · inclusi ${quote.includedPax}`,
  });
  rows.push({ label: "Bagagli", value: `${quote.luggage} · inclusi ${quote.includedBags}` });
  if (trip.dateLabel) rows.push({ label: "Data", value: trip.dateLabel });
  if (trip.time) rows.push({ label: "Orario", value: trip.time });

  const luggageLine =
    quote.luggage > 0
      ? `, ${quote.luggage} ${quote.luggage === 1 ? "bagaglio" : "bagagli"}`
      : "";
  const routeLine =
    aviation && route.from && route.to
      ? `, tratta ${route.from} → ${route.to}`
      : "";

  return {
    service: aviation ? "aviation" : "transfer",
    serviceLabel: aviation
      ? `Private Aviation — ${quote.vehicleLabel}`
      : `Trasferimento — ${quote.vehicleLabel}`,
    title: quote.vehicleLabel,
    subtitle: `${quote.supplierName} · ${FLEET_CATEGORY_LABELS[quote.category]}`,
    rows,
    lines: quote.lines,
    total: quote.total,
    summary: `Ecco la proposta: ${quote.vehicleLabel} di ${quote.supplierName}, ${quote.pax} passeggeri${luggageLine}${routeLine}${tripPhrase(trip)}. ${BOOKING_CTA}`,
    details,
    pax: quote.pax,
  };
}

// ── Disponibilità dei servizi di villa ──────────────────────────────────────

interface OfferedService {
  kind: "chef" | "yacht" | "wellness";
  title: string;
}

/**
 * I servizi di villa (non-flotta) offerti: vengono dalle stesse card del tab
 * Services (`conciergeServices`) e dal mapping dei modal (`matchServiceCategory`).
 * I transfer/aviation non sono qui: passano dal canale flotta.
 */
function offeredVillaServices(services: ConciergeService[]): OfferedService[] {
  const offered: OfferedService[] = [];
  for (const service of services) {
    const match = matchServiceCategory(service);
    if (!match || match.category === "transfer") continue;
    if (offered.some((entry) => entry.kind === match.category)) continue;
    offered.push({ kind: match.category, title: service.title });
  }
  return offered;
}

// ── Piano di risposta ───────────────────────────────────────────────────────

/**
 * Il piano di risposta. Ordine delle regole:
 *   servizio/categoria assente → "non disponibile" + alternative, nessuna card
 *   parametri mancanti         → chiedi SOLO quelli, nessuna card
 *   altrimenti                 → card con il preventivo del calcolatore reale
 */
export function planBookingReply(
  intent: BookingIntent,
  catalog: FleetCatalog,
  services: ConciergeService[] = conciergeServices,
): BookingPlan {
  if (!intent.isBooking || !intent.service) return { kind: "none" };
  if (intent.service === "transfer" || intent.service === "aviation") {
    return planFleetReply(intent, catalog);
  }
  return planVillaServiceReply(intent, services);
}

/** Transfer e aviazione privata: canale flotta (fleet DB + fallback). */
function planFleetReply(intent: BookingIntent, catalog: FleetCatalog): BookingPlan {
  const aviation = intent.service === "aviation";
  const category: FleetCategory | null = aviation
    ? "helicopter"
    : intent.requestedCategory;
  const inCategory = category
    ? catalog.vehicles.filter((vehicle) => vehicle.category === category)
    : [];

  if (category && inCategory.length === 0) {
    const alternatives = alternativeLines(catalog);
    const noun = withArticle(FLEET_CATEGORY_LABELS[category], {
      sentenceStart: true,
    });
    return {
      kind: "unavailable",
      content: `${noun} non è disponibile per questa villa. Le alternative reali disponibili sono: ${alternatives.join("; ")}. Posso preparare il preventivo per una di queste.`,
      alternatives,
    };
  }

  const vehicle = aviation
    ? intent.vehicle?.category === "helicopter"
      ? intent.vehicle
      : inCategory.length > 0
        ? cheapestIn(inCategory)
        : null
    : intent.vehicle ?? (inCategory.length > 0 ? cheapestIn(inCategory) : null);

  if (!vehicle) {
    return {
      kind: "clarify",
      content: askMissing(
        ["vehicle"],
        `Per questa villa posso predisporre: ${vehicleOptions(catalog)}.`,
      ),
      missing: ["vehicle"],
    };
  }

  // Parametri essenziali: transfer = passeggeri; aviation = tratta, data, ora, pax.
  const missing: BookingMissing[] = [];
  if (aviation) {
    const hasRoute =
      (intent.route.from !== "" && intent.route.to !== "") || intent.route.km !== null;
    if (!hasRoute) missing.push("route");
    if (!intent.trip.date) missing.push("date");
    if (!intent.trip.time) missing.push("time");
  }
  if (intent.pax === null) missing.push("pax");
  if (missing.length > 0) {
    // Contesto reale (capienza del veicolo) solo quando manca il solo pax:
    // nessun parametro inventato, solo l'informazione che aiuta a rispondere.
    const context =
      missing.length === 1 && missing[0] === "pax"
        ? `${vehicle.label} è disponibile fino a ${vehicle.maxPax} passeggeri.`
        : "";
    return { kind: "clarify", content: askMissing(missing, context), missing };
  }

  const pax = intent.pax ?? 0;
  if (pax > vehicle.maxPax) {
    const fitting = catalog.vehicles.filter((other) => other.maxPax >= pax);
    if (fitting.length === 0) {
      const maxPax = catalog.vehicles.reduce(
        (max, other) => Math.max(max, other.maxPax),
        0,
      );
      return {
        kind: "clarify",
        content: `${vehicle.label} accoglie fino a ${vehicle.maxPax} passeggeri e la villa non ha veicoli per ${pax} persone (massimo ${maxPax}). Posso organizzare più corse: mi dica come preferisce procedere.`,
        missing: ["vehicle"],
      };
    }
    return {
      kind: "clarify",
      content: `Per ${pax} passeggeri ${vehicle.label} non basta. Posso proporre: ${fitting
        .map((other) => `${other.label} (fino a ${other.maxPax} passeggeri)`)
        .join("; ")}. Quale preferisce?`,
      missing: ["vehicle"],
    };
  }

  const quote = calculate_service_quote(
    vehicle.id,
    {
      pax,
      luggage: intent.luggage ?? 0,
      km: intent.route.km ?? undefined,
    },
    catalog.vehicles,
  );
  if (!quote) {
    return {
      kind: "clarify",
      content: `Non riesco a quotare ${vehicle.label} con questi parametri. Quale veicolo preferisce fra: ${vehicleOptions(catalog)}?`,
      missing: ["vehicle"],
    };
  }

  const chatQuote = fleetChatQuote(quote, intent, intent.trip, aviation);
  return {
    kind: "booking",
    content: chatQuote.summary,
    quote: chatQuote,
    trip: intent.trip,
  };
}

/** Chef, yacht, wellness: calcolatori dei modal, nessun default inventato. */
function planVillaServiceReply(
  intent: BookingIntent,
  services: ConciergeService[],
): BookingPlan {
  const kind = intent.service as "chef" | "yacht" | "wellness";
  const offered = offeredVillaServices(services);
  const match = offered.find((entry) => entry.kind === kind);

  if (!match) {
    const alternatives = offered.map((entry) => entry.title);
    const noun = withArticle(serviceNoun(kind), { sentenceStart: true });
    const tail =
      alternatives.length > 0
        ? `I servizi disponibili in questa villa sono: ${alternatives.join("; ")}.`
        : "Al momento la villa non ha altri servizi concierge attivi.";
    return {
      kind: "unavailable",
      content: `${noun} non è disponibile per questa villa. ${tail}`,
      alternatives,
    };
  }

  const missing = missingVillaParams(intent, kind);
  if (missing.length > 0) {
    return { kind: "clarify", content: askMissing(missing), missing };
  }

  const quote = villaServiceQuote(intent, intent.trip);
  if (!quote) {
    return {
      kind: "clarify",
      content: askMissing(missingVillaParams(intent, kind)),
      missing: missingVillaParams(intent, kind),
    };
  }

  return { kind: "booking", content: quote.summary, quote, trip: intent.trip };
}

/** Nome italiano del servizio, con il genere giusto per l'articolo. */
function serviceNoun(kind: "chef" | "yacht" | "wellness"): string {
  switch (kind) {
    case "chef":
      return "servizio chef di villa";
    case "yacht":
      return "charter in barca";
    case "wellness":
      return "wellness";
  }
}

/** I parametri essenziali che mancano (allineati ai campi dei modal). */
function missingVillaParams(
  intent: BookingIntent,
  kind: "chef" | "yacht" | "wellness",
): BookingMissing[] {
  const missing: BookingMissing[] = [];
  if (kind === "chef") {
    if (!intent.meal) missing.push("meal");
    if (intent.guests === null) missing.push("guests");
  }
  if (kind === "yacht") {
    if (!intent.trip.date) missing.push("date");
    if (!intent.duration) missing.push("duration");
  }
  if (kind === "wellness" && !intent.treatmentId) missing.push("treatment");
  return missing;
}

// ── Payload dell'INSERT ─────────────────────────────────────────────────────

/**
 * I campi della richiesta creata dalla chat. `details` porta la forma esatta del
 * modal del servizio (serviceDetails.ts) più `channel: "chat"` e la data
 * richiesta, così staff e "I Miei Servizi" leggono la richiesta senza logica
 * nuova. Prezzo e commissioni (12% / 3%) vengono dal preventivo del tool.
 */
export function buildChatBookingPayload(
  quote: ChatQuote,
  trip: BookingTrip,
): ChatBookingPayload {
  // Servizi di villa: orario e voci del preventivo si salvano con la richiesta,
  // così lo staff li legge nel JSONB `details` senza ricalcolarli.
  const villaService =
    quote.service === "chef" ||
    quote.service === "yacht" ||
    quote.service === "wellness";
  const details: ChatBookingDetails = {
    ...quote.details,
    channel: "chat",
    date: trip.date,
    dateLabel: trip.dateLabel,
    ...(villaService
      ? {
          // "" quando l'ospite non ha indicato un orario (stessa convenzione di `date`).
          time: trip.time,
          lines: quote.lines.map((line) => ({ label: line.label, amount: line.amount })),
        }
      : {}),
    ...(quote.pax !== undefined ? { pax: quote.pax } : {}),
  };
  return {
    serviceLabel: quote.serviceLabel,
    price: quote.total,
    agencyCommission: round2(
      (quote.total * revenueConfig.agencyCommissionPct) / 100,
    ),
    platformCommission: round2(
      (quote.total * revenueConfig.platformCommissionPct) / 100,
    ),
    agencyPct: revenueConfig.agencyCommissionPct,
    auraPct: revenueConfig.auraFeePct,
    details,
  };
}

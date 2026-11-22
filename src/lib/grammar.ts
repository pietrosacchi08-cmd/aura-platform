/**
 * AURA — Articoli determinativi e concordanza (IT / EN).
 *
 * UNICO punto del codice in cui si sceglie l'articolo di un nome di servizio,
 * categoria o veicolo. Nessuna frase compone più "La " + nome a mano: tutto
 * passa da `withArticle`, quindi "La Elicottero" non può più comparire.
 *
 *   withArticle("Elicottero")                            → "l'elicottero"
 *   withArticle("Elicottero", { sentenceStart: true })   → "L'elicottero"
 *   withArticle("Supercar")                              → "la supercar"
 *   withArticle("Yacht")                                 → "lo yacht"
 *   withArticle("Chef privato")                          → "lo chef privato"
 *   withArticle("SUV con autista")                       → "il SUV con autista"
 *   withArticle("Berlina con autista")                   → "la berlina con autista"
 *   withArticle("elicottero", { language: "en" })        → "the helicopter"
 *
 * Regole italiane applicate (in quest'ordine):
 *   1. articolo irregolare dichiarato nel registro (`lo chef`, `lo yacht`);
 *   2. vocale iniziale  → "l'" (vale per maschile e femminile: l'elicottero, l'auto);
 *   3. femminile        → "la";
 *   4. s + consonante, z, x, y, gn, ps, pn → "lo";
 *   5. altrimenti       → "il".
 *
 * Il nome comune viene portato in minuscolo ("Elicottero" → "elicottero"), ma
 * acronimi e nomi propri restano intatti ("SUV con autista", "Mercedes Classe V").
 */

export type GrammaticalGender = "masculine" | "feminine";
export type Language = "it" | "en";

interface NounRule {
  gender: GrammaticalGender;
  /** Articolo irregolare: vince sulla regola fonetica. */
  article?: string;
}

/**
 * Registro dei nomi che l'agente usa nelle frasi. La chiave è il nome
 * normalizzato (minuscolo, senza accenti, spazi singoli).
 */
const NOUN_RULES: Record<string, NounRule> = {
  // Servizi della villa
  "chef": { gender: "masculine", article: "lo" },
  "chef privato": { gender: "masculine", article: "lo" },
  "servizio chef di villa": { gender: "masculine" },
  "cuoco": { gender: "masculine" },
  "catering": { gender: "masculine" },
  "yacht": { gender: "masculine", article: "lo" },
  "yacht & boat charter": { gender: "masculine", article: "lo" },
  "charter in barca": { gender: "masculine" },
  "charter": { gender: "masculine" },
  "barca": { gender: "feminine" },
  "gita in barca": { gender: "feminine" },
  "wellness": { gender: "masculine" },
  "wellness & spa": { gender: "masculine" },
  "spa": { gender: "feminine" },
  "massaggio": { gender: "masculine" },
  "trattamento": { gender: "masculine" },
  "personal trainer": { gender: "masculine" },
  "elicottero": { gender: "masculine" },
  "elicottero privato": { gender: "masculine" },
  "aviation": { gender: "feminine", article: "l'" },
  "aviazione privata": { gender: "feminine" },
  "jet privato": { gender: "masculine" },
  "servizio transfer": { gender: "masculine" },
  "trasferimento": { gender: "masculine" },
  "transfer": { gender: "masculine" },
  "servizio": { gender: "masculine" },
  // Categorie della flotta
  "suv con autista": { gender: "masculine" },
  "suv": { gender: "masculine" },
  "berlina con autista": { gender: "feminine" },
  "van con autista": { gender: "masculine" },
  "van": { gender: "masculine" },
  "supercar": { gender: "feminine" },
  "auto con autista": { gender: "feminine" },
};

/** Minuscolo, senza accenti, spazi singoli: la chiave del registro. */
function normalizeNoun(noun: string): string {
  return noun
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nome comune in minuscolo; acronimi e nomi propri (più di una maiuscola)
 * restano com'erano: "Elicottero" → "elicottero", "SUV con autista" invariato.
 */
function commonNounForm(noun: string): string {
  const trimmed = noun.trim();
  const uppercase = trimmed.match(/[A-Z]/g)?.length ?? 0;
  if (uppercase > 1) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** Genere grammaticale del nome (registro, altrimenti euristica sulla desinenza). */
export function genderOf(noun: string): GrammaticalGender {
  const key = normalizeNoun(noun);
  const rule = NOUN_RULES[key];
  if (rule) return rule.gender;
  const lastWord = key.split(" ").pop() ?? key;
  return /a$/.test(lastWord) && !/^(?:ma|ta|ista|ema|oma)$/.test(lastWord)
    ? "feminine"
    : "masculine";
}

/**
 * Articolo determinativo italiano per il nome dato.
 * `gender` esplicito vince sul registro (serve ai nomi non registrati).
 */
export function italianArticle(noun: string, gender?: GrammaticalGender): string {
  const key = normalizeNoun(noun);
  if (!key) return "";
  const rule = NOUN_RULES[key];
  if (rule?.article) return rule.article;
  if (/^[aeiou]/.test(key)) return "l'";
  if ((gender ?? rule?.gender ?? genderOf(noun)) === "feminine") return "la";
  // "lo" davanti a s + consonante, z, x, y, gn, ps, pn.
  if (/^(?:z|x|y|gn|ps|pn|s[bcdfglmnpqrstvz])/.test(key)) return "lo";
  return "il";
}

/** Articolo determinativo inglese: sempre "the". */
export function englishArticle(): string {
  return "the";
}

export interface ArticleOptions {
  /** Lingua della frase (default: italiano). */
  language?: Language;
  /** Genere esplicito, quando il nome non è nel registro. */
  gender?: GrammaticalGender;
  /** true quando la frase inizia con questo sintagma (maiuscola all'articolo). */
  sentenceStart?: boolean;
}

/**
 * Il nome con il suo articolo, nella lingua richiesta.
 * È l'unica funzione che l'agente usa per comporre frasi con nomi di
 * servizio/categoria/veicolo.
 */
export function withArticle(noun: string, options: ArticleOptions = {}): string {
  const cleaned = noun.trim();
  if (!cleaned) return "";
  const language = options.language ?? "it";
  const word = commonNounForm(cleaned);
  const phrase =
    language === "en"
      ? `${englishArticle()} ${word}`
      : (() => {
          const article = italianArticle(cleaned, options.gender);
          return `${article}${article.endsWith("'") ? "" : " "}${word}`;
        })();
  if (!options.sentenceStart) return phrase;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Elenco italiano: "a, b e c". */
export function joinItalian(items: string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} e ${clean[clean.length - 1]}`;
}

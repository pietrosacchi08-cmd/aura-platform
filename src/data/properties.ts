/**
 * AURA — Property configuration
 *
 * Single source of truth for every estate managed on the platform.
 * Add a new listing by appending one entry below; every tab
 * (Estate, Staff, Concierge, Revenue) derives its per-property state
 * from the `id` values declared here.
 */

export interface Property {
  /** Stable identifier used as the key for all per-property state. */
  id: string;
  /** Full listing title. */
  title: string;
  /** Short display label used in the header and switchers. */
  name: string;
  /** Agency reference code shown on concierge requests. */
  refCode: string;
  /** Location / area of the estate. */
  location: string;
  /** Asking price as displayed. */
  price: string;
  /** Pipe-separated spec line. */
  specs: string;
  /** Marketing highlights shown in the listing. */
  highlights: string[];
  /** Main hero image (local asset or remote URL). */
  heroImage: string;
  /** Accessible description for the hero image. */
  heroAlt: string;
  /** Gallery images for the property. */
  gallery: string[];
  bedrooms: number;
  baths: number;
  /** Interior surface, e.g. "900 mq" (kept for existing UI). */
  interior: string;
  /** Exterior / terrace surface, e.g. "6.800 mq" (kept for existing UI). */
  terrace: string;
  /** Initial climate setpoint for the estate tab. */
  defaultTemp: number;
  /** Initial pool state for the estate tab. */
  defaultPool: boolean;
}

export const properties: Property[] = [
  {
    id: "ref-6291",
    title: "Villa On A Panoramic Hill Over Forte Dei Marmi",
    name: "Villa Forte dei Marmi",
    refCode: "Ref. 6291",
    location: "Montignoso / Colline Apuo-Versiliesi",
    price: "€ 3.900.000",
    specs:
      "900 mq Interni | 6.800 mq Esterni | 6 Camere | 7 Bagni | 5 Livelli",
    highlights: [
      "Piscina panoramica riscaldata",
      "Spa privata",
      "Ascensore su 5 livelli",
      "Garage sotterraneo",
      "Terrazza panoramica vista mare (da La Spezia a Livorno)",
      "Cantina",
    ],
    heroImage: "/properties/ref-6291-01.jpg",
    heroAlt: "Villa on a panoramic hill over Forte dei Marmi with sea views",
    gallery: [
      "/properties/ref-6291-01.jpg",
      "/properties/ref-6291-02.jpg",
      "/properties/ref-6291-03.jpg",
      "/properties/ref-6291-04.jpg",
      "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=1200&q=80",
    ],
    bedrooms: 6,
    baths: 7,
    interior: "900 mq",
    terrace: "6.800 mq",
    defaultTemp: 22,
    defaultPool: true,
  },
  {
    id: "ref-14828",
    title: "Luxury Villa With Pool On Pietrasanta's Hills",
    name: "Villa Pietrasanta Hills",
    refCode: "Ref. 14828",
    location: "Colline di Pietrasanta, Versilia",
    price: "€ 3.500.000",
    specs:
      "500 mq Interni | 3,245 Ha Terreno | 5 Camere | 4 Bagni | 3 Livelli",
    highlights: [
      "Piscina panoramica con spogliatoio e bagno dedicato",
      "Uliveto e Vigneto privati",
      "Sala Biliardo",
      "Pavimenti in cotto antico e travi a vista",
      "Dependance per ospiti (200m dalla villa)",
      "Sentiero nel bosco privato",
    ],
    heroImage:
      "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&w=1200&q=80",
    heroAlt: "Stone villa with panoramic pool on the hills of Pietrasanta",
    gallery: [
      "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1560184897-ae75f418493e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1615529182904-14819c35db37?auto=format&fit=crop&w=1200&q=80",
    ],
    bedrooms: 5,
    baths: 4,
    interior: "500 mq",
    terrace: "3,245 Ha",
    defaultTemp: 21,
    defaultPool: true,
  },
  {
    id: "ref-15864",
    title: "Prestigious Villa With Sea Views And Tennis Court In Pietrasanta",
    name: "Villa Pietrasanta Tennis",
    refCode: "Ref. 15864",
    location: "Pietrasanta Centro / Collina (a 2 min a piedi dal centro storico)",
    price: "€ 2.350.000",
    specs: "290 mq Interni | 5.000 mq Terreno | 4 Camere | 3 Bagni | 3 Livelli",
    highlights: [
      "Campo da Tennis privato in erba sintetica",
      "Vista mare ininterrotta",
      "Uliveto secolare con oltre 100 piante",
      "Dependance indipendente per ospiti/staff",
      "Cantina",
      "Accesso pedonale diretto al centro di Pietrasanta",
    ],
    heroImage:
      "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1200&q=80",
    heroAlt: "Private tennis court of the villa in Pietrasanta",
    gallery: [
      "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=1200&q=80",
    ],
    bedrooms: 4,
    baths: 3,
    interior: "290 mq",
    terrace: "5.000 mq",
    defaultTemp: 24,
    defaultPool: true,
  },
];

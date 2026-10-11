// ── White-label configuration ────────────────────────────────────────────────
//
// Single source of truth for the agency branding of this AURA build.
// Change these values to re-skin the platform for a different agency partner.

export const agencyConfig = {
  /** Agency brand name — shown in the header and in the footer. */
  agencyName: "Your Agency",
  /** Optional logo URL. When set it replaces the AURA wordmark in the header. */
  logoUrl: "",
  /** Brand accent colour, applied to the --aura-accent CSS variable. */
  primaryColor: "#D4AF37",
};

/** Subscription price surfaced to the agency in the revenue panel. */
export const subscriptionPrice = "€2,000.00/yr";

// ── Concierge Services ───────────────────────────────────────────────────────

export interface ConciergeService {
  id: string;
  title: string;
  subtitle: string;
  /** Indicative price label — every request is quoted by the agency. */
  price: string;
  priceValue: number | null;
  cta: string;
  icon: "yacht" | "chauffeur" | "catering" | "aviation";
}

export const conciergeServices: ConciergeService[] = [
  {
    id: "yacht",
    title: "Yacht & Boat Charter",
    subtitle: "Daily cruises & superyacht tenders",
    price: "€4,500/day (example price)",
    priceValue: 4500,
    cta: "Request",
    icon: "yacht",
  },
  {
    id: "chauffeur",
    title: "Chauffeur & Transfers",
    subtitle: "Airport transfers & private drivers",
    price: "€800/day (example price)",
    priceValue: 800,
    cta: "Request",
    icon: "chauffeur",
  },
  {
    id: "catering",
    title: "Private Chef",
    subtitle: "In-villa private chef & staff",
    price: "Price on request",
    priceValue: null,
    cta: "Request",
    icon: "catering",
  },
  {
    id: "aviation",
    title: "Private Aviation",
    subtitle: "Global charter flights on-demand",
    price: "Price on request",
    priceValue: null,
    cta: "Request",
    icon: "aviation",
  },
];

/** Illustrative imagery per service card. */
export const conciergeImages: Record<ConciergeService["icon"], string> = {
  yacht: "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=1200&q=80",
  chauffeur: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?fit=crop&w=400&q=80",
  catering: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?fit=crop&w=400&q=80",
  aviation: "https://images.unsplash.com/photo-1540962351504-03099e0a754b?fit=crop&w=400&q=80",
};

// ── Revenue configuration ────────────────────────────────────────────────────
// This file is the per-agency configuration: an agency partner re-skins the
// platform AND sets its own commercial terms here. Changing a percentage below
// updates every figure, table header and total in the Revenue panel.
//
// The values below are EXAMPLE values — set them to your own agreement.
export interface SupplierOverride {
  auraFeePct?: number;
  agencyCommissionPct?: number;
}
export const revenueConfig: {
  /** AURA platform fee, as a percentage of the guest price. */
  auraFeePct: number;
  /** Agency commission, as a percentage of the guest price. */
  agencyCommissionPct: number;
  /** Supplier share, as a percentage of the guest price (indicative only — the
   *  supplier's share is always the remainder, see computeSplit). */
  supplierSharePct: number;
  /** Per-supplier overrides, keyed by supplier name. An entry here replaces the
   *  default percentages for that supplier only. Example:
   *  { "Charter partner": { agencyCommissionPct: 10 } } */
  supplierOverrides: Record<string, SupplierOverride>;
} = {
  auraFeePct: 3,           // example value
  agencyCommissionPct: 12, // example value
  supplierSharePct: 85,    // example value
  supplierOverrides: {},
};
const roundCents = (value: number): number => Math.round(value * 100) / 100;
/**
 * Split a guest price into its three shares. Percentages come from the
 * per-supplier override when the supplier is listed, otherwise from
 * revenueConfig.
 * Invariant: the supplier share is the remainder, so supplierShare +
 * agencyCommission + auraFee always equals the guest price exactly.
 */
export function computeSplit(
  guestPrice: number,
  supplier?: string,
): { supplierShare: number; agencyCommission: number; auraFee: number } {
  const override = supplier ? revenueConfig.supplierOverrides[supplier] : undefined;
  const auraFeePct = override?.auraFeePct ?? revenueConfig.auraFeePct;
  const agencyCommissionPct =
    override?.agencyCommissionPct ?? revenueConfig.agencyCommissionPct;
  const auraFee = roundCents((guestPrice * auraFeePct) / 100);
  const agencyCommission = roundCents((guestPrice * agencyCommissionPct) / 100);
  const supplierShare = roundCents(guestPrice - agencyCommission - auraFee);
  return { supplierShare, agencyCommission, auraFee };
}

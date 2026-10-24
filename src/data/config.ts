// ── White-label configuration ────────────────────────────────────────────────
//
// Single source of truth for the agency branding of this AURA build.
// Change these values to re-skin the platform for a different agency partner.

export const agencyConfig = {
  /** Agency brand name — shown in the header and in the footer. */
  agencyName: "Versilia Luxury Estates",
  /** Optional logo URL. When set it replaces the AURA wordmark in the header. */
  logoUrl: "",
  /** Brand accent colour, applied to the --aura-accent CSS variable. */
  primaryColor: "#D4AF37",
};

/** Subscription price surfaced to the agency in the revenue panel. */
export const subscriptionPrice = "€2,000.00/yr";
// ── Access gate (front-end mock auth, consistent with the demo nature) ───────
/** Stay PIN handed to the guest at check-in (demo default). */
export const guestAccess = { stayPin: "0000" };
/** Staff dashboard access password (demo). */
export const staffAccess = { password: "aura2026" };

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
    price: "€4,500/day",
    priceValue: 4500,
    cta: "Request",
    icon: "yacht",
  },
  {
    id: "chauffeur",
    title: "Chauffeur & Transfers",
    subtitle: "Airport transfers & private drivers",
    price: "€800/day",
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
  const split = splitRequestAmounts(guestPrice, agencyCommissionPct, auraFeePct);
  // guestPrice is a finite number here, so the amounts are never null.
  return {
    supplierShare: split.supplierAmount ?? 0,
    agencyCommission: split.agencyAmount ?? 0,
    auraFee: split.auraAmount ?? 0,
  };
}
export interface RequestAmounts {
  agencyAmount: number | null;
  auraAmount: number | null;
  supplierAmount: number | null;
}
/**
 * Split a RECORDED request price into its agency / AURA / supplier amounts.
 * These amounts are always derived, never stored: recompute them from the price
 * and the two percentages on every render instead of persisting them.
 * Invariant: the supplier amount is the REMAINDER (price − agency − AURA), so
 * agencyAmount + auraAmount + supplierAmount === price exactly (rounded to
 * cents). All three are null when no price is recorded (price === null).
 */
export function splitRequestAmounts(
  price: number | null,
  agencyPct: number,
  auraPct: number,
): RequestAmounts {
  if (price === null || !Number.isFinite(price)) {
    return { agencyAmount: null, auraAmount: null, supplierAmount: null };
  }
  const agencyAmount = roundCents((price * agencyPct) / 100);
  const auraAmount = roundCents((price * auraPct) / 100);
  const supplierAmount = roundCents(price - agencyAmount - auraAmount);
  return { agencyAmount, auraAmount, supplierAmount };
}

// ── Requests CSV export ──────────────────────────────────────────────────────
/**
 * One row of the agency requests export. The amount fields are the DERIVED
 * shares (splitRequestAmounts) of a RECORDED price — nothing here is stored,
 * and nothing here moves money. A null amount exports as an empty cell, never
 * as a placeholder.
 */
export interface CsvRequestRow {
  service: string;
  supplier: string;
  guestPrice: number | null;
  supplierAmount: number | null;
  agencyAmount: number | null;
  auraAmount: number | null;
  status: string;
}

const CSV_HEADER = [
  "Service",
  "Supplier",
  "Guest price",
  "Supplier amount",
  "Agency amount",
  "AURA amount",
  "Status",
];

/** Quote a field only when it holds a comma, a quote or a line break. */
const csvCell = (value: string | number | null): string => {
  if (value === null) return "";
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Build the full CSV for the agency requests table: a header row, one row per
 * request, then a Total row carrying the same totals as the table footer.
 * UTF-8 BOM + CRLF so a spreadsheet opens it in one click; numeric cells stay
 * plain numbers with two decimals and no currency symbol so Excel reads them as
 * numbers. Pure function — the caller turns the string into a download.
 */
export function toCsv(rows: CsvRequestRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.service),
        csvCell(row.supplier),
        csvCell(row.guestPrice),
        csvCell(row.supplierAmount),
        csvCell(row.agencyAmount),
        csvCell(row.auraAmount),
        csvCell(row.status),
      ].join(","),
    );
  }
  // Totals are the sum of the exported rows; a null amount adds nothing.
  const totals = rows.reduce(
    (acc, row) => ({
      guestPrice: acc.guestPrice + (row.guestPrice ?? 0),
      supplierAmount: acc.supplierAmount + (row.supplierAmount ?? 0),
      agencyAmount: acc.agencyAmount + (row.agencyAmount ?? 0),
      auraAmount: acc.auraAmount + (row.auraAmount ?? 0),
    }),
    { guestPrice: 0, supplierAmount: 0, agencyAmount: 0, auraAmount: 0 },
  );
  lines.push(
    [
      "Total",
      "",
      csvCell(totals.guestPrice),
      csvCell(totals.supplierAmount),
      csvCell(totals.agencyAmount),
      csvCell(totals.auraAmount),
      "",
    ].join(","),
  );
  return `\uFEFF${lines.join("\r\n")}`;
}

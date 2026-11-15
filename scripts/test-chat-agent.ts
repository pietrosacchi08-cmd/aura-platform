/**
 * AURA — QA deterministica dell'agente chat Concierge.
 *
 *   bun scripts/test-chat-agent.ts
 *
 * Verifica le funzioni PURE (nessun DOM, nessuna rete):
 *   (a) quote math con supplementi pax/bagagli e split 12/3 esatto (round2)
 *   (b) parsing dell'intent di esempio → veicolo/categoria, pax, data, ora
 *   (c) categoria assente (supercar) → "non disponibile" + alternative, no card
 *   (d) mapping dei campi dell'INSERT (service_label, price, commissioni, details.channel)
 *
 * Exit 0 = tutto verde. Esce 1 al primo controllo fallito.
 */
import { round2, revenueConfig } from "../src/data/config";
import { calculate_service_quote, type FleetCatalog, type FleetVehicle } from "../src/lib/fleet";
import {
  buildChatBookingPayload,
  parseBookingIntent,
  planBookingReply,
} from "../src/lib/chatAgent";

// ── Fixture: una villa con un van (Classe V) e un SUV ───────────────────────

const vehicle = (input: Partial<FleetVehicle> & { id: string; label: string }): FleetVehicle => ({
  villaId: "villa-test",
  supplierId: "supplier-test",
  supplierName: "Fornitore Test",
  category: "van",
  basePrice: 150,
  unitPrice: 0,
  unit: "fixed",
  luggageSurcharge: 10,
  extraPaxSurcharge: 15,
  maxPax: 7,
  active: true,
  ...input,
});

const VAN = vehicle({ id: "veh-classe-v", label: "Mercedes Classe V" });
const SUV = vehicle({
  id: "veh-gls",
  label: "Mercedes GLS 450",
  category: "suv",
  basePrice: 220,
  maxPax: 4,
});

const catalog: FleetCatalog = {
  villaId: "villa-test",
  source: "fallback",
  categories: [
    { category: "suv", label: "SUV con autista", vehicles: [SUV] },
    { category: "van", label: "Van con autista", vehicles: [VAN] },
  ],
  vehicles: [SUV, VAN],
};

/** Data fissa: i test non dipendono dal giorno in cui girano. */
const NOW = new Date(2026, 6, 17, 9, 0, 0); // venerdì 17/07/2026

let checks = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  checks += 1;
  if (condition) return;
  console.error(`✗ ${label}`);
  if (detail !== undefined) console.error("  ", detail);
  process.exit(1);
}

const eq = (label: string, actual: unknown, expected: unknown): void =>
  check(`${label} (atteso ${String(expected)}, ricevuto ${String(actual)})`, actual === expected);

// ── (a) Quote math + split 12/3 ─────────────────────────────────────────────

const quote = calculate_service_quote("veh-classe-v", { pax: 5, luggage: 4 }, catalog.vehicles);
check("(a) il preventivo esiste", quote !== null);
if (!quote) process.exit(1);

// base 150 + bagagli 10×(4−2)=20 + pax 15×(5−2)=45 = 215
eq("(a) totale", quote.total, 215);
eq("(a) supplemento bagagli", quote.luggageAmount, 20);
eq("(a) supplemento passeggeri", quote.extraPaxAmount, 45);
eq("(a) base", quote.basePrice, 150);
eq("(a) commissione agenzia 12%", quote.agencyCommission, round2((215 * 12) / 100));
eq("(a) commissione AURA 3%", quote.platformCommission, round2((215 * 3) / 100));
eq("(a) commissione agenzia = 25.8", quote.agencyCommission, 25.8);
eq("(a) commissione AURA = 6.45", quote.platformCommission, 6.45);
eq(
  "(a) quota fornitore = resto",
  quote.supplierShare,
  round2(quote.total - quote.agencyCommission - quote.platformCommission),
);
eq(
  "(a) le tre parti sommano al totale",
  round2(quote.agencyCommission + quote.platformCommission + quote.supplierShare),
  quote.total,
);
eq(
  "(a) le righe sommano al totale",
  round2(quote.lines.reduce((sum, line) => sum + line.amount, 0)),
  quote.total,
);
eq("(a) percentuali da revenueConfig", revenueConfig.agencyCommissionPct, 12);
eq("(a) percentuale AURA da revenueConfig", revenueConfig.platformCommissionPct, 3);

// ── (b) Parsing dell'intent di esempio ─────────────────────────────────────

const intent = parseBookingIntent(
  "Prenotami la Classe V per 5 persone domani alle 10",
  catalog,
  NOW,
);
eq("(b) è una richiesta di servizio", intent.isBooking, true);
eq("(b) categoria", intent.requestedCategory, "van");
eq("(b) veicolo", intent.vehicle?.label, "Mercedes Classe V");
eq("(b) passeggeri", intent.pax, 5);
eq("(b) orario", intent.trip.time, "10:00");
eq("(b) data (domani)", intent.trip.date, "2026-07-18");
eq("(b) etichetta data", intent.trip.dateLabel, "domani");

const plan = planBookingReply(intent, catalog);
eq("(b) esito booking", plan.kind, "booking");
if (plan.kind === "booking") {
  eq("(b) veicolo nella card", plan.quote.vehicleLabel, "Mercedes Classe V");
  // Nessun bagaglio citato → il tool quota 0 bagagli: 150 + 15×(5−2) = 195.
  eq("(b) bagagli non citati", plan.quote.luggage, 0);
  eq("(b) totale nella card dal tool", plan.quote.total, 195);
  eq("(b) fornitore nella card", plan.quote.supplierName, "Fornitore Test");
  check(
    "(b) nessun prezzo in testo libero",
    !/€|\beuro\b|\d+[.,]\d{2}/i.test(plan.content),
    plan.content,
  );
}

// Parametri mancanti: chiede SOLO ciò che manca, elencando le opzioni reali.
const noPax = parseBookingIntent("Vorrei un trasferimento in SUV", catalog, NOW);
const noPaxPlan = planBookingReply(noPax, catalog);
eq("(b) senza pax → clarify", noPaxPlan.kind, "clarify");
if (noPaxPlan.kind === "clarify") {
  eq("(b) manca solo il pax", noPaxPlan.missing.join(","), "pax");
  check(
    "(b) la domanda cita il veicolo reale",
    noPaxPlan.content.includes("Mercedes GLS 450"),
    noPaxPlan.content,
  );
}

const noVehicle = parseBookingIntent("Mi serve un transfer domani alle 9", catalog, NOW);
const noVehiclePlan = planBookingReply(noVehicle, catalog);
eq("(b) senza veicolo → clarify", noVehiclePlan.kind, "clarify");
if (noVehiclePlan.kind === "clarify") {
  eq("(b) manca solo il veicolo", noVehiclePlan.missing.join(","), "vehicle");
  check(
    "(b) elenca le opzioni reali della villa",
    noVehiclePlan.content.includes("Mercedes Classe V") &&
      noVehiclePlan.content.includes("Mercedes GLS 450"),
    noVehiclePlan.content,
  );
}

const notBooking = parseBookingIntent("Grazie mille, tutto perfetto", catalog, NOW);
eq("(b) messaggio non di servizio", notBooking.isBooking, false);
eq("(b) non di servizio → nessun piano", planBookingReply(notBooking, catalog).kind, "none");

// ── (c) Categoria assente: supercar ────────────────────────────────────────

const supercar = parseBookingIntent("Prenotami una supercar per 2 persone domani alle 15", catalog, NOW);
eq("(c) categoria riconosciuta", supercar.requestedCategory, "supercar");
const supercarPlan = planBookingReply(supercar, catalog);
eq("(c) esito unavailable", supercarPlan.kind, "unavailable");
if (supercarPlan.kind === "unavailable") {
  check(
    "(c) dichiara la non disponibilità",
    /non è disponibile/i.test(supercarPlan.content),
    supercarPlan.content,
  );
  check(
    "(c) propone le alternative reali",
    supercarPlan.content.includes("Mercedes Classe V") &&
      supercarPlan.content.includes("Mercedes GLS 450"),
    supercarPlan.content,
  );
  eq("(c) alternative reali (2)", supercarPlan.alternatives.length, 2);
}
check(
  "(c) nessuna card generata",
  supercarPlan.kind !== "booking" && !("quote" in supercarPlan),
);

// Anche una categoria presente nel catalogo ma senza veicoli attivi è assente.
const emptyHeliCatalog: FleetCatalog = { ...catalog, categories: catalog.categories };
const heli = parseBookingIntent("Vorrei un elicottero per 2 persone", emptyHeliCatalog, NOW);
eq("(c) elicottero assente → unavailable", planBookingReply(heli, emptyHeliCatalog).kind, "unavailable");

// ── (d) Mapping dei campi dell'INSERT ──────────────────────────────────────

const payload = buildChatBookingPayload(quote, { date: "2026-07-18", dateLabel: "domani", time: "10:00" });
check("(d) service_label cita il veicolo", payload.serviceLabel.includes("Mercedes Classe V"), payload.serviceLabel);
eq("(d) service_label tipo", payload.serviceLabel.startsWith("Trasferimento —"), true);
eq("(d) price = totale del tool", payload.price, 215);
eq("(d) agency_commission", payload.agencyCommission, 25.8);
eq("(d) platform_commission", payload.platformCommission, 6.45);
eq("(d) agency_pct", payload.agencyPct, 12);
eq("(d) aura_pct", payload.auraPct, 3);
eq("(d) details.channel", payload.details.channel, "chat");
eq("(d) details.category", payload.details.category, "transfer");
eq("(d) details.vehicleId", payload.details.vehicleId, "veh-classe-v");
eq("(d) details.vehicleLabel", payload.details.vehicleLabel, "Mercedes Classe V");
eq("(d) details.vehicleCategory", payload.details.vehicleCategory, "van");
eq("(d) details.vehicleSupplier", payload.details.vehicleSupplier, "Fornitore Test");
eq("(d) details.pax", payload.details.pax, 5);
eq("(d) details.passengers", payload.details.passengers, 5);
eq("(d) details.luggage", payload.details.luggage, 4);
eq("(d) details.time", payload.details.time, "10:00");
eq("(d) details.date", payload.details.date, "2026-07-18");
eq("(d) details.dateLabel", payload.details.dateLabel, "domani");
eq("(d) details.total", payload.details.total, 215);
eq("(d) details.vehicleQuote è il preventivo del tool", payload.details.vehicleQuote?.total, quote.total);
eq(
  "(d) il totale della richiesta viene solo dal tool",
  payload.price,
  calculate_service_quote("veh-classe-v", { pax: 5, luggage: 4 }, catalog.vehicles)?.total,
);

console.log(`✓ test-chat-agent: ${checks} controlli superati`);
process.exit(0);

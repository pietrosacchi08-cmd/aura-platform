/**
 * AURA — QA deterministica dell'agente chat Concierge.
 *
 *   bun scripts/test-chat-agent.ts
 *
 * Verifica le funzioni PURE (nessun DOM, nessuna rete):
 *   (a) quote math con supplementi pax/bagagli e split 12/3 esatto (round2)
 *   (b) parsing dell'intent di esempio → veicolo/categoria, pax, data, ora
 *   (c) categoria/servizio assente → "non disponibile" + alternative, no card
 *   (d) mapping dei campi dell'INSERT (service_label, price, commissioni, details)
 *   (e) parametri mancanti per OGNI servizio → chiede solo quelli, nessuna card
 *   (f) richiesta completa per OGNI servizio → card con totale dal calcolatore
 *   (g) articoli italiani corretti in tutte le frasi campione (mai "La Elicottero")
 *
 * Exit 0 = tutto verde. Esce 1 al primo controllo fallito.
 */
import { conciergeServices, round2, revenueConfig } from "../src/data/config";
import {
  chefQuote,
  wellnessQuote,
  yachtQuote,
  type ChefDetails,
  type TransferDetails,
  type WellnessDetails,
  type YachtDetails,
} from "../src/data/serviceDetails";
import { calculate_service_quote, type FleetCatalog, type FleetVehicle } from "../src/lib/fleet";
import {
  buildChatBookingPayload,
  parseBookingIntent,
  planBookingReply,
  type ChatBookingDetails,
} from "../src/lib/chatAgent";
import { italianArticle, withArticle } from "../src/lib/grammar";
import { formatEUR } from "../src/lib/format";

// ── Fixture: una villa con un van (Classe V), un SUV e un elicottero ────────

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
const HELI = vehicle({
  id: "veh-heli",
  label: "Airbus H130",
  category: "helicopter",
  basePrice: 1800,
  extraPaxSurcharge: 120,
  maxPax: 6,
});

const catalog: FleetCatalog = {
  villaId: "villa-test",
  source: "fallback",
  categories: [
    { category: "suv", label: "SUV con autista", vehicles: [SUV] },
    { category: "van", label: "Van con autista", vehicles: [VAN] },
    { category: "helicopter", label: "Elicottero", vehicles: [HELI] },
  ],
  vehicles: [SUV, VAN, HELI],
};

/** Catalogo senza elicottero: serve al caso "aviation non disponibile". */
const noHeliCatalog: FleetCatalog = {
  ...catalog,
  categories: catalog.categories.filter((group) => group.category !== "helicopter"),
  vehicles: catalog.vehicles.filter((v) => v.category !== "helicopter"),
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

/** Ogni frase prodotta dall'agente, per il controllo grammaticale finale. */
const phrases: string[] = [];
const plan = (text: string, cat: FleetCatalog = catalog, services = conciergeServices) => {
  const reply = planBookingReply(parseBookingIntent(text, cat, NOW), cat, services);
  if ("content" in reply) phrases.push(reply.content);
  return reply;
};

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
eq("(b) servizio", intent.service, "transfer");
eq("(b) categoria", intent.requestedCategory, "van");
eq("(b) veicolo", intent.vehicle?.label, "Mercedes Classe V");
eq("(b) passeggeri", intent.pax, 5);
eq("(b) orario", intent.trip.time, "10:00");
eq("(b) data (domani)", intent.trip.date, "2026-07-18");
eq("(b) etichetta data", intent.trip.dateLabel, "domani");

const planB = plan("Prenotami la Classe V per 5 persone domani alle 10");
eq("(b) esito booking", planB.kind, "booking");
if (planB.kind === "booking") {
  eq("(b) veicolo nella card", planB.quote.title, "Mercedes Classe V");
  // Nessun bagaglio citato → il tool quota 0 bagagli: 150 + 15×(5−2) = 195.
  eq("(b) totale nella card dal tool", planB.quote.total, 195);
  eq("(b) fornitore nella card", planB.quote.subtitle.startsWith("Fornitore Test"), true);
  check(
    "(b) nessun prezzo in testo libero",
    !/€|\beuro\b|\d+[.,]\d{2}/i.test(planB.content),
    planB.content,
  );
}

// Parametri mancanti: chiede SOLO ciò che manca, elencando le opzioni reali.
const noPaxPlan = plan("Vorrei un trasferimento in SUV");
eq("(b) senza pax → clarify", noPaxPlan.kind, "clarify");
if (noPaxPlan.kind === "clarify") {
  eq("(b) manca solo il pax", noPaxPlan.missing.join(","), "pax");
  check(
    "(b) la domanda cita il veicolo reale",
    noPaxPlan.content.includes("Mercedes GLS 450"),
    noPaxPlan.content,
  );
}

const noVehiclePlan = plan("Mi serve un transfer domani alle 9");
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

// ── (c) Servizio/categoria assente ────────────────────────────────────────

const supercarPlan = plan("Prenotami una supercar per 2 persone domani alle 15");
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
}
check("(c) nessuna card per la supercar", supercarPlan.kind !== "booking" && !("quote" in supercarPlan));

// Aviation: la villa non ha elicotteri in flotta → non disponibile, no card.
const noHeliPlan = plan("Vorrei un elicottero da Milano a Porto Cervo domani alle 10 per 2 persone", noHeliCatalog);
eq("(c) aviation assente → unavailable", noHeliPlan.kind, "unavailable");
if (noHeliPlan.kind === "unavailable") {
  check(
    "(c) nomina l'elicottero con l'articolo giusto",
    noHeliPlan.content.includes("L'elicottero non è disponibile"),
    noHeliPlan.content,
  );
  check(
    "(c) elenca le alternative reali della flotta",
    noHeliPlan.content.includes("Mercedes Classe V"),
    noHeliPlan.content,
  );
}

// Chef non offerto dalla villa → non disponibile, alternative reali, no card.
const chefOnlyServices = conciergeServices.filter((service) => service.id !== "catering");
const noChefPlan = plan("Vorrei uno chef per cena per 6 ospiti", catalog, chefOnlyServices);
eq("(c) chef assente → unavailable", noChefPlan.kind, "unavailable");
if (noChefPlan.kind === "unavailable") {
  check(
    "(c) il servizio assente è dichiarato",
    /non è disponibile/i.test(noChefPlan.content),
    noChefPlan.content,
  );
  check(
    "(c) elenca i servizi davvero attivi",
    noChefPlan.content.includes("Yacht & Boat Charter") &&
      noChefPlan.content.includes("Wellness & Spa"),
    noChefPlan.content,
  );
  check("(c) nessuna card per lo chef assente", !("quote" in noChefPlan));
}

// ── (e) Parametri mancanti per ogni servizio: nessun default, nessuna card ─

const chefIncomplete = plan("Vorrei uno chef domani");
eq("(e) chef incompleto → clarify", chefIncomplete.kind, "clarify");
if (chefIncomplete.kind === "clarify") {
  eq("(e) chef: mancano pasto e ospiti", chefIncomplete.missing.join(","), "meal,guests");
  check(
    "(e) chef: chiede solo quei due parametri",
    /pasto/i.test(chefIncomplete.content) && /ospiti/i.test(chefIncomplete.content),
    chefIncomplete.content,
  );
  check("(e) chef: nessuna card", !("quote" in chefIncomplete));
}

const yachtIncomplete = plan("Vorrei uno yacht");
eq("(e) yacht incompleto → clarify", yachtIncomplete.kind, "clarify");
if (yachtIncomplete.kind === "clarify") {
  eq("(e) yacht: mancano giorno e durata", yachtIncomplete.missing.join(","), "date,duration");
  check(
    "(e) yacht: nessuna card",
    !("quote" in yachtIncomplete),
    yachtIncomplete.content,
  );
}

const wellnessIncomplete = plan("Vorrei un trattamento wellness in villa");
eq("(e) wellness incompleto → clarify", wellnessIncomplete.kind, "clarify");
if (wellnessIncomplete.kind === "clarify") {
  eq("(e) wellness: manca il trattamento", wellnessIncomplete.missing.join(","), "treatment");
  check("(e) wellness: nessuna card", !("quote" in wellnessIncomplete));
}

const aviationIncomplete = plan("Vorrei un elicottero");
eq("(e) aviation incompleto → clarify", aviationIncomplete.kind, "clarify");
if (aviationIncomplete.kind === "clarify") {
  eq(
    "(e) aviation: mancano tratta, giorno, orario, passeggeri",
    aviationIncomplete.missing.join(","),
    "route,date,time,pax",
  );
  check("(e) aviation: nessuna card", !("quote" in aviationIncomplete));
}

// ── (f) Richiesta completa: card con il totale del calcolatore reale ──────

const chefPlan = plan("Vorrei uno chef per cena per 6 ospiti domani");
eq("(f) chef completo → booking", chefPlan.kind, "booking");
if (chefPlan.kind === "booking") {
  const expected = chefQuote({ meal: "dinner", guests: 6 });
  eq("(f) chef: totale dal calcolatore", chefPlan.quote.total, expected.total);
  eq("(f) chef: totale atteso 720", chefPlan.quote.total, 720);
  eq("(f) chef: servizio", chefPlan.quote.service, "chef");
  eq("(f) chef: service_label", chefPlan.quote.serviceLabel, "Private Chef — Cena");
  check(
    "(f) chef: nessun prezzo in testo libero",
    !/€|\beuro\b|\d+[.,]\d{2}/i.test(chefPlan.content),
    chefPlan.content,
  );
}

const yachtPlan = plan("Vorrei noleggiare uno yacht per una giornata intera domani");
eq("(f) yacht completo → booking", yachtPlan.kind, "booking");
if (yachtPlan.kind === "booking") {
  const expected = yachtQuote({ duration: "full-day", skipper: false, fuel: false });
  eq("(f) yacht: totale dal calcolatore", yachtPlan.quote.total, expected.total);
  eq("(f) yacht: totale atteso 2400", yachtPlan.quote.total, 2400);
  eq("(f) yacht: service_label", yachtPlan.quote.serviceLabel, "Yacht & Boat Charter — Giornata Intera");
}

const wellnessPlan = plan("Vorrei un massaggio relax in villa");
eq("(f) wellness completo → booking", wellnessPlan.kind, "booking");
if (wellnessPlan.kind === "booking") {
  const expected = wellnessQuote("massage-relax");
  eq("(f) wellness: totale dal calcolatore", wellnessPlan.quote.total, expected.total);
  eq("(f) wellness: totale atteso 110", wellnessPlan.quote.total, 110);
  eq("(f) wellness: service_label", wellnessPlan.quote.serviceLabel, "Wellness & Spa — Massaggio relax");
}

const aviationPlan = plan("Vorrei un elicottero da Milano a Porto Cervo domani alle 10 per 4 persone");
eq("(f) aviation completo → booking", aviationPlan.kind, "booking");
if (aviationPlan.kind === "booking") {
  const expected = calculate_service_quote(HELI, { pax: 4, luggage: 0 }, catalog.vehicles);
  eq("(f) aviation: totale dal tool flotta", aviationPlan.quote.total, expected?.total);
  eq("(f) aviation: totale atteso 2040", aviationPlan.quote.total, 2040);
  eq("(f) aviation: servizio", aviationPlan.quote.service, "aviation");
  eq("(f) aviation: service_label", aviationPlan.quote.serviceLabel, "Private Aviation — Airbus H130");
  check(
    "(f) aviation: la tratta è nella card",
    aviationPlan.quote.rows.some((row) => row.value === "Milano → Porto Cervo"),
    aviationPlan.quote.rows,
  );
  check(
    "(f) aviation: nessun prezzo in testo libero",
    !/€|\beuro\b|\d+[.,]\d{2}/i.test(aviationPlan.content),
    aviationPlan.content,
  );
}

// ── (d) Mapping dei campi dell'INSERT ─────────────────────────────────────

const transferPlan = plan("Prenotami la Classe V per 5 persone domani alle 10");
check("(d) il piano transfer è una booking", transferPlan.kind === "booking");
if (transferPlan.kind !== "booking") process.exit(1);
const payload = buildChatBookingPayload(transferPlan.quote, transferPlan.trip);
const transferDetails = payload.details as TransferDetails & {
  channel: string;
  pax?: number;
  date: string;
  dateLabel: string;
};
check("(d) service_label cita il veicolo", payload.serviceLabel.includes("Mercedes Classe V"), payload.serviceLabel);
eq("(d) service_label tipo", payload.serviceLabel.startsWith("Trasferimento —"), true);
eq("(d) price = totale del tool", payload.price, 195);
eq("(d) agency_commission", payload.agencyCommission, round2((195 * 12) / 100));
eq("(d) platform_commission", payload.platformCommission, round2((195 * 3) / 100));
eq("(d) agency_pct", payload.agencyPct, 12);
eq("(d) aura_pct", payload.auraPct, 3);
eq("(d) details.channel", transferDetails.channel, "chat");
eq("(d) details.category", transferDetails.category, "transfer");
eq("(d) details.vehicleId", transferDetails.vehicleId, "veh-classe-v");
eq("(d) details.vehicleLabel", transferDetails.vehicleLabel, "Mercedes Classe V");
eq("(d) details.vehicleCategory", transferDetails.vehicleCategory, "van");
eq("(d) details.vehicleSupplier", transferDetails.vehicleSupplier, "Fornitore Test");
eq("(d) details.pax", transferDetails.pax, 5);
eq("(d) details.passengers", transferDetails.passengers, 5);
eq("(d) details.luggage", transferDetails.luggage, 0);
eq("(d) details.time", transferDetails.time, "10:00");
eq("(d) details.date", transferDetails.date, "2026-07-18");
eq("(d) details.dateLabel", transferDetails.dateLabel, "domani");
eq("(d) details.total", transferDetails.total, 195);
eq("(d) details.vehicleQuote è il preventivo del tool", transferDetails.vehicleQuote?.total, 195);

// Chef: details nella forma del modal + channel/date + 12/3.
if (chefPlan.kind === "booking") {
  const chefPayload = buildChatBookingPayload(chefPlan.quote, chefPlan.trip);
  const chefDetailsOut = chefPayload.details as ChefDetails &
    ChatBookingDetails;
  eq("(d) chef: price = totale del calcolatore", chefPayload.price, 720);
  eq("(d) chef: agency_commission 12%", chefPayload.agencyCommission, 86.4);
  eq("(d) chef: platform_commission 3%", chefPayload.platformCommission, 21.6);
  eq("(d) chef: details.category", chefDetailsOut.category, "chef");
  eq("(d) chef: details.meal", chefDetailsOut.meal, "dinner");
  eq("(d) chef: details.guests", chefDetailsOut.guests, 6);
  eq("(d) chef: details.pricePerGuest", chefDetailsOut.pricePerGuest, 120);
  eq("(d) chef: details.channel", chefDetailsOut.channel, "chat");
  eq("(d) chef: details.date", chefDetailsOut.date, "2026-07-18");
  eq("(d) chef: details.dateLabel", chefDetailsOut.dateLabel, "domani");
  eq("(d) chef: details.lines = righe del preventivo", chefDetailsOut.lines?.length, 1);
  eq("(d) chef: linea del preventivo", chefDetailsOut.lines?.[0]?.label, "Cena × 6 ospiti");
  eq("(d) chef: importo della linea", chefDetailsOut.lines?.[0]?.amount, 720);
}

// Yacht: details nella forma del modal.
if (yachtPlan.kind === "booking") {
  const yachtPayload = buildChatBookingPayload(yachtPlan.quote, yachtPlan.trip);
  const yachtDetailsOut = yachtPayload.details as YachtDetails & ChatBookingDetails;
  eq("(d) yacht: details.category", yachtDetailsOut.category, "yacht");
  eq("(d) yacht: details.duration", yachtDetailsOut.duration, "full-day");
  eq("(d) yacht: details.durationLabel", yachtDetailsOut.durationLabel, "Giornata Intera");
  eq("(d) yacht: details.total", yachtDetailsOut.total, 2400);
  eq("(d) yacht: details.channel", yachtDetailsOut.channel, "chat");
  eq("(d) yacht: price", yachtPayload.price, 2400);
  eq("(d) yacht: details.date", yachtDetailsOut.date, "2026-07-18");
  eq("(d) yacht: details.dateLabel", yachtDetailsOut.dateLabel, "domani");
  eq("(d) yacht: details.lines = righe del preventivo", yachtDetailsOut.lines?.length, 1);
  eq("(d) yacht: linea del preventivo", yachtDetailsOut.lines?.[0]?.label, "Giornata Intera");
  eq("(d) yacht: importo della linea", yachtDetailsOut.lines?.[0]?.amount, 2400);
}

// Wellness: details nella forma del modal.
if (wellnessPlan.kind === "booking") {
  const wellnessPayload = buildChatBookingPayload(wellnessPlan.quote, wellnessPlan.trip);
  const wellnessDetailsOut = wellnessPayload.details as WellnessDetails &
    ChatBookingDetails;
  eq("(d) wellness: details.category", wellnessDetailsOut.category, "wellness");
  eq("(d) wellness: details.treatmentId", wellnessDetailsOut.treatmentId, "massage-relax");
  eq("(d) wellness: details.price", wellnessDetailsOut.price, 110);
  eq("(d) wellness: details.channel", wellnessDetailsOut.channel, "chat");
  eq("(d) wellness: price", wellnessPayload.price, 110);
  eq("(d) wellness: details.lines = righe del preventivo", wellnessDetailsOut.lines?.length, 1);
  eq("(d) wellness: linea del preventivo", wellnessDetailsOut.lines?.[0]?.label, "Massaggio relax");
  eq("(d) wellness: importo della linea", wellnessDetailsOut.lines?.[0]?.amount, 110);
}

// Aviation: details del transfer (modalità elicottero) + tratta.
if (aviationPlan.kind === "booking") {
  const aviationPayload = buildChatBookingPayload(aviationPlan.quote, aviationPlan.trip);
  const aviationDetails = aviationPayload.details as TransferDetails & { channel: string };
  eq("(d) aviation: details.category", aviationDetails.category, "transfer");
  eq("(d) aviation: details.mode", aviationDetails.mode, "helicopter");
  eq("(d) aviation: details.from", aviationDetails.from, "Milano");
  eq("(d) aviation: details.to", aviationDetails.to, "Porto Cervo");
  eq("(d) aviation: details.passengers", aviationDetails.passengers, 4);
  eq("(d) aviation: details.total", aviationDetails.total, 2040);
  eq("(d) aviation: details.channel", aviationDetails.channel, "chat");
  eq("(d) aviation: price", aviationPayload.price, 2040);
}

// ── (h) Orario e voci del preventivo persistiti per i servizi di villa ──
// Lo staff deve vedere orario e preventivo di chef/yacht/wellness senza
// ricalcolarli: qui si verifica che finiscano davvero nel JSONB `details`.

const chefTimedPlan = plan("Vorrei uno chef per cena per 6 ospiti domani alle 20:30");
eq("(h) chef con orario → booking", chefTimedPlan.kind, "booking");
if (chefTimedPlan.kind === "booking") {
  eq("(h) chef: orario letto dall'intent", chefTimedPlan.trip.time, "20:30");
  const chefTimedPayload = buildChatBookingPayload(chefTimedPlan.quote, chefTimedPlan.trip);
  const chefTimedDetails = chefTimedPayload.details as ChefDetails & ChatBookingDetails;
  eq("(h) chef: details.time salvato", chefTimedDetails.time, "20:30");
  eq("(h) chef: details.date", chefTimedDetails.date, "2026-07-18");
  eq("(h) chef: details.dateLabel", chefTimedDetails.dateLabel, "domani");
  eq("(h) chef: lines è una riga", chefTimedDetails.lines?.length, 1);
  eq("(h) chef: lines[0].label", chefTimedDetails.lines?.[0]?.label, "Cena × 6 ospiti");
  eq("(h) chef: lines[0].amount = totale", chefTimedDetails.lines?.[0]?.amount, 720);
  eq("(h) chef: lines sommano al prezzo", chefTimedDetails.lines?.[0]?.amount, chefTimedPayload.price);
}

const yachtTimedPlan = plan(
  "Vorrei noleggiare uno yacht per una giornata intera domani alle 10:00",
);
eq("(h) yacht con orario → booking", yachtTimedPlan.kind, "booking");
if (yachtTimedPlan.kind === "booking") {
  const yachtTimedPayload = buildChatBookingPayload(yachtTimedPlan.quote, yachtTimedPlan.trip);
  const yachtTimedDetails = yachtTimedPayload.details as YachtDetails & ChatBookingDetails;
  eq("(h) yacht: details.time salvato", yachtTimedDetails.time, "10:00");
  eq("(h) yacht: details.departureTime invariato", yachtTimedDetails.departureTime, "10:00");
  eq("(h) yacht: details.dateLabel", yachtTimedDetails.dateLabel, "domani");
  eq("(h) yacht: lines[0].amount = totale", yachtTimedDetails.lines?.[0]?.amount, 2400);
  eq("(h) yacht: lines sommano al prezzo", yachtTimedDetails.lines?.[0]?.amount, yachtTimedPayload.price);
}

const wellnessTimedPlan = plan("Vorrei un massaggio relax domani alle 15:00");
eq("(h) wellness con orario → booking", wellnessTimedPlan.kind, "booking");
if (wellnessTimedPlan.kind === "booking") {
  const wellnessTimedPayload = buildChatBookingPayload(
    wellnessTimedPlan.quote,
    wellnessTimedPlan.trip,
  );
  const wellnessTimedDetails = wellnessTimedPayload.details as WellnessDetails &
    ChatBookingDetails;
  eq("(h) wellness: details.time salvato", wellnessTimedDetails.time, "15:00");
  eq("(h) wellness: details.dateLabel", wellnessTimedDetails.dateLabel, "domani");
  eq("(h) wellness: lines[0].label", wellnessTimedDetails.lines?.[0]?.label, "Massaggio relax");
  eq("(h) wellness: lines[0].amount = totale", wellnessTimedDetails.lines?.[0]?.amount, 110);
  eq("(h) wellness: lines sommano al prezzo", wellnessTimedDetails.lines?.[0]?.amount, wellnessTimedPayload.price);
}

// ── (i) Importi: separatore delle migliaia in stile italiano ──

eq("(i) formatEUR(2400)", formatEUR(2400), "2.400,00");
eq("(i) formatEUR(480)", formatEUR(480), "480,00");
eq("(i) formatEUR(1500.5)", formatEUR(1500.5), "1.500,50");

// ── (g) Grammatica: una sola funzione, nessuna concatenazione sbagliata ───

eq("(g) articolo elicottero", italianArticle("Elicottero"), "l'");
eq("(g) L'elicottero", withArticle("Elicottero", { sentenceStart: true }), "L'elicottero");
eq("(g) la supercar", withArticle("Supercar"), "la supercar");
eq("(g) lo yacht", withArticle("Yacht"), "lo yacht");
eq("(g) lo chef privato", withArticle("Chef privato"), "lo chef privato");
eq("(g) il SUV", withArticle("SUV con autista"), "il SUV con autista");
eq("(g) la berlina", withArticle("Berlina con autista"), "la berlina con autista");
eq("(g) il van", withArticle("Van con autista"), "il van con autista");
eq("(g) il wellness", withArticle("Wellness"), "il wellness");
eq("(g) inglese: the helicopter", withArticle("helicopter", { language: "en" }), "the helicopter");
eq(
  "(g) inglese con maiuscola",
  withArticle("Helicopter", { language: "en", sentenceStart: true }),
  "The helicopter",
);

for (const phrase of phrases) {
  check(
    "(g) nessun articolo sbagliato nelle frasi dell'agente",
    !/\b(?:La|Lo|Il)\s+(?:Elicottero|Supercar|Yacht|Wellness)\b/.test(phrase) &&
      !/\bLa\s+[AEIOU]/.test(phrase),
    phrase,
  );
}
check(
  "(g) l'elicottero compare con l'articolo corretto",
  phrases.some((phrase) => phrase.includes("L'elicottero")),
  phrases.filter((phrase) => /elicottero/i.test(phrase)),
);

console.log(`✓ test-chat-agent: ${checks} controlli superati`);
process.exit(0);

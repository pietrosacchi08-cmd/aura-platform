/**
 * AURA service request modals — one interactive form per service category.
 *
 * The Services tab opens one of these instead of the generic "On Request"
 * booking modal:
 *   • Boat Charter / Private Yacht  → duration, departure time, skipper/fuel extras
 *   • Private Chef                  → meal, guests, dietary preferences
 *   • Luxury Transfer / Helicopter  → route, time, passengers, luggage
 *   • Wellness & Spa                → treatment, preferred date and time
 *
 * Every modal shows the full cost breakdown and a LIVE "TOTALE ESTIMATO" before
 * the guest presses "Conferma e Invia Richiesta". The estimate is an estimate:
 * the disclaimer says so, and the staff confirm the final amount.
 *
 * All rates live in src/data/config.ts (servicePricing); all maths lives in
 * src/data/serviceDetails.ts. This file is UI only.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { servicePricing } from "../data/config";
import {
  CHEF_MEAL_LABELS,
  ESTIMATE_DISCLAIMER,
  TRANSFER_MODE_LABELS,
  YACHT_DURATION_LABELS,
  chefDetails,
  chefQuote,
  clampInt,
  formatEuroIt,
  matchServiceCategory,
  serviceDetailsSummary,
  transferDetails,
  transferQuote,
  wellnessDetails,
  wellnessQuote,
  yachtDetails,
  yachtQuote,
  type ChefMeal,
  type Quote,
  type ServiceDetails,
  type TransferMode,
  type YachtDuration,
} from "../data/serviceDetails";

// ── Contract with the Services tab ──────────────────────────────────────────

/** The catalogue entry a modal is opened for (only the fields it needs). */
export interface ModalService {
  id: string;
  title: string;
  subtitle: string;
  price: string;
}

/** What the modal hands back when the guest confirms. */
export interface ServiceSubmitPayload {
  /** Catalogue service name recorded on the request. */
  serviceType: string;
  /** Structured choices → jsonb `details`. */
  details: ServiceDetails;
  /** Estimated total → `price`. */
  price: number;
  /** One-line Italian summary for the staff task feed. */
  summary: string;
}

export interface ServiceModalProps {
  service: ModalService;
  /** Active villa name — prefilled as the transfer pickup point. */
  propertyName: string;
  onClose: () => void;
  onSubmit: (payload: ServiceSubmitPayload) => void;
}

// ── Shared styling ──────────────────────────────────────────────────────────

const ACCENT = "var(--aura-accent, #D4AF37)";
const labelClass =
  "text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted";
const inputClass =
  "mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 text-sm font-light text-text-primary outline-none transition-colors duration-200 focus:border-[var(--aura-accent,#D4AF37)]";
const inputStyle = { backgroundColor: "rgba(11,11,11,0.75)" } as const;
const goldButtonClass =
  "w-full cursor-pointer rounded-lg border border-[var(--aura-accent,#D4AF37)] px-4 py-3 text-sm font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight";
const ghostButtonClass =
  "w-full cursor-pointer rounded-lg border border-border px-4 py-3 text-sm font-light tracking-wider text-text-secondary transition-colors duration-300 hover:border-[var(--aura-accent,#D4AF37)] hover:text-[var(--aura-accent,#D4AF37)]";

// ── Small building blocks ───────────────────────────────────────────────────

/** Fade-out-then-close helper shared by every modal. */
function useModalClose(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 180);
  }, [onClose]);
  return { closing, close };
}

/** Backdrop + card, with the app's slide-up / fade-out motion. */
function ModalShell({
  title,
  subtitle,
  propertyName,
  closing,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  propertyName: string;
  closing: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes the modal (keyboard parity with the backdrop click).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10 ${
        closing ? "pointer-events-none animate-fade-out" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div
        className={`relative z-10 w-full max-w-lg rounded-2xl border border-border p-6 md:p-8 ${
          closing ? "animate-fade-out" : "animate-slide-up"
        }`}
        style={{ backgroundColor: "var(--aura-card, #1A1A1A)" }}
      >
        <div className="mb-6">
          <p className={labelClass}>Richiesta servizio</p>
          <h3
            className="mt-2 text-xl font-light tracking-wide md:text-2xl"
            style={{ color: ACCENT }}
          >
            {title}
          </h3>
          <p className="mt-1 text-xs font-light text-text-secondary">{subtitle}</p>
          <p className="mt-1 text-[10px] font-light text-text-muted">{propertyName}</p>
          <div className="mt-4 h-px w-16" style={{ backgroundColor: ACCENT }} />
        </div>
        {children}
      </div>
    </div>
  );
}

/** A labelled form field. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** One selectable option in a segmented choice. */
function ChoicePill({
  active,
  onClick,
  label,
  note,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-center transition-all duration-200 ${
        active
          ? "bg-[var(--aura-accent,#D4AF37)] text-midnight"
          : "text-text-secondary hover:text-[var(--aura-accent,#D4AF37)]"
      }`}
      style={{
        borderColor: active ? ACCENT : "var(--color-border, #2A2A2A)",
      }}
    >
      <span className="block text-xs font-medium tracking-wide">{label}</span>
      {note && (
        <span
          className={`mt-0.5 block text-[10px] font-light ${
            active ? "text-midnight/80" : "text-text-muted"
          }`}
        >
          {note}
        </span>
      )}
    </button>
  );
}

/** A numeric −/+ stepper with a directly editable value. */
function Stepper({
  id,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const step = (delta: number) => onChange(clampInt(value + delta, min, max));
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= min}
        aria-label="Diminuisci"
        className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-border text-lg font-light text-text-secondary transition-colors duration-200 hover:border-[var(--aura-accent,#D4AF37)] hover:text-[var(--aura-accent,#D4AF37)] disabled:cursor-not-allowed disabled:opacity-30"
        style={inputStyle}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clampInt(Number(e.target.value), min, max))}
        className="h-10 w-full rounded-lg border border-border px-3 text-center text-sm font-light text-text-primary outline-none transition-colors duration-200 focus:border-[var(--aura-accent,#D4AF37)]"
        style={inputStyle}
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= max}
        aria-label="Aumenta"
        className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-border text-lg font-light text-text-secondary transition-colors duration-200 hover:border-[var(--aura-accent,#D4AF37)] hover:text-[var(--aura-accent,#D4AF37)] disabled:cursor-not-allowed disabled:opacity-30"
        style={inputStyle}
      >
        +
      </button>
    </div>
  );
}

/** A row with a switch, used for the yacht extras. */
function ToggleRow({
  label,
  amount,
  checked,
  onChange,
}: {
  label: string;
  amount: number;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-3 text-left transition-colors duration-200 hover:border-[var(--aura-accent,#D4AF37)]"
      style={inputStyle}
    >
      <span>
        <span className="block text-xs font-light tracking-wide text-text-primary">
          {label}
        </span>
        <span className="mt-0.5 block text-[10px] font-light text-text-muted">
          + {formatEuroIt(amount)}
        </span>
      </span>
      <span
        className="relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200"
        style={{
          borderColor: checked ? ACCENT : "var(--color-border, #2A2A2A)",
          backgroundColor: checked ? ACCENT : "transparent",
        }}
      >
        <span
          className="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200"
          style={{
            left: checked ? "18px" : "2px",
            backgroundColor: checked ? "#0B0B0B" : "#6B6B6B",
          }}
        />
      </span>
    </button>
  );
}

/** The live cost breakdown every modal ends with. */
function CostSummary({ quote, footnote }: { quote: Quote; footnote?: string }) {
  return (
    <div
      className="rounded-xl border border-border px-4 py-4"
      style={{ backgroundColor: "rgba(11,11,11,0.6)" }}
    >
      <p className={labelClass}>Riepilogo costo</p>
      <div className="mt-3 space-y-2">
        {quote.lines.map((line) => (
          <div
            key={line.label}
            className="flex items-start justify-between gap-3 text-[11px] font-light"
          >
            <span className="text-text-secondary">
              {line.label}
              {line.detail && (
                <span className="ml-1 text-text-muted">· {line.detail}</span>
              )}
            </span>
            <span className="shrink-0 tracking-wide text-text-primary">
              {formatEuroIt(line.amount)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
          TOTALE ESTIMATO
        </span>
        <span className="text-lg font-light tracking-wide" style={{ color: ACCENT }}>
          {formatEuroIt(quote.total)}
        </span>
      </div>
      <p className="mt-2 text-[10px] font-light leading-relaxed text-text-muted/70">
        {ESTIMATE_DISCLAIMER}
        {footnote ? ` — ${footnote}` : ""}
      </p>
    </div>
  );
}

/** Confirm / cancel pair. */
function ModalActions({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button type="button" onClick={onCancel} className={ghostButtonClass}>
        Annulla
      </button>
      <button type="button" onClick={onSubmit} className={goldButtonClass}>
        Conferma e Invia Richiesta
      </button>
    </div>
  );
}

// ── 1. Boat charter / private yacht ─────────────────────────────────────────

function YachtForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (details: ServiceDetails) => void;
  onCancel: () => void;
}) {
  const [duration, setDuration] = useState<YachtDuration>("half-day");
  const [departureTime, setDepartureTime] = useState("10:00");
  const [skipper, setSkipper] = useState(false);
  const [fuel, setFuel] = useState(false);
  const quote = yachtQuote({ duration, skipper, fuel });
  const { yacht } = servicePricing;

  return (
    <div className="space-y-5">
      <Field label="Durata">
        <div className="mt-1.5 flex gap-2">
          {(["half-day", "full-day"] as YachtDuration[]).map((option) => (
            <ChoicePill
              key={option}
              active={duration === option}
              onClick={() => setDuration(option)}
              label={YACHT_DURATION_LABELS[option]}
              note={formatEuroIt(
                option === "full-day" ? yacht.fullDay : yacht.halfDay,
              )}
            />
          ))}
        </div>
      </Field>

      <Field label="Orario di partenza" htmlFor="yacht-departure">
        <input
          id="yacht-departure"
          type="time"
          value={departureTime}
          onChange={(e) => setDepartureTime(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      <Field label="Opzioni a bordo">
        <div className="mt-1.5 space-y-2">
          <ToggleRow
            label="Skipper incluso"
            amount={yacht.skipper}
            checked={skipper}
            onChange={setSkipper}
          />
          <ToggleRow
            label="Carburante incluso"
            amount={yacht.fuel}
            checked={fuel}
            onChange={setFuel}
          />
        </div>
      </Field>

      <CostSummary quote={quote} />
      <ModalActions
        onCancel={onCancel}
        onSubmit={() =>
          onSubmit(yachtDetails({ duration, departureTime, skipper, fuel }))
        }
      />
    </div>
  );
}

// ── 2. Private chef ─────────────────────────────────────────────────────────

function ChefForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (details: ServiceDetails) => void;
  onCancel: () => void;
}) {
  const [meal, setMeal] = useState<ChefMeal>("dinner");
  const [guests, setGuests] = useState(servicePricing.chef.defaultGuests);
  const [dietary, setDietary] = useState("");
  const quote = chefQuote({ meal, guests });
  const { chef } = servicePricing;
  const mealPrices: Record<ChefMeal, number> = {
    breakfast: chef.breakfast,
    lunch: chef.lunch,
    dinner: chef.dinner,
  };

  return (
    <div className="space-y-5">
      <Field label="Tipo di pasto">
        <div className="mt-1.5 flex gap-2">
          {(["breakfast", "lunch", "dinner"] as ChefMeal[]).map((option) => (
            <ChoicePill
              key={option}
              active={meal === option}
              onClick={() => setMeal(option)}
              label={CHEF_MEAL_LABELS[option]}
              note={`${formatEuroIt(mealPrices[option])}/ospite`}
            />
          ))}
        </div>
      </Field>

      <Field label="Numero di ospiti" htmlFor="chef-guests">
        <Stepper
          id="chef-guests"
          value={guests}
          min={chef.minGuests}
          max={chef.maxGuests}
          onChange={setGuests}
        />
      </Field>

      <Field label="Preferenze alimentari" htmlFor="chef-dietary">
        <textarea
          id="chef-dietary"
          rows={2}
          value={dietary}
          onChange={(e) => setDietary(e.target.value)}
          placeholder="Allergie, intolleranze, richieste particolari…"
          className={`${inputClass} resize-none`}
          style={inputStyle}
        />
      </Field>

      <CostSummary quote={quote} />
      <ModalActions
        onCancel={onCancel}
        onSubmit={() => onSubmit(chefDetails({ meal, guests, dietary }))}
      />
    </div>
  );
}

// ── 3. Luxury transfer / helicopter ─────────────────────────────────────────

function TransferForm({
  initialMode,
  propertyName,
  onSubmit,
  onCancel,
}: {
  initialMode: TransferMode;
  propertyName: string;
  onSubmit: (details: ServiceDetails) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<TransferMode>(initialMode);
  const [from, setFrom] = useState(propertyName);
  const [to, setTo] = useState("");
  const [time, setTime] = useState("10:00");
  const [passengers, setPassengers] = useState(
    initialMode === "helicopter"
      ? servicePricing.helicopter.defaultPassengers
      : servicePricing.transfer.defaultPassengers,
  );
  const [luggage, setLuggage] = useState(2);
  const card =
    mode === "helicopter" ? servicePricing.helicopter : servicePricing.transfer;
  const quote = transferQuote({ mode, passengers });
  const maxPassengers = card.maxPassengers;

  // Switching mode resets the passenger count into the new card's range.
  const changeMode = (next: TransferMode) => {
    setMode(next);
    const nextCard =
      next === "helicopter" ? servicePricing.helicopter : servicePricing.transfer;
    setPassengers((prev) => clampInt(prev, 1, nextCard.maxPassengers));
  };

  return (
    <div className="space-y-5">
      <Field label="Servizio">
        <div className="mt-1.5 flex gap-2">
          {(["transfer", "helicopter"] as TransferMode[]).map((option) => (
            <ChoicePill
              key={option}
              active={mode === option}
              onClick={() => changeMode(option)}
              label={TRANSFER_MODE_LABELS[option]}
              note={formatEuroIt(
                option === "helicopter"
                  ? servicePricing.helicopter.base
                  : servicePricing.transfer.base,
              )}
            />
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Punto di partenza" htmlFor="transfer-from">
          <input
            id="transfer-from"
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Indirizzo o luogo"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Destinazione" htmlFor="transfer-to">
          <input
            id="transfer-to"
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Indirizzo o luogo"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Orario" htmlFor="transfer-time">
          <input
            id="transfer-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Numero passeggeri" htmlFor="transfer-passengers">
          <Stepper
            id="transfer-passengers"
            value={passengers}
            min={1}
            max={maxPassengers}
            onChange={setPassengers}
          />
        </Field>
      </div>

      <Field label="Bagagli" htmlFor="transfer-luggage">
        <Stepper
          id="transfer-luggage"
          value={luggage}
          min={0}
          max={card.maxLuggage}
          onChange={setLuggage}
        />
      </Field>

      <CostSummary quote={quote} footnote="il numero di bagagli non incide sulla stima" />
      <ModalActions
        onCancel={onCancel}
        onSubmit={() =>
          onSubmit(
            transferDetails({ mode, from, to, time, passengers, luggage }),
          )
        }
      />
    </div>
  );
}

// ── 4. Wellness & spa / personal training ───────────────────────────────────

function WellnessForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (details: ServiceDetails) => void;
  onCancel: () => void;
}) {
  const { treatments, defaultTreatmentId } = servicePricing.wellness;
  const [treatmentId, setTreatmentId] = useState(defaultTreatmentId);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  const quote = wellnessQuote(treatmentId);

  return (
    <div className="space-y-5">
      <Field label="Tipologia di trattamento">
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {treatments.map((treatment) => {
            const active = treatment.id === treatmentId;
            return (
              <button
                key={treatment.id}
                type="button"
                onClick={() => setTreatmentId(treatment.id)}
                aria-pressed={active}
                className={`cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${
                  active
                    ? "bg-[var(--aura-accent,#D4AF37)] text-midnight"
                    : "text-text-secondary hover:text-[var(--aura-accent,#D4AF37)]"
                }`}
                style={{
                  borderColor: active ? ACCENT : "var(--color-border, #2A2A2A)",
                }}
              >
                <span className="block text-xs font-medium tracking-wide">
                  {treatment.label}
                </span>
                <span
                  className={`mt-0.5 block text-[10px] font-light ${
                    active ? "text-midnight/80" : "text-text-muted"
                  }`}
                >
                  {formatEuroIt(treatment.price)}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Data preferita" htmlFor="wellness-date">
          <input
            id="wellness-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Orario preferito" htmlFor="wellness-time">
          <input
            id="wellness-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </div>

      <CostSummary quote={quote} />
      <ModalActions
        onCancel={onCancel}
        onSubmit={() => onSubmit(wellnessDetails({ treatmentId, date, time }))}
      />
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Opens the right form for a catalogue service. Services outside the four
 * categories are not handled here — the Services tab keeps its generic flow
 * for those.
 */
export function ServiceRequestModal({
  service,
  propertyName,
  onClose,
  onSubmit,
}: ServiceModalProps) {
  const { closing, close } = useModalClose(onClose);
  const [sent, setSent] = useState(false);
  const [sentSummary, setSentSummary] = useState("");
  const match = matchServiceCategory(service);

  const handleSubmit = useCallback(
    (details: ServiceDetails) => {
      onSubmit({
        serviceType: service.title,
        details,
        price: details.total,
        summary: serviceDetailsSummary(details),
      });
      setSentSummary(formatEuroIt(details.total));
      setSent(true);
    },
    [onSubmit, service.title],
  );

  const body = () => {
    if (!match) return null;
    if (sent) {
      return (
        <div className="animate-fade-in-up flex flex-col items-center space-y-4 text-center">
          <div className="animate-check-pop flex h-16 w-16 items-center justify-center rounded-full bg-[var(--aura-accent,#D4AF37)]">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0B0B0B"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p
              className="text-xl font-light tracking-wide"
              style={{ color: ACCENT }}
            >
              Richiesta inviata
            </p>
            <p className="mt-2 text-sm font-light text-text-secondary">
              {service.title}
              {sentSummary && ` · ${sentSummary}`}
            </p>
          </div>
          <p className="text-xs font-light leading-relaxed text-text-secondary">
            {ESTIMATE_DISCLAIMER}. Trovi lo stato della richiesta in 🛒 I Miei
            Servizi.
          </p>
          <button
            type="button"
            onClick={close}
            className={`mt-2 sm:w-auto sm:px-8 ${goldButtonClass}`}
          >
            Chiudi
          </button>
        </div>
      );
    }
    if (match.category === "yacht") {
      return <YachtForm onSubmit={handleSubmit} onCancel={close} />;
    }
    if (match.category === "chef") {
      return <ChefForm onSubmit={handleSubmit} onCancel={close} />;
    }
    if (match.category === "transfer") {
      return (
        <TransferForm
          initialMode={match.transferMode ?? "transfer"}
          propertyName={propertyName}
          onSubmit={handleSubmit}
          onCancel={close}
        />
      );
    }
    return <WellnessForm onSubmit={handleSubmit} onCancel={close} />;
  };

  return (
    <ModalShell
      title={service.title}
      subtitle={service.subtitle}
      propertyName={propertyName}
      closing={closing}
      onClose={close}
    >
      {body()}
    </ModalShell>
  );
}

// ── Staff-facing details panel ──────────────────────────────────────────────

/**
 * "Dettagli richiesta" — the guest's choices, labelled in Italian, shown in the
 * expandable staff row. Renders nothing when the request carries no details
 * (legacy rows, chat prompts, services outside the four categories).
 */
export function ServiceDetailsPanel({
  rows,
}: {
  rows: { label: string; value: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-border px-3 py-3"
      style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}
    >
      <p className={labelClass}>Dettagli richiesta</p>
      <dl className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3">
            <dt className="text-[11px] font-light text-text-muted">{row.label}</dt>
            <dd className="max-w-[60%] text-right text-[11px] font-light tracking-wide text-text-primary">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

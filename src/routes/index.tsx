import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { properties, type Property } from "../data/properties";
import {
  agencyConfig,
  computeSplit,
  conciergeImages,
  conciergeServices,
  revenueConfig,
  splitRequestAmounts,
  subscriptionPrice,
  type ConciergeService,
} from "../data/config";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "concierge" | "services" | "staff" | "revenue";

interface TabDef {
  id: Tab;
  label: string;
  icon: string;
}

interface TabContent {
  title: string;
  subtitle: string;
}

interface TaskItem {
  id: string;
  module: string;
  description: string;
  status: "pending" | "in_progress" | "confirmed" | "completed";
  completedAt?: string;
  assignedTo?: string;
  createdAt?: string;
}

interface ChatMessage {
  id: string;
  role: "system" | "user" | "ai";
  content: string;
  tasks?: TaskItem[];
}
// ── Guest Requests ───────────────────────────────────────────────────────────
type GuestRequestStatus =
  | "received"
  | "in_progress"
  | "confirmed"
  | "completed"
  | "cancelled";
// Money fields below are RECORDED amounts only — AURA never moves money.
// Derived amounts (agency / AURA / supplier) are never stored: they are
// computed from `price` + the two percentages with splitRequestAmounts.
interface GuestRequest {
  id: string;
  guestName: string;
  villaName: string;
  serviceType: string;
  details: string;
  status: GuestRequestStatus;
  /** Recorded price, or null while no price has been set. */
  price: number | null;
  /** Agency share of the price, in percent (default from revenueConfig). */
  agencyPct: number;
  /** AURA share of the price, in percent (default from revenueConfig). */
  auraPct: number;
  /** Free-text note written by the staff for this request. */
  staffNote: string;
  createdAt: string;
  updatedAt: string;
}
// Ordered lifecycle shown to the guest as a timeline.
const GUEST_REQUEST_STEPS: Array<Exclude<GuestRequestStatus, "cancelled">> = [
  "received",
  "in_progress",
  "confirmed",
  "completed",
];
const GUEST_REQUEST_LABELS: Record<GuestRequestStatus, string> = {
  received: "Received",
  in_progress: "In progress",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};
const GUEST_REQUEST_STATUSES: GuestRequestStatus[] = [
  "received",
  "in_progress",
  "confirmed",
  "completed",
  "cancelled",
];
/**
 * Normalise one persisted row to the current GuestRequest shape.
 * Legacy rows (written before the field rename) carried `serviceTitle` /
 * `property` and none of the money or note fields; they are upgraded with
 * defaults. Rows with no id or an unknown status are dropped (return null).
 */
function normalizeGuestRequest(raw: unknown): GuestRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id ? row.id : null;
  const status =
    typeof row.status === "string" && row.status in GUEST_REQUEST_LABELS
      ? (row.status as GuestRequestStatus)
      : null;
  if (!id || !status) return null;
  const legacy = raw as { serviceTitle?: unknown; property?: unknown };
  const serviceType =
    typeof row.serviceType === "string"
      ? row.serviceType
      : typeof legacy.serviceTitle === "string"
        ? legacy.serviceTitle
        : "Concierge request";
  const villaName =
    typeof row.villaName === "string"
      ? row.villaName
      : typeof legacy.property === "string"
        ? legacy.property
        : "—";
  const createdAt =
    typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const price =
    typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null;
  return {
    id,
    guestName:
      typeof row.guestName === "string" && row.guestName ? row.guestName : "Guest",
    villaName,
    serviceType,
    details: typeof row.details === "string" ? row.details : "",
    status,
    price,
    agencyPct: num(row.agencyPct, revenueConfig.agencyCommissionPct),
    auraPct: num(row.auraPct, revenueConfig.auraFeePct),
    staffNote: typeof row.staffNote === "string" ? row.staffNote : "",
    createdAt,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : createdAt,
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const tabs: TabDef[] = [
  { id: "concierge", label: "Concierge", icon: "✦" },
  { id: "services", label: "Services", icon: "❖" },
  { id: "staff", label: "Staff", icon: "⚡" },
  { id: "revenue", label: "Revenue", icon: "◆" },
];

const tabContent: Record<Tab, TabContent> = {
  concierge: {
    title: "Luxury Concierge",
    subtitle: "Your requests, passed to our staff",
  },
  services: {
    title: "Concierge Services",
    subtitle: "Curated Services Marketplace",
  },
  staff: {
    title: "Staff Operations",
    subtitle: "AI-Generated Task Automation",
  },
  revenue: {
    title: "Revenue Analytics",
    subtitle: "Agency Performance Insights",
  },
};

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  component: Home,
});

// ── Home ─────────────────────────────────────────────────────────────────────

function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("concierge");
  const [toast, setToast] = useState<string | null>(null);

  const DEFAULT_PROPERTY = properties[0];
  const [activePropertyId, setActivePropertyId] = useState(DEFAULT_PROPERTY.id);

  // Property-scoped state (Record keyed by property id)
  const [tasksByProperty, setTasksByProperty] = useState<Record<string, TaskItem[]>>(() => {
    const empty: Record<string, TaskItem[]> = Object.fromEntries(
      properties.map((p) => [p.id, [] as TaskItem[]])
    );
    try {
      const stored = localStorage.getItem("aura-tasks-by-property");
      if (stored) {
        const parsed = JSON.parse(stored);
        for (const key of Object.keys(empty)) {
          if (Array.isArray(parsed[key])) empty[key] = parsed[key];
        }
      }
    } catch { /* ignore */ }
    return empty;
  });
  // Revenue rows are demo data held in memory — never persisted to storage.
  const [revenueByProperty] = useState<
    Record<string, RevenueTransaction[]>
  >(() => {
    const seed: Record<string, RevenueTransaction[]> = Object.fromEntries(
      properties.map((p) => [p.id, [] as RevenueTransaction[]])
    );
    seed["ref-6291"] = [
      { id: "tx-6291-001", service: "Yacht & Boat Charter", supplier: "Charter partner", guestPrice: 6500, status: "approved" },
      { id: "tx-6291-002", service: "Private Chef", supplier: "Catering partner", guestPrice: 1100, status: "approved" },
      { id: "tx-6291-003", service: "Chauffeur & Transfers", supplier: "Transfer partner", guestPrice: 800, status: "approved" },
    ];
    seed["ref-14828"] = [
      { id: "tx-14828-001", service: "Wine Tasting & Tour", supplier: "Wine partner", guestPrice: 2200, status: "approved" },
      { id: "tx-14828-002", service: "Helicopter Transfer", supplier: "Transfer partner", guestPrice: 4000, status: "approved" },
    ];
    seed["ref-15864"] = [
      { id: "tx-15864-001", service: "Spa & Wellness Treatment", supplier: "Spa partner", guestPrice: 1600, status: "approved" },
      { id: "tx-15864-002", service: "Private Chef", supplier: "Catering partner", guestPrice: 2500, status: "approved" },
    ];
    return seed;
  });
  // Derive current values from activePropertyId
  const activeProperty = properties.find((p) => p.id === activePropertyId)!;
  const tasks = tasksByProperty[activePropertyId];
  const revenueTransactions = revenueByProperty[activePropertyId];

  // Persist tasks to localStorage (keyed by property)
  useEffect(() => {
    try { localStorage.setItem("aura-tasks-by-property", JSON.stringify(tasksByProperty)); }
    catch { /* storage full */ }
  }, [tasksByProperty]);

  // Property-scoped setters
  const setActiveTasks = useCallback(
    (updater: React.SetStateAction<TaskItem[]>) => {
      setTasksByProperty((prev) => {
        const current = prev[activePropertyId] ?? [];
        const next =
          typeof updater === "function"
            ? (updater as (prevList: TaskItem[]) => TaskItem[])(current)
            : updater;
        return { ...prev, [activePropertyId]: next };
      });
    },
    [activePropertyId]
  );

  const handleAddTask = useCallback(
    (t: TaskItem) =>
      setTasksByProperty((prev) => ({
        ...prev,
        [activePropertyId]: [...(prev[activePropertyId] ?? []), t],
      })),
    [activePropertyId]
  );

  // ── Guest requests — request lifecycle for this device ─────────────────────
  // MOCK / DEMO DATA LAYER: requests live in React state and are mirrored to
  // this browser's localStorage ("aura-guest-requests") — there is no server,
  // database or sync behind it. Swapping in a real backend is contained here:
  // the UI only ever reads state and calls the handlers below.
  const [guestRequests, setGuestRequests] = useState<GuestRequest[]>(() => {
    try {
      const stored = localStorage.getItem("aura-guest-requests");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed
            .map(normalizeGuestRequest)
            .filter((r): r is GuestRequest => r !== null);
        }
      }
    } catch { /* ignore */ }
    return [];
  });
  const [requestsStorageError, setRequestsStorageError] = useState(false);

  // Persist guest requests (guarded — a full or blocked store must not break the app)
  useEffect(() => {
    try {
      localStorage.setItem("aura-guest-requests", JSON.stringify(guestRequests));
      setRequestsStorageError(false);
    } catch { setRequestsStorageError(true); }
  }, [guestRequests]);

  const handleCreateRequest = useCallback(
    (serviceType: string, guestName = "Guest", details = "") => {
      const now = new Date().toISOString();
      const request: GuestRequest = {
        id: `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        guestName,
        villaName: properties.find((p) => p.id === activePropertyId)?.name ?? "—",
        serviceType,
        details,
        status: "received",
        price: null,
        agencyPct: revenueConfig.agencyCommissionPct,
        auraPct: revenueConfig.auraFeePct,
        staffNote: "",
        createdAt: now,
        updatedAt: now,
      };
      setGuestRequests((prev) => [request, ...prev]);
    },
    [activePropertyId, properties],
  );

  // Every edit stamps updatedAt, so the staff list shows when a request moved.
  const handleUpdateRequest = useCallback(
    (id: string, patch: Partial<GuestRequest>) => {
      setGuestRequests((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
        ),
      );
    },
    [],
  );
  const handleUpdateRequestStatus = useCallback(
    (id: string, status: GuestRequestStatus) => {
      handleUpdateRequest(id, { status });
    },
    [handleUpdateRequest],
  );

  const handleRetryRequests = useCallback(() => {
    try {
      const stored = localStorage.getItem("aura-guest-requests");
      const parsed = stored ? JSON.parse(stored) : [];
      setGuestRequests(
        Array.isArray(parsed)
          ? parsed.map(normalizeGuestRequest).filter((r): r is GuestRequest => r !== null)
          : [],
      );
      setRequestsStorageError(false);
    } catch { setRequestsStorageError(true); }
  }, []);

  const handleSwitchProperty = useCallback((id: string) => {
    if (id === activePropertyId) return;
    const prop = properties.find((p) => p.id === id);
    setActivePropertyId(id);
    if (prop) {
      setToast(`Switched active workspace to ${prop.name}`);
      setTimeout(() => setToast(null), 2500);
    }
  }, [activePropertyId]);

  return (
    <div
      className="flex min-h-dvh flex-col text-text-primary"
      style={
        {
          "--aura-accent": agencyConfig.primaryColor,
          backgroundColor: "var(--aura-surface, #0B0B0B)",
        } as React.CSSProperties
      }
    >
      <Header
        property={activeProperty}
        properties={properties}
        activePropertyId={activePropertyId}
        onSwitchProperty={handleSwitchProperty}
      />
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        pendingCount={tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length}
      />
      <TabPanels
        activeTab={activeTab}
        activeProperty={activeProperty}
        properties={properties}
        activePropertyId={activePropertyId}
        onSwitchProperty={handleSwitchProperty}
        tasks={tasks}
        setTasks={setActiveTasks}
        onAddTask={handleAddTask}
        revenueTransactions={revenueTransactions}
        guestRequests={guestRequests}
        requestsStorageError={requestsStorageError}
        onCreateRequest={handleCreateRequest}
        onUpdateRequest={handleUpdateRequest}
        onUpdateRequestStatus={handleUpdateRequestStatus}
        onRetryRequests={handleRetryRequests}
      />
      <Footer />

      {/* Toast notification */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up rounded-xl border border-[var(--aura-accent,#D4AF37)] bg-charcoal px-6 py-3 shadow-lg">
          <p className="text-sm font-light tracking-wide" style={{ color: "var(--aura-accent, #D4AF37)" }}>
            {toast}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({
  property,
  properties: propertyList,
  activePropertyId,
  onSwitchProperty,
}: {
  property: Property;
  properties: Property[];
  activePropertyId: string;
  onSwitchProperty: (id: string) => void;
}) {
  return (
    <header className="border-b border-border px-6 py-8 md:px-12 lg:px-24">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex items-center gap-3 logo-glow-bg">
          {agencyConfig.logoUrl ? (
            <img
              src={agencyConfig.logoUrl}
              alt={agencyConfig.agencyName}
              className="relative z-10 h-8 w-auto md:h-10"
            />
          ) : (
            <h1
              className="relative z-10 text-lg font-light tracking-[0.18em] sm:text-xl md:text-2xl lg:text-3xl"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              AURA
            </h1>
          )}
          <span
            className="relative z-10 h-px w-6 shrink-0"
            style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
            aria-hidden="true"
          />
          <span className="relative z-10 text-xs font-light tracking-[0.18em] text-text-secondary sm:text-sm">
            {agencyConfig.agencyName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Property switcher */}
          <div className="relative">
            <select
              aria-label="Switch active property"
              value={activePropertyId}
              onChange={(e) => onSwitchProperty(e.target.value)}
              className="cursor-pointer appearance-none rounded-full border border-border bg-charcoal py-2 pl-4 pr-9 text-xs font-light tracking-[0.12em] text-text-secondary transition-colors duration-300 hover:border-[var(--aura-accent,#D4AF37)] hover:text-text-primary focus:outline-none focus-visible:border-[var(--aura-accent,#D4AF37)]"
            >
              {propertyList.map((p) => (
                <option key={p.id} value={p.id} className="bg-charcoal text-text-primary">
                  {p.id === activePropertyId ? `✓ ${p.name}` : p.name}
                </option>
              ))}
            </select>
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            >
              <path d="M2 4.5L6 8.5L10 4.5" />
            </svg>
          </div>
        </div>
      </div>

      <p className="mt-2 flex items-center gap-2 text-xs font-light tracking-[0.15em] text-text-secondary">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
          aria-hidden="true"
        />
        <span className="transition-colors duration-300" style={{ color: "var(--aura-accent-light, #e0c45e)" }}>
          {property.name}
        </span>
      </p>
    </header>
  );
}

// ── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onTabChange,
  pendingCount = 0,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  pendingCount?: number;
}) {
  return (
    <nav className="border-b border-border" role="tablist">
      <div className="flex overflow-x-auto scrollbar-hide px-6 md:px-12 lg:px-24">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={`
                tab-btn group relative flex items-center gap-2 px-5 py-4
                text-sm font-medium whitespace-nowrap
                ${
                  isActive
                    ? "text-[var(--aura-accent,#D4AF37)]"
                    : "text-text-muted hover:text-text-secondary"
                }
              `}
            >
              <span
                className="text-base transition-transform duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] group-hover:scale-110"
                aria-hidden="true"
              >
                {tab.icon}
              </span>
              <span className="tracking-wide">{tab.label}</span>
              {/* Badge for pending tasks on Staff tab */}
              {tab.id === "staff" && pendingCount > 0 && (
                <span className="bg-[var(--aura-accent,#D4AF37)] text-midnight text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ml-0.5">
                  {pendingCount}
                </span>
              )}
              {/* Active indicator underline */}
              <span
                className={`
                  tab-underline absolute bottom-0 left-0 right-0 h-0.5 rounded-full
                  ${isActive ? "scale-x-100" : "scale-x-0"}
                `}
                style={{
                  backgroundColor: isActive
                    ? "var(--aura-accent, #D4AF37)"
                    : "transparent",
                }}
              />
              {/* Active glow */}
              {isActive && (
                <span
                  className="absolute -bottom-px left-1/2 h-0.5 w-1/2 -translate-x-1/2 rounded-full blur-sm"
                  style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Tab Panels ───────────────────────────────────────────────────────────────

function TabPanels({
  activeTab,
  activeProperty,
  properties,
  activePropertyId,
  onSwitchProperty,
  tasks,
  setTasks,
  onAddTask,
  revenueTransactions,
  guestRequests,
  requestsStorageError,
  onCreateRequest,
  onUpdateRequestStatus,
  onUpdateRequest,
  onRetryRequests,
}: {
  activeTab: Tab;
  activeProperty: Property;
  properties: Property[];
  activePropertyId: string;
  onSwitchProperty: (id: string) => void;
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  onAddTask: (task: TaskItem) => void;
  revenueTransactions: RevenueTransaction[];
  guestRequests: GuestRequest[];
  requestsStorageError: boolean;
  onCreateRequest: (serviceType: string) => void;
  onUpdateRequest: (id: string, patch: Partial<GuestRequest>) => void;
  onUpdateRequestStatus: (id: string, status: GuestRequestStatus) => void;
  onRetryRequests: () => void;
}) {
  return (
    <main className="flex-1 px-6 py-10 md:px-12 md:py-14 lg:px-24 lg:py-16">
      <div className="relative">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <div
              key={tab.id}
              role="tabpanel"
              aria-hidden={!isActive}
              className={`
                transition-all duration-[250ms] ease-[cubic-bezier(0.25,0.8,0.25,1)]
                ${
                  isActive
                    ? "relative z-10 opacity-100 animate-fade-in"
                    : "absolute inset-0 z-0 opacity-0 pointer-events-none"
                }
              `}
            >
              {tab.id === "concierge" ? (
                <ConciergePanel
                  tasks={tasks}
                  setTasks={setTasks}
                  onCreateRequest={onCreateRequest}
                />
              ) : tab.id === "services" ? (
                <ServicesPanel
                  onAddTask={onAddTask}
                  activeProperty={activeProperty}
                  guestRequests={guestRequests}
                  requestsStorageError={requestsStorageError}
                  onCreateRequest={onCreateRequest}
                  onRetryRequests={onRetryRequests}
                />
              ) : tab.id === "staff" ? (
                <StaffPanel
                  tasks={tasks}
                  setTasks={setTasks}
                  guestRequests={guestRequests}
                  requestsStorageError={requestsStorageError}
                  onUpdateRequest={onUpdateRequest}
                  onUpdateRequestStatus={onUpdateRequestStatus}
                  onRetryRequests={onRetryRequests}
                />
              ) : tab.id === "revenue" ? (
                <RevenuePanel revenueTransactions={revenueTransactions} activeProperty={activeProperty} />
              ) : (
                <PlaceholderPanel
                  icon={tab.icon}
                  title={tabContent[tab.id].title}
                  subtitle={tabContent[tab.id].subtitle}
                />
              )}
            </div>
          );
        })}

        {/* Height placeholder */}
        <div className="invisible" aria-hidden="true">
          <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-12 lg:p-14">
            <div className="mb-10">
              <h2 className="text-2xl font-light md:text-3xl">&nbsp;</h2>
              <p className="mt-2">&nbsp;</p>
            </div>
            <div className="py-24 md:py-32" />
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Placeholder Panel (for non-Estate tabs) ──────────────────────────────────

function PlaceholderPanel({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-12 lg:p-14">
      <div className="mb-10">
        <h2
          className="text-2xl font-light tracking-wide md:text-3xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          {title}
        </h2>
        <p className="mt-2 font-light text-text-secondary">{subtitle}</p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 md:py-32">
        <span className="text-4xl opacity-30" aria-hidden="true">
          {icon}
        </span>
        <p className="mt-4 text-sm font-light tracking-wide text-text-muted">
          {title}
        </p>
        <p className="mt-1 text-xs text-text-muted/60">Coming in a future phase</p>
      </div>
    </div>
  );
}
// CONCIERGE PANEL — AURA Concierge Chat (Concierge Tab)
// ═══════════════════════════════════════════════════════════════════════════════

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "system",
  content:
    "Good evening. I am AURA Concierge. I take your requests — a private chef, a transfer, a boat, aviation, housekeeping or anything else on the estate — and pass them to our staff, who confirm the arrangements with you. How may I assist?",
};

// ── AI Response Engine ─────────────────────────────────────────────────────────

type IntentType = "concierge" | "transport" | "transportChauffeur" | "transportYacht" | "transportAviation" | "housekeeping" | "maintenance" | "security" | "general" | "closing" | "update";

interface DetectedIntent {
  type: IntentType;
  confidence: "high" | "medium";
  specifics: string;
}

interface AIResponse {
  content: string;
  tasks: TaskItem[];
  intents: DetectedIntent[];
}

// Service intents that become a tracked guest request.
const REQUEST_INTENT_TITLES: Partial<Record<IntentType, string>> = {
  concierge: "Private Chef & Dining",
  transportChauffeur: "Chauffeur & Transfer",
  transportYacht: "Yacht & Boat Charter",
  transportAviation: "Private Aviation",
  transport: "Private Transfer",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  security: "Security",
};
// ── Intent Signal Keywords ────────────────────────────────────────────────────

const intentKeywords: Record<Exclude<IntentType, "general">, string[]> = {
  concierge: [
    "champagne", "wine", "drinks", "drink", "cocktail", "bar", "bottle",
    "dinner", "lunch", "breakfast", "brunch", "restaurant", "reservation",
    "table", "booking", "catering", "chef", "food", "menu", "party",
    "event", "guests", "dining", "cuisine", "sommelier", "tasting",
    "celebration", "celebrate", "celebrating", "refreshment", "canapé",
    "beverage", "vintage", "spirit", "liquor", "alcohol", "rosé", "prosecco",
    "seafood", "dom pérignon", "krug", "cristal", "moët", "bollinger",
    "veuve", "caviar", "oyster", "lobster", "truffle",
    "dj", "live music", "saxophonist", "pianist", "band", "entertainment",
    "sound system", "dance floor",
  ],
  transportChauffeur: ["driver", "car", "chauffeur", "transfer", "airport", "pickup", "ride", "sedan", "vehicle", "limo"],
  transportYacht: ["yacht", "boat", "charter", "sailing", "cruise", "vessel", "sunset", "tender", "superyacht"],
  transportAviation: ["jet", "flight", "plane", "aviation", "fly", "aircraft", "helicopter"],
  transport: [
    "yacht", "boat", "charter", "sailing", "cruise", "vessel", "sunset",
    "tender", "superyacht", "jet", "flight", "plane", "aviation", "fly",
    "aircraft", "helicopter", "driver", "car", "chauffeur", "transfer",
    "airport", "pickup", "ride", "sedan", "vehicle", "limo",
  ],
  update: [],
  housekeeping: [
    "room", "suite", "bedroom", "guest", "prepare", "prep", "clean",
    "towel", "linen", "amenity", "turndown", "fresh", "bed",
  ],
  maintenance: [
    "temperature", "climate", "pool", "heat", "spa", "cool", "warm",
    "hot", "cold", "tech", "wifi", "internet", "light", "ac",
    "air conditioning", "heating", "degree",
  ],
  security: [
    "security", "gate", "access", "perimeter", "guard", "surveillance",
    "camera", "patrol", "access", "vault", "lock", "safe", "code",
    "valet", "parking", "clearance",
  ],
};

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
}

// ── Intent Analysis ───────────────────────────────────────────────────────────

function analyzeIntents(message: string): DetectedIntent[] {
  const m = message.toLowerCase();
  const intents: DetectedIntent[] = [];

  // Time-update detection (Fix 2) — check before anything else
  const updatePattern = /\b(instead\s+of|change\s+(it|the|my|to)|update|make\s+it|modify|reschedule|move\s+(it|the)|earlier|later)\b.*\b(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)|noon|midnight)\b/i;
  const isUpdate = updatePattern.test(m);
  if (isUpdate) {
    const timeMatch = m.match(/(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)|noon|midnight)/);
    const extractedTime = timeMatch ? timeMatch[0] : "the requested time";
    return [{ type: "update", confidence: "high", specifics: extractedTime }];
  }


  // Arrival detection — used to suppress concierge and elevate housekeeping/maintenance
  const arrivalPattern = /\b(arriv|coming\s+(home|back|to\s+the)|arriverò|arrivo|check[-\s]?in|weekend|tomorrow|domani|staying|vengo|atterr)\b/i;
  const hasArrivalIntent = arrivalPattern.test(m);
  const propertyContextPattern = /\b(villa|estate|home|property|house|room|bed|suite|stay|prepare.*estate|prepare.*villa|prepare.*room|get.*ready|prep|turndown|sleep)\b/i;
  const hasPropertyContext = propertyContextPattern.test(m);
  const hasFoodBeverage = /\b(champagne|wine|dinner|lunch|breakfast|dining|restaurant|drinks|food|menu|chef|catering|cocktail)\b/i;

  for (const [type, keywords] of Object.entries(intentKeywords)) {
    const matched: string[] = [];
    // Skip the combined "transport" key and "update" key — we use sub-types instead
    if (type === "transport" || type === "update") continue;
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (regex.test(m)) {
        matched.push(kw);
      }
    }
    if (matched.length > 0) {
      const intentType = type as IntentType;
      // Suppress concierge for arrival messages without food/beverage specifics
      if (intentType === "concierge" && hasArrivalIntent && !hasFoodBeverage.test(m)) {
        continue;
      }
      intents.push({
        type: intentType,
        confidence: matched.length >= 2 ? "high" : "medium",
        specifics: matched.slice(0, 5).join(", "),
      });
    }
  }

  // Force-add housekeeping & maintenance for arrival messages (only when property context is present)
  if (hasArrivalIntent && hasPropertyContext) {
    if (!intents.some(i => i.type === "housekeeping")) {
      intents.push({ type: "housekeeping", confidence: "high", specifics: "arrival preparation" });
    }
    if (!intents.some(i => i.type === "maintenance")) {
      intents.push({ type: "maintenance", confidence: "high", specifics: "climate control" });
    }
  }

  // Closing detection (Fix 3) — only when no other intents found
  if (intents.length === 0) {
    const closingPattern = /\b(no\s+grazie|va\s+bene\s+così|grazie|perfetto|no\s+thanks|i('?m| am)\s+good|that('?s|\s+is)\s+all|nothing\s+else|thank\s+you|all\s+good|we('?re| are)\s+fine|grazie\s+mille|tutto\s+a\s+posto|great|perfect|thanks|awesome|wonderful|lovely|brilliant|excellent|superb|sounds\s+good|ok|okay)\b/i;
    if (closingPattern.test(m) && m.length < 60) {
      intents.push({ type: "closing", confidence: "high", specifics: "closing" });
    } else {
      intents.push({
        type: "general",
        confidence: "medium",
        specifics: m.length < 80 ? m : m.substring(0, 77) + "...",
      });
    }
  }

  return intents;
}

// ── Response Generation ───────────────────────────────────────────────────────

// ── Response Generation ───────────────────────────────────────────────────────
// AURA never confirms availability, prices or arrangements for the guest — the
// agency staff do. Every reply to a service request therefore ends with the
// exact same sentence, and no reply promises execution or quotes a number.
const arrivalVariants: Array<(s: string) => string> = [
  (s) => `Good evening, Sir. I have your arrival noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Thank you, Sir — your arrival and guest count are noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const conciergeVariants: Array<(s: string) => string> = [
  (s) => `Certainly, Sir. Your dining request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `With pleasure, Sir. I have your request for our cellar selection. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Of course, Sir. Your request for the chef and the dining room is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Thank you, Sir. I have recorded your request. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const transportYachtVariants: Array<(s: string) => string> = [
  (s) => `Certainly, Sir. Your boat request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `With pleasure, Sir. I have your charter request noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Of course, Sir. I have noted the date you have in mind for the boat. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const chauffeurVariants: Array<(s: string) => string> = [
  (s) => `At once, Sir. Your transfer request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Certainly, Sir. I have your chauffeur request noted, together with the time you mentioned. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const aviationVariants: Array<(s: string) => string> = [
  (s) => `Of course, Sir. Your aviation request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Thank you, Sir. I have recorded your flight request and the route details. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const maintenanceVariants: Array<(s: string) => string> = [
  (s) => `Understood, Sir. Your climate and pool request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Of course, Sir. I have recorded your maintenance request. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const securityVariants: Array<(s: string) => string> = [
  (s) => `Understood, Sir. Your security request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Certainly, Sir. I have recorded your access and security request. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const housekeepingVariants: Array<(s: string) => string> = [
  (s) => `Certainly, Sir. Your housekeeping request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
  (s) => `Of course, Sir. I have recorded your housekeeping request. I've sent your request to our staff. You'll see the status here once it's confirmed.`,
];
const generalShortVariants: Array<(s: string) => string> = [
  (s) => `Sir, I would be delighted to assist. Could you share a little more detail — the service you have in mind, the date, and the number of guests?`,
  (s) => `I am at your service, Sir. Tell me a little more about what you need so it reaches the right staff.`,
  (s) => `At your disposal, Sir. I can take requests for dining, transfers, boats, aviation and the house — what would you like to request today?`,
];
const generalLongVariants: Array<(s: string) => string> = [
  (s) => `Thank you, Sir. I have noted your message. Which service shall I pass to our staff — dining, transfers, boats, aviation or housekeeping?`,
  (s) => `Understood, Sir. If you tell me the service and the details, I can pass the request to our staff. Is there anything else you would like to add?`,
  (s) => `Of course, Sir. I have noted this. What would you like me to pass to our staff?`,
];

const variantCounters: Record<string, number> = {};

function getNextVariant<T>(key: string, variants: T[]): T {
  if (!(key in variantCounters)) variantCounters[key] = 0;
  const idx = variantCounters[key] % variants.length;
  variantCounters[key]++;
  return variants[idx];
}

function generateResponse(
  intents: DetectedIntent[],
  message: string,
  _conversationContext: string[],
): string {
  // Availability and price questions are always answered by our staff — AURA
  // never quotes a number or confirms availability for the guest.
  if (/\b(availab\w*|how much|price|pricing|cost|costs|rate|rates|quote|quotation)\b/i.test(message)) {
    return "Our staff will confirm this for you.";
  }
  // Closing intent — return warm farewell
  if (intents.length === 1 && intents[0].type === "closing") {
    return "I remain at your complete disposal, Sir. Have a wonderful day.";
  }

  // Update intent — return time-update acknowledgment
  if (intents.length === 1 && intents[0].type === "update") {
    const newTime = intents[0].specifics;
    return `Understood, Sir. I have noted the change of timing to ${newTime} and passed it to our staff.`;
  }

  // Arrival detection for response generation
  const _arrivalPattern = /\b(arriv|coming\s+(home|back|to\s+the)|arriverò|arrivo|check[-\s]?in|weekend|tomorrow|domani|staying|vengo|atterr)\b/i;
  const _hasArrivalIntent = _arrivalPattern.test(message.toLowerCase());
  const _propertyPattern = /\b(villa|estate|home|property|house|room|bed|suite|stay|prepare|prep|turndown)\b/i;
  const _hasPropertyContext = _propertyPattern.test(message.toLowerCase());

  const parts: string[] = [];
  const seenTypes = new Set<string>();

  // Prepend arrival-specific response if arrival detected AND property context present
  if (_hasArrivalIntent && _hasPropertyContext) {
    parts.push(getNextVariant("arrival", arrivalVariants)(""));
  }

  for (const intent of intents) {
    if (seenTypes.has(intent.type)) continue;
    seenTypes.add(intent.type);

    switch (intent.type) {
      case "concierge":
        parts.push(getNextVariant("concierge", conciergeVariants)(intent.specifics));
        break;
      case "transportYacht":
        parts.push(getNextVariant("transportYacht", transportYachtVariants)(intent.specifics));
        break;
      case "transportChauffeur":
        parts.push(getNextVariant("transportChauffeur", chauffeurVariants)(intent.specifics));
        break;
      case "transportAviation":
        parts.push(getNextVariant("transportJet", aviationVariants)(intent.specifics));
        break;
      case "transport": {
        const m = message.toLowerCase();
        if (/\b(yacht|boat|charter|sailing|cruise|vessel|sunset|tender|superyacht)\b/.test(m)) {
          parts.push(getNextVariant("transportYacht", transportYachtVariants)(intent.specifics));
        } else if (/\b(driver|car|chauffeur|transfer|airport|pickup|ride|sedan|vehicle|limo)\b/.test(m)) {
          parts.push(getNextVariant("transportChauffeur", chauffeurVariants)(intent.specifics));
        } else {
          parts.push(getNextVariant("transportJet", aviationVariants)(intent.specifics));
        }
        break;
      }
      case "housekeeping":
        parts.push(getNextVariant("housekeeping", housekeepingVariants)(intent.specifics));
        break;
      case "maintenance":
        parts.push(getNextVariant("maintenance", maintenanceVariants)(intent.specifics));
        break;
      case "security":
        parts.push(getNextVariant("security", securityVariants)(intent.specifics));
        break;
      case "general":
        if (message.length < 20) {
          parts.push("Good evening, Sir. How may I be of assistance today?");
        } else if (message.length < 40) {
          parts.push(getNextVariant("generalShort", generalShortVariants)(intent.specifics));
        } else {
          parts.push(getNextVariant("generalLong", generalLongVariants)(intent.specifics));
        }
        break;
    }
  }

  // No trailing promise is appended: the mandated request-receipt sentence must
  // always be the final sentence of a service reply.

  // Compose unified response for multi-intent, single variant for single intent
  if (parts.length === 1) {
    return parts[0];
  }
  return composeMultiIntent(intents, parts, message);
}

function composeMultiIntent(
  intents: DetectedIntent[],
  parts: string[],
  _message: string,
): string {
  // Get the unique intent types in order
  const types = intents.map(i => i.type).filter((t, idx, arr) => arr.indexOf(t) === idx);
  if (types.length <= 1) return parts[0];
  // Several requests in one message — one receipt, one mandated closing line.
  return `Certainly, Sir. I have noted all of it. I've sent your request to our staff. You'll see the status here once it's confirmed.`;
}
// ── Task Dispatch ─────────────────────────────────────────────────────────────

function extractGuestCount(message: string): number {
  const m = message.toLowerCase();
  const guestMatch = m.match(/(\d+)\s*(guest|people|person|pax)/);
  if (guestMatch) return parseInt(guestMatch[1], 10);
  const forMatch = m.match(/for\s+(\d+)/);
  if (forMatch) return parseInt(forMatch[1], 10);
  const partyMatch = m.match(/party\s+of\s+(\d+)/);
  if (partyMatch) return parseInt(partyMatch[1], 10);
  return 0;
}

function dispatchTasks(intents: DetectedIntent[], message: string): TaskItem[] {
  // Closing intent — no tasks
  if (intents.length === 1 && intents[0].type === "closing") {
    return [];
  }

  // Update intent — no new tasks, just acknowledgment
  if (intents.length === 1 && intents[0].type === "update") {
    return [];
  }

  const tasks: TaskItem[] = [];
  const guestCount = extractGuestCount(message);
  const m = message.toLowerCase();

  for (const intent of intents) {
    switch (intent.type) {
      case "concierge": {
        // Seafood & gourmet
        if (/\b(seafood|lobster|oyster|caviar|truffle)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Chef",
            description: "Fresh seafood dinner preparation",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        // Premium champagne brands
        if (/\b(dom pérignon|krug|cristal|moët|bollinger|veuve)\b/.test(m)) {
          const brandMatch = m.match(/\b(dom pérignon|krug|cristal|moët|bollinger|veuve)\b/i);
          const brand = brandMatch ? brandMatch[0].replace(/\b\w/g, (c: string) => c.toUpperCase()) : "Premium Champagne";
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: `Chilled ${brand} service`,
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        // Live music / entertainment
        if (/\b(dj|live music|saxophonist|pianist|band|entertainment)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: "Live music/entertainment coordination",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        // Sound system / dance floor
        if (/\b(sound system|dance floor)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: "Sound system & technical setup",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        if (/\b(champagne|wine|drinks|drink|cocktail|bar|bottle|vintage|spirit|liquor|alcohol|rosé|prosecco|beverage|refreshment)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: "Chill & serve premium Champagne selection",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        } else if (/\b(dinner|lunch|breakfast|brunch|restaurant|reservation|table|dining|cuisine|food|menu)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: "Arrange private dining reservation",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        } else if (/\b(party|event|celebration|celebrate|celebrating|guests|canapé)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: guestCount > 0
              ? `Event coordination for ${guestCount} guests`
              : "Event coordination & catering arrangements",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        } else {
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: "Curate premium food & beverage selection",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }

        if (guestCount > 0) {
          tasks.push({
            id: generateTaskId(),
            module: "Chef",
            description: `Menu preparation for ${guestCount} guests`,
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        break;
      }

      case "transportYacht": {
        tasks.push(
          {
            id: generateTaskId(),
            module: "Concierge",
            description: "Coordinate yacht charter arrangements",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
          {
            id: generateTaskId(),
            module: "Concierge",
            description: "Prepare tender for private dock transfer",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
        );
        break;
      }

      case "transportChauffeur": {
        tasks.push(
          {
            id: generateTaskId(),
            module: "Chauffeur",
            description: "Vehicle preparation & route planning",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
          {
            id: generateTaskId(),
            module: "Chauffeur",
            description: "Confirm chauffeur schedule & briefing",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
        );
        break;
      }

      case "transportAviation": {
        tasks.push(
          {
            id: generateTaskId(),
            module: "Aviation",
            description: "Initiate private jet charter request",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
          {
            id: generateTaskId(),
            module: "Aviation",
            description: "File flight plan & secure priority clearance",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
        );
        break;
      }

      case "transport": {
        if (/\b(yacht|boat|charter|sailing|cruise|vessel|sunset|tender|superyacht)\b/.test(m)) {
          tasks.push(
            {
              id: generateTaskId(),
              module: "Concierge",
              description: "Coordinate yacht charter arrangements",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            },
            {
              id: generateTaskId(),
              module: "Concierge",
              description: "Prepare tender for private dock transfer",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            },
          );
        } else if (/\b(driver|car|chauffeur|transfer|airport|pickup|ride|sedan|vehicle|limo)\b/.test(m)) {
          tasks.push(
            {
              id: generateTaskId(),
              module: "Chauffeur",
              description: "Vehicle preparation & route planning",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            },
            {
              id: generateTaskId(),
              module: "Chauffeur",
              description: "Confirm chauffeur schedule & briefing",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            },
          );
        } else {
          tasks.push(
            {
              id: generateTaskId(),
              module: "Aviation",
              description: "Initiate private jet charter request",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            },
            {
              id: generateTaskId(),
              module: "Aviation",
              description: "File flight plan & secure priority clearance",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            },
          );
        }
        break;
      }

      case "housekeeping": {
        if (/\b(room|suite|bedroom|guest)\b/.test(m)) {
          const count = guestCount > 0 ? guestCount : 2;
          const roomCount = Math.max(1, Math.ceil((count - 1) / 2));
          tasks.push({
            id: generateTaskId(),
            module: "Housekeeping",
            description: `Prep Master Suite & ${roomCount} Guest Room${roomCount > 1 ? "s" : ""}`,
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        } else {
          tasks.push({
            id: generateTaskId(),
            module: "Housekeeping",
            description: "Full property preparation & amenity refresh",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        break;
      }

      case "maintenance": {
        if (/\b(pool|spa|heat)\b/.test(m)) {
          // Check for event/party context — if present, create concierge task instead
          const hasEventContext = /\b(dj|party|event|entertainment|music)\b/.test(m);
          if (hasEventContext) {
            tasks.push({
              id: generateTaskId(),
              module: "Concierge",
              description: "Poolside event setup & coordination",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            });
          } else {
            tasks.push({
              id: generateTaskId(),
              module: "Maintenance",
              description: "Check & adjust pool temperature to 28°C",
              status: "pending", createdAt: new Date().toLocaleTimeString(),
            });
          }
        } else if (/\b(temperature|climate|ac|air conditioning|heating|cool|warm|hot|cold|degree)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Maintenance",
            description: "Calibrate climate control & HVAC systems",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        } else if (/\b(wifi|internet|tech|light)\b/.test(m)) {
          tasks.push({
            id: generateTaskId(),
            module: "Maintenance",
            description: "Run system diagnostics & connectivity check",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        } else {
          tasks.push({
            id: generateTaskId(),
            module: "Maintenance",
            description: "Full estate systems check & calibration",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        break;
      }

      case "security": {
        tasks.push(
          {
            id: generateTaskId(),
            module: "Security",
            description: "Conduct full perimeter sweep & vulnerability assessment",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
          {
            id: generateTaskId(),
            module: "Security",
            description: "Update access logs & gate codes",
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          },
        );
        break;
      }

      case "general": {
        if (message.length >= 20) {
          const cleaned = message.replace(/^[.\s]*|[.\s]*$/g, "").replace(/\s+/g, " ").substring(0, 120);
          tasks.push({
            id: generateTaskId(),
            module: "Concierge",
            description: `Review and action: ${cleaned}`,
            status: "pending", createdAt: new Date().toLocaleTimeString(),
          });
        }
        break;
      }
    }
  }

  const seen = new Set<string>();
  return tasks.filter((t) => {
    const key = `${t.module}:${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Processing Phase Type ──────────────────────────────────────────────────────

type ProcessingPhase = "idle" | "processing" | "typing";

// ── StaffPanel ─────────────────────────────────────────────────────────────────

function ConciergePanel({
  tasks,
  setTasks,
  onCreateRequest,
}: {
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  onCreateRequest: (serviceType: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("aura-messages");
      return stored ? JSON.parse(stored) : [WELCOME_MESSAGE];
    } catch { return [WELCOME_MESSAGE]; }
  });
  const [processingPhase, setProcessingPhase] = useState<ProcessingPhase>("idle");
  const [inputValue, setInputValue] = useState("");
  const [latestAiMsgId, setLatestAiMsgId] = useState<string | null>(null);
  const [isTypewriting, setIsTypewriting] = useState(false);
  const [typewriterChars, setTypewriterChars] = useState(0);
  const typewriterContentRef = useRef("");
  const typewriterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const conversationTopicsRef = useRef<string[]>([]);
  const sendingRef = useRef(false);

    // Persist chat messages to localStorage
  useEffect(() => {
    try { localStorage.setItem("aura-messages", JSON.stringify(messages)); }
    catch { /* storage full */ }
  }, [messages]);

  const completedCount = tasks.filter((t) => t.status === "confirmed" || t.status === "completed").length;

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      if (typewriterIntervalRef.current) {
        clearInterval(typewriterIntervalRef.current);
        typewriterIntervalRef.current = null;
      }
    };
  }, []);

  // Safety timeout: if processing gets stuck non-idle for >8s, force-recover
  useEffect(() => {
    if (processingPhase === "idle") return;
    const safety = setTimeout(() => {
      setProcessingPhase("idle");
      setIsTypewriting(false);
      sendingRef.current = false;
    }, 8000);
    return () => clearTimeout(safety);
  }, [processingPhase]);

  // Typewriter effect
  useEffect(() => {
    if (!isTypewriting) return;
    const fullLen = typewriterContentRef.current.length;
    typewriterIntervalRef.current = setInterval(() => {
      setTypewriterChars(prev => {
        const next = prev + 1;
        if (next >= fullLen) {
          if (typewriterIntervalRef.current) {
            clearInterval(typewriterIntervalRef.current);
            typewriterIntervalRef.current = null;
          }
          setIsTypewriting(false);
          return fullLen;
        }
        return next;
      });
    }, 25);
    return () => {
      if (typewriterIntervalRef.current) {
        clearInterval(typewriterIntervalRef.current);
        typewriterIntervalRef.current = null;
      }
    };
  }, [isTypewriting]);

  // Auto-scroll chat to bottom (container-only, does not scroll page)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, processingPhase, typewriterChars]);

  // Every service request the guest makes is recorded in the request lifecycle.
  const registerRequestFromIntents = useCallback(
    (intents: DetectedIntent[]) => {
      const hit = intents.find((i) => REQUEST_INTENT_TITLES[i.type]);
      if (hit) onCreateRequest(REQUEST_INTENT_TITLES[hit.type] as string);
    },
    [onCreateRequest],
  );
  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (sendingRef.current || !trimmed || processingPhase !== "idle") return;
      sendingRef.current = true;

      const suggestionResponses: Record<string, string> = {
        "request a private chef": "With pleasure, Sir. Your private chef request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.",
        "request a transfer": "Certainly, Sir. Your transfer request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.",
        "request a boat": "Of course, Sir. Your boat request is noted. I've sent your request to our staff. You'll see the status here once it's confirmed.",
      };

      const normalized = trimmed.toLowerCase().replace(/[.?!,]+$/, "").trim();
      if (suggestionResponses[normalized]) {
        // Show the user's message immediately (same as normal flow)
        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: "user",
          content: trimmed,
        };
        setMessages((prev) => [...prev, userMsg]);
        setInputValue("");
        conversationTopicsRef.current = [...conversationTopicsRef.current, trimmed].slice(-3);

        // Bypass the long timeout — respond in just ~700ms
        setProcessingPhase("processing");
        const s1 = setTimeout(() => {
          setProcessingPhase("typing");
          const s2 = setTimeout(() => {
            const aiMsgId = `ai-${Date.now()}`;
            const aiMsg: ChatMessage = {
              id: aiMsgId,
              role: "ai",
              content: suggestionResponses[normalized],
            };
            setMessages((prev) => [...prev, aiMsg]);
            typewriterContentRef.current = suggestionResponses[normalized];
            setTypewriterChars(0);
            setIsTypewriting(true);
            setLatestAiMsgId(aiMsgId);
            setProcessingPhase("idle");
            sendingRef.current = false;
          }, 400);
          timersRef.current.push(s2);
        }, 300);
        timersRef.current.push(s1);

        // Also dispatch relevant tasks based on content
        const intents = analyzeIntents(trimmed);
        registerRequestFromIntents(intents);
        const responseTasks = dispatchTasks(intents, trimmed);
        if (responseTasks.length > 0) {
          const t3 = setTimeout(() => setTasks((prev) => [...prev, ...responseTasks]), 700);
          timersRef.current.push(t3);
        }        return;
      }

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
      };

      setMessages((prev) => [...prev, userMsg]);
      setInputValue("");
      setProcessingPhase("processing");

      // Update conversation memory (last 3 topics)
      const topic = trimmed.length > 60 ? trimmed.substring(0, 57) + "..." : trimmed;
      conversationTopicsRef.current = [...conversationTopicsRef.current, topic].slice(-3);

      // Phase 1: Gold pulse processing (1.5-2s)
      const processingDelay = 1500 + Math.random() * 500;

      const t1 = setTimeout(() => {
        // Analyze intents, generate response, dispatch tasks
        const intents = analyzeIntents(trimmed);
        registerRequestFromIntents(intents);
        const responseContent = generateResponse(intents, trimmed, conversationTopicsRef.current);
        const responseTasks = dispatchTasks(intents, trimmed);
        const aiMsgId = `ai-${Date.now()}`;

        // Enter typing phase
        setProcessingPhase("typing");

        // Phase 2: Typing dots (1s)
        const t2 = setTimeout(() => {
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            role: "ai",
            content: responseContent,
            tasks: responseTasks.length > 0 ? responseTasks : undefined,
          };

          setMessages((prev) => [...prev, aiMsg]);
          if (responseTasks.length > 0) {
            setTasks((prev) => [...prev, ...responseTasks]);
          }
          setLatestAiMsgId(aiMsgId);
          // Start typewriter effect
          typewriterContentRef.current = responseContent;
          setTypewriterChars(0);
          setIsTypewriting(true);
          setProcessingPhase("idle");
          sendingRef.current = false;
        }, 1000);

        timersRef.current.push(t2);
      }, processingDelay);

      timersRef.current.push(t1);
    },
    [processingPhase, registerRequestFromIntents],
  );

  const handleToggleTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const statusCycle: Record<string, TaskItem["status"]> = {
          pending: "in_progress",
          in_progress: "confirmed",
          confirmed: "completed",
          completed: "pending",
        };
        const nextStatus = statusCycle[t.status] || "pending";
        return {
          ...t,
          status: nextStatus,
          completedAt: nextStatus === "completed" ? new Date().toLocaleTimeString() : t.completedAt,
        };
      }),
    );
  }, []);

  const handleAssignTask = useCallback((taskId: string, name: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, assignedTo: name || undefined } : t,
      ),
    );
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-charcoal p-6 md:p-10 lg:p-12 flex flex-col">
      {/* Header area */}
      <div className="mb-8">
        <h2
          className="text-2xl font-light tracking-wide md:text-3xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Luxury Concierge
        </h2>
        <p className="mt-1 text-sm font-light text-text-secondary">
          Your requests, passed to our staff
        </p>
      </div>

      {/* Panel Content */}
      {/* Chat — AURA Concierge */}
      <OwnerView
        messages={messages}
        processingPhase={processingPhase}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSend}
        messagesEndRef={messagesEndRef}
        messagesContainerRef={messagesContainerRef}
        latestAiMsgId={latestAiMsgId}
        isTypewriting={isTypewriting}
        typewriterChars={typewriterChars}
      />
    </div>
  );
}

// ── Concierge Chat ──────────────────────────────────────────────

function OwnerView({
  messages,
  processingPhase,
  inputValue,
  onInputChange,
  onSend,
  messagesEndRef,
  messagesContainerRef,
  latestAiMsgId,
  isTypewriting = false,
  typewriterChars = 0,
}: {
  messages: ChatMessage[];
  processingPhase: ProcessingPhase;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: (text: string) => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  latestAiMsgId: string | null;
  isTypewriting?: boolean;
  typewriterChars?: number;
}) {
  const isBusy = processingPhase !== "idle";
  return (
    <div className="flex flex-col flex-1" style={{ minHeight: "380px" }}>
      {/* Chat Header */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border px-4 py-3">
        <div className="relative flex-shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal border border-border">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
              <path d="M16 14H8a4 4 0 0 0-4 4v1h16v-1a4 4 0 0 0-4-4z" />
              <circle cx="12" cy="20" r="2" />
            </svg>
          </div>
          {/* Online pulse dot */}
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }} />
            <span className="relative inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium tracking-wide text-text-primary">
            AURA Concierge
          </p>
          <p className="text-xs text-text-muted">
            {isBusy ? "Taking your request..." : "Here to take your request"}
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--aura-accent,#D4AF37)]" />
          {isBusy ? "Active" : "Online"}
        </span>
      </div>

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto rounded-xl border border-border px-4 py-4 space-y-4"
        style={{
          backgroundColor: "var(--aura-surface, #0B0B0B)",
        }}
      >
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg}
            isNew={msg.id === latestAiMsgId}
            typewriterChars={
              msg.id === latestAiMsgId && isTypewriting
                ? typewriterChars
                : undefined
            }
          />
        ))}

        {/* Gold Pulse Loading Indicator */}
        {processingPhase === "processing" && <GoldPulseLoader />}

        {/* Typing indicator */}
        {processingPhase === "typing" && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* Request Chips */}
      <div className="mt-3 flex flex-wrap gap-2 flex-shrink-0">
        {["Request a private chef", "Request a transfer", "Request a boat"].map(
          (prompt) => (
            <button
              key={prompt}
              onClick={() => onSend(prompt)}
              disabled={isBusy}
              className="rounded-full border px-3 py-1.5 text-[11px] font-light tracking-wide transition-all duration-300 border-[var(--aura-border-accent,rgba(212,175,55,0.3))] text-[var(--aura-accent,#D4AF37)] hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {prompt}
            </button>
          ),
        )}
      </div>

      {/* Input Area */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(inputValue);
        }}
        className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-charcoal px-3 py-2 transition-colors duration-300 focus-within:border-[var(--aura-border-accent,rgba(212,175,55,0.3))] flex-shrink-0"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Tell me your plans..."
          disabled={isBusy}
          className="flex-1 bg-transparent px-2 py-1.5 text-sm font-light text-text-primary placeholder:text-text-muted/50 outline-none"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || isBusy}
          className={`
            flex h-8 w-8 items-center justify-center rounded-lg
            transition-all duration-300
            ${
              inputValue.trim() && !isBusy
                ? "bg-[var(--aura-accent,#D4AF37)] text-midnight hover:opacity-90"
                : "bg-border text-text-muted cursor-not-allowed"
            }
          `}
          aria-label="Send message"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}


// ── Gold Pulse Loader ─────────────────────────────────────────────────────────

function GoldPulseLoader() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-4 rounded-2xl border border-[var(--aura-border-accent,rgba(212,175,55,0.25))] bg-charcoal px-5 py-4">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <div className="animate-ai-pulse-ring absolute inset-0 rounded-full" />
          <div
            className="animate-ai-pulse-inner relative flex h-8 w-8 items-center justify-center rounded-full border-2"
            style={{ borderColor: "var(--aura-accent, #D4AF37)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="animate-status-pulse text-xs font-light tracking-wide"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            AURA Concierge is taking your request...
          </p>
        </div>
      </div>
    </div>
  );
}
// ── Chat Bubble ──────────────────────────────────────────────────────────────

function ChatBubble({
  message,
  isNew,
  typewriterChars,
}: {
  message: ChatMessage;
  isNew?: boolean;
  typewriterChars?: number;
}) {
  const isSystem = message.role === "system";
  const isAi = message.role === "ai";
  const isUser = message.role === "user";

  // Typewriter: only for AI messages that have typewriterChars defined and less than full length
  const isTyping = isAi && typewriterChars !== undefined && typewriterChars < message.content.length;
  const displayContent = isTyping ? message.content.slice(0, typewriterChars) : message.content;

  return (
    <div
      className={`
        flex ${isUser ? "justify-end" : "justify-start"}
        ${isNew && !isTyping ? "animate-response-in" : "animate-fade-in-up"}
      `}
    >
      <div
        className={`
          max-w-[90%] sm:max-w-[75%] rounded-2xl px-4 py-3 min-w-0
          ${
            isSystem
              ? "border border-[var(--aura-border-accent,rgba(212,175,55,0.2))] bg-[var(--aura-accent-subtle,rgba(212,175,55,0.08))]"
              : isAi
                ? "border border-border bg-charcoal"
                : "bg-[var(--aura-accent,#D4AF37)] text-midnight"
          }
        `}
      >
        <p className={`text-sm font-light leading-relaxed break-words ${isUser ? "text-midnight" : "text-text-primary"}`}>
          {displayContent}
          {isTyping && <span className="typewriter-cursor">|</span>}
        </p>

        {/* Task cards inside AI message */}
        {message.tasks && message.tasks.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-lg border-l-2 px-3 py-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 max-w-full mr-0 overflow-hidden"
                style={{
                  borderLeftColor: "var(--aura-accent, #D4AF37)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                }}
              >
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.15em] flex-shrink-0 whitespace-nowrap"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  [{task.module} Module]
                </span>
                <span className="text-xs font-light text-text-secondary break-words">
                  — {task.description} <span className="text-[10px] text-text-muted whitespace-nowrap">[AI Auto-Created]</span>
                </span>
              </div>
            ))}

            <p className="pt-2 text-[11px] font-light italic text-text-muted">
              All tasks have been dispatched to your staff dashboard for confirmation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in-up">
      <div className="rounded-2xl border border-border bg-charcoal px-5 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: "var(--aura-accent, #D4AF37)",
                animation: `typing-bounce 0.8s ${i * 0.15}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── StaffPanel — AI-Generated Task Checklist ────────────────────────────────

function StaffPanel({
  tasks,
  setTasks,
  guestRequests,
  requestsStorageError,
  onUpdateRequest,
  onUpdateRequestStatus,
  onRetryRequests,
}: {
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  guestRequests: GuestRequest[];
  requestsStorageError: boolean;
  onUpdateRequest: (id: string, patch: Partial<GuestRequest>) => void;
  onUpdateRequestStatus: (id: string, status: GuestRequestStatus) => void;
  onRetryRequests: () => void;
}) {
  const completedCount = tasks.filter(
    (t) => t.status === "confirmed" || t.status === "completed",
  ).length;

  const handleToggleTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const statusCycle: Record<string, TaskItem["status"]> = {
          pending: "in_progress",
          in_progress: "confirmed",
          confirmed: "completed",
          completed: "pending",
        };
        const nextStatus = statusCycle[t.status] || "pending";
        return {
          ...t,
          status: nextStatus,
          completedAt:
            nextStatus === "completed" ? new Date().toLocaleTimeString() : t.completedAt,
        };
      }),
    );
  }, [setTasks]);

  const handleAssignTask = useCallback(
    (taskId: string, name: string) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, assignedTo: name || undefined } : t)),
      );
    },
    [setTasks],
  );

  return (
    <div className="rounded-2xl border border-border bg-charcoal p-6 md:p-10 lg:p-12 flex flex-col">
      {/* Header area */}
      <div className="mb-8">
        <h2
          className="text-2xl font-light tracking-wide md:text-3xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Staff Operations
        </h2>
        <p className="mt-1 text-sm font-light text-text-secondary">
          AI-generated tasks, dispatched and tracked in real time
        </p>
      </div>

      <StaffView
        tasks={tasks}
        completedCount={completedCount}
        totalCount={tasks.length}
        onToggleTask={handleToggleTask}
        onAssignTask={handleAssignTask}
      />

      {/* Requests — staff-side request management (list + inline editor) */}
      <StaffRequestsSection
        guestRequests={guestRequests}
        requestsStorageError={requestsStorageError}
        onUpdateRequest={onUpdateRequest}
        onUpdateRequestStatus={onUpdateRequestStatus}
        onRetryRequests={onRetryRequests}
      />
    </div>
  );
}

// ── Staff Requests — filterable list with an inline detail editor ─────────────
type RequestFilter = GuestRequestStatus | "all";
const REQUEST_FILTERS: RequestFilter[] = ["all", ...GUEST_REQUEST_STATUSES];

function formatRequestAmount(value: number | null): string {
  if (value === null) return "—";
  return `€ ${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function formatRequestStamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function requestStatusBadge(status: GuestRequestStatus): string {
  const base =
    "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]";
  return status === "cancelled"
    ? `${base} border-border text-text-muted`
    : `${base} border-[var(--aura-accent,#D4AF37)] text-[var(--aura-accent,#D4AF37)]`;
}
const requestInputClass =
  "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-light text-text-primary outline-none transition-colors duration-200 focus:border-[var(--aura-accent,#D4AF37)]";
const requestLabelClass =
  "text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted";

function StaffRequestsSection({
  guestRequests,
  requestsStorageError,
  onUpdateRequest,
  onUpdateRequestStatus,
  onRetryRequests,
}: {
  guestRequests: GuestRequest[];
  requestsStorageError: boolean;
  onUpdateRequest: (id: string, patch: Partial<GuestRequest>) => void;
  onUpdateRequestStatus: (id: string, status: GuestRequestStatus) => void;
  onRetryRequests: () => void;
}) {
  const [filter, setFilter] = useState<RequestFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Newest first — a request that just came in sits at the top of the list.
  const sorted = useMemo(
    () =>
      [...guestRequests].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      ),
    [guestRequests],
  );
  const counts = useMemo(() => {
    const acc: Record<RequestFilter, number> = {
      all: guestRequests.length,
      received: 0,
      in_progress: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const request of guestRequests) acc[request.status] += 1;
    return acc;
  }, [guestRequests]);
  const rows = filter === "all" ? sorted : sorted.filter((r) => r.status === filter);

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          className="text-xs font-medium uppercase tracking-[0.15em]"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Requests
        </h3>
        <span className="text-[10px] font-light text-text-muted">
          {counts.all} total
        </span>
      </div>
      <p className="mt-1 text-xs font-light text-text-muted">
        Recorded requests from guests. Amounts are recorded only — nothing is
        charged in the app.
      </p>
      {/* Status filter */}
      <div className="mt-4 flex flex-wrap gap-2">
        {REQUEST_FILTERS.map((key) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors duration-200 ${
                isActive
                  ? "bg-[var(--aura-accent,#D4AF37)] text-midnight"
                  : "text-text-secondary hover:text-[var(--aura-accent,#D4AF37)]"
              }`}
              style={{
                borderColor: isActive
                  ? "var(--aura-accent, #D4AF37)"
                  : "var(--color-border, #2A2A2A)",
              }}
            >
              {key === "all" ? "All" : GUEST_REQUEST_LABELS[key]} ({counts[key]})
            </button>
          );
        })}
      </div>
      {requestsStorageError && (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"
          style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}
        >
          <p className="text-xs font-light text-text-secondary">
            We couldn't load your requests. Please try again.
          </p>
          <button
            onClick={onRetryRequests}
            className="cursor-pointer rounded-md border border-[var(--aura-accent,#D4AF37)] px-3 py-1 text-[11px] font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-colors duration-200 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
          >
            Retry
          </button>
        </div>
      )}
      {guestRequests.length === 0 ? (
        <div
          className="mt-4 rounded-2xl border border-border px-6 py-8 text-center"
          style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}
        >
          <p className="text-sm font-light text-text-primary">No requests yet</p>
          <p className="mt-1 text-xs font-light text-text-muted">
            Requests from guests will appear here.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="mt-4 rounded-2xl border border-border px-6 py-6 text-center"
          style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}
        >
          <p className="text-xs font-light text-text-muted">
            No requests with this status.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((request) => (
            <StaffRequestRow
              key={request.id}
              request={request}
              isExpanded={expandedId === request.id}
              onToggle={() =>
                setExpandedId(expandedId === request.id ? null : request.id)
              }
              onUpdateRequest={onUpdateRequest}
              onUpdateRequestStatus={onUpdateRequestStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StaffRequestRow({
  request,
  isExpanded,
  onToggle,
  onUpdateRequest,
  onUpdateRequestStatus,
}: {
  request: GuestRequest;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateRequest: (id: string, patch: Partial<GuestRequest>) => void;
  onUpdateRequestStatus: (id: string, status: GuestRequestStatus) => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}
    >
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full cursor-pointer items-start justify-between gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-white/5"
      >
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-wide text-text-primary">
            {request.guestName}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-light text-text-secondary">
            {request.serviceType}
          </p>
          <p className="mt-0.5 truncate text-[10px] font-light text-text-muted">
            {request.villaName}
          </p>
          <p className="mt-1 text-[10px] font-light text-text-muted">
            Updated {formatRequestStamp(request.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={requestStatusBadge(request.status)}>
            {GUEST_REQUEST_LABELS[request.status]}
          </span>
          <span className="text-[11px] font-light tracking-wide text-text-secondary">
            {formatRequestAmount(request.price)}
          </span>
          <span
            className="text-[9px]"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            {isExpanded ? "▲" : "▼"}
          </span>
        </div>
      </button>
      {isExpanded && (
        <div className="animate-fade-in border-t border-border px-4 py-4">
          <StaffRequestEditor
            request={request}
            onUpdateRequest={onUpdateRequest}
            onUpdateRequestStatus={onUpdateRequestStatus}
          />
        </div>
      )}
    </div>
  );
}

// Detail editor — every field here only RECORDS data; nothing is charged.
function StaffRequestEditor({
  request,
  onUpdateRequest,
  onUpdateRequestStatus,
}: {
  request: GuestRequest;
  onUpdateRequest: (id: string, patch: Partial<GuestRequest>) => void;
  onUpdateRequestStatus: (id: string, status: GuestRequestStatus) => void;
}) {
  // Local strings so a half-typed value ("12.") never fights the stored number.
  const [priceInput, setPriceInput] = useState(
    request.price === null ? "" : String(request.price),
  );
  const [agencyInput, setAgencyInput] = useState(String(request.agencyPct));
  const [auraInput, setAuraInput] = useState(String(request.auraPct));
  const [note, setNote] = useState(request.staffNote);

  const parsedPrice = priceInput.trim() === "" ? null : Number(priceInput);
  const price =
    parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0
      ? parsedPrice
      : null;
  const clampPct = (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
  };
  const agencyPct = clampPct(agencyInput);
  const auraPct = clampPct(auraInput);
  // The supplier share is the remainder, so the two percentages may never sum
  // above 100 — such a pair is shown but not committed, with a hint below.
  const pctOverflow = agencyPct + auraPct > 100;
  const showSplit = price !== null && price > 0 && !pctOverflow;
  const split = splitRequestAmounts(price, agencyPct, auraPct);

  const updatePrice = (value: string) => {
    setPriceInput(value);
    if (value.trim() === "") {
      onUpdateRequest(request.id, { price: null });
      return;
    }
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) onUpdateRequest(request.id, { price: n });
  };
  const updatePct = (nextAgency: number, nextAura: number) => {
    if (nextAgency + nextAura > 100) return;
    onUpdateRequest(request.id, { agencyPct: nextAgency, auraPct: nextAura });
  };

  return (
    <div className="space-y-4">
      {request.details && (
        <p className="text-[11px] font-light text-text-secondary">
          {request.details}
        </p>
      )}
      {/* Status — this is what the guest timeline follows */}
      <div>
        <p className={requestLabelClass}>Status</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GUEST_REQUEST_STATUSES.map((status) => {
            const isActive = request.status === status;
            return (
              <button
                key={status}
                onClick={() => onUpdateRequestStatus(request.id, status)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors duration-200 ${
                  isActive
                    ? "bg-[var(--aura-accent,#D4AF37)] text-midnight"
                    : "text-text-secondary hover:text-[var(--aura-accent,#D4AF37)]"
                }`}
                style={{
                  borderColor: isActive
                    ? "var(--aura-accent, #D4AF37)"
                    : "var(--color-border, #2A2A2A)",
                }}
              >
                {GUEST_REQUEST_LABELS[status]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={requestLabelClass} htmlFor={`request-price-${request.id}`}>
            Price (EUR)
          </label>
          <input
            id={`request-price-${request.id}`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={priceInput}
            onChange={(e) => updatePrice(e.target.value)}
            placeholder="—"
            className={`mt-1.5 ${requestInputClass}`}
          />
        </div>
        <div>
          <label className={requestLabelClass} htmlFor={`request-agency-${request.id}`}>
            Agency %
          </label>
          <input
            id={`request-agency-${request.id}`}
            type="number"
            min={0}
            max={100}
            step="0.5"
            inputMode="decimal"
            value={agencyInput}
            onChange={(e) => {
              setAgencyInput(e.target.value);
              updatePct(clampPct(e.target.value), auraPct);
            }}
            className={`mt-1.5 ${requestInputClass}`}
          />
        </div>
        <div>
          <label className={requestLabelClass} htmlFor={`request-aura-${request.id}`}>
            AURA %
          </label>
          <input
            id={`request-aura-${request.id}`}
            type="number"
            min={0}
            max={100}
            step="0.5"
            inputMode="decimal"
            value={auraInput}
            onChange={(e) => {
              setAuraInput(e.target.value);
              updatePct(agencyPct, clampPct(e.target.value));
            }}
            className={`mt-1.5 ${requestInputClass}`}
          />
        </div>
      </div>
      {pctOverflow && (
        <p
          className="text-[10px] font-light"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Agency % + AURA % must stay at or below 100 — the supplier share is the
          remainder.
        </p>
      )}
      {/* Derived amounts — computed live from price + percentages, never stored */}
      {showSplit && split.agencyAmount !== null ? (
        <div
          className="rounded-lg border border-border px-3 py-3"
          style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}
        >
          <div className="flex items-center justify-between text-[11px] font-light">
            <span className="text-text-secondary">Recorded price</span>
            <span className="tracking-wide text-text-primary">
              {formatRequestAmount(price)}
            </span>
          </div>
          <div className="mt-2 space-y-1.5 border-t border-border pt-2">
            <div className="flex items-center justify-between text-[11px] font-light">
              <span className="text-text-muted">Supplier (remainder)</span>
              <span
                className="tracking-wide"
                style={{ color: "var(--aura-accent, #D4AF37)" }}
              >
                {formatRequestAmount(split.supplierAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-light">
              <span className="text-text-muted">Agency ({agencyPct}%)</span>
              <span
                className="tracking-wide"
                style={{ color: "var(--aura-accent, #D4AF37)" }}
              >
                {formatRequestAmount(split.agencyAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-light">
              <span className="text-text-muted">AURA ({auraPct}%)</span>
              <span
                className="tracking-wide"
                style={{ color: "var(--aura-accent, #D4AF37)" }}
              >
                {formatRequestAmount(split.auraAmount)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] font-light text-text-muted">
          Set a price to see the split
        </p>
      )}
      <div>
        <label className={requestLabelClass} htmlFor={`request-note-${request.id}`}>
          Staff note
        </label>
        <textarea
          id={`request-note-${request.id}`}
          rows={3}
          value={note}
          placeholder="Internal note for this request"
          onChange={(e) => {
            setNote(e.target.value);
            onUpdateRequest(request.id, { staffNote: e.target.value });
          }}
          className={`mt-1.5 resize-none ${requestInputClass}`}
        />
      </div>
      <p className="text-[10px] font-light text-text-muted">
        Created {formatRequestStamp(request.createdAt)} · Updated{" "}
        {formatRequestStamp(request.updatedAt)}
      </p>
    </div>
  );
}

// ── Staff View — Interactive Checklist ───────────────────────────────────────

function StaffView({
  tasks,
  completedCount,
  totalCount,
  onToggleTask,
  onAssignTask,
}: {
  tasks: TaskItem[];
  completedCount: number;
  totalCount: number;
  onToggleTask: (taskId: string) => void;
  onAssignTask: (taskId: string, name: string) => void;
}) {
  const pendingTasks = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  const completedTasks = tasks.filter((t) => t.status === "confirmed" || t.status === "completed");
  const doneCount = completedTasks.length;
  const donePct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  const progressPct = donePct;

  // Empty state
  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 animate-fade-in-up">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-muted/40"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
        <p className="mt-4 text-sm font-light tracking-wide text-text-muted">
          No active tasks.
        </p>
        <p className="mt-1 text-xs text-text-muted/60">
          Waiting for owner instructions...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* View Header */}
      <div>
        <h3 className="text-lg font-light tracking-wide text-text-primary md:text-xl">
          Staff Task Dashboard
        </h3>
        <p className="mt-1 text-sm font-light text-text-muted">
          Tasks pending confirmation
        </p>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-light tracking-wide text-text-secondary">
            {doneCount} of {totalCount} tasks completed
          </span>
          <span
            className="font-medium"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            {Math.round(progressPct)}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${progressPct}%`,
              backgroundColor: "var(--aura-accent, #D4AF37)",
            }}
          />
        </div>
      </div>

      {/* Pending Tasks */}
      {pendingTasks.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Pending / In Progress
          </p>
          {pendingTasks.map((task) => (
            <TaskCard key={task.id} task={task} onToggle={onToggleTask} onAssign={onAssignTask} />
          ))}
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Confirmed / Completed
          </p>
          {completedTasks.map((task) => (
            <TaskCard key={task.id} task={task} onToggle={onToggleTask} onAssign={onAssignTask} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task Card ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TaskItem["status"] }) {
  const config: Record<TaskItem["status"], { bg: string; text: string; label: string }> = {
    pending: { bg: "rgba(212,175,55,0.15)", text: "#D4AF37", label: "Pending" },
    in_progress: { bg: "rgba(245,158,11,0.15)", text: "#F59E0B", label: "In Progress" },
    confirmed: { bg: "rgba(16,185,129,0.15)", text: "#10B981", label: "Confirmed" },
    completed: { bg: "rgba(107,114,128,0.15)", text: "#9CA3AF", label: "Completed" },
  };
  const c = config[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  );
}

function TaskCard({
  task,
  onToggle,
  onAssign,
}: {
  task: TaskItem;
  onToggle: (taskId: string) => void;
  onAssign: (taskId: string, name: string) => void;
}) {
  const [showAssignInput, setShowAssignInput] = useState(false);
  const [assignValue, setAssignValue] = useState(task.assignedTo || "");
  const staffRoles = ["Driver Marco", "Chef Antoine", "Housekeeping Maria", "Security Team", "Concierge Desk", "Maintenance Staff"];

  const isCompleted = task.status === "completed";
  const isConfirmed = task.status === "confirmed";
  const isDone = isCompleted || isConfirmed;
  const isPending = task.status === "pending";

  // Extract guest count and room info from description
  const guestMatch = task.description.match(/(\d+)\s*guests?/i);
  const roomMatch = task.description.match(/(master|guest|bed)\s*(suite|room|bedroom)/i);
  const contextBadge = guestMatch ? `${guestMatch[1]} guests` : null;
  const contextRoom = roomMatch ? roomMatch[0] : null;

  // Action label based on status
  const actionLabel = task.status === "pending" ? "Start" : task.status === "in_progress" ? "Confirm" : task.status === "confirmed" ? "Complete" : "";

  const handleAssignSubmit = () => {
    const trimmed = assignValue.trim();
    onAssign(task.id, trimmed);
    setShowAssignInput(false);
  };

  return (
    <div
      className={`
        group flex flex-col gap-2 rounded-xl border px-5 py-4
        transition-all duration-300
        ${
          isDone
            ? "border-border/50 opacity-60"
            : "border-border hover:border-[var(--aura-border-accent,rgba(212,175,55,0.3))]"
        }
      `}
      style={{
        backgroundColor: isDone
          ? "rgba(26,26,26,0.6)"
          : "var(--aura-card, #1A1A1A)",
      }}
    >
      {/* Top row: status + module + assignment */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Left accent + status indicator */}
        <button
          onClick={() => onToggle(task.id)}
          className="flex-shrink-0"
          title="Cycle status"
        >
          {isDone ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--aura-accent,#D4AF37)]">
              <svg
                width="14"
                height="14"
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
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-300 hover:border-[var(--aura-accent,#D4AF37)]"
              style={{
                borderColor: task.status === "in_progress" ? "#F59E0B" : "var(--aura-accent, #D4AF37)",
              }}
            >
              <span
                className={`h-3 w-3 rounded-full ${
                  task.status === "in_progress" ? "animate-pulse" : ""
                }`}
                style={{
                  backgroundColor: task.status === "in_progress" ? "#F59E0B" : "var(--aura-accent, #D4AF37)",
                  opacity: task.status === "in_progress" ? 1 : 0.3,
                }}
              />
            </div>
          )}
        </button>

        <span
          className="text-[10px] font-semibold uppercase tracking-[0.15em]"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          [{task.module} Module]
        </span>

        <StatusBadge status={task.status} />

        {/* Assignment area */}
        <div className="ml-auto flex items-center gap-1">
          {showAssignInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={assignValue}
                onChange={(e) => setAssignValue(e.target.value)}
                onBlur={handleAssignSubmit}
                onKeyDown={(e) => { if (e.key === "Enter") handleAssignSubmit(); }}
                placeholder="Assign staff member..."
                className="rounded-lg border border-[var(--aura-accent,#D4AF37)] bg-midnight px-2 py-1 text-[10px] text-text-primary outline-none w-36"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => setShowAssignInput(true)}
              className="text-[10px] font-light text-text-muted hover:text-[var(--aura-accent,#D4AF37)] transition-colors duration-200"
              title="Assign staff"
            >
              Assigned to:{" "}
              <span className={task.assignedTo ? "text-text-secondary" : "italic"}>
                {task.assignedTo || "Unassigned"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Staff role suggestions when input is open */}
      {showAssignInput && (
        <div className="flex flex-wrap gap-1 pl-10">
          {staffRoles.map((role) => (
            <button
              key={role}
              onMouseDown={(e) => {
                e.preventDefault();
                setAssignValue(role);
                onAssign(task.id, role);
                setShowAssignInput(false);
              }}
              className="rounded-md border border-border px-2 py-0.5 text-[9px] text-text-muted hover:border-[var(--aura-accent,#D4AF37)] hover:text-[var(--aura-accent,#D4AF37)] transition-colors duration-200"
            >
              {role}
            </button>
          ))}
        </div>
      )}

      {/* Description row */}
      <div className="flex-1 min-w-0 pl-10">
        <p
          className={`text-sm font-light ${
            isDone ? "text-text-muted line-through" : "text-text-primary"
          }`}
        >
          {task.description}
        </p>

        {/* Metadata row */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {task.createdAt && (
            <span className="text-[10px] font-light text-text-muted/70">
              Created: {task.createdAt}
            </span>
          )}
          {contextBadge && (
            <span className="inline-flex items-center rounded-full border border-border/50 px-1.5 py-0.5 text-[9px] text-text-muted/70">
              {contextBadge}
              {contextRoom && ` · ${contextRoom}`}
            </span>
          )}
          {isCompleted && task.completedAt && (
            <span className="text-[10px] font-light text-text-muted/70">
              Completed: {task.completedAt}
            </span>
          )}
          {isConfirmed && (
            <span className="text-[10px] font-light text-emerald-400/70">
              Awaiting final confirmation
            </span>
          )}
        </div>
      </div>

      {/* Action button row */}
      {actionLabel && (
        <div className="pl-10">
          <button
            onClick={() => onToggle(task.id)}
            className="rounded-lg border border-[var(--aura-accent,#D4AF37)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))]"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCIERGE PANEL — Luxury Marketplace + Booking Escrow
// ═══════════════════════════════════════════════════════════════════════════════

function ServicesPanel({
  onAddTask,
  activeProperty,
  guestRequests,
  requestsStorageError,
  onCreateRequest,
  onRetryRequests,
}: {
  onAddTask: (task: TaskItem) => void;
  activeProperty: Property;
  guestRequests: GuestRequest[];
  requestsStorageError: boolean;
  onCreateRequest: (serviceType: string) => void;
  onRetryRequests: () => void;
}) {
  const [bookingService, setBookingService] = useState<ConciergeService | null>(null);

  return (
    <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-10 lg:p-12">
      {/* Header */}
      <div className="mb-10">
        <h2
          className="text-2xl font-light tracking-wide md:text-3xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Concierge Services
        </h2>
        <p className="mt-2 font-light text-text-secondary">
          Curated luxury, available on demand
        </p>
        <div
          className="mt-6 h-px w-24"
          style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
        />
      </div>

      {/* Service Cards Grid */}
      <div className="grid gap-6 sm:grid-cols-2">
        {conciergeServices.map((service, idx) => (
          <ServiceCard
            key={service.id}
            service={service}
            index={idx}
            onBook={() => setBookingService(service)}
          />
        ))}
      </div>

      {/* Your Requests — guest-facing request timeline */}
      <div className="mt-12">
        <h3 className="text-lg font-light tracking-wide text-text-primary md:text-xl">
          Your Requests
        </h3>
        <p className="mt-1 text-sm font-light text-text-muted">
          Every request is passed to our staff, who confirm it with you.
        </p>

        {requestsStorageError && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3" style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}>
            <p className="text-xs font-light text-text-secondary">
              We couldn't load your requests. Please try again.
            </p>
            <button
              onClick={onRetryRequests}
              className="cursor-pointer rounded-md border border-[var(--aura-accent,#D4AF37)] px-3 py-1 text-[11px] font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-colors duration-200 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
            >
              Retry
            </button>
          </div>
        )}

        {guestRequests.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-border px-6 py-8 text-center" style={{ backgroundColor: "var(--aura-surface, #0B0B0B)" }}>
            <p className="text-sm font-light text-text-muted">
              No requests yet — choose a service above and we'll pass it to our staff.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {guestRequests.map((request) => (
              <GuestRequestCard key={request.id} request={request} />
            ))}
          </div>
        )}
      </div>

      {/* Request Modal */}
      {bookingService && (
        <BookingModal
          service={bookingService}
          activeProperty={activeProperty}
          onClose={() => setBookingService(null)}
          onAddTask={onAddTask}
          onCreateRequest={onCreateRequest}
        />
      )}
    </div>
  );
}

// ── Guest Request Card — status + lifecycle timeline ──────────────────────────
function GuestRequestCard({ request }: { request: GuestRequest }) {
  const isCancelled = request.status === "cancelled";
  const currentIndex = GUEST_REQUEST_STEPS.indexOf(
    request.status as Exclude<GuestRequestStatus, "cancelled">,
  );
  const created = new Date(request.createdAt);
  const createdLabel = isNaN(created.getTime())
    ? request.createdAt
    : created.toLocaleString();
  const isDone = request.status === "confirmed" || request.status === "completed";
  return (
    <div className="rounded-2xl border border-border bg-charcoal p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-wide text-text-primary">
            {request.serviceType}
          </p>
          <p className="mt-1 text-xs font-light text-text-muted">
            {request.villaName} · {createdLabel}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${
            isDone ? "" : "text-text-muted"
          }`}
          style={{
            borderColor: isDone ? "var(--aura-accent, #D4AF37)" : "#2A2A2A",
            color: isDone ? "var(--aura-accent, #D4AF37)" : undefined,
          }}
        >
          {GUEST_REQUEST_LABELS[request.status]}
        </span>
      </div>
      {isCancelled ? (
        <p className="mt-4 text-xs font-light text-text-muted">
          This request was cancelled — please submit a new one if you still need it.
        </p>
      ) : (
        <div className="mt-5 flex items-start">
          {GUEST_REQUEST_STEPS.map((step, idx) => {
            const reached = idx <= currentIndex;
            return (
              <div
                key={step}
                className={`flex items-center ${idx === GUEST_REQUEST_STEPS.length - 1 ? "" : "flex-1"}`}
              >
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: reached
                        ? "var(--aura-accent, #D4AF37)"
                        : "#2A2A2A",
                    }}
                  />
                  <span
                    className={`whitespace-nowrap text-[9px] uppercase tracking-wider ${
                      reached ? "text-[var(--aura-accent,#D4AF37)]" : "text-text-muted"
                    }`}
                  >
                    {GUEST_REQUEST_LABELS[step]}
                  </span>
                </div>
                {idx < GUEST_REQUEST_STEPS.length - 1 && (
                  <span
                    className="mx-2 mb-4 h-px flex-1"
                    style={{
                      backgroundColor:
                        idx < currentIndex ? "var(--aura-accent, #D4AF37)" : "#2A2A2A",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({
  service,
  index = 0,
  onBook,
}: {
  service: ConciergeService;
  index?: number;
  onBook: () => void;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border bg-charcoal transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] hover:scale-[1.02] hover:border-[var(--aura-accent,#D4AF37)] animate-slide-up-staggered gold-glow-hover"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Thumbnail image banner */}
      <div className="relative h-[120px] w-full overflow-hidden">
        <img
          src={conciergeImages[service.icon]}
          alt={service.title}
          className="h-full w-full object-cover"
        />
        {/* Dark vignette overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.6) 100%)
            `,
          }}
        />
      </div>

      {/* Card content */}
      <div className="p-6 md:p-8">
        {/* Title */}
        <h3 className="text-lg font-light tracking-wide text-text-primary md:text-xl">
          {service.title}
        </h3>

        {/* Subtitle */}
        <p className="mt-1.5 text-sm font-light text-text-muted">
          {service.subtitle}
        </p>

        {/* Price */}
        <p
          className="mt-5 text-2xl font-light tracking-wide md:text-3xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          {service.price}
        </p>

        {/* CTA Button */}
        <button
          onClick={onBook}
          className="mt-6 w-full cursor-pointer rounded-lg border border-[var(--aura-accent,#D4AF37)] bg-transparent px-4 py-3 text-sm font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
        >
          {service.cta}
        </button>
      </div>
    </div>
  );
}

// ── Service Icon ──────────────────────────────────────────────────────────────

function ServiceIcon({ type }: { type: ConciergeService["icon"] }) {
  const accent = "var(--aura-accent, #D4AF37)";

  switch (type) {
    case "yacht":
      return (
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke={accent}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 26c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4-2 6 0" opacity="0.4" />
          <path d="M6 18l4-6h12l4 6" />
          <line x1="16" y1="12" x2="16" y2="4" />
          <path d="M16 4l-5 4h10l-5-4z" />
          <line x1="12" y1="18" x2="12" y2="22" opacity="0.5" />
          <line x1="20" y1="18" x2="20" y2="22" opacity="0.5" />
        </svg>
      );

    case "chauffeur":
      return (
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke={accent}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="12" width="22" height="8" rx="2" />
          <path d="M7 12l2-4h14l2 4" />
          <circle cx="10" cy="22" r="2.5" />
          <circle cx="22" cy="22" r="2.5" />
          <line x1="6" y1="18" x2="26" y2="18" opacity="0.2" />
        </svg>
      );

    case "catering":
      return (
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke={accent}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="16" cy="8" r="4" />
          <path d="M8 16c0-2 1.79-4 4-4h8c2.21 0 4 2 4 4v2c0 4-3.58 8-8 8s-8-4-8-8v-2z" />
          <line x1="12" y1="28" x2="20" y2="28" />
          <path d="M10 22l-4 6" opacity="0.4" />
          <path d="M22 22l4 6" opacity="0.4" />
        </svg>
      );

    case "aviation":
      return (
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke={accent}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 26l10-5-2-6 8-2 4 8 6-2-3-9 3-4-4-1-5 5-9-3-2 6 8 3-4 5z" />
          <path d="M2 28h28" opacity="0.3" />
        </svg>
      );
  }
}

// ── Booking Modal ─────────────────────────────────────────────────────────────

function BookingModal({
  service,
  activeProperty,
  onClose,
  onAddTask,
  onCreateRequest,
}: {
  service: ConciergeService;
  activeProperty: Property;
  onClose: () => void;
  onAddTask: (task: TaskItem) => void;
  onCreateRequest: (serviceType: string) => void;
}) {
  const [step, setStep] = useState<"details" | "sent">("details");
  const [isClosing, setIsClosing] = useState(false);
  const sentRef = useRef(false);
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };
  // Sending a request records it for the guest and dispatches a staff task.
  // Nothing is charged here and nothing is confirmed here.
  const handleSendRequest = () => {
    if (sentRef.current) return;
    sentRef.current = true;
    onAddTask({
      id: generateTaskId(),
      module: "Concierge",
      description: `[CONCIERGE] ${service.title} — ${service.price} — Request submitted, awaiting staff confirmation`,
      status: "pending",
      createdAt: new Date().toLocaleTimeString(),
    });
    onCreateRequest(service.title);
    setStep("sent");
  };
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        isClosing ? "animate-fade-out pointer-events-none" : ""
      }`}
      onClick={step === "sent" ? handleClose : undefined}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      {/* Modal card */}
      <div
        className={`relative z-10 mx-4 w-full max-w-md rounded-2xl border border-border p-8 ${
          isClosing ? "animate-fade-out" : "animate-slide-up"
        }`}
        style={{ backgroundColor: "var(--aura-card, #1A1A1A)" }}
      >
        {step === "details" ? (
          <div className="animate-fade-in-up flex flex-col space-y-6">
            <div className="flex flex-col items-center space-y-3 text-center">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full border-2"
                style={{
                  borderColor: "var(--aura-accent, #D4AF37)",
                  color: "var(--aura-accent, #D4AF37)",
                }}
              >
                <ServiceIcon type={service.icon} />
              </div>
              <p
                className="text-xl font-light tracking-wide"
                style={{ color: "var(--aura-accent, #D4AF37)" }}
              >
                {service.title}
              </p>
              <p className="text-sm font-light text-text-secondary">
                {service.subtitle}
              </p>
            </div>

            <div
              className="w-full rounded-xl border border-border p-4"
              style={{ backgroundColor: "rgba(11,11,11,0.6)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                  Price
                </span>
                <span className="text-xs font-light tracking-wide text-text-secondary">
                  {service.price}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                  Property
                </span>
                <span className="text-xs font-light tracking-wide text-text-secondary">
                  {activeProperty.name}
                </span>
              </div>
              <p className="mt-3 text-[10px] font-light leading-relaxed text-text-muted/60">
                Indicative only — our staff confirm availability and the final
                price with you.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 cursor-pointer rounded-lg border border-border px-4 py-3 text-sm font-light tracking-wider text-text-secondary transition-colors duration-300 hover:border-[var(--aura-accent,#D4AF37)] hover:text-[var(--aura-accent,#D4AF37)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSendRequest}
                className="flex-1 cursor-pointer rounded-lg border border-[var(--aura-accent,#D4AF37)] px-4 py-3 text-sm font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
              >
                Send request
              </button>
            </div>
          </div>
        ) : (
          <div className="animate-fade-in-up flex flex-col items-center space-y-6 text-center">
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
                style={{ color: "var(--aura-accent, #D4AF37)" }}
              >
                Request sent
              </p>
              <p className="mt-2 text-sm font-light text-text-secondary">
                {service.title}
              </p>
            </div>
            <p className="text-xs font-light leading-relaxed text-text-secondary">
              I've sent your request to our staff. You'll see the status here
              once it's confirmed.
            </p>
            <p className="text-[10px] font-light text-text-muted/60">
              Follow the status under Services → Your Requests.
            </p>
            <button
              onClick={handleClose}
              className="mt-2 cursor-pointer rounded-lg border border-[var(--aura-accent,#D4AF37)] px-6 py-3 text-sm font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
interface RevenueTransaction {
  id: string;
  /** Canonical catalogue service name, or a descriptive niche service. */
  service: string;
  /** Demo supplier label — the key used for per-supplier overrides. */
  supplier: string;
  /** What the guest pays; every share is derived from this via computeSplit. */
  guestPrice: number;
  status: "approved" | "pending";
}

interface RevenueStat {
  label: string;
  value: string;
  subLabel: string;
}

function formatCurrency(value: number): string {
  return `€${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffMin < 1) return "Just now";
  if (diffMin === 1) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  if (diffHr === 1) return "1 hour ago";
  if (diffHr < 24) return `${diffHr} hours ago`;
  const d = new Date(timestamp);
  return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function RevenuePanel({
  revenueTransactions,
  activeProperty,
}: {
  revenueTransactions: RevenueTransaction[];
  activeProperty: Property;
}) {
  // Every share is derived on render from revenueConfig / per-supplier
  // overrides via computeSplit — no fee figure is stored or hand-typed.
  const rows = revenueTransactions
    // Guard: ignore any legacy row that predates the guestPrice shape so stale
    // data can never render NaN.
    .filter((t) => typeof t.guestPrice === "number" && Number.isFinite(t.guestPrice))
    .map((t) => ({ ...t, split: computeSplit(t.guestPrice, t.supplier) }));

  // Totals are the sum of the rendered rows (the same `rows` array the table maps).
  const totals = rows.reduce(
    (acc, r) => ({
      guestPrice: acc.guestPrice + r.guestPrice,
      supplierShare: acc.supplierShare + r.split.supplierShare,
      agencyCommission: acc.agencyCommission + r.split.agencyCommission,
      auraFee: acc.auraFee + r.split.auraFee,
    }),
    { guestPrice: 0, supplierShare: 0, agencyCommission: 0, auraFee: 0 },
  );
  const approvedRows = rows.filter((r) => r.status === "approved");
  const totalClientSpend = totals.guestPrice;
  const totalPlatformRevenue = approvedRows.reduce((sum, r) => sum + r.split.auraFee, 0);
  const totalAgencyCommissions = totals.agencyCommission;
  // Worked example shown in the "How this is calculated" block, taken from the
  // first rendered row (so it can never drift from the real figures).
  const workedExample = rows[0];
  const revenueStats: RevenueStat[] = [
    { label: "Total Client Spend via App", value: formatCurrency(totalClientSpend), subLabel: "Current quarter" },
    { label: "Agency commission (example)", value: formatCurrency(totalAgencyCommissions), subLabel: `${revenueConfig.agencyCommissionPct}% Avg Share` },
    { label: "Pricing (demo)", value: subscriptionPrice, subLabel: "1 Property" },
  ];

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-10 lg:p-12">
        <div className="mb-10">
          <div className="flex items-center gap-3">
            <h2
              className="text-2xl font-light tracking-wide md:text-3xl"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              Agency Revenue Analytics
            </h2>
            {/* Private badge */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]"
              style={{
                borderColor: "var(--aura-border-accent, rgba(212,175,55,0.3))",
                color: "var(--aura-accent, #D4AF37)",
                backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.1))",
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                <circle cx="12" cy="16" r="1" />
              </svg>
              Private
            </span>
          </div>
          <p className="mt-2 font-light text-text-secondary">
            Performance overview for property managers
          </p>
          <div
            className="mt-6 h-px w-24"
            style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
          />
        </div>

        {/* Part A: Summary Stat Boxes */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {revenueStats.map((stat, idx) => (
            <div
              key={idx}
              className="group relative overflow-hidden rounded-xl border border-border bg-charcoal transition-all duration-300 hover:-translate-y-1 hover:border-[var(--aura-border-accent,rgba(212,175,55,0.3))] animate-slide-up-staggered gold-glow-hover"
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              {/* Gold top-border accent */}
              <div
                className="absolute left-0 right-0 top-0 h-[3px]"
                style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
              />
              <div className="p-6 pt-7 md:p-8 md:pt-9">
                <DemoDataBadge />
                <p className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                  {stat.label}
                </p>
                <p
                  className="mt-4 text-3xl font-light tracking-wide md:text-4xl lg:text-5xl"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {stat.value}
                </p>
                <p className="mt-2 text-xs font-light text-text-muted">
                  {stat.subLabel}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Part B: Micro-Ledger */}
      <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-10 lg:p-12">
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-light tracking-wide text-text-primary md:text-2xl">
              Recent Transactions
            </h3>
            <DemoDataBadge />
          </div>
          <p className="mt-1 text-sm font-light text-text-muted">
            Current quarter — agency commission breakdown
          </p>
        </div>

        {/* Responsive table wrapper */}
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full min-w-[700px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="pb-4 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  Service
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  Guest price
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {`Supplier (${revenueConfig.supplierSharePct}%)`}
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {`Agency (${revenueConfig.agencyCommissionPct}%)`}
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {`AURA (${revenueConfig.auraFeePct}%)`}
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={tx.id}
                    className="ledger-row"
                    style={{
                      backgroundColor: isEven
                        ? "var(--aura-card, #1A1A1A)"
                        : "#1E1E1E",
                    }}
                  >
                    <td className="py-4 pl-4 text-sm font-light tracking-wide text-text-primary first:rounded-l-lg">
                      {tx.service}
                      <span className="mt-0.5 block text-[11px] font-light text-text-muted">
                        {tx.supplier}
                      </span>
                    </td>
                    <td className="py-4 text-right text-sm font-light text-text-secondary">
                      {formatCurrency(tx.guestPrice)}
                    </td>
                    <td className="py-4 pr-2 text-right text-sm font-light text-text-secondary">
                      {formatCurrency(tx.split.supplierShare)}
                    </td>
                    <td
                      className="py-4 pr-2 text-right text-sm font-medium tracking-wide"
                      style={{ color: "var(--aura-accent, #D4AF37)" }}
                    >
                      {formatCurrency(tx.split.agencyCommission)}
                    </td>
                    <td
                      className="py-4 pr-2 text-right text-sm font-light tracking-wide"
                      style={{ color: "var(--aura-accent, #D4AF37)" }}
                    >
                      {formatCurrency(tx.split.auraFee)}
                    </td>
                    <td className="py-4 pr-4 text-right last:rounded-r-lg">
                      <BookingStatusBadge status={tx.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals row */}
            <tfoot>
              <tr>
                <td
                  colSpan={6}
                  className="pt-6"
                >
                  <div
                    className="h-px w-full"
                    style={{
                      background:
                        "linear-gradient(to right, var(--aura-accent, #D4AF37), transparent)",
                      opacity: 0.3,
                    }}
                  />
                </td>
              </tr>
              {/* Totals row — summed from the rows rendered above. */}
              <tr className="border-t border-[var(--aura-border-accent,rgba(212,175,55,0.3))]">
                <td className="py-3 pl-4 text-sm font-semibold tracking-wide text-text-primary">
                  Total
                </td>
                <td className="py-3 text-right text-sm font-semibold text-text-primary">
                  {formatCurrency(totals.guestPrice)}
                </td>
                <td className="py-3 pr-2 text-right text-sm font-semibold text-text-primary">
                  {formatCurrency(totals.supplierShare)}
                </td>
                <td
                  className="py-3 pr-2 text-right text-sm font-semibold tracking-wide"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {formatCurrency(totals.agencyCommission)}
                </td>
                <td
                  className="py-3 pr-2 text-right text-sm font-semibold tracking-wide"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {formatCurrency(totals.auraFee)}
                </td>
                <td className="py-3 pr-4 text-right">
                  <span className="text-[11px] font-light text-text-muted">
                    {approvedRows.length} of {rows.length} approved
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* How this is calculated */}
        <div
          className="mt-8 rounded-xl border border-border p-6 md:p-7"
          style={{ backgroundColor: "#1E1E1E" }}
        >
          <h4 className="text-sm font-medium uppercase tracking-[0.12em] text-text-primary">
            How this is calculated
          </h4>
          <ul className="mt-4 space-y-2 text-sm font-light text-text-secondary">
            <li>
              Guest price — the amount the guest is quoted and pays through the app.
            </li>
            <li>
              Supplier share ({revenueConfig.supplierSharePct}%) — the remainder, i.e. the
              guest price less both commissions below.
            </li>
            <li>
              Agency commission ({revenueConfig.agencyCommissionPct}%) — retained by the agency.
            </li>
            <li>
              AURA platform fee ({revenueConfig.auraFeePct}%) — the platform's share.
            </li>
          </ul>
          {workedExample && (
            <p className="mt-4 text-sm font-light text-text-secondary">
              Worked example — {workedExample.service} at{" "}
              {formatCurrency(workedExample.guestPrice)}: supplier{" "}
              <span style={{ color: "var(--aura-accent, #D4AF37)" }}>
                {formatCurrency(workedExample.split.supplierShare)}
              </span>{" "}
              · agency{" "}
              <span style={{ color: "var(--aura-accent, #D4AF37)" }}>
                {formatCurrency(workedExample.split.agencyCommission)}
              </span>{" "}
              · AURA{" "}
              <span style={{ color: "var(--aura-accent, #D4AF37)" }}>
                {formatCurrency(workedExample.split.auraFee)}
              </span>
              .
            </p>
          )}
          <p className="mt-4 text-xs font-light text-text-muted">
            Example values for demonstration only.
          </p>
          <p className="mt-2 text-xs font-light text-text-muted/70">
            Percentages are per-agency configuration and can be overridden per supplier.
          </p>
        </div>
      </div>

      {/* Part C: Revenue Summary Footer */}
      <div
        className="rounded-2xl border p-8 md:p-10 lg:p-12"
        style={{
          borderColor: "var(--aura-border-accent, rgba(212,175,55,0.3))",
          backgroundColor: "var(--aura-card, #1A1A1A)",
        }}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-4">
            <h3 className="text-lg font-light tracking-wide text-text-primary md:text-xl">
              Revenue Summary
            </h3>
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-light text-text-muted">
                  Total Platform Revenue ({revenueConfig.auraFeePct}% Commission):
                </span>
                <span
                  className="text-xl font-light tracking-wide md:text-2xl"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {formatCurrency(totalPlatformRevenue)}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-light text-text-muted">
                  Total Agency Commission ({revenueConfig.agencyCommissionPct}%):
                </span>
                <span
                  className="text-xl font-light tracking-wide md:text-2xl"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {formatCurrency(totalAgencyCommissions)}
                </span>
              </div>
            </div>
          </div>

          {/* Accent divider */}
          <div
            className="h-px w-full md:hidden"
            style={{ backgroundColor: "var(--aura-accent, #D4AF37)", opacity: 0.2 }}
          />
          <div
            className="hidden h-20 w-px md:block"
            style={{ backgroundColor: "var(--aura-accent, #D4AF37)", opacity: 0.3 }}
          />

          <div className="text-right">
            <p className="text-xs font-light leading-relaxed text-text-muted">
              Based on {formatCurrency(totalClientSpend)} in client spend
              <br />
              Data for {activeProperty.refCode} — {activeProperty.name}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Demo Data Badge ───────────────────────────────────────────────────────────

/** Small pill marking figures that are illustrative rather than real. */
function DemoDataBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]"
      style={{
        borderColor: "var(--aura-border-accent, rgba(212,175,55,0.3))",
        color: "var(--aura-accent, #D4AF37)",
        backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.1))",
      }}
    >
      Demo data
    </span>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function BookingStatusBadge({ status }: { status: "approved" | "pending" }) {
  const isApproved = status === "approved";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]"
      style={
        isApproved
          ? {
              color: "var(--aura-accent, #D4AF37)",
              backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.12))",
              border: "1px solid var(--aura-border-accent, rgba(212,175,55,0.25))",
            }
          : {
              color: "#6B6B6B",
              backgroundColor: "rgba(107,107,107,0.1)",
              border: "1px solid rgba(107,107,107,0.2)",
            }
      }
    >
      {/* Dot indicator */}
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: isApproved
            ? "var(--aura-accent, #D4AF37)"
            : "#6B6B6B",
        }}
      />
      {status}
    </span>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-border px-6 py-6 md:px-12 lg:px-24">
      <div className="flex flex-col items-center gap-1 text-center">
        <p
          className="text-xs font-light tracking-widest transition-colors duration-500"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          AURA
        </p>
        <p className="text-[10px] font-light tracking-wide text-text-muted/50">
          {agencyConfig.agencyName} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}

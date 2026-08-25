import { useState, useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { createFileRoute } from "@tanstack/react-router";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "estate" | "staff" | "concierge" | "revenue";
type AgencyPreset = "sothebys" | "evs" | "lionard";
type StaffViewMode = "owner" | "staff";

interface TabDef {
  id: Tab;
  label: string;
  icon: string;
}

interface TabContent {
  title: string;
  subtitle: string;
}

interface AgencyInfo {
  id: AgencyPreset;
  name: string;
  subtitle: string;
  className: string;
  label: string;
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

interface Property {
  id: string;
  name: string;
  location: string;
  heroImage: string;
  heroAlt: string;
  bedrooms: number;
  baths: number;
  interior: string;
  terrace: string;
  defaultTemp: number;
  defaultPool: boolean;
}

const properties: Property[] = [
  {
    id: "villa-olmo",
    name: "Villa Olmo — Como",
    location: "Via per Cernobbio 12, 22100 Como",
    heroImage: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?fit=crop&w=800&q=80",
    heroAlt: "Villa Olmo at dusk with lake view",
    bedrooms: 7, baths: 6, interior: "520 m²", terrace: "120 m²",
    defaultTemp: 22, defaultPool: false,
  },
  {
    id: "villa-bellagio",
    name: "Villa Bellagio — Lake Como",
    location: "Via Paolo Carcano 5, 22021 Bellagio",
    heroImage: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?fit=crop&w=800&q=80",
    heroAlt: "Villa Bellagio overlooking Lake Como",
    bedrooms: 5, baths: 4, interior: "410 m²", terrace: "95 m²",
    defaultTemp: 21, defaultPool: true,
  },
  {
    id: "villa-rosa",
    name: "Villa Rosa — Amalfi Coast",
    location: "Via San Nicola 3, 84011 Amalfi",
    heroImage: "https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?fit=crop&w=800&q=80",
    heroAlt: "Villa Rosa perched on Amalfi cliffs",
    bedrooms: 4, baths: 3, interior: "340 m²", terrace: "180 m²",
    defaultTemp: 24, defaultPool: true,
  },
];

// ── Constants ────────────────────────────────────────────────────────────────

const tabs: TabDef[] = [
  { id: "estate", label: "Estate", icon: "🏰" },
  { id: "staff", label: "Staff", icon: "⚡" },
  { id: "concierge", label: "Concierge", icon: "✦" },
  { id: "revenue", label: "Revenue", icon: "◆" },
];

const tabContent: Record<Tab, TabContent> = {
  estate: {
    title: "Property Dashboard",
    subtitle: "Smart Controls & Estate Overview",
  },
  staff: {
    title: "AI Estate Manager",
    subtitle: "Intelligent Staff Automation",
  },
  concierge: {
    title: "Luxury Concierge",
    subtitle: "Curated Services Marketplace",
  },
  revenue: {
    title: "Revenue Analytics",
    subtitle: "Agency Performance Insights",
  },
};

const agencyPresets: AgencyInfo[] = [
  {
    id: "sothebys",
    name: "Sotheby's International Realty",
    subtitle: "Jet-Black & Gold",
    className: "agency-sothebys",
    label: "Sotheby's Custom",
  },
  {
    id: "evs",
    name: "Engel & Völkers",
    subtitle: "Matte Silver & Carbon",
    className: "agency-evs",
    label: "Engel & Völkers",
  },
  {
    id: "lionard",
    name: "Lionard Luxury Real Estate",
    subtitle: "Royal Gold & Deep Navy",
    className: "agency-lionard",
    label: "Lionard",
  },
];

// ── Concierge Service Data ────────────────────────────────────────────────────

interface ConciergeService {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  priceValue: number | null;
  cta: string;
  icon: "yacht" | "chauffeur" | "catering" | "aviation";
}

const conciergeServices: ConciergeService[] = [
  {
    id: "yacht",
    title: "Private Yacht Charter",
    subtitle: "Daily cruises & superyacht tenders",
    price: "From €4,500/day",
    priceValue: 4500,
    cta: "Request Captain",
    icon: "yacht",
  },
  {
    id: "chauffeur",
    title: "Chauffeur & Luxury Fleet",
    subtitle: "Airport transfers & private drivers",
    price: "From €800/day",
    priceValue: 800,
    cta: "Book Driver",
    icon: "chauffeur",
  },
  {
    id: "catering",
    title: "Michelin-Starred Catering",
    subtitle: "In-villa private chef & staff",
    price: "Custom Quote",
    priceValue: null,
    cta: "Book Chef",
    icon: "catering",
  },
  {
    id: "aviation",
    title: "Aviation & Private Jets",
    subtitle: "Global charter flights on-demand",
    price: "On Request",
    priceValue: null,
    cta: "Request Flight",
    icon: "aviation",
  },
];

// ── Concierge Image URLs ──────────────────────────────────────────────────────

const conciergeImages: Record<ConciergeService["icon"], string> = {
  yacht: "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=1200&q=80",
  chauffeur: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?fit=crop&w=400&q=80",
  catering: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?fit=crop&w=400&q=80",
  aviation: "https://images.unsplash.com/photo-1540962351504-03099e0a754b?fit=crop&w=400&q=80",
};

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  component: Home,
});

// ── Home ─────────────────────────────────────────────────────────────────────

function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("estate");
  const [agencyPreset, setAgencyPreset] = useState<AgencyPreset>("sothebys");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const DEFAULT_PROPERTY = properties[0];
  const [activePropertyId, setActivePropertyId] = useState(DEFAULT_PROPERTY.id);

  // Property-scoped state (Record keyed by property id)
  const [tasksByProperty, setTasksByProperty] = useState<Record<string, TaskItem[]>>(() => {
    const empty: Record<string, TaskItem[]> = {
      "villa-olmo": [],
      "villa-bellagio": [],
      "villa-rosa": [],
    };
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
  const [revenueByProperty, setRevenueByProperty] = useState<Record<string, RevenueTransaction[]>>({
    "villa-olmo": [
      { id: "tx-001", service: "Yacht Charter", amount: 4500, auraFee: 135, agencyShare: 540, status: "approved" },
      { id: "tx-002", service: "Chauffeur Service", amount: 800, auraFee: 24, agencyShare: 96, status: "approved" },
    ],
    "villa-bellagio": [
      { id: "tx-b01", service: "Private Catering", amount: 2400, auraFee: 72, agencyShare: 288, status: "approved" },
    ],
    "villa-rosa": [
      { id: "tx-r01", service: "Aviation Charter", amount: 12000, auraFee: 360, agencyShare: 1440, status: "approved" },
      { id: "tx-r02", service: "Yacht Day Trip", amount: 3200, auraFee: 96, agencyShare: 384, status: "pending" },
    ],
  });
  const [tempByProperty, setTempByProperty] = useState<Record<string, number>>({
    "villa-olmo": 22, "villa-bellagio": 21, "villa-rosa": 24,
  });
  const [poolByProperty, setPoolByProperty] = useState<Record<string, boolean>>({
    "villa-olmo": false, "villa-bellagio": true, "villa-rosa": true,
  });

  // Derive current values from activePropertyId
  const activeProperty = properties.find((p) => p.id === activePropertyId)!;
  const tasks = tasksByProperty[activePropertyId];
  const revenueTransactions = revenueByProperty[activePropertyId];
  const estateTemp = tempByProperty[activePropertyId];
  const poolActive = poolByProperty[activePropertyId];

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

  const setActiveEstateTemp = useCallback(
    (t: number) => setTempByProperty((prev) => ({ ...prev, [activePropertyId]: t })),
    [activePropertyId]
  );

  const setActivePool = useCallback(
    (a: boolean) => setPoolByProperty((prev) => ({ ...prev, [activePropertyId]: a })),
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

  const handleRevenueAdd = useCallback(
    (tx: Omit<RevenueTransaction, "id">) =>
      setRevenueByProperty((prev) => ({
        ...prev,
        [activePropertyId]: [
          ...(prev[activePropertyId] ?? []),
          { ...tx, id: `rtx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
        ],
      })),
    [activePropertyId]
  );

  const handleSwitchProperty = useCallback((id: string) => {
    if (id === activePropertyId) return;
    const prop = properties.find((p) => p.id === id);
    setActivePropertyId(id);
    if (prop) {
      setToast(`Switched active workspace to ${prop.name}`);
      setTimeout(() => setToast(null), 2500);
    }
  }, [activePropertyId]);

  const currentAgency =
    agencyPresets.find((a) => a.id === agencyPreset) ?? agencyPresets[0];

  const handlePresetChange = useCallback((preset: AgencyPreset) => {
    setIsTransitioning(true);
    setAgencyPreset(preset);
    // Remove transition class after the fade completes
    setTimeout(() => setIsTransitioning(false), 600);
  }, []);

  return (
    <div
      className={`flex min-h-dvh flex-col text-text-primary ${currentAgency.className} ${
        isTransitioning ? "agency-transitioning" : ""
      }`}
      style={{
        backgroundColor: "var(--aura-surface, #0B0B0B)",
        ...(isTransitioning ? { willChange: "background-color" } : {}),
      }}
    >
      <Header
        agency={currentAgency}
        property={activeProperty}
        onToggleAdmin={() => setShowAdminPanel((p) => !p)}
        showAdminPanel={showAdminPanel}
      />
      <AgencyAdminPanel
        presets={agencyPresets}
        activePreset={agencyPreset}
        onSelect={handlePresetChange}
        visible={showAdminPanel}
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
        estateTemp={estateTemp}
        setEstateTemp={setActiveEstateTemp}
        poolActive={poolActive}
        setPoolActive={setActivePool}
        onAddTask={handleAddTask}
        revenueTransactions={revenueTransactions}
        onRevenueAdd={handleRevenueAdd}
      />
      <Footer agency={currentAgency} />

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
  agency,
  property,
  onToggleAdmin,
  showAdminPanel,
}: {
  agency: AgencyInfo;
  property: Property;
  onToggleAdmin: () => void;
  showAdminPanel: boolean;
}) {
  return (
    <header className="border-b border-border px-6 py-8 md:px-12 lg:px-24">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3 logo-glow-bg">
          <h1
            className="relative z-10 text-4xl font-light tracking-[0.2em] md:text-5xl"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            AURA
          </h1>
          <span
            className="relative z-10 h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
            aria-hidden="true"
          />
        </div>

        {/* Settings gear */}
        <button
          onClick={onToggleAdmin}
          className={`
            relative flex h-10 w-10 items-center justify-center rounded-full
            border transition-all duration-300
            ${
              showAdminPanel
                ? "border-[var(--aura-accent,#D4AF37)] text-[var(--aura-accent,#D4AF37)]"
                : "border-border text-text-muted hover:border-text-secondary hover:text-text-secondary"
            }
          `}
          aria-label="Agency Admin Settings"
          title="Agency Admin Settings"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-500 hover:rotate-90"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <p className="mt-2 font-light text-text-muted">
        <span className="text-sm tracking-wide">
          Exclusive Experience curated by{" "}
        </span>
        <span
          className="text-sm font-normal transition-colors duration-500"
          style={{ color: "var(--aura-accent-light, #e0c45e)" }}
        >
          {agency.name}
        </span>
      </p>

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

// ── Agency Admin Panel ───────────────────────────────────────────────────────

function AgencyAdminPanel({
  presets,
  activePreset,
  onSelect,
  visible,
}: {
  presets: AgencyInfo[];
  activePreset: AgencyPreset;
  onSelect: (preset: AgencyPreset) => void;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <div className="animate-slide-down border-b border-border">
      <div className="px-6 py-6 md:px-12 lg:px-24">
        <div className="mb-4 flex items-center gap-2">
          <span
            className="text-xs font-medium uppercase tracking-[0.15em]"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            Agency Identity
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <p className="mb-5 text-xs font-light text-text-muted">
          Select a white-label preset to update the platform branding in
          real-time.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => onSelect(preset.id)}
                className={`
                  group relative overflow-hidden rounded-xl border p-5 text-left
                  transition-all duration-300
                  ${
                    isActive
                      ? "border-[var(--aura-accent,#D4AF37)] bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))]"
                      : "border-border bg-charcoal hover:border-text-secondary"
                  }
                `}
              >
                {/* Preview swatch */}
                <div className="mb-4 flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{
                      backgroundColor:
                        preset.id === "sothebys"
                          ? "#D4AF37"
                          : preset.id === "evs"
                            ? "#C0C0C0"
                            : "#C9A84C",
                    }}
                  />
                  <div
                    className="h-3 w-8 rounded-full opacity-60"
                    style={{
                      backgroundColor:
                        preset.id === "lionard" ? "#0A1628" : "#0B0B0B",
                    }}
                  />
                </div>

                <h3
                  className={`text-sm font-medium tracking-wide transition-colors duration-300 ${
                    isActive
                      ? "text-[var(--aura-accent,#D4AF37)]"
                      : "text-text-primary"
                  }`}
                >
                  {preset.label}
                </h3>
                <p className="mt-1 text-xs font-light text-text-muted">
                  {preset.subtitle}
                </p>

                {/* Active indicator */}
                {isActive && (
                  <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--aura-accent,#D4AF37)]">
                    <svg
                      width="10"
                      height="10"
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
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
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
  estateTemp,
  setEstateTemp,
  poolActive,
  setPoolActive,
  onAddTask,
  revenueTransactions,
  onRevenueAdd,
}: {
  activeTab: Tab;
  activeProperty: Property;
  properties: Property[];
  activePropertyId: string;
  onSwitchProperty: (id: string) => void;
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  estateTemp: number;
  setEstateTemp: (t: number) => void;
  poolActive: boolean;
  setPoolActive: (a: boolean) => void;
  onAddTask: (task: TaskItem) => void;
  revenueTransactions: RevenueTransaction[];
  onRevenueAdd: (tx: Omit<RevenueTransaction, "id">) => void;
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
              {tab.id === "estate" ? (
                <EstatePanel estateTemp={estateTemp} poolActive={poolActive} onTempChange={setEstateTemp} onPoolToggle={setPoolActive} onAddTask={(t) => setTasks(prev => [...prev, t])} activeProperty={activeProperty} properties={properties} activePropertyId={activePropertyId} onSwitchProperty={onSwitchProperty} />
              ) : tab.id === "staff" ? (
                <StaffPanel tasks={tasks} setTasks={setTasks} onEstateTempChange={setEstateTemp} onPoolToggle={setPoolActive} />
              ) : tab.id === "concierge" ? (
                <ConciergePanel onAddTask={onAddTask} onRevenueAdd={onRevenueAdd} />
              ) : tab.id === "revenue" ? (
                <RevenuePanel revenueTransactions={revenueTransactions} />
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

// ═══════════════════════════════════════════════════════════════════════════════
// ESTATE PANEL — Property Dashboard + Smart Estate Controls
// ═══════════════════════════════════════════════════════════════════════════════

function EstatePanel({
  estateTemp, poolActive, onTempChange, onPoolToggle, onAddTask,
  activeProperty, properties, activePropertyId, onSwitchProperty,
}: {
  estateTemp: number;
  poolActive: boolean;
  onTempChange: (t: number) => void;
  onPoolToggle: (a: boolean) => void;
  onAddTask: (t: TaskItem) => void;
  activeProperty: Property;
  properties: Property[];
  activePropertyId: string;
  onSwitchProperty: (id: string) => void;
}) {
  return (
    <div className="space-y-8">
      {/* Hero Property Card */}
      <PropertyImagePlaceholder property={activeProperty} />
      <HeroPropertyCard property={activeProperty} />

      {/* Smart Estate Controls */}
      <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-10 lg:p-12">
        <div className="mb-8">
          <h3
            className="text-xl font-light tracking-wide md:text-2xl"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            Smart Estate Control
          </h3>
          <p className="mt-1 text-sm font-light text-text-muted">
            IoT Gateway — Real-time property monitoring &amp; automation
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ClimateControl temp={estateTemp} onTempChange={onTempChange} onAddTask={onAddTask} />
          <PoolSpaToggle active={poolActive} onToggle={onPoolToggle} onAddTask={onAddTask} />
          <SecurityPerimeter properties={properties} activePropertyId={activePropertyId} onSwitchProperty={onSwitchProperty} />
        </div>
      </div>
    </div>
  );
}

// ── Property Image (Hero) ────────────────────────────────────────────────────

function PropertyImagePlaceholder({ property }: { property: Property }) {
  return (
    <div className="relative h-[200px] overflow-hidden rounded-2xl border border-border md:h-[280px]">
      {/* Unsplash hero image */}
      <img
        src={property.heroImage}
        alt={property.heroAlt}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Dark gradient overlay — bottom to top for text readability */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.1) 100%)
          `,
        }}
      />

      {/* Subtle gold accent overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 30% 50%, var(--aura-accent-subtle, rgba(212,175,55,0.06)) 0%, transparent 60%)
          `,
        }}
      />

      {/* Property label overlay */}
      <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8">
        <span
          className="inline-block rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{
            backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.15))",
            color: "var(--aura-accent, #D4AF37)",
            border: "1px solid var(--aura-border-accent, rgba(212,175,55,0.3))",
          }}
        >
          {property.name.split(" — ")[0]}
        </span>
      </div>
    </div>
  );
}

// ── Hero Property Card ───────────────────────────────────────────────────────

function HeroPropertyCard({ property }: { property: Property }) {
  return (
    <div
      className="rounded-2xl border p-8 md:p-10 lg:p-12"
      style={{
        backgroundColor: "var(--aura-card, #1A1A1A)",
        borderColor: "var(--aura-border-accent, rgba(212,175,55,0.3))",
      }}
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-light tracking-wide md:text-3xl lg:text-4xl">
              {property.name}
            </h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.15em]"
              style={{
                backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.15))",
                color: "var(--aura-accent, #D4AF37)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--aura-accent,#D4AF37)]" />
              Active
            </span>
          </div>

          <p className="text-sm font-light text-text-secondary">
            {property.location}
          </p>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-sm font-light text-text-secondary">
            <StatItem label="Bedrooms" value={String(property.bedrooms)} />
            <span className="text-border">|</span>
            <StatItem label="Baths" value={String(property.baths)} />
            <span className="text-border">|</span>
            <StatItem label="Interior" value={property.interior} />
            <span className="text-border">|</span>
            <StatItem label="Terrace" value={property.terrace} />
          </div>
        </div>

        {/* Decorative accent line */}
        <div
          className="hidden h-px w-16 md:block md:h-16 md:w-px"
          style={{ backgroundColor: "var(--aura-accent, #D4AF37)" }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </span>
  );
}

// ── Climate Control ──────────────────────────────────────────────────────────

function ClimateControl({ temp, onTempChange, onAddTask }: { temp: number; onTempChange: (t: number) => void; onAddTask: (t: TaskItem) => void }) {

  const pct = ((temp - 18) / (26 - 18)) * 100;

  return (
    <div
      className="rounded-xl border border-border p-6 transition-colors duration-300 hover:border-[var(--aura-border-accent,rgba(212,175,55,0.3))] animate-slide-up-staggered gold-glow-hover"
      style={{ backgroundColor: "var(--aura-card, #1A1A1A)", animationDelay: "0ms" }}
    >
      <h4 className="text-sm font-medium tracking-wide text-text-primary">
        Climate Control
      </h4>
      <p className="mt-1 text-xs text-text-muted">Interior Ambient</p>

      {/* Temperature display */}
      <div className="mt-6 flex items-baseline gap-1">
        <span
          className="text-5xl font-light tracking-tight md:text-6xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          {temp}
        </span>
        <span className="text-2xl font-light text-text-muted">°C</span>
      </div>

      {/* Slider */}
      <div className="mt-6 space-y-2">
        <input
          type="range"
          min={18}
          max={26}
          value={temp}
          onChange={(e) => {
            const newTemp = Number(e.target.value);
            onTempChange(newTemp);
            onAddTask({
              id: generateTaskId(),
              module: "Climate Control",
              description: `Guest set temperature to ${newTemp}°C`,
              status: "pending",
              createdAt: new Date().toLocaleTimeString(),
            });
          }}
          className="luxury-slider w-full"
          style={{
            background: `linear-gradient(to right, var(--aura-accent, #D4AF37) 0%, var(--aura-accent, #D4AF37) ${pct}%, #2A2A2A ${pct}%, #2A2A2A 100%)`,
          }}
          aria-label="Temperature control"
        />
        <div className="flex justify-between text-[10px] font-light text-text-muted">
          <span>18°C</span>
          <span>26°C</span>
        </div>
      </div>
    </div>
  );
}

// ── Pool & Spa Toggle ────────────────────────────────────────────────────────

function PoolSpaToggle({ active, onToggle, onAddTask }: { active: boolean; onToggle: (a: boolean) => void; onAddTask: (t: TaskItem) => void }) {

  return (
    <div
      className="rounded-xl border border-border p-6 transition-colors duration-300 hover:border-[var(--aura-border-accent,rgba(212,175,55,0.3))] animate-slide-up-staggered gold-glow-hover"
      style={{ backgroundColor: "var(--aura-card, #1A1A1A)", animationDelay: "100ms" }}
    >
      <h4 className="text-sm font-medium tracking-wide text-text-primary">
        Pool &amp; Spa
      </h4>
      <p className="mt-1 text-xs text-text-muted">
        {active ? "Heating system active" : "Heating system idle"}
      </p>

      {/* Toggle */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={() => {
            const newActive = !active;
            onToggle(newActive);
            onAddTask({
              id: generateTaskId(),
              module: "Pool & Spa",
              description: newActive ? "Guest activated pool heating to 28°C" : "Guest deactivated pool heating",
              status: "pending",
              createdAt: new Date().toLocaleTimeString(),
            });
          }}
          role="switch"
          aria-checked={active}
          className={`
            toggle-track relative inline-flex h-7 w-12 shrink-0 cursor-pointer
            rounded-full transition-colors duration-300
            ${active ? "bg-[var(--aura-accent,#D4AF37)]" : "bg-border"}
          `}
        >
          <span
            className={`
              toggle-thumb absolute left-0.5 top-0.5 inline-block h-6 w-6
              rounded-full bg-white shadow-sm
              ${active ? "translate-x-5" : "translate-x-0"}
            `}
          />
        </button>

        <span
          className={`text-sm font-light transition-colors duration-300 ${
            active ? "text-[var(--aura-accent,#D4AF37)]" : "text-text-muted"
          }`}
        >
          {active ? "Active — Heating to 28°C" : "Inactive"}
        </span>
      </div>

      {active && (
        <p className="mt-3 animate-fade-in-up text-xs font-light text-text-muted">
          Estimated ready: 2 hours
        </p>
      )}
    </div>
  );
}

// ── Security Perimeter ───────────────────────────────────────────────────────

function SecurityPerimeter({
  properties,
  activePropertyId,
  onSwitchProperty,
}: {
  properties: Property[];
  activePropertyId: string;
  onSwitchProperty: (id: string) => void;
}) {
  const [showFaceID, setShowFaceID] = useState(false);
  const [showPropertySelect, setShowPropertySelect] = useState(false);
  const [scanTimes, setScanTimes] = useState<Record<string, number>>({
    "villa-olmo": Date.now(),
    "villa-bellagio": Date.now() - 1000 * 60 * 4, // 4 min ago
    "villa-rosa": Date.now() - 1000 * 60 * 12, // 12 min ago
  });
  const [now, setNow] = useState(Date.now());
  const [visited, setVisited] = useState<Set<string>>(new Set([activePropertyId]));

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div
        className="rounded-xl border border-border p-6 transition-colors duration-300 hover:border-[var(--aura-border-accent,rgba(212,175,55,0.3))] animate-slide-up-staggered gold-glow-hover"
        style={{ backgroundColor: "var(--aura-card, #1A1A1A)", animationDelay: "200ms" }}
      >
        <h4 className="text-sm font-medium tracking-wide text-text-primary">
          Security Perimeter
        </h4>

        {/* Status badge */}
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--aura-accent-subtle,rgba(212,175,55,0.15))] bg-[var(--aura-accent-subtle,rgba(212,175,55,0.08))] px-3 py-2">
          {/* Shield icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="text-xs font-medium tracking-wide text-[var(--aura-accent,#D4AF37)]">
            CCTV Encrypted | Biometric Vault Lock Active
          </span>
        </div>

        <p className="mt-3 text-xs font-light text-text-muted">
          Last perimeter scan: {formatRelativeTime(scanTimes[activePropertyId] ?? now)}
        </p>

        {/* Switch Property button */}
        <button
          onClick={() => setShowPropertySelect(!showPropertySelect)}
          className="mt-6 w-full rounded-lg border border-border px-4 py-3 text-xs font-medium tracking-wider text-text-secondary transition-all duration-300 hover:border-[var(--aura-accent,#D4AF37)] hover:text-[var(--aura-accent,#D4AF37)]"
        >
          Switch Property
        </button>

        {showPropertySelect && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.id !== activePropertyId) {
                    if (!visited.has(p.id)) {
                      setScanTimes((prev) => ({ ...prev, [p.id]: Date.now() }));
                      setVisited((prev) => new Set(prev).add(p.id));
                    }
                    onSwitchProperty(p.id);
                  }
                  setShowPropertySelect(false);
                }}
                className={`w-full px-4 py-3 text-left text-xs font-light tracking-wide transition-colors ${
                  p.id === activePropertyId
                    ? "bg-[var(--aura-accent-subtle,rgba(212,175,55,0.12))] text-[var(--aura-accent,#D4AF37)]"
                    : "text-text-secondary hover:bg-charcoal hover:text-text-primary"
                }`}
              >
                {p.name} {p.id === activePropertyId ? "✓" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* FaceID Modal */}
      {showFaceID && <FaceIDModal onClose={() => setShowFaceID(false)} />}
    </>
  );
}

// ── FaceID Modal ─────────────────────────────────────────────────────────────

function FaceIDModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<"scanning" | "verified" | "done">(
    "scanning"
  );

  // Simulate authentication: scanning → verified after 2.2s → done after 3.5s
  useEffect(() => {
    const scanTimer = setTimeout(() => setPhase("verified"), 2200);
    const doneTimer = setTimeout(() => setPhase("done"), 3500);
    return () => {
      clearTimeout(scanTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  const handleDone = () => {
    if (phase === "done") {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={phase === "done" ? handleDone : undefined}
    >
      {/* Backdrop blur */}
      <div className="absolute inset-0 bg-midnight/80 backdrop-blur-md" />

      {/* Modal card */}
      <div
        className="relative z-10 mx-4 w-full max-w-sm rounded-2xl border border-border p-8 text-center animate-fade-in-up"
        style={{ backgroundColor: "var(--aura-card, #1A1A1A)" }}
      >
        {/* Biometric icon */}
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center">
          {/* Pulsing ring */}
          {phase === "scanning" && (
            <div className="absolute h-20 w-20 animate-faceid-pulse rounded-full" />
          )}

          {/* Rotating ring with pulse-glow while scanning */}
          <div
            className={`
              flex h-20 w-20 items-center justify-center rounded-full border-2
              ${phase === "scanning" ? "animate-faceid-ring animate-faceid-pulse-glow" : ""}
            `}
            style={{
              borderColor:
                phase === "verified" || phase === "done"
                  ? "var(--aura-accent, #D4AF37)"
                  : "var(--aura-accent, #D4AF37)",
              opacity: phase === "scanning" ? 1 : phase === "verified" ? 1 : 0.7,
            }}
          >
            {/* Face silhouette */}
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
        </div>

        {/* Status text */}
        {phase === "scanning" && (
          <p
            className="text-sm font-light tracking-wide"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            Authenticating...
          </p>
        )}

        {phase === "verified" && (
          <div className="animate-fade-in-up space-y-2">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--aura-accent,#D4AF37)]">
              <svg
                width="18"
                height="18"
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
            <p
              className="text-sm font-medium tracking-wide"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              Identity Verified
            </p>
            <p className="text-xs font-light text-text-muted">
              Access Granted
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="animate-fade-in-up space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--aura-accent,#D4AF37)]">
              <svg
                width="18"
                height="18"
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
            <p
              className="text-sm font-medium tracking-wide"
              style={{ color: "var(--aura-accent, #D4AF37)" }}
            >
              Identity Verified — Access Granted
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-lg border border-[var(--aura-accent,#D4AF37)] px-6 py-2 text-xs font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))]"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAFF PANEL — AI Estate Manager (Owner Chat + Staff Checklist)
// ═══════════════════════════════════════════════════════════════════════════════

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "system",
  content:
    "Good evening. I am the AURA Executive Director. How may I assist with your estate today? I can coordinate staff, manage arrivals, arrange yacht charters, private dining, chauffeur services, aviation, or prepare the property for your visit.",
};

// ── AI Response Engine ─────────────────────────────────────────────────────────

type IntentType = "concierge" | "transport" | "transportChauffeur" | "transportYacht" | "transportAviation" | "housekeeping" | "maintenance" | "security" | "general" | "closing" | "update" | "climateControl" | "poolControl";

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
    "camera", "patrol", "biometric", "vault", "lock", "safe", "code",
    "valet", "parking", "clearance",
  ],
  climateControl: [
    "temperature", "climate", "cool", "warm", "hot", "cold",
    "ac", "air conditioning", "heating", "degree", "set temp",
  ],
  poolControl: [
    "pool", "spa", "jacuzzi", "swim", "heat pool", "pool heat",
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


  // Climate control detection — extract target temperature
  const climatePattern = /\b(set|change|adjust|make|turn)\b.*\b(temperature|climate|temp|heat|cool|warm|hot|cold|degree|°)\b.*?(\d{1,2})\s*(°c?|celsius|degrees?)?/i;
  const climateMatch = m.match(climatePattern);
  if (climateMatch) {
    const targetTemp = parseInt(climateMatch[3], 10);
    if (targetTemp >= 16 && targetTemp <= 30) {
      return [{ type: "climateControl", confidence: "high", specifics: `${targetTemp}°C` }];
    }
  }

  // Pool control detection
  const poolPattern = /\b(turn|switch|set|put|activate|enable|start|heat)\b.*\b(pool|spa|jacuzzi)\b.*\b(on|off|active|heat)/i;
  const poolOffPattern = /\b(turn|switch)\b.*\b(pool|spa)\b.*\b(off|disable|deactivate)/i;
  if (poolOffPattern.test(m)) {
    return [{ type: "poolControl", confidence: "high", specifics: "off" }];
  } else if (poolPattern.test(m)) {
    return [{ type: "poolControl", confidence: "high", specifics: "on" }];
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

const arrivalVariants: Array<(s: string) => string> = [
  (s) => `I will ensure the estate is perfectly prepared for your arrival, Sir. I am briefing the housekeeping and maintenance teams now — your preferred climate settings, fresh linens, and every detail will be attended to. The staff will be ready to welcome you.`,
  (s) => `Your arrival is being coordinated as we speak, Sir. The villa will be climate-controlled to your liking, the rooms prepared to the highest standard, and the full staff briefed. Is there anything specific you would like prioritized before you land?`,
];

const conciergeVariants: Array<(s: string) => string> = [
  (s) => `Certainly, Sir. I will have our cellar master bring up a selection of chilled Champagnes. Would you prefer a classic brut or something more rare — a Krug or Dom Pérignon, perhaps?`,
  (s) => `At once, Sir. I am arranging for our finest Champagne to be chilled and served. Shall I coordinate light canapés to accompany?`,
  (s) => `With pleasure, Sir. I am personally curating a selection from our cellar. A chilled bottle of our finest will be ready shortly. Would you like the sommelier to present the options tableside?`,
  (s) => `Of course, Sir. I will have the dining room prepared and our chef briefed immediately. May I suggest our seasonal tasting menu paired with a vintage Champagne?`,
];

const transportYachtVariants: Array<(s: string) => string> = [
  (s) => `I would be delighted to arrange your yacht charter. The Captain is on standby and I can have the tender ready at the private dock within the hour. Shall we aim for a sunset departure?`,
  (s) => `It would be my pleasure, Sir. The yacht is being prepared as we speak. The crew will have everything in order — shall I coordinate a sunset departure with Champagne onboard?`,
  (s) => `Most certainly, Sir. I am liaising with the Captain now. The tender will be at your private dock and the yacht prepared to the highest standard. What time shall we schedule departure?`,
];

const chauffeurVariants: Array<(s: string) => string> = [
  (s) => `At once, Sir. Your chauffeur will be briefed and the vehicle prepared to the highest standard. Shall I arrange a specific vehicle from the fleet — the Rolls-Royce Phantom or the Mercedes-Maybach for your transfer?`,
  (s) => `Immediately, Sir. I am dispatching your driver now. The vehicle will be waiting at the entrance, climate-controlled and ready. Would you prefer the Phantom this evening?`,
];

const aviationVariants: Array<(s: string) => string> = [
  (s) => `I have taken the liberty of arranging priority clearance at the private terminal, Sir. Your flight crew will be briefed within the hour. Shall I coordinate ground transport at both departure and arrival locations?`,
  (s) => `Consider it done, Sir. I am securing your flight plan and arranging priority handling. The jet will be prepared to your exact specifications. Will you require catering onboard?`,
];

const climateVariants: Array<(s: string) => string> = [
  (s) => `I have adjusted the climate control to ${s}, Sir. The ambient temperature is now being calibrated to your preference. You should feel the change shortly.`,
  (s) => `At once, Sir. The estate climate system is being set to ${s}. The HVAC will stabilize within a few minutes.`,
];

const poolVariants: Array<(s: string) => string> = [
  (s) => `The pool heating has been activated, Sir. The water will reach 28°C within approximately 2 hours. The spa jets are being primed as we speak.`,
  (s) => `I have turned on the pool heating system, Sir. The temperature is being raised to 28°C. Would you like me to have towels and refreshments prepared poolside as well?`,
];

const poolOffVariants: Array<(s: string) => string> = [
  (s) => `The pool heating has been deactivated, Sir. The system will begin cooling naturally. Is there anything else you would like adjusted?`,
];

const maintenanceVariants: Array<(s: string) => string> = [
  (s) => `I am checking the systems now, Sir. I will have the temperature adjusted to your preference and confirm all climate zones are optimal. The pool heating status will be reported shortly.`,
  (s) => `Right away, Sir. I am accessing the smart-estate controls and will have the climate and pool systems calibrated to your specifications. Is there a particular temperature you prefer?`,
];

const securityVariants: Array<(s: string) => string> = [
  (s) => `Immediately, Sir. I am initiating a full perimeter sweep and updating all access protocols. Your security detail will confirm within the hour. Would you like me to activate the enhanced surveillance package for the evening?`,
  (s) => `At once, Sir. All access codes are being refreshed and the perimeter is under active monitoring. I will have the security team report directly. Shall I also coordinate valet parking for any arriving guests?`,
];

const housekeepingVariants: Array<(s: string) => string> = [
  (s) => `I will have the housekeeping team attend to that immediately, Sir. The rooms will be prepared to the highest standard — fresh linens, amenities refreshed, and every detail considered.`,
  (s) => `Certainly, Sir. I am briefing the housekeeping staff now. They will ensure every room is immaculate and all amenities are stocked. Is there anything specific you would like prioritized?`,
];

const generalShortVariants: Array<(s: string) => string> = [
  (s) => `Sir, I would be delighted to assist. To ensure I make the most precise arrangements, could you share a bit more detail? For example, the date of your arrival, the number of guests, or which services you require — yacht, dining, chauffeur, or aviation.`,
  (s) => `I am at your service, Sir. Allow me to coordinate whatever you need — might you tell me a bit more about your plans so I can ensure everything is perfectly arranged?`,
  (s) => `At your disposal, Sir. I can arrange anything from a private dinner to a yacht charter. What would you like me to prepare for you today?`,
];

const generalLongVariants: Array<(s: string) => string> = [
  (s) => `Thank you, Sir. I have noted your request and am coordinating with the appropriate teams. Your estate staff — Chef, Housekeeping, Maintenance, Security, and Concierge — stands ready. Is there anything specific you would like me to prioritize?`,
  (s) => `I understand, Sir. I will ensure your request receives immediate attention. The entire estate team is at your disposal. Shall I focus on any particular area first?`,
  (s) => `Of course, Sir. I am dispatching instructions to the relevant teams now. Your estate will be prepared exactly as you wish. Is there anything else you would like to add?`,
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
  conversationContext: string[],
): string {
  // Closing intent — return warm farewell
  if (intents.length === 1 && intents[0].type === "closing") {
    return "I remain at your complete disposal, Sir. Have a wonderful day.";
  }

  // Update intent — return time-update acknowledgment
  if (intents.length === 1 && intents[0].type === "update") {
    const newTime = intents[0].specifics;
    return `Understood, Sir. I have updated the timing to ${newTime}. Your staff will be notified immediately.`;
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
      case "climateControl":
        parts.push(getNextVariant("climateControl", climateVariants)(intent.specifics));
        break;
      case "poolControl":
        if (intent.specifics === "off") {
          parts.push(getNextVariant("poolOff", poolOffVariants)(intent.specifics));
        } else {
          parts.push(getNextVariant("poolOn", poolVariants)(intent.specifics));
        }
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

  if (conversationContext.length > 0 && Math.random() < 0.3) {
    const ctx = conversationContext[conversationContext.length - 1];
    parts.push(`As with your previous request regarding "${ctx}", I will ensure the same level of care and attention.`);
  }

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

  // 2-intent combinations
  if (types.length === 2) {
    const [a, b] = types;
    
    // Concierge + housekeeping
    if ((a === "concierge" && b === "housekeeping") || (a === "housekeeping" && b === "concierge")) {
      return "Certainly, Sir. I will arrange the refreshments you requested and have housekeeping attend to the preparations simultaneously. The estate will be in perfect order.";
    }
    // Concierge + maintenance
    if ((a === "concierge" && b === "maintenance") || (a === "maintenance" && b === "concierge")) {
      return "At once, Sir. While I arrange the requested services, I will have maintenance adjust the systems to your preference. Everything will be seamless.";
    }
    // Transport + concierge
    if ((a === "transport" && b === "concierge") || (a === "concierge" && b === "transport")) {
      return "I would be delighted to coordinate both, Sir. The transport will be prepared while our team handles your concierge request. Everything will be seamless.";
    }
    // Housekeeping + maintenance
    if ((a === "housekeeping" && b === "maintenance") || (a === "maintenance" && b === "housekeeping")) {
      return "I will ensure the estate is perfectly prepared, Sir. Housekeeping and maintenance are being briefed now — every detail will be attended to.";
    }
    // General fallback for 2 intents
    return "I am coordinating across multiple teams, Sir. Everything will be arranged to the highest standard.";
  }

  // 3+ intents — comprehensive response
  return "I am orchestrating this across every department, Sir. The concierge, housekeeping, and maintenance teams are all being briefed — the estate will be in flawless condition.";
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

      case "climateControl": {
        const tempMatch = message.match(/(\d{1,2})\s*(°c?|celsius|degrees?)?/i);
        const targetTemp = tempMatch ? parseInt(tempMatch[1], 10) : 22;
        tasks.push({
          id: generateTaskId(),
          module: "Climate Control",
          description: `Guest requested temperature change to ${targetTemp}°C`,
          status: "pending", createdAt: new Date().toLocaleTimeString(),
        });
        break;
      }

      case "poolControl": {
        const isOn = intent.specifics !== "off";
        tasks.push({
          id: generateTaskId(),
          module: "Pool & Spa",
          description: isOn ? "Guest requested pool heating activation to 28°C" : "Guest requested pool heating deactivation",
          status: "pending", createdAt: new Date().toLocaleTimeString(),
        });
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
            description: "Update biometric access logs & gate codes",
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

function StaffPanel({
  tasks,
  setTasks,
  onEstateTempChange,
  onPoolToggle,
}: {
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  onEstateTempChange?: (t: number) => void;
  onPoolToggle?: (a: boolean) => void;
}) {
  const [viewMode, setViewMode] = useState<StaffViewMode>("owner");
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

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (sendingRef.current || !trimmed || processingPhase !== "idle") return;
      sendingRef.current = true;

      const suggestionResponses: Record<string, string> = {
        "i'm arriving tomorrow with guests": "Excellent, Sir. I will have the estate fully prepared for your arrival tomorrow. The climate will be set to your preference, housekeeping will refresh every room, and I'll brief the chef for your guest count. Shall I also arrange airport transfers?",
        "book the yacht for sunset": "I would be delighted to arrange your yacht charter, Sir. The Captain is on standby and I can have the tender ready at the private dock within the hour. Shall we aim for a sunset departure with Champagne onboard?",
        "set temperature to 24 degrees": "Right away, Sir. I am adjusting the climate to 24°C. The interior ambient will reach your preferred temperature shortly.",
        "activate the pool heating": "The pool heating has been activated, Sir. The water will reach 28°C within approximately 2 hours. The spa jets are being primed as we speak.",
        "prepare the villa for a dinner party": "Certainly, Sir. I will coordinate the full staff — chef, housekeeping, and valet. The dining room will be arranged and the sommelier will prepare the wine selection. How many guests should we expect?",
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
        const responseTasks = dispatchTasks(intents, trimmed);
        if (responseTasks.length > 0) {
          const t3 = setTimeout(() => setTasks((prev) => [...prev, ...responseTasks]), 700);
          timersRef.current.push(t3);
        }
        // Apply estate state changes
        const t4 = setTimeout(() => {
          for (const intent of intents) {
            if (intent.type === "climateControl") {
              const tempMatch = trimmed.match(/(\d{1,2})\s*(°c?|celsius|degrees?)?/i);
              if (tempMatch) {
                const t = parseInt(tempMatch[1], 10);
                if (t >= 16 && t <= 30) onEstateTempChange?.(t);
              }
            } else if (intent.type === "poolControl") {
              onPoolToggle?.(intent.specifics !== "off");
            }
          }
        }, 700);
        timersRef.current.push(t4);
        return;
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
          // Apply estate state changes from AI commands
          for (const intent of intents) {
            if (intent.type === "climateControl") {
              const tempMatch = trimmed.match(/(\d{1,2})\s*(°c?|celsius|degrees?)?/i);
              if (tempMatch) {
                const t = parseInt(tempMatch[1], 10);
                if (t >= 16 && t <= 30) onEstateTempChange?.(t);
              }
            } else if (intent.type === "poolControl") {
              onPoolToggle?.(intent.specifics !== "off");
            }
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
    [processingPhase],
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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-2xl font-light tracking-wide md:text-3xl"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            AI Estate Manager
          </h2>
          <p className="mt-1 text-sm font-light text-text-secondary">
            Intelligent Staff Automation
          </p>
        </div>

        {/* View Toggle */}
        <ViewToggle active={viewMode} onChange={setViewMode} />
      </div>

      {/* Panel Content */}
      {viewMode === "owner" ? (
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
      ) : (
        <StaffView
          tasks={tasks}
          completedCount={completedCount}
          totalCount={tasks.length}
          onToggleTask={handleToggleTask}
          onAssignTask={handleAssignTask}
          onEstateTempChange={onEstateTempChange}
          onPoolToggle={onPoolToggle}
        />
      )}
    </div>
  );
}

// ── View Toggle ───────────────────────────────────────────────────────────────

function ViewToggle({
  active,
  onChange,
}: {
  active: StaffViewMode;
  onChange: (mode: StaffViewMode) => void;
}) {
  return (
    <div
      className="relative inline-flex rounded-full border border-border p-0.5"
      style={{ backgroundColor: "var(--aura-card, #1A1A1A)" }}
    >
      {/* Sliding pill background */}
      <div
        className={`
          absolute top-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] rounded-full
          transition-all duration-300 ease-out
        `}
        style={{
          backgroundColor: "var(--aura-accent, #D4AF37)",
          left: active === "owner" ? "2px" : "calc(50% + 0px)",
        }}
      />

      <button
        onClick={() => onChange("owner")}
        className={`
          relative z-10 rounded-full px-4 py-1.5 text-xs font-medium
          tracking-wide transition-colors duration-300
          ${active === "owner" ? "text-midnight" : "text-text-muted hover:text-text-secondary"}
        `}
      >
        Owner View
      </button>
      <button
        onClick={() => onChange("staff")}
        className={`
          relative z-10 rounded-full px-4 py-1.5 text-xs font-medium
          tracking-wide transition-colors duration-300
          ${active === "staff" ? "text-midnight" : "text-text-muted hover:text-text-secondary"}
        `}
      >
        Staff View
      </button>
    </div>
  );
}

// ── Owner View — AI Estate Chat ──────────────────────────────────────────────

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
            AURA Executive Director
          </p>
          <p className="text-xs text-text-muted">
            {isBusy ? "Preparing your arrangements..." : "Your estate manager, always on duty"}
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

      {/* Suggestion Chips */}
      <div className="mt-3 flex flex-wrap gap-2 flex-shrink-0">
        <button
          onClick={() => onSend("I'm arriving tomorrow with guests")}
          disabled={isBusy}
          className="rounded-full border px-3 py-1.5 text-[11px] font-light tracking-wide transition-all duration-300 border-[var(--aura-border-accent,rgba(212,175,55,0.3))] text-[var(--aura-accent,#D4AF37)] hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Arriving tomorrow with guests
        </button>
        <button
          onClick={() => onSend("Book the yacht for sunset")}
          disabled={isBusy}
          className="rounded-full border px-3 py-1.5 text-[11px] font-light tracking-wide transition-all duration-300 border-[var(--aura-border-accent,rgba(212,175,55,0.3))] text-[var(--aura-accent,#D4AF37)] hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Book the yacht for sunset
        </button>
        <button
          onClick={() => onSend("Arrange a private dinner for 6")}
          disabled={isBusy}
          className="rounded-full border px-3 py-1.5 text-[11px] font-light tracking-wide transition-all duration-300 border-[var(--aura-border-accent,rgba(212,175,55,0.3))] text-[var(--aura-accent,#D4AF37)] hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Arrange a private dinner for 6
        </button>
        <button
          onClick={() => onSend("Prepare the estate for a weekend stay")}
          disabled={isBusy}
          className="rounded-full border px-3 py-1.5 text-[11px] font-light tracking-wide transition-all duration-300 border-[var(--aura-border-accent,rgba(212,175,55,0.3))] text-[var(--aura-accent,#D4AF37)] hover:bg-[var(--aura-accent-subtle,rgba(212,175,55,0.15))] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Prepare the estate for a weekend stay
        </button>
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
            AURA Executive Director is preparing your arrangements...
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

// ── Staff View — Interactive Checklist ───────────────────────────────────────

function StaffView({
  tasks,
  completedCount,
  totalCount,
  onToggleTask,
  onAssignTask,
  onEstateTempChange,
  onPoolToggle,
}: {
  tasks: TaskItem[];
  completedCount: number;
  totalCount: number;
  onToggleTask: (taskId: string) => void;
  onAssignTask: (taskId: string, name: string) => void;
  onEstateTempChange?: (t: number) => void;
  onPoolToggle?: (a: boolean) => void;
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

function ConciergePanel({ onAddTask, onRevenueAdd }: { onAddTask: (task: TaskItem) => void; onRevenueAdd: (tx: Omit<RevenueTransaction, "id">) => void }) {
  const [bookingService, setBookingService] = useState<ConciergeService | null>(null);

  return (
    <div className="rounded-2xl border border-border bg-charcoal p-8 md:p-10 lg:p-12">
      {/* Header */}
      <div className="mb-10">
        <h2
          className="text-2xl font-light tracking-wide md:text-3xl"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Exclusive Services &amp; Experiences
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

      {/* Booking Modal */}
      {bookingService && (
        <BookingModal
          service={bookingService}
          onClose={() => setBookingService(null)}
          onAddTask={onAddTask}
          onRevenueAdd={onRevenueAdd}
        />
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
  onClose,
  onAddTask,
  onRevenueAdd,
}: {
  service: ConciergeService;
  onClose: () => void;
  onAddTask: (task: TaskItem) => void;
  onRevenueAdd: (tx: Omit<RevenueTransaction, "id">) => void;
}) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [paymentState, setPaymentState] = useState<"idle" | "processing" | "paid">("idle");
  const [paymentRef, setPaymentRef] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const finalizedRef = useRef(false);
  const isPriced = service.priceValue !== null;

  // Null-price services (Custom Quote / On Request): finalize once on reaching
  // Checkout — Request Submitted, no payment, pending revenue awaiting quote
  useEffect(() => {
    if (stage === 3 && !isPriced && !finalizedRef.current) {
      finalizedRef.current = true;
      onAddTask({
        id: generateTaskId(),
        module: "Concierge",
        description: `[CONCIERGE] ${service.title} — ${service.price} — Request submitted, awaiting quote`,
        status: "pending",
        createdAt: new Date().toLocaleTimeString(),
      });
      onRevenueAdd({
        service: service.title,
        amount: 0,
        auraFee: 0,
        agencyShare: 0,
        status: "pending",
      });
    }
  }, [stage, isPriced, onAddTask, onRevenueAdd, service.title, service.price]);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(2), 1500);
    const t2 = setTimeout(() => setStage(3), 3000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  // Priced services: simulate payment, then finalize task + revenue exactly once
  const handlePayNow = () => {
    if (!isPriced || paymentState !== "idle" || finalizedRef.current) return;
    setPaymentState("processing");
    const ref = `AURA-PAY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setTimeout(() => {
      setPaymentRef(ref);
      setPaymentState("paid");
      if (!finalizedRef.current) {
        finalizedRef.current = true;
        onAddTask({
          id: generateTaskId(),
          module: "Concierge",
          description: `[CONCIERGE] ${service.title} — ${service.price} — Paid via AURA Vault (${ref})`,
          status: "pending",
          createdAt: new Date().toLocaleTimeString(),
        });
        onRevenueAdd({
          service: service.title,
          amount: service.priceValue ?? 0,
          auraFee: Math.round((service.priceValue ?? 0) * 0.03),
          agencyShare: Math.round((service.priceValue ?? 0) * 0.12),
          status: "approved",
        });
      }
    }, 1500);
  };

  const handleBackdropClick = () => {
    if (stage === 3 && paymentState !== "processing") {
      handleClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        isClosing ? "animate-fade-out pointer-events-none" : ""
      }`}
      onClick={handleBackdropClick}
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
        {stage === 1 && <Stage1Securing serviceName={service.title} />}
        {stage === 2 && <Stage2Escrow service={service} />}
        {stage === 3 && isPriced && (
          <Stage3Checkout
            service={service}
            paymentState={paymentState}
            paymentRef={paymentRef}
            onPayNow={handlePayNow}
            onClose={handleClose}
          />
        )}
        {stage === 3 && !isPriced && (
          <Stage3Requested service={service} onClose={handleClose} />
        )}
      </div>
    </div>
  );
}

// ── Stage 1: Securing Booking ─────────────────────────────────────────────────

function Stage1Securing({ serviceName }: { serviceName: string }) {
  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      {/* Pulsing gold ring */}
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="animate-escrow-pulse absolute inset-0 rounded-full" />
        <div
          className="relative flex h-12 w-12 items-center justify-center rounded-full border-2"
          style={{ borderColor: "var(--aura-accent, #D4AF37)" }}
        >
          {/* Shield icon */}
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
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
      </div>

      <div>
        <p className="text-lg font-light tracking-wide text-text-primary">
          Securing Booking
        </p>
        <p
          className="mt-1 text-sm font-light"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          via AURA Vault Protection...
        </p>
      </div>

      <p
        className="rounded-full border border-[var(--aura-border-accent,rgba(212,175,55,0.3))] px-4 py-1.5 text-xs font-light tracking-wide"
        style={{ color: "var(--aura-accent, #D4AF37)" }}
      >
        {serviceName}
      </p>
    </div>
  );
}

// ── Stage 2: Escrow Details ───────────────────────────────────────────────────

function Stage2Escrow({ service }: { service: ConciergeService }) {
  const isPriced = service.priceValue !== null;
  const amount = service.priceValue ?? 0;
  const auraFee = Math.round(amount * 0.03);
  const agencyShare = Math.round(amount * 0.12);
  const vendorPayout = Math.round(amount * 0.85);
  return (
    <div className="animate-fade-in-up space-y-5">
      <h3
        className="text-center text-lg font-light tracking-wide"
        style={{ color: "var(--aura-accent, #D4AF37)" }}
      >
        Escrow Details
      </h3>

      {/* Transaction Amount */}
      <div className="rounded-xl border border-border p-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          Transaction Amount
        </p>
        <p
          className="mt-2 text-2xl font-light tracking-wide"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          {service.price}
        </p>
      </div>

      {/* Secure Escrow Hold badge */}
      <div
        className="flex items-center gap-3 rounded-xl border p-4"
        style={{
          borderColor: "var(--aura-accent, #D4AF37)",
          backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.08))",
        }}
      >
        {/* Shield + lock icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--aura-accent, #D4AF37)", flexShrink: 0 }}
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <circle cx="12" cy="16" r="1" />
        </svg>
        <span
          className="text-sm font-medium tracking-wide"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Secure Escrow Hold Active
        </span>
      </div>

      {/* System log — fee breakdown */}
      <div
        className="rounded-lg border border-border/40 p-3"
        style={{ backgroundColor: "rgba(11,11,11,0.6)" }}
      >
        {isPriced ? (
          <div className="space-y-1.5 font-mono text-[11px] font-light leading-relaxed tracking-wide">
            <div className="flex items-center justify-between gap-4 text-text-muted">
              <span>Transaction Amount</span>
              <span className="text-text-primary">{formatCurrency(amount)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-text-muted">
              <span>AURA Platform Fee (3%)</span>
              <span style={{ color: "var(--aura-accent, #D4AF37)" }}>{formatCurrency(auraFee)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-text-muted">
              <span>Agency Commission (12%)</span>
              <span className="text-text-primary">{formatCurrency(agencyShare)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-text-muted">
              <span>Vendor Payout (85%)</span>
              <span className="text-text-primary">{formatCurrency(vendorPayout)}</span>
            </div>
          </div>
        ) : (
          <p className="font-mono text-[11px] font-light leading-relaxed tracking-wide text-text-muted">
            Custom Quote — fees calculated at confirmation
          </p>
        )}
        <p className="mt-1.5 font-mono text-[10px] tracking-wide text-text-muted/50">
          Mock escrow — no real funds are held
        </p>
      </div>
    </div>
  );
}

// ── Stage 3: Confirmed ────────────────────────────────────────────────────────

// ── Stage 3: Mock Checkout ────────────────────────────────────────────────────

function Stage3Checkout({
  service,
  paymentState,
  paymentRef,
  onPayNow,
  onClose,
}: {
  service: ConciergeService;
  paymentState: "idle" | "processing" | "paid";
  paymentRef: string;
  onPayNow: () => void;
  onClose: () => void;
}) {
  // Paid state — success screen with mock payment reference
  if (paymentState === "paid") {
    return (
      <div className="animate-fade-in-up flex flex-col items-center space-y-6 text-center">
        {/* Gold checkmark with pop animation */}
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
            Payment Successful
          </p>
          <p className="mt-2 text-sm font-light text-text-secondary">
            {service.title}
          </p>
        </div>

        {/* Mock payment reference */}
        <div
          className="w-full rounded-xl border border-border/40 p-4"
          style={{ backgroundColor: "rgba(11,11,11,0.6)" }}
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Mock Payment Reference
          </p>
          <p
            className="mt-1.5 font-mono text-sm tracking-wider"
            style={{ color: "var(--aura-accent, #D4AF37)" }}
          >
            {paymentRef}
          </p>
          <p className="mt-1 text-[10px] font-light text-text-muted/60">
            Simulated transaction — no real funds were collected
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-2 cursor-pointer rounded-lg border border-[var(--aura-accent,#D4AF37)] px-6 py-3 text-sm font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up flex flex-col items-center space-y-6 text-center">
      {/* AURA Vault badge */}
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full border-2"
        style={{ borderColor: "var(--aura-accent, #D4AF37)" }}
      >
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
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <circle cx="12" cy="16" r="1" />
        </svg>
      </div>

      <div>
        <p className="text-lg font-light tracking-wide text-text-primary">
          Checkout
        </p>
        <p className="mt-1 text-sm font-light text-text-secondary">
          {service.title}
        </p>
      </div>

      {/* Amount due */}
      <div className="w-full rounded-xl border border-border p-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          Amount Due
        </p>
        <p
          className="mt-2 text-3xl font-light tracking-wide"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          {formatCurrency(service.priceValue ?? 0)}
        </p>
        <p className="mt-1 text-[11px] font-light text-text-muted/60">
          {service.price}
        </p>
      </div>

      {/* AURA Vault payment badge */}
      <div
        className="flex w-full items-center justify-center gap-2 rounded-xl border p-3"
        style={{
          borderColor: "var(--aura-border-accent, rgba(212,175,55,0.3))",
          backgroundColor: "var(--aura-accent-subtle, rgba(212,175,55,0.08))",
        }}
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
          style={{ color: "var(--aura-accent, #D4AF37)", flexShrink: 0 }}
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span
          className="text-xs font-medium uppercase tracking-[0.15em]"
          style={{ color: "var(--aura-accent, #D4AF37)" }}
        >
          Secured by AURA Vault
        </span>
      </div>

      {/* Pay Now / Processing */}
      {paymentState === "processing" ? (
        <div className="flex w-full flex-col items-center space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--aura-accent,#D4AF37)] border-t-transparent" />
            <p className="text-sm font-light text-text-secondary">
              Processing payment...
            </p>
          </div>
          <p className="text-[10px] font-light text-text-muted/60">
            Mock checkout — no real funds move
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={onPayNow}
            className="w-full cursor-pointer rounded-lg bg-[var(--aura-accent,#D4AF37)] px-6 py-3.5 text-sm font-medium uppercase tracking-[0.15em] text-midnight transition-all duration-300 hover:brightness-110"
          >
            Pay Now
          </button>
          <button
            onClick={onClose}
            className="cursor-pointer text-xs font-light tracking-wide text-text-muted transition-colors hover:text-text-primary"
          >
            Not now
          </button>
        </>
      )}
    </div>
  );
}

// ── Stage 3 (null price): Request Submitted ───────────────────────────────────

function Stage3Requested({
  service,
  onClose,
}: {
  service: ConciergeService;
  onClose: () => void;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col items-center space-y-6 text-center">
      {/* Gold checkmark with pop animation */}
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
          Request Submitted
        </p>
        <p className="mt-2 text-sm font-light text-text-secondary">
          {service.title} — {service.price}
        </p>
      </div>

      <div
        className="w-full rounded-xl border border-border/40 p-4"
        style={{ backgroundColor: "rgba(11,11,11,0.6)" }}
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          Custom Quote
        </p>
        <p className="mt-1.5 text-sm font-light text-text-secondary">
          Your concierge will provide a tailored quote shortly
        </p>
      </div>

      <button
        onClick={onClose}
        className="mt-2 cursor-pointer rounded-lg border border-[var(--aura-accent,#D4AF37)] px-6 py-3 text-sm font-medium tracking-wider text-[var(--aura-accent,#D4AF37)] transition-all duration-300 hover:bg-[var(--aura-accent,#D4AF37)] hover:text-midnight"
      >
        Close
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE PANEL — Agency Revenue Analytics Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

interface RevenueTransaction {
  id: string;
  service: string;
  amount: number;
  auraFee: number;      // 3% AURA platform fee
  agencyShare: number;  // 12% agency commission
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

function RevenuePanel({ revenueTransactions }: { revenueTransactions: RevenueTransaction[] }) {
  const totalClientSpend = revenueTransactions.reduce((sum, t) => sum + t.amount, 0);
  const totalPlatformRevenue = revenueTransactions.filter((t) => t.status === "approved").reduce((sum, t) => sum + t.auraFee, 0);
  const totalAuraFees = revenueTransactions.reduce((sum, t) => sum + t.auraFee, 0);
  const totalAgencyCommissions = revenueTransactions.reduce((sum, t) => sum + t.agencyShare, 0);
  const revenueStats: RevenueStat[] = [
    { label: "Total Client Spend via App", value: formatCurrency(totalClientSpend), subLabel: "Current quarter" },
    { label: "Agency Net Commissions", value: formatCurrency(totalAgencyCommissions), subLabel: "12% Avg Share" },
    { label: "Active Premium Subscriptions", value: "€30,000.00/yr", subLabel: "15 Properties" },
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
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
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
          <h3 className="text-xl font-light tracking-wide text-text-primary md:text-2xl">
            Recent Transactions
          </h3>
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
                  Amount
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  AURA Fee
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  Agency Share
                </th>
                <th className="pb-4 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {revenueTransactions.map((tx, idx) => {
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
                    </td>
                    <td className="py-4 text-right text-sm font-light text-text-secondary">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td
                      className="py-4 pr-2 text-right text-sm font-light tracking-wide"
                      style={{ color: "var(--aura-accent, #D4AF37)" }}
                    >
                      {formatCurrency(tx.auraFee)}
                    </td>
                    <td
                      className="py-4 pr-2 text-right text-sm font-medium tracking-wide"
                      style={{ color: "var(--aura-accent, #D4AF37)" }}
                    >
                      {formatCurrency(tx.agencyShare)}
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
                  colSpan={5}
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
              <tr>
                <td className="py-3 pl-4 text-sm font-medium tracking-wide text-text-primary">
                  Totals
                </td>
                <td className="py-3 text-right text-sm font-medium text-text-primary">
                  {formatCurrency(totalClientSpend)}
                </td>
                <td
                  className="py-3 text-right text-sm font-medium tracking-wide"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {formatCurrency(totalAuraFees)}
                </td>
                <td
                  className="py-3 text-right text-sm font-medium tracking-wide"
                  style={{ color: "var(--aura-accent, #D4AF37)" }}
                >
                  {formatCurrency(totalAgencyCommissions)}
                </td>
                <td className="py-3 pr-4 text-right">
                  <span className="text-[11px] font-light text-text-muted">
                    {revenueTransactions.filter((t) => t.status === "approved").length} of{" "}
                    {revenueTransactions.length} approved
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
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
                  Total Platform Revenue (3% Commission):
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
                  Total Agency Commissions (12%):
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
              across 15 active properties
            </p>
          </div>
        </div>
      </div>
    </div>
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

function Footer({ agency }: { agency: AgencyInfo }) {
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
          Powered by {agency.name} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}

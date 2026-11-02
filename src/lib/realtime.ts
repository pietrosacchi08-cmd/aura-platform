/**
 * AURA realtime — the single seam between the app and its data store.
 *
 * Two modes, decided once from the environment:
 *
 *  • CLOUD MODE — `@supabase/supabase-js` talks to Postgres and subscribes to
 *    `postgres_changes` on `guest_requests` / `guest_sessions`, so the guest app
 *    and the staff dashboard see each other live.
 *  • LOCAL MODE — no credentials (or a client that failed to initialise): every
 *    function below operates on the browser's localStorage stores exactly as the
 *    app always has, with an in-memory broadcast so same-tab subscribers still
 *    fire. Nothing is ever broken by the absence of Supabase.
 *
 * The wrapper is deliberately thin: it maps the app's own shape to columns and
 * back, and does nothing else. All behaviour (toasts, beeps, resets, totals)
 * lives in the UI, which only ever calls these functions.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseServiceDetails, type ServiceDetails } from "../data/serviceDetails";

// ── App-facing shapes (structurally compatible with the UI's own models) ─────

export type RealtimeStatus =
  | "received"
  | "in_progress"
  | "confirmed"
  | "completed"
  | "cancelled";

/** A guest request, in the app's own field names. */
export interface RealtimeRequest {
  id: string;
  guestName: string;
  villaName: string;
  serviceType: string;
  /** Structured guest choices from the Services modals (jsonb column `details`). */
  details: ServiceDetails | null;
  status: RealtimeStatus;
  price: number | null;
  agencyPct: number;
  auraPct: number;
  /** Agency commission recorded with the request (column `agency_commission`). */
  agencyCommission: number | null;
  /** AURA platform commission recorded with the request (column `platform_commission`). */
  platformCommission: number | null;
  staffNote: string;
  supplierId: string | null;
  supplierName?: string | null;
  guestSessionId?: string | null;
  villaId?: string | null;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A guest stay session, in the app's own field names. */
export interface RealtimeSession {
  sessionId: string;
  villaId: string;
  guestName: string;
  startedAt: string;
  /** Non-null once staff have concluded the stay (reset). */
  closedAt: string | null;
}

// ── Environment ─────────────────────────────────────────────────────────────

/**
 * Values reach the client through `VITE_`-prefixed variables only (Vite strips
 * everything else). `vite.config.ts` copies bare `SUPABASE_URL` /
 * `SUPABASE_ANON_KEY` into those names so a platform that injects unprefixed
 * variables still works.
 */
const SUPABASE_URL = readEnv(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);

function readEnv(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

// ── Client (lazy, fail-soft) ────────────────────────────────────────────────

let client: SupabaseClient | null = null;
let clientResolved = false;

/** The Supabase client, or null in local mode. Never throws. */
function getClient(): SupabaseClient | null {
  if (clientResolved) return client;
  clientResolved = true;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    // Bad URL, blocked storage, offline… behave exactly like today.
    client = null;
  }
  return client;
}

/** True when requests/sessions are synced through Supabase. */
export function isCloudMode(): boolean {
  return getClient() !== null;
}

// ── Column mapping (app shape ⇄ table row) ──────────────────────────────────

type Row = Record<string, unknown>;

function toRow(request: RealtimeRequest): Row {
  return {
    id: request.id,
    villa_id: request.villaId ?? null,
    villa_name: request.villaName,
    guest_session_id: request.guestSessionId ?? null,
    guest_name: request.guestName,
    service_label: request.serviceType,
    price: request.price,
    status: request.status,
    supplier_id: request.supplierId ?? null,
    supplier_name: request.supplierName ?? null,
    archived: request.archived === true,
    details: request.details ?? null,
    agency_pct: request.agencyPct,
    aura_pct: request.auraPct,
    agency_commission: request.agencyCommission ?? null,
    platform_commission: request.platformCommission ?? null,
    staff_note: request.staffNote,
    created_at: request.createdAt,
    updated_at: request.updatedAt,
  };
}

/** Only the columns that a patch actually carries — never a full overwrite. */
function toRowPatch(patch: Partial<RealtimeRequest>): Row {
  const row: Row = {};
  if (patch.villaId !== undefined) row.villa_id = patch.villaId;
  if (patch.villaName !== undefined) row.villa_name = patch.villaName;
  if (patch.guestSessionId !== undefined) row.guest_session_id = patch.guestSessionId;
  if (patch.guestName !== undefined) row.guest_name = patch.guestName;
  if (patch.serviceType !== undefined) row.service_label = patch.serviceType;
  if (patch.price !== undefined) row.price = patch.price;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.supplierId !== undefined) row.supplier_id = patch.supplierId;
  if (patch.supplierName !== undefined) row.supplier_name = patch.supplierName;
  if (patch.archived !== undefined) row.archived = patch.archived;
  if (patch.details !== undefined) row.details = patch.details;
  if (patch.agencyPct !== undefined) row.agency_pct = patch.agencyPct;
  if (patch.auraPct !== undefined) row.aura_pct = patch.auraPct;
  if (patch.agencyCommission !== undefined) row.agency_commission = patch.agencyCommission;
  if (patch.platformCommission !== undefined)
    row.platform_commission = patch.platformCommission;
  if (patch.staffNote !== undefined) row.staff_note = patch.staffNote;
  return row;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
/** A numeric column that is genuinely nullable (commissions, price). */
function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // PostgREST returns `numeric` as a string in some configurations.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function fromRow(raw: Row): RealtimeRequest | null {
  const id = str(raw.id);
  const status = str(raw.status) as RealtimeStatus;
  if (!id || !status) return null;
  const createdAt = str(raw.created_at, new Date().toISOString());
  return {
    id,
    guestName: str(raw.guest_name, "Guest"),
    villaName: str(raw.villa_name, "—"),
    serviceType: str(raw.service_label, "Concierge request"),
    details: parseServiceDetails(raw.details),
    status,
    price: numOrNull(raw.price),
    agencyPct: num(raw.agency_pct, 0),
    auraPct: num(raw.aura_pct, 0),
    agencyCommission: numOrNull(raw.agency_commission),
    platformCommission: numOrNull(raw.platform_commission),
    staffNote: str(raw.staff_note),
    supplierId: typeof raw.supplier_id === "string" && raw.supplier_id ? raw.supplier_id : null,
    supplierName: typeof raw.supplier_name === "string" ? raw.supplier_name : null,
    guestSessionId:
      typeof raw.guest_session_id === "string" && raw.guest_session_id
        ? raw.guest_session_id
        : null,
    villaId: typeof raw.villa_id === "string" && raw.villa_id ? raw.villa_id : null,
    archived: raw.archived === true,
    createdAt,
    updatedAt: str(raw.updated_at, createdAt),
  };
}

function fromSessionRow(raw: Row): RealtimeSession | null {
  const sessionId = str(raw.id);
  const villaId = str(raw.villa_id);
  if (!sessionId || !villaId) return null;
  return {
    sessionId,
    villaId,
    guestName: str(raw.guest_name, "Guest"),
    startedAt: str(raw.opened_at, new Date().toISOString()),
    closedAt: typeof raw.closed_at === "string" && raw.closed_at ? raw.closed_at : null,
  };
}

// ── Local store (local mode) ────────────────────────────────────────────────

const REQUESTS_KEY = "aura-guest-requests";
const SESSIONS_KEY = "aura-guest-sessions";

function readLocalRequests(): RealtimeRequest[] {
  try {
    const stored = localStorage.getItem(REQUESTS_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => (row && typeof row === "object" ? fromLocalRequest(row as Row) : null))
      .filter((r): r is RealtimeRequest => r !== null);
  } catch {
    return [];
  }
}

/** localStorage rows already use the app's shape; keep unknown fields intact. */
function fromLocalRequest(raw: Row): RealtimeRequest | null {
  const id = str(raw.id);
  if (!id) return null;
  const created = str(raw.createdAt, new Date().toISOString());
  return {
    ...(raw as unknown as RealtimeRequest),
    id,
    guestName: str(raw.guestName, "Guest"),
    villaName: str(raw.villaName, "—"),
    serviceType: str(raw.serviceType, "Concierge request"),
    details: parseServiceDetails(raw.details),
    status: str(raw.status, "received") as RealtimeStatus,
    price: numOrNull(raw.price),
    agencyPct: num(raw.agencyPct, 0),
    auraPct: num(raw.auraPct, 0),
    agencyCommission: numOrNull(raw.agencyCommission),
    platformCommission: numOrNull(raw.platformCommission),
    staffNote: str(raw.staffNote),
    supplierId: typeof raw.supplierId === "string" ? raw.supplierId : null,
    guestSessionId:
      typeof raw.guestSessionId === "string" ? raw.guestSessionId : null,
    villaId: typeof raw.villaId === "string" ? raw.villaId : null,
    archived: raw.archived === true,
    createdAt: created,
    updatedAt: str(raw.updatedAt, created),
  };
}

function writeLocalRequests(rows: RealtimeRequest[]): void {
  try {
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(rows));
  } catch {
    /* storage full or blocked — the in-memory state still drives the UI */
  }
}

function readLocalSessions(): RealtimeSession[] {
  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => fromSessionRow(row as Row))
      .filter((s): s is RealtimeSession => s !== null);
  } catch {
    return [];
  }
}

function writeLocalSessions(rows: RealtimeSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function toSessionRow(session: RealtimeSession): Row {
  return {
    id: session.sessionId,
    villa_id: session.villaId,
    guest_name: session.guestName,
    opened_at: session.startedAt,
    closed_at: session.closedAt,
  };
}

// ── In-memory broadcast (local mode, same tab) ──────────────────────────────

const requestListeners = new Set<(rows: RealtimeRequest[]) => void>();
const sessionListeners = new Set<(rows: RealtimeSession[]) => void>();

function broadcastRequests(): void {
  const rows = readLocalRequests();
  requestListeners.forEach((cb) => cb(rows));
}
function broadcastSessions(): void {
  const rows = readLocalSessions();
  sessionListeners.forEach((cb) => cb(rows));
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** All requests, optionally scoped to one villa. Newest first. */
export async function listRequests(villaId: string | null): Promise<RealtimeRequest[]> {
  const client = getClient();
  if (!client) {
    const rows = readLocalRequests().filter(
      (r) => villaId === null || r.villaId === villaId,
    );
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  try {
    let query = client.from("guest_requests").select("*");
    if (villaId !== null) query = query.eq("villa_id", villaId);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    return data
      .map((row: unknown) => fromRow(row as Row))
      .filter((r: RealtimeRequest | null): r is RealtimeRequest => r !== null)
      .sort((a: RealtimeRequest, b: RealtimeRequest) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** All stay sessions, optionally scoped to one villa. Newest first. */
export async function listSessions(villaId: string | null): Promise<RealtimeSession[]> {
  const client = getClient();
  if (!client) {
    return readLocalSessions().filter((s) => villaId === null || s.villaId === villaId);
  }
  try {
    let query = client.from("guest_sessions").select("*");
    if (villaId !== null) query = query.eq("villa_id", villaId);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    return data
      .map((row: unknown) => fromSessionRow(row as Row))
      .filter((s: RealtimeSession | null): s is RealtimeSession => s !== null);
  } catch {
    return [];
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Columns added by supabase/schema-v2-service-details.sql. The deployed app may
 * run against a database where that migration has not been executed yet, so an
 * insert that trips over them is retried ONCE without them (see createRequest).
 */
const OPTIONAL_COLUMNS = [
  "details",
  "agency_pct",
  "aura_pct",
  "agency_commission",
  "platform_commission",
] as const;

/** A copy of the row without the v2-only columns. */
function withoutOptionalColumns(row: Row): Row {
  const fallback: Row = { ...row };
  for (const column of OPTIONAL_COLUMNS) delete fallback[column];
  return fallback;
}

/**
 * True when PostgREST rejected the write because a column is unknown to it or
 * because the value does not fit the column's current type:
 *  • 42703 / PGRST204 — column does not exist (migration not run yet)
 *  • 22P02 / PGRST102 — `details` is still the legacy TEXT column, so a jsonb
 *    object cannot be written to it yet
 * Anything else is a real failure and is left to the fail-soft path.
 */
function isSchemaMismatch(error: { code?: string | null; message?: string | null }): boolean {
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "42703" || code === "PGRST204") return true;
  if (code === "22P02" || code === "PGRST102") return true;
  const message = (typeof error.message === "string" ? error.message : "").toLowerCase();
  if (message.includes("invalid input syntax")) return true;
  return (
    message.includes("column") &&
    (message.includes("does not exist") ||
      message.includes("could not find") ||
      message.includes("schema cache"))
  );
}

/**
 * Persist one new request (guest app, chat prompt or Services booking).
 *
 * Resilience: the optional v2 columns (details jsonb + the two commission
 * amounts) may not exist yet on a database where the migration has not been
 * run. In that case the insert is retried once WITHOUT them, so the request —
 * including its price — is still recorded and nothing breaks pre-migration.
 * Any other failure leaves the optimistic local state in charge (fail-soft).
 */
export async function createRequest(request: RealtimeRequest): Promise<void> {
  const client = getClient();
  if (!client) {
    writeLocalRequests([request, ...readLocalRequests()]);
    broadcastRequests();
    return;
  }
  try {
    const row = toRow(request);
    const { error } = await client
      .from("guest_requests")
      .upsert(row, { onConflict: "id" });
    if (!error) return;
    if (!isSchemaMismatch(error)) return;
    // Pre-migration database: record the request without the optional columns.
    await client.from("guest_requests").upsert(withoutOptionalColumns(row), {
      onConflict: "id",
    });
  } catch {
    /* offline — the optimistic local state still shows the request */
  }
}

/** Patch one request (staff status/supplier/price/note, or archival). */
export async function updateRequest(
  id: string,
  patch: Partial<RealtimeRequest>,
): Promise<void> {
  const client = getClient();
  const rowPatch = toRowPatch(patch);
  if (!client) {
    const rows = readLocalRequests().map((r) =>
      r.id === id
        ? { ...r, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() }
        : r,
    );
    writeLocalRequests(rows);
    broadcastRequests();
    return;
  }
  if (Object.keys(rowPatch).length === 0) return;
  try {
    await client
      .from("guest_requests")
      .update({ ...rowPatch, updated_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    /* ignore */
  }
}

/** Open a stay session (called once the guest clears the name + PIN gate). */
export async function openSession(session: RealtimeSession): Promise<void> {
  const client = getClient();
  if (!client) {
    const existing = readLocalSessions().filter((s) => s.sessionId !== session.sessionId);
    writeLocalSessions([session, ...existing]);
    broadcastSessions();
    return;
  }
  try {
    await client.from("guest_sessions").upsert(toSessionRow(session), { onConflict: "id" });
  } catch {
    /* ignore */
  }
}

/**
 * Conclude a stay: every open session for the villa is stamped closed_at.
 * Rows are archived, never deleted.
 */
export async function closeSessionsForVilla(villaId: string): Promise<void> {
  const now = new Date().toISOString();
  const client = getClient();
  if (!client) {
    const rows = readLocalSessions().map((s) =>
      s.villaId === villaId && s.closedAt === null ? { ...s, closedAt: now } : s,
    );
    writeLocalSessions(rows);
    broadcastSessions();
    return;
  }
  try {
    await client
      .from("guest_sessions")
      .update({ closed_at: now })
      .eq("villa_id", villaId)
      .is("closed_at", null);
  } catch {
    /* ignore */
  }
}

/**
 * Archive (never delete) the villa's live requests so staff views empty out
 * while revenue keeps counting them.
 */
export async function archiveRequestsForVilla(villaId: string): Promise<void> {
  const now = new Date().toISOString();
  const client = getClient();
  if (!client) {
    const rows = readLocalRequests().map((r) =>
      r.villaId === villaId && !r.archived
        ? { ...r, archived: true, updatedAt: now }
        : r,
    );
    writeLocalRequests(rows);
    broadcastRequests();
    return;
  }
  try {
    await client
      .from("guest_requests")
      .update({ archived: true, updated_at: now })
      .eq("villa_id", villaId)
      .eq("archived", false);
  } catch {
    /* ignore */
  }
}

// ── Subscriptions ───────────────────────────────────────────────────────────

/** Subscribe to live request changes. Returns an unsubscribe function. */
export function subscribeRequests(cb: (rows: RealtimeRequest[]) => void): () => void {
  const client = getClient();
  if (!client) {
    requestListeners.add(cb);
    return () => {
      requestListeners.delete(cb);
    };
  }
  const refresh = () => {
    void listRequests(null).then((rows) => cb(rows));
  };
  const channel = client
    .channel("aura:guest_requests")
    .on("postgres_changes", { event: "*", schema: "public", table: "guest_requests" }, refresh)
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/** Subscribe to live session changes (used to detect a staff reset). */
export function subscribeSessions(cb: (rows: RealtimeSession[]) => void): () => void {
  const client = getClient();
  if (!client) {
    sessionListeners.add(cb);
    return () => {
      sessionListeners.delete(cb);
    };
  }
  const refresh = () => {
    void listSessions(null).then((rows) => cb(rows));
  };
  const channel = client
    .channel("aura:guest_sessions")
    .on("postgres_changes", { event: "*", schema: "public", table: "guest_sessions" }, refresh)
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

import { getEnv } from '../env';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger';

/**
 * A namespaced, salted, non-reversible stand-in for an identifier in logs.
 *
 * Cloud Logging is readable by every project owner — four on this project — so
 * anything written there is visible to colleagues, not only to the user it
 * belongs to. A log of which mailbox opened which panel is a record of
 * behaviour nobody consented to share.
 *
 * All three properties are load-bearing:
 *
 * SALTED, because a bare hash of a work email is not anonymous. The space is
 * `firstname@mystartupcfo.com` — a few hundred candidates. Anyone with the
 * staff list can hash all of them and match, which makes an unsalted digest a
 * lookup table with extra steps. The salt lives in Secret Manager, so reversing
 * it requires the secret AND the logs, held by different grants.
 *
 * NAMESPACED, so the same string hashed as a mailbox and as a customer domain
 * produces different digests. Without it, `user:` and `account:` values are
 * cross-correlatable — you could tell that a viewer's address equals a
 * customer's domain owner, which is exactly the relationship the redaction is
 * meant to hide.
 *
 * FAILS CLOSED. With no salt configured this returns 'redacted' rather than a
 * weak digest, because a hash that looks anonymous and is not is worse than
 * visibly omitting the value.
 */
function pseudo(ns: 'user' | 'account', value: string | undefined): string {
  if (!value) return 'none';
  const salt = getEnv().LOG_SALT;
  if (!salt) return 'redacted';
  return createHash('sha256')
    .update(`${salt}\u0000${ns}\u0000${value.toLowerCase()}`)
    .digest('hex')
    .slice(0, 12);
}


/**
 * Thin client for the InboxPulse API's internal service path
 * (`/api/internal/*`, guarded by SERVICE_API_KEY + x-tenant-id/x-user-id).
 * Verified end-to-end in Phase 0. Field access is defensive because the exact
 * response shapes are confirmed at wire time, not compile time.
 */
function internalHeaders(tenantId?: string, userId?: string): Record<string, string> {
  const env = getEnv();
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'x-internal-api-key': env.SERVICE_API_KEY,
  };
  if (tenantId) h['x-tenant-id'] = tenantId;
  if (userId) h['x-user-id'] = userId;
  return h;
}

function unwrap<T>(json: unknown): T {
  const j = json as { data?: T } & Record<string, unknown>;
  return (j?.data ?? j) as T;
}

export interface EmailStats {
  total: number;
  analyzed: number;
}

/**
 * Every call to the InboxPulse API, with a deadline.
 *
 * There were nine fetches here and not one of them could time out. When
 * SERVICE_API_URL pointed at a service that had stopped answering, the panel
 * hung on a spinner until Gmail gave up — no error, no card, no log line saying
 * what it was waiting for.
 *
 * The card must render without account context rather than not render at all.
 * Everything this client returns is enrichment: history, stats, the customer
 * name. The thread reading does not depend on any of it, so a slow API should
 * cost the user a smaller card, never the whole panel.
 *
 * Two seconds was chosen when every call here was a lookup. The management
 * queries are not: "where the fires are" aggregates 90 days of negative threads
 * per client, computes a monthly complaint rate for each, and then resolves an
 * owner — 2.2s against the live corpus, plus 0.9s for the owner step. Under a 2s
 * deadline it timed out on EVERY request, and the card renders a failed fetch
 * and an empty list identically, so the panel simply had no "Where the fires
 * are" section and read as a firm with nothing on fire.
 *
 * Six seconds is chosen against what the slow calls actually take with headroom,
 * not against what feels responsive. The failure it prevents is silent and total;
 * the cost when a service really is down is a panel that takes six seconds to
 * render everything else, which is visible and recoverable.
 */
const API_TIMEOUT_MS = 6000;

async function apiFetch(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    logger.warn({ err: String(err), url: url.split('?')[0] }, 'internal API call failed or timed out');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getEmailStats(tenantId: string, userId?: string): Promise<EmailStats | null> {
  const env = getEnv();
  try {
    const res = await apiFetch(`${env.SERVICE_API_URL}/api/internal/emails/stats`, {
      headers: internalHeaders(tenantId, userId),
    });
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'GET /api/internal/emails/stats non-OK');
      return null;
    }
    const d = unwrap<Partial<EmailStats>>(await res.json());
    return { total: Number(d.total ?? 0), analyzed: Number(d.analyzed ?? 0) };
  } catch (err) {
    logger.error({ err: String(err) }, 'getEmailStats failed');
    return null;
  }
}

/**
 * Map a signed-in user's email to their tenant via the connected-mailbox
 * integration. Returns null if no mailbox integration matches (or on error).
 * (No userId is returned — internal auth grants full perms from tenant alone.)
 */
export async function resolveTenantByEmail(email: string): Promise<string | null> {
  const env = getEnv();
  try {
    const url = `${env.SERVICE_API_URL}/api/internal/integrations/lookup/by-email?email=${encodeURIComponent(email)}&source=gmail`;
    const res = await apiFetch(url, { headers: internalHeaders() });
    if (!res || !res.ok) {
      logger.info({ status: res?.status, user: pseudo('user', email) }, 'lookup/by-email: no tenant for user');
      return null;
    }
    const d = unwrap<{ tenantId?: string }>(await res.json());
    return d.tenantId ?? null;
  } catch (err) {
    logger.error({ err: String(err) }, 'resolveTenantByEmail failed');
    return null;
  }
}

export interface ResolvedMessage {
  emailId: string;
  customerId?: string;
  threadId?: string;
  subject?: string;
  receivedAt?: string;
  signals: number[];
}

/** Resolve one open Gmail message-id to its InboxPulse email record. */
export async function resolveThreadByMessage(
  messageId: string,
  rfcMessageId: string | undefined,
  tenantId: string,
): Promise<ResolvedMessage | null> {
  const env = getEnv();
  try {
    const res = await apiFetch(`${env.SERVICE_API_URL}/api/internal/emails/resolve-by-messages`, {
      method: 'POST',
      headers: internalHeaders(tenantId),
      body: JSON.stringify({
        messageIds: [messageId],
        // Cross-mailbox-stable id — lets a viewer resolve a thread ingested from
        // a teammate's mailbox (whose per-mailbox provider id differs from theirs).
        rfcMessageIds: rfcMessageId ? [rfcMessageId] : undefined,
        provider: 'gmail',
      }),
    });
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'resolve-by-messages non-OK');
      return null;
    }
    const d = unwrap<{ emails?: Record<string, any>[] }>(await res.json());
    const row = d.emails?.[0];
    if (!row) return null;
    return {
      emailId: row.id ?? row.emailId,
      customerId: row.customerId,
      threadId: row.threadId,
      subject: row.subject ?? undefined,
      receivedAt: row.receivedAt ?? undefined,
      signals: Array.isArray(row.signals) ? row.signals : [],
    };
  } catch (err) {
    logger.error({ err: String(err) }, 'resolveThreadByMessage failed');
    return null;
  }
}

export interface StoredAnalysis {
  emailId: string;
  subject?: string;
  sentiment?: string;
  reason?: string;
  modelUsed?: string;
  analysedAt?: string;
}

/**
 * Has this message already been analysed and stored?
 *
 * Asked before the card offers "Analyse and save". `resolveThreadByMessage`
 * cannot answer it: that endpoint is customer-scoped, and a message saved from
 * the panel has no customer by construction — the Save button is only offered
 * on threads that resolved to none. So a message this button had already stored
 * still came back unresolved, and the card offered to analyse it again, every
 * time it was opened.
 *
 * Returns null both when nothing is stored and when the lookup fails. That is
 * the safe direction: an unreachable API leaves the buttons offered rather than
 * hiding a control on a guess.
 */
export async function findStoredAnalysis(
  messageId: string,
  rfcMessageId: string | undefined,
  tenantId: string,
): Promise<StoredAnalysis | null> {
  const env = getEnv();
  try {
    const res = await apiFetch(`${env.SERVICE_API_URL}/api/internal/emails/stored-analysis`, {
      method: 'POST',
      headers: internalHeaders(tenantId),
      body: JSON.stringify({
        messageIds: [messageId],
        rfcMessageIds: rfcMessageId ? [rfcMessageId] : undefined,
        provider: 'gmail',
      }),
    });
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'stored-analysis non-OK');
      return null;
    }
    const d = unwrap<{ analysis?: Record<string, unknown> | null }>(await res.json());
    const row = d.analysis;
    if (!row) return null;
    return {
      emailId: String(row.emailId ?? ''),
      subject: (row.subject as string) ?? undefined,
      sentiment: (row.sentiment as string) ?? undefined,
      reason: (row.reasoning as string) ?? undefined,
      modelUsed: (row.modelUsed as string) ?? undefined,
      analysedAt: (row.analysedAt as string) ?? undefined,
    };
  } catch (err) {
    logger.error({ err: String(err) }, 'findStoredAnalysis failed');
    return null;
  }
}

/**
 * Resolve a DB thread id from the open thread's Gmail (provider) thread id.
 * Lets the sidebar show thread-level trend/flagged even when the open message
 * itself isn't a tracked customer email. Returns null if the thread is unknown.
 */
export async function resolveThreadIdByProvider(
  providerThreadId: string,
  tenantId: string,
): Promise<string | null> {
  const env = getEnv();
  try {
    const res = await apiFetch(
      `${env.SERVICE_API_URL}/api/internal/emails/thread/by-provider/${encodeURIComponent(providerThreadId)}`,
      { headers: internalHeaders(tenantId) },
    );
    if (!res || !res.ok) return null;
    const d = unwrap<{ threadId?: string | null }>(await res.json());
    return d.threadId ?? null;
  } catch (err) {
    logger.error({ err: String(err) }, 'resolveThreadIdByProvider failed');
    return null;
  }
}

export interface ThreadTrendPoint {
  messageId: string;
  receivedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  isCustomer: boolean;
  fromEmail: string;
}

/**
 * Per-message sentiment trend for a thread (oldest→newest), for the sidebar's
 * "Trend, this thread" chart. Returns [] on any error or when nothing is scored.
 */
export async function getThreadTrend(
  threadId: string,
  tenantId: string,
): Promise<ThreadTrendPoint[]> {
  const env = getEnv();
  try {
    const res = await apiFetch(
      `${env.SERVICE_API_URL}/api/internal/emails/thread/${threadId}/trend`,
      { headers: internalHeaders(tenantId) },
    );
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'thread/:id/trend non-OK');
      return [];
    }
    const d = unwrap<{ points?: ThreadTrendPoint[] }>(await res.json());
    return Array.isArray(d.points) ? d.points : [];
  } catch (err) {
    logger.error({ err: String(err) }, 'getThreadTrend failed');
    return [];
  }
}

export interface FlaggedFlag {
  type: string;
  label: string;
  detail?: string;
  provenance: string;
}

export interface FlaggedMessage {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  subject: string;
  severity: number;
  flags: FlaggedFlag[];
}

/**
 * Flagged messages in a thread (most-severe first), for the sidebar's "Flagged
 * messages" section. Returns [] on any error or when nothing is flagged.
 */
export async function getThreadFlagged(
  threadId: string,
  tenantId: string,
): Promise<FlaggedMessage[]> {
  const env = getEnv();
  try {
    const res = await apiFetch(
      `${env.SERVICE_API_URL}/api/internal/emails/thread/${threadId}/flagged`,
      { headers: internalHeaders(tenantId) },
    );
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'thread/:id/flagged non-OK');
      return [];
    }
    const d = unwrap<{ messages?: FlaggedMessage[] }>(await res.json());
    return Array.isArray(d.messages) ? d.messages : [];
  } catch (err) {
    logger.error({ err: String(err) }, 'getThreadFlagged failed');
    return [];
  }
}

export interface AnalyzedEmail {
  customerId?: string;
  customerName?: string;
  fromEmail?: string;
  fromName?: string;
  subject?: string;
  signals: number[];
  taskId?: string;
  taskDone: boolean;
  assignedToName?: string;
  assignedToEmail?: string;
  problem?: string;
  resolution?: string;
}

/** Hydrate a resolved email with customer name + escalation/task state. */
export async function getAnalyzedEmail(
  emailId: string,
  tenantId: string,
): Promise<AnalyzedEmail | null> {
  const env = getEnv();
  try {
    const res = await apiFetch(`${env.SERVICE_API_URL}/api/internal/emails/analyzed/${emailId}`, {
      headers: internalHeaders(tenantId),
    });
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'analyzed/:id non-OK');
      return null;
    }
    const it = unwrap<Record<string, any>>(await res.json());
    const status = it.taskStatus;
    return {
      customerId: it.customerId,
      customerName: it.customerName,
      fromEmail: it.fromEmail,
      fromName: it.fromName,
      subject: it.subject,
      signals: Array.isArray(it.signals) ? it.signals : [],
      taskId: it.taskId ?? undefined,
      taskDone: status === 1 || status === '1' || status === 'done' || status === 'DONE',
      assignedToName: it.assignedToName ?? undefined,
      assignedToEmail: it.assignedToEmail ?? undefined,
      problem: it.problem ?? undefined,
      resolution: it.resolution ?? undefined,
    };
  } catch (err) {
    logger.error({ err: String(err) }, 'getAnalyzedEmail failed');
    return null;
  }
}

/** What we know about a sender's company that is NOT in the open thread. */
export interface PriorConcern {
  when: string;
  reason: string;
}

export interface AccountContext {
  found: boolean;
  /** 'viewer' = only mail you are on; 'tenant' = everything the org has. */
  scope?: 'tenant' | 'viewer';
  customerId?: string;
  name?: string;
  messages: number;
  threads: number;
  contacts: number;
  firstSeen?: string;
  lastSeen?: string;
  openTasks: number;
  negativeCount: number;
  priorConcerns: PriorConcern[];
}

/**
 * Resolve a sender's DOMAIN to account history.
 *
 * Domain rather than customer id on purpose: the add-on always has the sender's
 * address from Gmail headers, so this works on a thread InboxPulse has never
 * ingested — which is every thread in an inbox excluded from ingestion.
 */
export async function getAccountContext(
  domain: string,
  tenantId: string,
  viewer: { userId: string; isAdmin: boolean; email?: string },
): Promise<AccountContext | null> {
  const env = getEnv();
  // No viewer, no call. The endpoint rejects a missing userId, and asking
  // without one would only ever produce a 400.
  if (!env.SERVICE_API_KEY || !viewer.userId) return null;
  try {
    const url =
      `${env.SERVICE_API_URL}/api/internal/addon/account-context` +
      `?domain=${encodeURIComponent(domain)}` +
      `&tenantId=${encodeURIComponent(tenantId)}` +
      `&userId=${encodeURIComponent(viewer.userId)}` +
      `&isAdmin=${viewer.isAdmin ? 'true' : 'false'}` +
      (viewer.email ? `&email=${encodeURIComponent(viewer.email)}` : '');
    const res = await apiFetch(url, { headers: internalHeaders() });
    if (!res || !res.ok) {
      logger.warn({ status: res?.status, account: pseudo('account', domain) }, 'account-context non-OK');
      return null;
    }
    const json = (await res.json()) as { data?: AccountContext };
    return json.data?.found ? json.data : null;
  } catch (err) {
    logger.warn({ err: String(err), account: pseudo('account', domain) }, 'account-context failed');
    return null;
  }
}

/** Create a task from the panel. Returns false when the viewer is not entitled. */
/**
 * File a message the panel read, with its reading, into InboxPulse.
 *
 * The SECOND write in this client, and the first that adds a row to `emails`.
 * Returns a discriminated result rather than a boolean because the three
 * outcomes need different words on the card: stored, refused for a stated
 * reason, or we could not reach the service. `createTask` returns a boolean and
 * that is already the thing that makes "you do not have access" and "the API is
 * down" render identically.
 */
export async function saveAnalysedEmail(input: {
  tenantId: string;
  integrationId: string;
  provider: string;
  thread: { providerThreadId: string; subject: string };
  email: {
    messageId: string;
    rfcMessageId?: string | null;
    subject: string;
    body: string;
    fromEmail: string;
    fromName?: string | null;
    tos?: string[];
    ccs?: string[];
    receivedAt: string;
  };
  analysis: { sentiment: 'positive' | 'neutral' | 'negative'; reason: string; modelUsed: string };
}): Promise<
  { status: 'stored'; emailId: string } | { status: 'refused'; reason: string } | { status: 'unreachable' }
> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return { status: 'refused', reason: 'no service key configured' };
  try {
    const res = await apiFetch(`${env.SERVICE_API_URL}/api/internal/emails/analysed-live`, {
      method: 'POST',
      headers: internalHeaders(input.tenantId),
      body: JSON.stringify(input),
    });
    if (!res) return { status: 'unreachable' };
    if (!res.ok) {
      // The API's own message, not a generic one: a 400 here is a shape problem
      // in what the panel sent, and that is the only place it is visible.
      const detail = await res.text().catch(() => '');
      logger.warn({ status: res.status, detail: detail.slice(0, 300) }, 'saveAnalysedEmail non-OK');
      return { status: 'refused', reason: `the API returned ${res.status}` };
    }
    const json = (await res.json()) as { data?: { emailId?: string } };
    return json.data?.emailId
      ? { status: 'stored', emailId: json.data.emailId }
      : { status: 'refused', reason: 'the API stored nothing' };
  } catch (err) {
    logger.warn({ err: String(err) }, 'saveAnalysedEmail failed');
    return { status: 'unreachable' };
  }
}

export async function createTask(input: {
  tenantId: string;
  userId: string;
  isAdmin: boolean;
  customerId: string;
  title: string;
}): Promise<boolean> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return false;
  try {
    const res = await apiFetch(`${env.SERVICE_API_URL}/api/internal/addon/task`, {
      method: 'POST',
      headers: { ...internalHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res || !res.ok) {
      logger.warn({ status: res?.status }, 'createTask non-OK');
      return false;
    }
    const json = (await res.json()) as { data?: { created?: boolean } };
    return json.data?.created === true;
  } catch (err) {
    logger.warn({ err: String(err) }, 'createTask failed');
    return false;
  }
}

export interface WaitingClient {
  customerId: string | null;
  customer: string;
  subject: string;
  from: string;
  daysWaiting: number;
  reason: string;
}

/**
 * Angry clients nobody has answered.
 *
 * The team-lead question stated plainly: negative sentiment, no first reply,
 * inbound. Every dashboard answers a version of it indirectly — sentiment
 * distributions, escalation counts, turnaround charts — and the lead reading
 * those still has to do the join in their head.
 *
 * Viewer-scoped server-side: admins see the tenant, everyone else sees only
 * customers they are assigned. A view of who is unhappy must not become a way
 * to read accounts the viewer cannot otherwise open.
 */
export async function getWaitingClients(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  days = 30,
): Promise<WaitingClient[]> {
  return cached(
    `waiting:${tenantId}:${userId}:${isAdmin}:${days}`,
    VIEWER_TTL_MS,
    (v: WaitingClient[]) => v.length === 0,
    () => _uncachedWaitingClients(tenantId, userId, isAdmin, days),
  );
}

/**
 * Keyed by viewer, so 200 users are 200 keys and this does nothing for a cold
 * morning peak — that is what the precomputed snapshots are for. What it does
 * remove is the repeat cost of re-opening the panel, which is the common case
 * during a working session.
 */
async function _uncachedWaitingClients(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  days: number,
): Promise<WaitingClient[]> {
  const env = getEnv();
  const url =
    `${env.SERVICE_API_URL}/api/internal/addon/waiting` +
    `?tenantId=${encodeURIComponent(tenantId)}&userId=${encodeURIComponent(userId)}` +
    `&isAdmin=${isAdmin}&days=${days}`;
  const res = await apiFetch(url, { headers: internalHeaders(tenantId, userId) });
  if (!res || !res.ok) return [];
  try {
    const d = unwrap<WaitingClient[]>(await res.json());
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export interface Viewer {
  userId: string;
  isAdmin: boolean;
  accessibleCustomers: number;
}

/**
 * Resolve the signed-in Gmail address to the InboxPulse user behind it.
 *
 * This existed on the API (`/api/internal/addon/viewer`) and was never called.
 * The add-on passed `ADDON_DEV_USER_ID` instead — a pinned id for local work —
 * and that variable is UNSET in production, so `viewer.userId` was the empty
 * string, `getAccountContext` returned null on the guard, and **account history
 * never rendered in production at all**. Silently: no error, no log, just a
 * card missing the one section whose whole argument is that Gemini cannot
 * produce it.
 *
 * Resolving the real viewer also fixes the scoping. Admin status now comes from
 * the user's actual permissions rather than a hardcoded `isAdmin: false`, which
 * was quietly denying admins their own tenant's history.
 */
/**
 * Three outcomes, deliberately not two.
 *
 * `absent` means the service answered and this address is not a member.
 * `unreachable` means we never got an answer. Collapsing them into `null` let
 * the panel tell a real user "This mailbox is not a user in this workspace"
 * during an outage on 2026-08-19 — a timeout rendered as a confident statement
 * about their account, and they went looking for who had revoked their access.
 * The row was there the whole time.
 */
export type ViewerLookup =
  | { status: 'found'; viewer: Viewer }
  | { status: 'absent' }
  | { status: 'unreachable' };

export async function resolveViewer(tenantId: string, email: string): Promise<ViewerLookup> {
  return cached(
    `viewer:${tenantId}:${email.toLowerCase()}`,
    VIEWER_TTL_MS,
    // Never cache "we could not ask" — that is a transient fact about us, and
    // caching it would keep telling the reader we cannot identify them.
    (v: ViewerLookup) => v.status === 'unreachable',
    () => _uncachedResolveViewer(tenantId, email),
  );
}

async function _uncachedResolveViewer(tenantId: string, email: string): Promise<ViewerLookup> {
  const env = getEnv();
  // No key or no address: we cannot ask, which is not the same as an answer.
  if (!env.SERVICE_API_KEY || !email) return { status: 'unreachable' };
  const url =
    `${env.SERVICE_API_URL}/api/internal/addon/viewer` +
    `?tenantId=${encodeURIComponent(tenantId)}&email=${encodeURIComponent(email)}`;
  const res = await apiFetch(url, { headers: internalHeaders(tenantId) });
  if (!res || !res.ok) return { status: 'unreachable' };
  try {
    const d = unwrap<{ found?: boolean; userId?: string; isAdmin?: boolean; accessibleCustomers?: number }>(
      await res.json(),
    );
    // A well-formed answer saying `found: false` IS an answer.
    if (!d?.found || !d.userId) return { status: 'absent' };
    return {
      status: 'found',
      viewer: {
        userId: d.userId,
        isAdmin: Boolean(d.isAdmin),
        accessibleCustomers: Number(d.accessibleCustomers ?? 0),
      },
    };
  } catch {
    // Unparseable is a broken conversation, not a membership verdict.
    return { status: 'unreachable' };
  }
}

export interface DangerPulse {
  windowDays: number;
  negativeMedianH: number | null;
  otherMedianH: number | null;
  negativeP90H: number | null;
  negativeCount: number;
  /** MESSAGES that waited more than five days for a first reply. Per-email. */
  overFiveDays: number;
  /**
   * Distinct clients behind those waits — the unit the card reports.
   *
   * Optional: the add-on and crm-api deploy independently, and against an
   * older API the card falls back to the message count rather than showing
   * `undefined clients`.
   */
  overFiveDaysClients?: number;
  trend: Array<{ month: string; medianH: number }>;
  attributionPct: number;
}

/** The number the product exists to move. Tenant-wide aggregate, no per-account detail. */
/**
 * A short-lived, single-flight cache for the panel's tenant-wide sections.
 *
 * Measured before this existed: 25 concurrent panel opens produced p50 2,634ms
 * on `pulse` and 3,586ms on `stirring`, and 117 of 262 calls blew through the
 * add-on's 6s abort. Users did not see a slow panel — they saw sections missing.
 *
 * Two separate problems, and caching alone only fixes one:
 *
 *   TTL removes the repeated work. `pulse`, `stirring` and `slow-responders`
 *   are computed over 90-day windows and are IDENTICAL for every viewer in the
 *   tenant, so 200 users were paying 200 times for one answer that moves a few
 *   times an hour.
 *
 *   SINGLE FLIGHT removes the thundering herd. Without it, N simultaneous
 *   misses all run the query at once, which is exactly the morning peak this
 *   has to survive — everyone opens Gmail within the same few minutes, and a
 *   cold cache would hand the database the whole spike anyway.
 *
 * Failures are deliberately NOT cached: a null from a timeout must not become
 * the tenant's answer for the next three minutes.
 */
const TENANT_TTL_MS = 180_000;
const VIEWER_TTL_MS = 60_000;
const cacheStore = new Map<string, { value: unknown; expires: number }>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * How long a stale answer may still be shown while a fresh one is computed.
 *
 * These sections are 90-day aggregates. A three-minute-old count of who is
 * waiting is not meaningfully different from a current one, and it is
 * enormously different from a section that renders nothing because the query
 * took 4.5s and the panel gave up at 6s. Measured at 25 concurrent panels,
 * `stirring` timed out on 65% of calls and `pulse` on 57%; the same data served
 * stale answers in microseconds.
 *
 * The honesty constraint: stale is served only while a refresh is ACTUALLY
 * running, and only up to this bound. Past it the value is dropped and the
 * caller waits, so the panel can never quietly show last week's numbers because
 * the refresh has been failing since Tuesday.
 */
const STALE_MAX_MS = 15 * 60 * 1000;

async function cached<T>(key: string, ttlMs: number, isFailure: (v: T) => boolean, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cacheStore.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  // Expired but recent: hand back what we have and refresh behind it. The
  // reader gets last cycle's numbers immediately instead of a missing section.
  if (hit && now - hit.expires < STALE_MAX_MS) {
    if (!inFlight.has(key)) {
      const refresh = (async () => {
        try {
          const value = await fn();
          if (!isFailure(value)) cacheStore.set(key, { value, expires: Date.now() + ttlMs });
          return value;
        } finally {
          inFlight.delete(key);
        }
      })();
      // Unhandled rejections must not take the process down; the stale value stands.
      refresh.catch(() => undefined);
      inFlight.set(key, refresh);
    }
    return hit.value as T;
  }

  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  const task = (async () => {
    try {
      const value = await fn();
      // Only a real answer earns a TTL.
      if (!isFailure(value)) cacheStore.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    } finally {
      inFlight.delete(key);
      // Bound the map; these keys are per tenant and per viewer, not per thread.
      if (cacheStore.size > 500) {
        for (const [k, v] of cacheStore) if (v.expires <= Date.now()) cacheStore.delete(k);
      }
    }
  })();
  inFlight.set(key, task);
  return task;
}

/** Exposed so a test can assert the cache is bypassed, and for /diagnostics. */
export function clearPanelCache(): void {
  cacheStore.clear();
  inFlight.clear();
}

export async function getDangerPulse(tenantId: string, days = 90): Promise<DangerPulse | null> {
  return cached(`pulse:${tenantId}:${days}`, TENANT_TTL_MS, (v: DangerPulse | null) => v === null, () => _uncached_getDangerPulse(tenantId, days));
}

async function _uncached_getDangerPulse(tenantId: string, days = 90): Promise<DangerPulse | null> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return null;
  const res = await apiFetch(
    `${env.SERVICE_API_URL}/api/internal/addon/pulse?tenantId=${encodeURIComponent(tenantId)}&days=${days}`,
    { headers: internalHeaders(tenantId) },
  );
  if (!res || !res.ok) return null;
  try {
    const d = unwrap<DangerPulse>(await res.json());
    // Carry the window so the deep link lands on the same population the
    // median was computed over, rather than a different default.
    // Default overFiveDays, so a card built against an older crm-api renders a
    // zero rather than "undefined waited more than 5 days". The two services
    // deploy independently and the addon has shipped ahead of the API before.
    return d ? { ...d, overFiveDays: Number(d.overFiveDays ?? 0), windowDays: days } : null;
  } catch {
    return null;
  }
}

export interface Fire {
  customerId: string | null;
  customer: string;
  negative: number;
  unanswered: number;
  oldestDays: number;
  owner: string | null;
  ownerRole?: string | null;
  ownerPeers?: number;
  /**
   * Complaint rate per month, oldest first, whole percents.
   *
   * Optional because an older API returns rows without it, and a panel that
   * throws on a missing field is worse than one that shows a count alone.
   */
  arc?: number[];
  /**
   * Whether we are in a live back-and-forth with this client right now — the
   * client wrote 4+ times in the last week against 8+ in the prior month, and
   * we replied 3+ times.
   *
   * Optional for the same reason as `arc`: the addon and crm-api deploy
   * independently, and against an older API this is simply absent, which the
   * card renders as no marker rather than as a wrong one.
   */
  engaged?: boolean;
  /**
   * True when `owner` is who actually corresponds with this client rather than
   * who the allocation sheet assigns. Optional for the same deploy-skew reason
   * as the fields above.
   */
  ownerInferred?: boolean;
}

/** Where the fires are, by client, with the account manager to call. */
export async function getFires(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  days = 90,
): Promise<Fire[]> {
  return cached(
    `fires:${tenantId}:${userId}:${isAdmin}:${days}`,
    VIEWER_TTL_MS,
    (v: Fire[]) => v.length === 0,
    () => _uncachedFires(tenantId, userId, isAdmin, days),
  );
}

async function _uncachedFires(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  days: number,
): Promise<Fire[]> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return [];
  const res = await apiFetch(
    `${env.SERVICE_API_URL}/api/internal/addon/fires?tenantId=${encodeURIComponent(tenantId)}` +
      `&userId=${encodeURIComponent(userId)}&isAdmin=${isAdmin}&days=${days}`,
    { headers: internalHeaders(tenantId) },
  );
  if (!res || !res.ok) return [];
  try {
    const d = unwrap<Fire[]>(await res.json());
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** One client's negative rate over their own analysed mail. */
export interface NegativeShareRow {
  customerId: string | null;
  customer: string;
  /** Negatives as a percent of THEIR analysed mail — the plotted magnitude. */
  rateOfAnalysed: number;
  /** Negatives as a percent of every negative in the firm. Printed, never sorted on. */
  shareOfFirmNegatives: number;
  negative: number;
  analysed: number;
  messages: number;
  /** `analysed / messages` — why two rows may not be comparable. */
  coveragePct: number;
}

export interface NegativeShare {
  rows: NegativeShareRow[];
  /** The firm's own rate. The chart's reference line, and firm-wide for every reader. */
  baselinePct: number;
  floor: number;
  windowStart: string | null;
  /** `max(received_at)`, not `now()`. */
  windowEnd: string | null;
  lastAnalysed: string | null;
  blindMessages: number;
  /** Clients this viewer could see that cleared the floor with a negative. */
  qualified: number;
  notShown: number;
}

/**
 * Which clients are unhappiest as a share of their own mail.
 *
 * Entitlement-scoped, so it takes the resolved viewer like `getFires`. The API
 * masks; nothing here decides who may see what.
 *
 * Empty rows are NOT treated as a failure for caching purposes — unlike the
 * other viewer-scoped calls above. A viewer entitled to no qualifying client
 * legitimately has none, and re-asking every 60s would spend a 2-second query on
 * re-deriving that. The metadata still arrives, so the card can say so.
 */
export async function getNegativeShare(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  days = 90,
  limit = 5,
): Promise<NegativeShare | null> {
  return cached(
    `negshare:${tenantId}:${userId}:${isAdmin}:${days}:${limit}`,
    VIEWER_TTL_MS,
    (v: NegativeShare | null) => v === null,
    () => _uncachedNegativeShare(tenantId, userId, isAdmin, days, limit),
  );
}

async function _uncachedNegativeShare(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  days: number,
  limit: number,
): Promise<NegativeShare | null> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return null;
  const res = await apiFetch(
    `${env.SERVICE_API_URL}/api/internal/addon/negative-share?tenantId=${encodeURIComponent(tenantId)}` +
      `&userId=${encodeURIComponent(userId)}&isAdmin=${isAdmin}&days=${days}&limit=${limit}`,
    { headers: internalHeaders(tenantId) },
  );
  if (!res || !res.ok) return null;
  try {
    const d = unwrap<NegativeShare>(await res.json());
    // A failed fetch and an empty ranking must not be the same value. `null`
    // means we could not ask; `rows: []` means we asked and nobody qualified,
    // and only one of those is worth telling the reader about.
    return d && Array.isArray(d.rows) ? d : null;
  } catch {
    return null;
  }
}

/**
 * A client talking twice as much as usual, who has not complained.
 *
 * The row states the volume and does not assert a mood: causation is unsettled,
 * and a client at twice their usual traffic is not necessarily unhappy.
 */
export interface Stirring {
  customer: string;
  customerId: string | null;
  /** Messages in the last 7 days. */
  recent: number;
  /** Their usual, as messages per week over the preceding four. */
  usual: number;
  owner: string | null;
}

/** Clients whose mail has doubled this week, before anyone has complained. */
export async function getStirring(tenantId: string): Promise<Stirring[]> {
  return cached(`stirring:${tenantId}`, TENANT_TTL_MS, (v: Stirring[]) => v.length === 0, () => _uncached_getStirring(tenantId));
}

async function _uncached_getStirring(tenantId: string): Promise<Stirring[]> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return [];
  const res = await apiFetch(
    `${env.SERVICE_API_URL}/api/internal/addon/stirring?tenantId=${encodeURIComponent(tenantId)}`,
    { headers: internalHeaders(tenantId) },
  );
  if (!res || !res.ok) return [];
  try {
    const d = unwrap<Stirring[]>(await res.json());
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export interface SlowResponder {
  name: string;
  userId?: string | null;
  threads: number;
  medianH: number;
}

/** Median hours to first reply on negative mail, per account manager. */
export async function getSlowResponders(tenantId: string, days = 90): Promise<SlowResponder[]> {
  return cached(`slow:${tenantId}:${days}`, TENANT_TTL_MS, (v: SlowResponder[]) => v.length === 0, () => _uncached_getSlowResponders(tenantId, days));
}

async function _uncached_getSlowResponders(tenantId: string, days = 90): Promise<SlowResponder[]> {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return [];
  const res = await apiFetch(
    `${env.SERVICE_API_URL}/api/internal/addon/slow-responders?tenantId=${encodeURIComponent(tenantId)}&days=${days}`,
    { headers: internalHeaders(tenantId) },
  );
  if (!res || !res.ok) return [];
  try {
    const d = unwrap<SlowResponder[]>(await res.json());
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

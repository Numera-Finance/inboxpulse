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
 * Two seconds because this runs inside a request a human is watching. An
 * internal service that has not answered in two seconds is not about to.
 */
const API_TIMEOUT_MS = 2000;

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

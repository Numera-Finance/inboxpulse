import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables with .env.local taking precedence
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Validate environment variables via Zod schema (exits on failure)
import { getEnv } from './env';
getEnv();

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { logger } from './utils/logger';
import { pushCard } from './cards/widgets';
import { buildHomepageCard } from './cards/homepage';
import { buildThreadCard } from './cards/thread';
import { buildFlaggedDetailCard } from './cards/flagged-detail';
import { signalNames } from './cards/signals';
import { getGmail, getActionParameters, type AddonEvent } from './gmail/event';
import { fetchMessageHeaders, fetchMessageBody, normalizeGmailMessageId } from './gmail/gmail-api';
import { verifyRequest } from './auth/verify';
import {
  getEmailStats,
  resolveTenantByEmail,
  resolveThreadByMessage,
  getAnalyzedEmail,
  getThreadTrend,
  getThreadFlagged,
  resolveThreadIdByProvider,
} from './services/api-client';
import { analyseMessageLive, isLiveAnalysisEnabled } from './services/live-analysis';

const app = new Hono();

app.use('*', honoLogger());
app.use('*', cors());

/** Resolve the tenant for a request: signed-in user's email → tenant, else dev fallback. */
async function resolveTenant(email: string | undefined): Promise<string | null> {
  if (email) {
    const t = await resolveTenantByEmail(email);
    if (t) return t;
  }
  return getEnv().ADDON_DEV_TENANT_ID ?? null;
}

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'crm-addon', timestamp: new Date().toISOString() }),
);

// (The trend chart used to be served here as a self-rasterized PNG at
// /chart/trend.png — a public, unauthenticated endpoint. The Trend section now
// uses native CardService widgets, so the route and its rasterizer are gone.)

// Action callback: a row in "Flagged messages" was clicked. Pushes a detail card
// onto the add-on's own stack — the in-panel alternative to navigating, since an
// add-on can't move Gmail's thread pane. Falls back gracefully at every step: a
// missing body still renders the flags + metadata we already hold.
app.post('/gmail/flagged/detail', async (c) => {
  const env = getEnv();
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'flagged/detail: request not verified');
    return c.json(pushCard(buildThreadCard({ status: 'unverified' })));
  }

  const params = getActionParameters(event);
  const messageId = params.messageId;
  const threadId = params.threadId;
  const tenantId = await resolveTenant(verified.email);
  if (!messageId || !threadId || !tenantId) {
    return c.json(pushCard(buildThreadCard({ status: 'untracked' })));
  }

  // Re-read the thread's flags rather than stuffing them through action
  // parameters — they're strings, and the reason text is long.
  const flagged = await getThreadFlagged(threadId, tenantId);
  const message = flagged.find((m) => m.messageId === messageId);
  if (!message) return c.json(pushCard(buildThreadCard({ status: 'untracked' })));

  const { accessToken, oauthToken } = getGmail(event);
  const body = await fetchMessageBody(messageId, oauthToken, accessToken);

  return c.json(pushCard(buildFlaggedDetailCard({ message, body, viewerEmail: verified.email })));
});

// Homepage trigger — opened without a message context.
app.post('/homepage', async (c) => {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return c.json(pushCard(buildHomepageCard(null)));
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* empty body is fine for local curl */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(pushCard(buildHomepageCard(null)));
  const tenantId = await resolveTenant(verified.email);
  const stats = tenantId ? await getEmailStats(tenantId) : null;
  return c.json(pushCard(buildHomepageCard(stats)));
});

// Gmail contextual trigger — a message is open.
app.post('/gmail/contextual', async (c) => {
  const env = getEnv();
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    // Allow an empty body so the endpoint is curl-testable locally.
  }
  const { messageId: rawMessageId, threadId: rawThreadId, accessToken, oauthToken } = getGmail(event);
  // The event can carry ids as `msg-f:`/`thread-f:<decimal>`; the Gmail API and
  // our stored ids use the bare hex form. Normalize so resolution paths match.
  const messageId = normalizeGmailMessageId(rawMessageId);
  const providerThreadId = normalizeGmailMessageId(rawThreadId);

  if (!env.SERVICE_API_KEY) {
    return c.json(pushCard(buildThreadCard({ messageId, status: 'preview' })));
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'contextual: request not verified');
    return c.json(pushCard(buildThreadCard({ messageId, status: 'unverified' })));
  }

  // The open message's own envelope headers (title / from / to / cc / bcc) plus
  // its cross-mailbox-stable RFC Message-ID, in one Gmail metadata call.
  const headers = await fetchMessageHeaders(messageId, oauthToken, accessToken);
  const viewerEmail = verified.email;

  const tenantId = await resolveTenant(viewerEmail);
  if (!tenantId)
    return c.json(pushCard(buildThreadCard({ messageId, status: 'unidentified', headers, viewerEmail })));

  // Thread-level trend + flagged for a DB thread id (best-effort; [] on failure).
  const threadExtras = async (
    dbThreadId: string | null | undefined,
  ): Promise<[Awaited<ReturnType<typeof getThreadTrend>>, Awaited<ReturnType<typeof getThreadFlagged>>]> =>
    dbThreadId
      ? Promise.all([getThreadTrend(dbThreadId, tenantId), getThreadFlagged(dbThreadId, tenantId)])
      : [[], []];

  // Even an untracked open message still gets the thread's trend/flagged when the
  // thread is known (resolved via its Gmail thread id from the event).
  const baseUrl = env.ADDON_BASE_URL;
  const untrackedCard = async () => {
    const dbThreadId = providerThreadId ? await resolveThreadIdByProvider(providerThreadId, tenantId) : null;
    const [trend, flagged] = await threadExtras(dbThreadId);

    // Nothing stored for this thread — analyse the open message in-request and
    // throw the result away. Opt-in, and only on this branch: a tracked thread
    // always uses its stored analysis. Every failure returns null, so the card
    // renders exactly as before.
    let live = null;
    if (isLiveAnalysisEnabled() && !trend.length && !flagged.length) {
      const body = await fetchMessageBody(messageId, oauthToken, accessToken);
      if (body) {
        live = await analyseMessageLive({ subject: headers?.subject, from: headers?.from, body });
      }
    }

    return c.json(
      pushCard(
        buildThreadCard({
          messageId,
          status: 'untracked',
          headers,
          viewerEmail,
          trend,
          flagged,
          threadId: dbThreadId ?? undefined,
          baseUrl,
          live,
        }),
      ),
    );
  };

  if (!messageId) return untrackedCard();

  // The RFC Message-ID (read above) lets a thread ingested from a teammate's
  // mailbox still resolve — per-mailbox provider ids differ.
  const resolved = await resolveThreadByMessage(messageId, headers?.rfcMessageId, tenantId);
  if (!resolved) return untrackedCard();

  const analyzed = await getAnalyzedEmail(resolved.emailId, tenantId);
  const flags = signalNames(resolved.signals.length ? resolved.signals : analyzed?.signals ?? []);
  const [trend, flagged] = await threadExtras(resolved.threadId);
  return c.json(
    pushCard(
      buildThreadCard({
        messageId,
        status: 'resolved',
        accountName: analyzed?.customerName,
        flags,
        headers,
        viewerEmail,
        trend,
        flagged,
        threadId: resolved.threadId,
        baseUrl,
        subject: resolved.subject ?? analyzed?.subject,
        fromEmail: analyzed?.fromEmail,
        receivedAt: resolved.receivedAt,
        task: analyzed?.taskId
          ? {
              done: analyzed.taskDone,
              assignee: analyzed.assignedToName,
              problem: analyzed.problem,
              resolution: analyzed.resolution,
            }
          : null,
      }),
    ),
  );
});

const port = getEnv().PORT;
logger.info({ port }, 'crm-addon starting');

// Bun serves the module's DEFAULT export (a { port, fetch } server config) when
// running `bun dist/index.js`. This is the idiomatic Bun entrypoint — do NOT
// also call @hono/node-server's serve(), and do NOT use a named export here
// (Bun would try to Bun.serve() an object with no `fetch` and crash on boot).
export default {
  port,
  fetch: app.fetch,
};

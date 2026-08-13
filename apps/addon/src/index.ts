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
import { fetchMessageHeaders, fetchMessageBody, fetchThreadMessages, normalizeGmailMessageId } from './gmail/gmail-api';
import { verifyRequest } from './auth/verify';
import {
  getEmailStats,
  resolveTenantByEmail,
  resolveThreadByMessage,
  getAnalyzedEmail,
  getThreadTrend,
  getThreadFlagged,
  resolveThreadIdByProvider,
  getAccountContext,
  createTask,
} from './services/api-client';
import { analyseMessageLive, readThreadLive, isLiveAnalysisEnabled } from './services/live-analysis';
import { shareToChat, isChatShareEnabled } from './services/chat';
import { deriveParticipants, type Participant } from './services/participants';

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

// Action callback: "Share to Chat" on the thread card. Posts a short summary to
// the configured space and answers with a toast — deliberately NOT a card
// rebuild, so the user keeps their place in the panel.
app.post('/gmail/share/chat', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'share/chat: request not verified');
    return c.json(notify('Could not verify this request.'));
  }

  const p = getActionParameters(event);
  const ok = await shareToChat({
    subject: p.subject,
    from: p.from,
    sentiment: p.sentiment,
    reason: p.reason,
    link: p.messageId ? gmailMessageLink(p.messageId, verified.email) : undefined,
    sharedBy: verified.email,
  });

  return c.json(notify(ok ? 'Shared to Chat' : 'Could not share to Chat'));
});

/** Deep link to a single message, targeting the viewer's account by address. */
function gmailMessageLink(messageId: string, viewerEmail?: string): string {
  const target = viewerEmail ? `?authuser=${encodeURIComponent(viewerEmail)}` : '';
  return `https://mail.google.com/mail/u/0/${target}#all/${encodeURIComponent(messageId)}`;
}

/** A toast, with no card mutation — the cheapest possible action response. */
function notify(text: string) {
  return { action: { notification: { text } } };
}

// Action callback: "Read this thread". This is where the model call lives — off
// the first-paint path, so opening the panel is instant and the ~6s of analysis
// happens only when asked for. Answers with a full card via pushCard.
app.post('/gmail/analyse', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    return c.json(pushCard(buildThreadCard({ status: 'unverified' })));
  }

  const { accessToken, oauthToken } = getGmail(event);
  const p = getActionParameters(event);
  const messageId = normalizeGmailMessageId(p.messageId);
  const threadId = normalizeGmailMessageId(p.threadId);
  const viewerEmail = verified.email;
  const baseUrl = getEnv().ADDON_BASE_URL;

  const headers = await fetchMessageHeaders(messageId, oauthToken, accessToken);
  const threadMessages = await fetchThreadMessages(threadId, oauthToken, accessToken);
  const participants = threadMessages?.length ? deriveParticipants(threadMessages, viewerEmail) : [];

  const threadText = (threadMessages ?? [])
    .map((m) => `From: ${m.from ?? 'unknown'}\n${m.body}`)
    .join('\n\n')
    .slice(0, 8000);

  // The external participant's domain is the key to account history. Taken from
  // the thread's participants rather than the open message's From: on a reply
  // the sender is often internal, and the customer is the point.
  const tenantId = await resolveTenant(viewerEmail);
  const externalDomain = participants.find((p) => p.external)?.address.split('@')[1];

  const [reading, account] = await Promise.all([
    threadText ? readThreadLive({ subject: headers?.subject, thread: threadText }) : null,
    externalDomain && tenantId
      ? getAccountContext(externalDomain, tenantId, {
          userId: getEnv().ADDON_DEV_USER_ID ?? '',
          isAdmin: false,
          email: viewerEmail,
        })
      : null,
  ]);

  logger.info(
    { externalDomain, account: account?.name ?? null, negatives: account?.negativeCount ?? 0 },
    'account context',
  );

  if (!reading) {
    // Analysis failed or timed out. Re-render the pending card rather than an
    // empty one, so the button is still there to try again.
    return c.json(
      pushCard(
        buildThreadCard({
          messageId,
          status: 'untracked',
          headers,
          viewerEmail,
          participants,
          baseUrl,
          providerThreadId: threadId,
          account,
          analysisPending: true,
        }),
      ),
    );
  }

  // Sparkline series, straight from the same reading.
  const liveTrend = reading.messageSentiments.map((sent, i) => ({
    score: sent === 'positive' ? 85 : sent === 'negative' ? 20 : 55,
    sentiment: sent,
    receivedAt: threadMessages?.[i]?.date ?? '',
    isCustomer: true,
  }));

  logger.info(
    {
      commitments: reading.commitments.length,
      hasDraft: Boolean(reading.draft),
      series: liveTrend.length,
    },
    'thread analysed on demand',
  );

  return c.json(
    pushCard(
      buildThreadCard({
        messageId,
        status: 'untracked',
        headers,
        viewerEmail,
        participants,
        baseUrl,
        providerThreadId: threadId,
        analysedMessages: threadMessages?.length ?? 0,
        account,
        live: { sentiment: reading.sentiment, reason: reading.reason, ephemeral: true },
        digest: { commitments: reading.commitments, openQuestions: reading.openQuestions },
        draft: reading.draft || null,
      }),
    ),
  );
});

// Action callback: "Track" on a commitment. The one control on the panel that
// WRITES — it turns a commitment the model found into a task in the CRM.
// Answers with a toast rather than rebuilding the card, so the user keeps their
// place and sees the outcome immediately.
app.post('/gmail/task', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const p = getActionParameters(event);
  const tenantId = await resolveTenant(verified.email);
  if (!tenantId || !p.customerId || !p.title) return c.json(notify('Could not create the task.'));

  const ok = await createTask({
    tenantId,
    userId: getEnv().ADDON_DEV_USER_ID ?? '',
    isAdmin: false,
    customerId: p.customerId,
    title: p.title,
  });

  // A refusal here is an ENTITLEMENT refusal, not a failure — the viewer is not
  // assigned to that customer. Say so, rather than reporting a generic error.
  return c.json(notify(ok ? 'Task created' : 'You do not have access to this account'));
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

  // Preview mode means "no InboxPulse API", which is a reason to skip STORED
  // analysis — not a reason to skip live analysis, which never calls crm-api.
  // Short-circuiting here made the whole live path unreachable without a shared
  // service secret, which is exactly the friction the live path exists to avoid.
  if (!env.SERVICE_API_KEY && !isLiveAnalysisEnabled()) {
    return c.json(pushCard(buildThreadCard({ messageId, status: 'preview' })));
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'contextual: request not verified');
    return c.json(pushCard(buildThreadCard({ messageId, status: 'unverified' })));
  }

  // Which credentials Google actually sent. A 403 "insufficient scopes" is
  // indistinguishable from a missing token in the failure message, so record
  // presence (never the values) before the call rather than guessing after it.
  logger.info(
    {
      hasMessageId: Boolean(messageId),
      hasAccessToken: Boolean(accessToken),
      hasOauthToken: Boolean(oauthToken),
      eventKeys: Object.keys(event ?? {}),
      gmailKeys: Object.keys((event as Record<string, unknown>)?.gmail ?? {}),
    },
    'contextual: inbound credentials',
  );

  // The open message's own envelope headers (title / from / to / cc / bcc) plus
  // its cross-mailbox-stable RFC Message-ID, in one Gmail metadata call.
  const headers = await fetchMessageHeaders(messageId, oauthToken, accessToken);
  const viewerEmail = verified.email;

  /**
   * Analyse the open message in-request. Depends on nothing but Gmail and the
   * configured model — no tenant, no service key, no stored record — so it is
   * available on every branch where we would otherwise render an empty state.
   */
  const liveForOpenMessage = async () => {
    if (!isLiveAnalysisEnabled()) return null;
    const body = await fetchMessageBody(messageId, oauthToken, accessToken);
    if (!body) return null;
    return analyseMessageLive({ subject: headers?.subject, from: headers?.from, body });
  };

  const tenantId = await resolveTenant(viewerEmail);
  if (!tenantId) {
    // No workspace link. Stored context is unavailable, but the message itself
    // can still be read — which is the whole point of the live path.
    const live = await liveForOpenMessage();
    return c.json(
      pushCard(buildThreadCard({ messageId, status: 'unidentified', headers, viewerEmail, live })),
    );
  }

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
    // Nothing stored for this thread. Read the WHOLE thread and analyse each
    // message, so the sparkline has a real series rather than one padded point.
    // Falls back to the open message alone when the thread read is refused —
    // the per-message token may not reach beyond the message being viewed.
    let live = null;
    const digest = null;
    const draft: string | null = null;
    let participants: Participant[] = [];
    let analysisPending = false;
    if (!trend.length && !flagged.length && isLiveAnalysisEnabled()) {
      const threadMessages = await fetchThreadMessages(providerThreadId, oauthToken, accessToken);
      if (threadMessages?.length) {
        // Who is involved comes from the WHOLE chain — see services/participants.
        participants = deriveParticipants(threadMessages, viewerEmail);

        // The per-message sentiment loop was dropped here. It was the slowest
        // part of the render and the least useful output: a row of identical
        // squares on an internal thread tells the reader nothing. Commitments
        // and unanswered questions are invisible at a glance and matter even
        // when nothing is wrong, which is most mail.
        const threadText = threadMessages
          .map((m) => `From: ${m.from ?? 'unknown'}\n${m.body}`)
          .join('\n\n')
          .slice(0, 8000);

        // NOTHING is analysed on first paint. Reading the thread costs ~6s on
        // local hardware and Gmail shows an empty panel until the response
        // lands, so the model call moved behind a button — see the
        // analysisPending branch in buildThreadCard and /gmail/analyse below.
        analysisPending = true;
        logger.info({ messages: threadMessages.length }, 'first paint: analysis deferred');
      } else {
        live = await liveForOpenMessage();
      }
    }

    // Gmail refused the read, so we know nothing about the open message. Saying
    // "not a tracked client thread" here would be a confident answer to a
    // question we never got to ask.
    const status = !headers && !live ? ('unreadable' as const) : ('untracked' as const);

    return c.json(
      pushCard(
        buildThreadCard({
          messageId,
          status,
          headers,
          viewerEmail,
          trend,
          flagged,
          threadId: dbThreadId ?? undefined,
          baseUrl,
          live,
          chatShareEnabled: isChatShareEnabled(),
          participants,
          digest,
          draft,
          analysisPending,
          providerThreadId,
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

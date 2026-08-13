import { logger } from '../utils/logger';

/**
 * Normalize a Gmail message/thread id from an add-on event into the canonical
 * hex id that the Gmail API and our stored `message_id` / `provider_thread_id`
 * use.
 *
 * The contextual event can deliver the id in Gmail's URL form `msg-f:<decimal>`
 * (also `msg-a:` / `msg-r:` for messages, `thread-f:<decimal>` for threads),
 * whereas the Gmail API and the DB use the bare hex id (e.g. `19f7fc0a4fd52871`).
 * Left unnormalized, the Gmail API 400s and the provider-id match misses — so the
 * thread resolves as "untracked". We strip the `<kind>-x:` prefix and, when the
 * remainder is decimal, convert it to hex.
 */
export function normalizeGmailMessageId(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const m = raw.match(/^[a-z]+-[a-z]:(.+)$/i);
  const inner = m ? m[1] : raw;
  if (/^\d+$/.test(inner)) {
    try {
      return BigInt(inner).toString(16);
    } catch {
      return inner;
    }
  }
  return inner;
}

interface GmailPayload {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
  /** Present when the message is fetched with format=full. */
  headers?: Array<{ name?: string; value?: string }>;
}

/** Decode Gmail's base64url part data to UTF-8; '' when absent or malformed. */
function decodePart(data: string | undefined): string {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/** Depth-first search for the first part matching `mimeType`. */
function findPart(payload: GmailPayload | undefined, mimeType: string): GmailPayload | undefined {
  if (!payload) return undefined;
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const hit = findPart(part, mimeType);
    if (hit) return hit;
  }
  return undefined;
}

/** Crude but adequate HTML → text for the card: drop markup, keep the words. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Trim a reply down to what this sender actually wrote: drop the quoted chain
 * below an "On ... wrote:" attribution and any '>'-quoted lines, then collapse
 * the runs of blank lines that signature blocks leave behind.
 */
export function stripQuotedReply(body: string): string {
  const withoutTrailer = body.split(/^\s*On .{0,200}\bwrote:\s*$/m)[0];
  return withoutTrailer
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract readable body text from a Gmail `format=full` message payload. */
export function extractBodyText(payload: GmailPayload | undefined): string {
  const plain = findPart(payload, 'text/plain');
  if (plain) return stripQuotedReply(decodePart(plain.body?.data));
  const html = findPart(payload, 'text/html');
  if (html) return stripQuotedReply(htmlToText(decodePart(html.body?.data)));
  return stripQuotedReply(decodePart(payload?.body?.data));
}

/**
 * GET a Gmail API URL using the add-on's tokens, trying each accepted auth form.
 *
 * The documented form for the per-message scopes is the FIRST attempt: the user's
 * OAuth token as the bearer, plus the message-scoped token in an additional
 * `X-Goog-Gmail-Access-Token` header. The other two are fallbacks for odd events
 * (only one token present).
 *
 * Logs the API's own error text on failure — a bare status can't distinguish
 * "user's grant is missing the scope" (403, insufficient scopes) from "that id
 * isn't in this mailbox" (404), and those have completely different fixes.
 */
async function gmailGet<T>(
  url: string,
  oauthToken: string | undefined,
  accessToken: string | undefined,
  what: string,
): Promise<T | undefined> {
  if (!oauthToken && !accessToken) return undefined;

  const attempts: Array<Record<string, string>> = [];
  if (oauthToken && accessToken)
    attempts.push({ Authorization: `Bearer ${oauthToken}`, 'X-Goog-Gmail-Access-Token': accessToken });
  if (accessToken) attempts.push({ Authorization: `Bearer ${accessToken}` });
  if (oauthToken) attempts.push({ Authorization: `Bearer ${oauthToken}` });

  for (const headers of attempts) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const detail = await res
          .text()
          .then((t) => t.slice(0, 400))
          .catch(() => '');
        logger.warn({ status: res.status, what, detail }, 'gmail fetch non-OK');
        continue;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn({ err: String(err), what }, 'gmail fetch attempt failed');
    }
  }
  return undefined;
}

/**
 * Read one message's body text. Used for the sidebar's in-panel expansion of a
 * flagged message, which is always a message in the OPEN thread — the scope
 * `gmail.addons.current.message.readonly` grants "access to the content of other
 * messages in the open thread", so no extra consent is needed.
 *
 * Best-effort: returns undefined on any failure, and the detail card then renders
 * from InboxPulse's own metadata alone rather than failing.
 */
export async function fetchMessageBody(
  messageId: string | undefined,
  oauthToken: string | undefined,
  accessToken: string | undefined,
): Promise<string | undefined> {
  if (!messageId) return undefined;

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
  const json = await gmailGet<{ payload?: GmailPayload }>(url, oauthToken, accessToken, 'message body');
  if (!json) return undefined;
  return extractBodyText(json.payload) || undefined;
}

/** Envelope headers of the open message, as read from Gmail. */
export interface MessageHeaders {
  /** Stable, cross-mailbox RFC 2822 `Message-ID`. */
  rfcMessageId?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
}

const WANTED_HEADERS = ['Message-Id', 'Subject', 'From', 'To', 'Cc', 'Bcc'] as const;

/**
 * Read the open message's envelope headers (subject / from / to / cc / bcc) and
 * its stable RFC 2822 `Message-ID` from Gmail, in one metadata call.
 *
 * The RFC `Message-ID` matters for resolution: the add-on event only carries the
 * PER-MAILBOX provider id (`gmail.messageId`), which won't match a copy of the
 * same thread ingested from a teammate's mailbox, whereas the RFC id is identical
 * in every mailbox. The rest populate the sidebar's "Open message" section.
 *
 * Uses the current-message access token the add-on receives
 * (`gmail.addons.current.message.readonly` scope). Best-effort: returns undefined
 * on any failure so resolution falls back to the provider id and the card falls
 * back to the InboxPulse-side subject/sender.
 *
 * NOTE on Bcc: a received message never carries a `Bcc` header (the sender's MTA
 * strips it) — it only shows on the sender's own copy in Sent. Absent = omitted.
 */
export async function fetchMessageHeaders(
  messageId: string | undefined,
  oauthToken: string | undefined,
  accessToken: string | undefined,
): Promise<MessageHeaders | undefined> {
  if (!messageId) return undefined;

  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}` +
    `?format=metadata&${WANTED_HEADERS.map((h) => `metadataHeaders=${h}`).join('&')}`;

  const json = await gmailGet<{ payload?: { headers?: { name?: string; value?: string }[] } }>(
    url,
    oauthToken,
    accessToken,
    'message headers',
  );
  if (!json) return undefined;

  const raw = json.payload?.headers ?? [];
  const pick = (name: string): string | undefined => {
    const v = raw.find((h) => h.name?.toLowerCase() === name)?.value?.trim();
    return v || undefined;
  };
  return {
    rfcMessageId: pick('message-id'),
    subject: pick('subject'),
    from: pick('from'),
    to: pick('to'),
    cc: pick('cc'),
    bcc: pick('bcc'),
  };
}

/** One message of a thread, reduced to what live analysis needs. */
export interface ThreadMessage {
  id: string;
  from?: string;
  date?: string;
  body: string;
}

/**
 * Every message on the open thread, oldest first.
 *
 * Whether this is permitted depends on the grant: the contextual trigger's
 * per-message token is scoped to the message the user has open, so a thread
 * read may be refused even though the message read succeeds. gmailGet already
 * tries the user's OAuth token as well, which is the credential that can carry
 * broader access — so this returns undefined rather than throwing, and the
 * caller degrades to single-message analysis.
 */
export async function fetchThreadMessages(
  threadId: string | undefined,
  oauthToken: string | undefined,
  accessToken: string | undefined,
): Promise<ThreadMessage[] | undefined> {
  if (!threadId) return undefined;

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`;
  const json = await gmailGet<{
    messages?: Array<{ id?: string; internalDate?: string; payload?: GmailPayload }>;
  }>(url, oauthToken, accessToken, 'thread messages');
  if (!json?.messages?.length) return undefined;

  const out: ThreadMessage[] = [];
  for (const m of json.messages) {
    const body = extractBodyText(m.payload);
    if (!body) continue;
    const headers = m.payload?.headers ?? [];
    const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value;
    out.push({
      id: m.id ?? '',
      from,
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : undefined,
      body,
    });
  }
  return out.length ? out : undefined;
}

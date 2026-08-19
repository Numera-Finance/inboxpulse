import { extractLatestReply } from './extraction/extractor';
import {
  formatAddressesWithRoles,
  formatRosterBlock,
  rosterRoleMap,
  roleLabel,
  type AddressLike,
  type ParticipantRole,
  type RosterEntry,
} from './participant-roles';
import { logger } from '../utils/logger';

/**
 * Maximum number of messages to include in thread context.
 *
 * Bodies are dequoted before inclusion (see below), so this is a genuine
 * window over distinct turns rather than a token-budget proxy.
 */
const MAX_THREAD_CONTEXT_EMAILS = 8;

/** Email row fields the thread context reads. */
export interface ThreadContextEmail {
  messageId: string;
  subject?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  tos?: AddressLike[] | null;
  ccs?: AddressLike[] | null;
  body?: string | null;
  receivedAt?: Date | string | null;
}

/**
 * Reduce a stored body to the text the model should actually read.
 *
 * Two transforms, both load-bearing:
 *  1. HTML → text. Gmail bodies are stored as raw HTML; without this the model
 *     reads markup, and the prompt is mostly `<div dir="ltr">`.
 *  2. Dequoting. Every message in a thread embeds the entire prior chain as
 *     quoted text. Including it verbatim would repeat the thread once per turn
 *     — quadratic growth, and the model sees the same content N times.
 *
 * Returns the body unchanged if extraction throws, which is the safe direction:
 * a noisy body beats a missing one.
 */
function prepareThreadBody(body: string, messageId: string): string {
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(body);

  try {
    const extraction = extractLatestReply(body, isHtml);
    const prepared = extraction.messageBody.trim();
    // Dequoting occasionally strips everything (a reply that is only a quote).
    // Fall back rather than emit an empty turn.
    return prepared || body.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { messageId, error: message },
      'Thread body extraction failed, using raw body'
    );
    return body.trim();
  }
}

/**
 * Build the thread-context block sent to the analysis service.
 *
 * Each turn carries its full dequoted body plus the addressing structure
 * (From / To / Cc, each labelled with its participant role). The addressing is
 * what lets attribution-sensitive analyses tell "the customer is complaining to
 * us" from "a third party is complaining and we are merely copied" — the roles
 * come from {@link buildParticipantRoster}, resolved against tenant domains and
 * curated customer records.
 *
 * @param roster - Participant roster covering these messages. When omitted,
 *   addresses render without role labels (callers that have no tenant context).
 */
export function buildThreadContext(
  threadEmails: ThreadContextEmail[],
  currentMessageId: string,
  roster?: RosterEntry[]
): { threadContext: string } {
  if (!threadEmails || threadEmails.length === 0) {
    return { threadContext: 'No thread history available' };
  }

  const sortedEmails = [...threadEmails].sort((a, b) => {
    const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return dateA - dateB;
  });

  // Keep the most recent window — it always contains the current message, which
  // is typically the newest turn.
  const emailsToInclude =
    sortedEmails.length <= MAX_THREAD_CONTEXT_EMAILS
      ? sortedEmails
      : sortedEmails.slice(-MAX_THREAD_CONTEXT_EMAILS);

  const roles: ReadonlyMap<string, ParticipantRole> = roster
    ? rosterRoleMap(roster)
    : new Map<string, ParticipantRole>();

  const contextParts: string[] = [];

  const rosterBlock = roster ? formatRosterBlock(roster) : '';
  if (rosterBlock) {
    contextParts.push(rosterBlock);
    contextParts.push('');
  }

  if (sortedEmails.length > emailsToInclude.length) {
    contextParts.push(
      `Thread History (showing the ${emailsToInclude.length} most recent of ${sortedEmails.length} messages):\n`
    );
  } else {
    contextParts.push(`Thread History (${sortedEmails.length} messages):\n`);
  }

  for (const dbEmail of emailsToInclude) {
    const isCurrent = dbEmail.messageId === currentMessageId;
    const marker = isCurrent ? '[CURRENT] ' : '';

    const fromEmail = dbEmail.fromEmail?.toLowerCase().trim();
    const fromRole = fromEmail ? roles.get(fromEmail) : undefined;
    const fromLabel = fromRole ? ` [${roleLabel(fromRole)}]` : '';
    const fromName = dbEmail.fromName ? `${dbEmail.fromName} ` : '';
    contextParts.push(`${marker}From: ${fromName}<${fromEmail || 'unknown'}>${fromLabel}`);

    const toLine = formatAddressesWithRoles(dbEmail.tos, roles);
    if (toLine) contextParts.push(`To: ${toLine}`);

    const ccLine = formatAddressesWithRoles(dbEmail.ccs, roles);
    if (ccLine) contextParts.push(`Cc: ${ccLine}`);

    contextParts.push(`Subject: ${dbEmail.subject || ''}`);

    if (dbEmail.receivedAt) {
      contextParts.push(`Date: ${new Date(dbEmail.receivedAt).toISOString()}`);
    }

    if (dbEmail.body) {
      contextParts.push(`Body:\n${prepareThreadBody(dbEmail.body, dbEmail.messageId)}`);
    }

    contextParts.push('---');
  }

  return {
    threadContext: contextParts.join('\n'),
  };
}

import type { Email, EmailThread } from '@crm/shared';
import type { NewEmail, NewEmailThread, Email as DbEmail } from './schema';
import { createHash } from 'crypto';

/**
 * Convert email thread to database insert type
 */
export function threadToDb(
  thread: EmailThread,
  tenantId: string,
  integrationId: string
): NewEmailThread {
  return {
    tenantId,
    integrationId, // Required - provider can be derived from integration
    providerThreadId: thread.threadId,
    subject: thread.subject,
    firstMessageAt: thread.firstMessageAt,
    lastMessageAt: thread.lastMessageAt,
    metadata: thread.metadata,
  };
}

/**
 * Whether an email's sender is on one of the tenant's own domains.
 * Single source of truth for tenant-domain matching (used by both reply
 * detection and isCustomerEmail classification) so the two never drift.
 */
export function isFromTenantDomain(fromEmail: string, tenantDomains?: string[] | null): boolean {
  if (!tenantDomains?.length) {
    return false;
  }
  const from = fromEmail.toLowerCase();
  return tenantDomains.some((d) => from.endsWith(`@${d.toLowerCase()}`));
}

/**
 * A "reply" is an outbound message in a thread: it carries Gmail's SENT label
 * OR its sender is on a tenant domain. Replies are never stored or analyzed —
 * only their timestamp is used to populate firstReplyAt (time-to-response).
 *
 * @param tenantDomains - Tenant's email domains (e.g., ['acme.com']). When not
 *   configured, only the SENT label can classify an email as a reply.
 */
export function isReplyEmail(email: Email, tenantDomains?: string[] | null): boolean {
  const labels = email.labels || [];
  if (labels.includes('SENT')) {
    return true;
  }
  return isFromTenantDomain(email.from.email, tenantDomains);
}

// Local-parts that indicate an unattended/automated mailbox.
const NO_REPLY_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'no.reply',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
]);

/**
 * Whether an email looks machine-generated (auto-reply, vacation responder,
 * bulk/automated sender). Such messages must NOT count as a genuine first reply
 * for time-to-response, or an instant auto-acknowledgement would make TAT ≈ 0.
 */
export function isAutoSubmitted(email: Email): boolean {
  const md = email.metadata || {};

  // RFC 3834: Auto-Submitted is anything other than "no" (auto-replied, auto-generated).
  const autoSubmitted = typeof md.autoSubmitted === 'string' ? md.autoSubmitted.toLowerCase().trim() : '';
  if (autoSubmitted && autoSubmitted !== 'no') {
    return true;
  }

  // Precedence: bulk/auto_reply/junk are conventional markers for automated mail.
  const precedence = typeof md.precedence === 'string' ? md.precedence.toLowerCase().trim() : '';
  if (precedence === 'bulk' || precedence === 'auto_reply' || precedence === 'junk') {
    return true;
  }

  // noreply@-style senders are unattended mailboxes.
  const localPart = email.from.email.toLowerCase().split('@')[0];
  return NO_REPLY_LOCAL_PARTS.has(localPart);
}

/**
 * Whether a reply is actually addressed to someone outside the tenant (i.e. the
 * customer), rather than an internal-only message (teammate note, forward to a
 * colleague). At least one to/cc recipient must be off the tenant's domains.
 */
export function hasExternalRecipient(email: Email, tenantDomains?: string[] | null): boolean {
  const recipients = [...(email.tos || []), ...(email.ccs || [])];
  return recipients.some((r) => r.email && !isFromTenantDomain(r.email, tenantDomains));
}

/**
 * Whether an outbound/reply email should count as the customer-facing first
 * reply for time-to-response: it must be a real human response addressed to the
 * customer, not automated mail and not an internal-only message.
 */
export function isCountableReply(email: Email, tenantDomains?: string[] | null): boolean {
  return !isAutoSubmitted(email) && hasExternalRecipient(email, tenantDomains);
}

/**
 * Convert email to database insert type
 * @param tenantDomains - Tenant's email domains (e.g., ['acme.com', 'subsidiary.com']) for TAT classification
 */
export function emailToDb(
  email: Email,
  tenantId: string,
  threadId: string,
  integrationId?: string,
  tenantDomains?: string[] | null
): NewEmail {
  // Determine if this is a customer email (not from any tenant domain)
  // Used for TAT metrics - only customer emails are tracked
  const isCustomerEmail = tenantDomains?.length
    ? !isFromTenantDomain(email.from.email, tenantDomains)
    : null; // null if tenant domains not configured

  // Extract RFC 2822 Message-ID from metadata (set by email parser)
  const rfcMessageId = email.metadata?.rfcMessageId as string | undefined || null;

  // Compute content hash for deduplication
  const contentHash = computeEmailContentHash(email);

  return {
    tenantId,
    threadId,
    integrationId,
    provider: email.provider,
    messageId: email.messageId,
    subject: email.subject,
    body: email.body,
    fromEmail: email.from.email,
    fromName: email.from.name,
    tos: email.tos,
    ccs: email.ccs,
    bccs: email.bccs,
    priority: email.priority || 'normal',
    labels: email.labels,
    receivedAt: email.receivedAt,
    metadata: email.metadata,
    isCustomerEmail,
    rfcMessageId,
    contentHash,
  };
}

/**
 * Compute SHA-256 content hash for email deduplication.
 * Identical forwarded copies (via Gmail auto-forward) will produce the same hash
 * because the email content is preserved as-is.
 *
 * Hash = SHA-256(lowercase(from) + lowercase(subject) + lowercase(body) + sorted(tos) + sorted(ccs) + sorted(bccs))
 */
export function computeEmailContentHash(email: Email): string {
  const fromEmail = (email.from.email || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const body = (email.body || '').toLowerCase();

  const sortEmails = (addrs?: Array<{ email: string; name?: string }>): string =>
    (addrs || []).map(a => a.email.toLowerCase()).sort().join(',');

  const tos = sortEmails(email.tos);
  const ccs = sortEmails(email.ccs);
  const bccs = sortEmails(email.bccs);

  const content = `${fromEmail}\n${subject}\n${body}\n${tos}\n${ccs}\n${bccs}`;
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Convert database email to shared Email type
 * Used for analysis service which expects shared Email type
 */
export function dbEmailToEmail(dbEmail: DbEmail): Email {
  return {
    provider: dbEmail.provider as Email['provider'],
    messageId: dbEmail.messageId,
    threadId: dbEmail.threadId,
    subject: dbEmail.subject,
    body: dbEmail.body || undefined,
    from: {
      email: dbEmail.fromEmail,
      name: dbEmail.fromName || undefined,
    },
    tos: dbEmail.tos || [],
    ccs: dbEmail.ccs || undefined,
    bccs: dbEmail.bccs || undefined,
    priority: dbEmail.priority as Email['priority'],
    labels: dbEmail.labels || undefined,
    receivedAt: dbEmail.receivedAt,
    metadata: dbEmail.metadata || undefined,
  };
}

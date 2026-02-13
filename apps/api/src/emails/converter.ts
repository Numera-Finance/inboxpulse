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
    messageCount: thread.messageCount,
    metadata: thread.metadata,
  };
}

/**
 * Convert email to database insert type
 * @param tenantDomain - Tenant's email domain (e.g., 'acme.com') for TAT classification
 */
export function emailToDb(
  email: Email,
  tenantId: string,
  threadId: string,
  integrationId?: string,
  tenantDomain?: string | null
): NewEmail {
  // Determine if this is a customer email (not from tenant domain)
  // Used for TAT metrics - only customer emails are tracked
  const isCustomerEmail = tenantDomain
    ? !email.from.email.toLowerCase().endsWith(`@${tenantDomain.toLowerCase()}`)
    : null; // null if tenant domain not configured

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

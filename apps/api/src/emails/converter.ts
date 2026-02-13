import type { Email, EmailThread } from '@crm/shared';
import type { NewEmail, NewEmailThread, Email as DbEmail } from './schema';

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
  };
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

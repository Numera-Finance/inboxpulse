/**
 * Email Templates
 * Export all email templates for the notification system
 */

export { BaseLayout, type BaseLayoutProps } from './base-layout';
export { EmailEscalation, type EmailEscalationProps } from './email-escalation';
export { EscalationBatchEmail, type EscalationBatchEmailProps, type EscalationItem, type EscalationMetrics } from './escalation-batch';
export { DealWon, type DealWonProps } from './deal-won';
export { TaskAssignment, type TaskAssignmentProps } from './task-assignment';
export { TaskAssignedEmail, type TaskAssignedEmailProps, type TaskAssignedTask } from './task-assigned';
export { BatchDigest, type BatchDigestProps, type NotificationItem } from './batch-digest';

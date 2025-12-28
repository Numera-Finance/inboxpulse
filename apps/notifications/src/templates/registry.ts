/**
 * Template Registry
 * Registers all email templates with the notification system
 */

import {
  createReactEmailProvider,
  type ReactEmailTemplate,
} from '@crm/notifications';
import { EmailEscalation } from './emails/email-escalation';
import { DealWon } from './emails/deal-won';
import { TaskAssignment } from './emails/task-assignment';
import { BatchDigest } from './emails/batch-digest';

/**
 * All registered email templates
 */
export const emailTemplates: ReactEmailTemplate[] = [
  {
    id: 'email.escalation',
    component: EmailEscalation,
    subject: '{{severity}}: Email from {{customerName}} needs attention',
  },
  {
    id: 'email.response_needed',
    component: EmailEscalation,
    subject: 'Response needed: {{emailSubject}}',
  },
  {
    id: 'deal.won',
    component: DealWon,
    subject: 'Deal Won: {{dealName}} - {{currency}} {{dealValue}}',
  },
  {
    id: 'deal.closed',
    component: DealWon,
    subject: 'Deal Closed: {{dealName}}',
  },
  {
    id: 'task.assigned',
    component: TaskAssignment,
    subject: 'New Task: {{taskTitle}}',
  },
  {
    id: 'task.due_soon',
    component: TaskAssignment,
    subject: 'Task Due Soon: {{taskTitle}}',
  },
  {
    id: 'task.overdue',
    component: TaskAssignment,
    subject: 'Task Overdue: {{taskTitle}}',
  },
  {
    id: 'batch.digest',
    component: BatchDigest,
    subject: 'Your notification summary for {{periodLabel}}',
  },
];

/**
 * Create and export the template provider
 */
export const templateProvider = createReactEmailProvider(emailTemplates);

/**
 * Get available notification types for template registration
 */
export function getAvailableNotificationTypes(): string[] {
  return emailTemplates.map((t) => t.id);
}

/**
 * Task Unassigned Immediate Template
 *
 * Sends immediate notification when an escalation leaves a user — cleared
 * outright, or handed to someone else.
 */

import { render } from '@react-email/components';
import {
  BaseImmediateTemplate,
  type ImmediateInput,
  type TemplateDefinition,
  type ChannelSender,
  type SendResult,
} from '@crm/notifications';
import { TaskUnassignedEmail } from '../emails/task-unassigned';

/**
 * Data expected by task.unassigned template
 */
export interface TaskUnassignedData {
  task: {
    id: string;
    customer: string;
    subject: string;
    dateOpened: string;
    removedBy?: string | null;
    /** Who holds it now; null when it was left unassigned. */
    reassignedTo?: string | null;
  };
  recipientName?: string;
}

export class TaskUnassignedTemplate extends BaseImmediateTemplate<TaskUnassignedData> {
  static readonly definition: TemplateDefinition = {
    name: 'task.unassigned',
    label: 'Task Unassignment',
    description: 'Notify when a task or escalation is removed from you',
    category: 'tasks',
    defaultEnabled: true,
    defaultFrequency: 'immediate',
    defaultChannels: ['email'],
    defaultBatchInterval: null,
    isBatchTemplate: false,
  };

  readonly name = TaskUnassignedTemplate.definition.name;

  async send(input: ImmediateInput, sender: ChannelSender): Promise<SendResult> {
    const data = input.data as unknown as TaskUnassignedData;

    // Render email
    const html = await render(
      TaskUnassignedEmail({
        task: data.task,
        recipientName: data.recipientName,
      })
    );

    // Send
    return sender.send({
      channel: 'email',
      to: input.user.email,
      subject: data.task.reassignedTo
        ? `Escalation Reassigned: ${data.task.customer} - ${data.task.subject}`
        : `Escalation Removed: ${data.task.customer} - ${data.task.subject}`,
      html,
    });
  }
}

// Export singleton instance (auto-registers on instantiation)
export const taskUnassignedTemplate = new TaskUnassignedTemplate();

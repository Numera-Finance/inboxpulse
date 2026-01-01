/**
 * Task Assigned Immediate Template
 *
 * Sends immediate notification when a task is assigned to a user.
 */

import { render } from '@react-email/components';
import {
  BaseImmediateTemplate,
  type ImmediateInput,
  type TemplateDefinition,
  type ChannelSender,
  type SendResult,
} from '@crm/notifications';
import { TaskAssignedEmail } from '../emails/task-assigned';

/**
 * Data expected by task.assigned template
 */
export interface TaskAssignedData {
  task: {
    id: string;
    customer: string;
    subject: string;
    dateOpened: string;
    assignedTo: string;
    assignedBy?: string | null;
    accountOwner: string;
    detailsUrl: string;
  };
  recipientName?: string;
}

export class TaskAssignedTemplate extends BaseImmediateTemplate<TaskAssignedData> {
  static readonly definition: TemplateDefinition = {
    name: 'task.assigned',
    label: 'Task Assignment',
    description: 'Notify when a task or escalation is assigned to you',
    category: 'tasks',
    defaultEnabled: true,
    defaultFrequency: 'immediate',
    defaultChannels: ['email'],
    defaultBatchInterval: null,
    isBatchTemplate: false,
  };

  readonly name = TaskAssignedTemplate.definition.name;

  async send(input: ImmediateInput, sender: ChannelSender): Promise<SendResult> {
    const data = input.data as unknown as TaskAssignedData;

    // Render email
    const html = await render(
      TaskAssignedEmail({
        task: data.task,
        recipientName: data.recipientName,
      })
    );

    // Send
    return sender.send({
      channel: 'email',
      to: input.user.email,
      subject: `New Escalation Assigned: ${data.task.customer} - ${data.task.subject}`,
      html,
    });
  }
}

// Export singleton instance (auto-registers on instantiation)
export const taskAssignedTemplate = new TaskAssignedTemplate();

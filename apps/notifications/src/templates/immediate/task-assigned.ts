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

export type TaskSignalCategory = 'negative' | 'upsell' | 'churn';

const SUBJECT_PREFIX_BY_CATEGORY: Record<TaskSignalCategory, string> = {
  negative: 'New Escalation Assigned',
  upsell: 'New Upsell Assigned',
  churn: 'New Churn Risk Assigned',
};

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
    signalCategory?: TaskSignalCategory;
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
    const category: TaskSignalCategory = data.task.signalCategory ?? 'negative';
    const subjectPrefix = SUBJECT_PREFIX_BY_CATEGORY[category];

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
      subject: `${subjectPrefix}: ${data.task.customer} - ${data.task.subject}`,
      html,
    });
  }
}

// Export singleton instance (auto-registers on instantiation)
export const taskAssignedTemplate = new TaskAssignedTemplate();

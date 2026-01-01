/**
 * Task Assigned Immediate Template
 *
 * Sends immediate notification when a task is assigned to a user.
 * Caller builds the payload; template gates and sends.
 */

import {
  BaseImmediateTemplate,
  type TemplateDefinition,
} from '@crm/notifications';

export class TaskAssignedTemplate extends BaseImmediateTemplate {
  /**
   * Template definition - colocated with implementation
   */
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
}

// Export singleton instance (auto-registers on instantiation)
export const taskAssignedTemplate = new TaskAssignedTemplate();

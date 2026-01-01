/**
 * Escalation Summary Batch Template
 *
 * Sends periodic summary of open escalations to managers.
 * Fetches escalation data from API, decides if worth sending, renders and sends.
 */

import { render } from '@react-email/components';
import {
  BaseBatchTemplate,
  BATCH_INTERVALS,
  type BatchUser,
  type Channel,
  type ChannelPayload,
  type TemplateDefinition,
} from '@crm/notifications';
import { getServiceAuthHeaders } from '@crm/shared';
import { EscalationBatchEmail, type EscalationItem, type EscalationMetrics } from '../emails';
import { logger } from '../../utils/logger';

// API base URL for fetching escalation data
const API_BASE_URL = process.env.SERVICE_API_URL || 'http://localhost:4001';

// =============================================================================
// Types
// =============================================================================

interface EscalationData {
  escalations: EscalationItem[];
  metrics: EscalationMetrics;
}

interface EscalationApiResponse {
  success: boolean;
  data?: EscalationData;
  error?: string;
}

// =============================================================================
// Template Implementation
// =============================================================================

export class EscalationSummaryTemplate extends BaseBatchTemplate<EscalationData> {
  /**
   * Template definition - colocated with implementation
   */
  static readonly definition: TemplateDefinition = {
    name: 'escalation.summary',
    label: 'Escalation Summary',
    description: 'Periodic summary of open escalations for your team',
    category: 'escalations',
    defaultEnabled: true,
    defaultFrequency: 'batched',
    defaultChannels: ['email'],
    defaultBatchInterval: BATCH_INTERVALS.DAILY_8AM,
    isBatchTemplate: true,
  };

  readonly name = EscalationSummaryTemplate.definition.name;

  /**
   * Fetch escalation data for a user from the API
   */
  async fetchData(user: BatchUser): Promise<EscalationData | null> {
    try {
      const params = new URLSearchParams({
        managerId: user.userId,
      });
      if (user.lastSentAt) {
        params.set('since', user.lastSentAt.toISOString());
      }

      const response = await fetch(
        `${API_BASE_URL}/api/tasks/escalations-for-manager?${params}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': user.tenantId,
            'x-user-id': user.userId,
            ...getServiceAuthHeaders(),
          },
        }
      );

      if (!response.ok) {
        logger.warn(
          { userId: user.userId, status: response.status },
          'Failed to fetch escalation data'
        );
        return null;
      }

      const data: EscalationApiResponse = await response.json();
      return data.success ? data.data ?? null : null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ userId: user.userId, error: message }, 'Error fetching escalation data');
      return null;
    }
  }

  /**
   * Check if notification should be sent (has escalations to report)
   */
  shouldSend(user: BatchUser, data: EscalationData | null): boolean {
    return data !== null && data.escalations.length > 0;
  }

  /**
   * Build channel payload for a user
   */
  async getPayload(
    user: BatchUser,
    data: EscalationData,
    channel: Channel
  ): Promise<ChannelPayload> {
    if (channel !== 'email') {
      throw new Error(`Unsupported channel: ${channel}`);
    }

    const recipientName = user.firstName || user.name || user.email.split('@')[0];
    const html = await render(
      EscalationBatchEmail({
        escalations: data.escalations,
        metrics: data.metrics,
        recipientName,
      })
    );

    const totalCount =
      data.metrics.new +
      data.metrics.open1Day +
      data.metrics.open3Days +
      data.metrics.openMoreThan3Days;

    return {
      channel: 'email',
      to: user.email,
      subject: `Action Required: ${totalCount} Escalation${totalCount !== 1 ? 's' : ''} Pending`,
      html,
    };
  }
}

// Export singleton instance (auto-registers on instantiation)
export const escalationSummaryTemplate = new EscalationSummaryTemplate();

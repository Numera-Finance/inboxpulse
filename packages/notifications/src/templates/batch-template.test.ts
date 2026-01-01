/**
 * Tests for BatchTemplate calculateNextSendAt with cron expressions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BaseBatchTemplate,
  BATCH_INTERVALS,
  type BatchInput,
  type BatchResult,
  type BatchUser,
  type Channel,
  type ChannelPayload,
  type ChannelSender,
  type TemplateBatchInterval,
  type TemplateDefinition,
} from './batch-template';

// Concrete implementation for testing
class TestBatchTemplate extends BaseBatchTemplate<{ value: number }> {
  static readonly definition: TemplateDefinition = {
    name: 'test.template',
    label: 'Test Template',
    description: 'A test template',
    category: 'system',
    defaultEnabled: true,
    defaultFrequency: 'batched',
    defaultChannels: ['email'],
    defaultBatchInterval: BATCH_INTERVALS.DAILY_8AM,
    isBatchTemplate: true,
  };

  readonly name = TestBatchTemplate.definition.name;

  async fetchData(user: BatchUser): Promise<{ value: number } | null> {
    return { value: 42 };
  }

  async getPayload(user: BatchUser, data: { value: number }, channel: Channel): Promise<ChannelPayload> {
    return {
      channel: 'email',
      to: user.email,
      subject: `Test: ${data.value}`,
      html: '<p>Test</p>',
    };
  }

  // Expose protected method for testing
  public testCalculateNextSendAt(
    batchInterval: TemplateBatchInterval | null | undefined,
    userTimezone: string,
    fromTime: Date = new Date()
  ): Date {
    return this.calculateNextSendAt(batchInterval, userTimezone, fromTime);
  }
}

describe('BaseBatchTemplate', () => {
  describe('calculateNextSendAt', () => {
    let template: TestBatchTemplate;

    beforeEach(() => {
      template = new TestBatchTemplate();
    });

    describe('with DAILY_8AM cron (0 8 * * *)', () => {
      it('schedules for 8am tomorrow when current time is 10am', () => {
        const fromTime = new Date('2025-01-15T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.DAILY_8AM,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-16T08:00:00.000Z');
      });

      it('schedules for 8am today when current time is 6am', () => {
        const fromTime = new Date('2025-01-15T06:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.DAILY_8AM,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-15T08:00:00.000Z');
      });

      it('respects user timezone (America/New_York)', () => {
        const fromTime = new Date('2025-01-15T14:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.DAILY_8AM,
          'America/New_York',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-16T13:00:00.000Z');
      });

      it('respects user timezone (Asia/Kolkata)', () => {
        const fromTime = new Date('2025-01-15T04:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.DAILY_8AM,
          'Asia/Kolkata',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-16T02:30:00.000Z');
      });
    });

    describe('with EVERY_4_HOURS cron (0 */4 * * *)', () => {
      it('schedules for next 4-hour mark', () => {
        const fromTime = new Date('2025-01-15T05:30:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.EVERY_4_HOURS,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-15T08:00:00.000Z');
      });

      it('schedules correctly near midnight', () => {
        const fromTime = new Date('2025-01-15T23:30:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.EVERY_4_HOURS,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-16T00:00:00.000Z');
      });
    });

    describe('with WEEKDAYS_9AM cron (0 9 * * 1-5)', () => {
      it('schedules for Monday when current day is Friday after 9am', () => {
        const fromTime = new Date('2025-01-17T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.WEEKDAYS_9AM,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-20T09:00:00.000Z');
      });

      it('schedules for same day when current day is Tuesday before 9am', () => {
        const fromTime = new Date('2025-01-14T07:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.WEEKDAYS_9AM,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-14T09:00:00.000Z');
      });

      it('skips weekend days', () => {
        const fromTime = new Date('2025-01-18T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          BATCH_INTERVALS.WEEKDAYS_9AM,
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-20T09:00:00.000Z');
      });
    });

    describe('with custom cron expressions', () => {
      it('handles twice daily (0 8,20 * * *)', () => {
        const fromTime = new Date('2025-01-15T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          { cron: '0 8,20 * * *' },
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-15T20:00:00.000Z');
      });

      it('handles monthly (0 9 1 * *)', () => {
        const fromTime = new Date('2025-01-15T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          { cron: '0 9 1 * *' },
          'UTC',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-02-01T09:00:00.000Z');
      });
    });

    describe('with timezone override in batch interval', () => {
      it('uses timezone from batchInterval when specified', () => {
        const fromTime = new Date('2025-01-15T14:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          { cron: '0 8 * * *', timezone: 'America/Los_Angeles' },
          'America/New_York',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-15T16:00:00.000Z');
      });

      it('uses timezone override for next day scheduling', () => {
        const fromTime = new Date('2025-01-15T18:00:00Z');
        const nextSend = template.testCalculateNextSendAt(
          { cron: '0 8 * * *', timezone: 'America/Los_Angeles' },
          'America/New_York',
          fromTime
        );
        expect(nextSend.toISOString()).toBe('2025-01-16T16:00:00.000Z');
      });
    });

    describe('with null/undefined batch interval', () => {
      it('defaults to daily at 8am when batchInterval is null', () => {
        const fromTime = new Date('2025-01-15T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(null, 'UTC', fromTime);
        expect(nextSend.toISOString()).toBe('2025-01-16T08:00:00.000Z');
      });

      it('defaults to daily at 8am when batchInterval is undefined', () => {
        const fromTime = new Date('2025-01-15T10:00:00Z');
        const nextSend = template.testCalculateNextSendAt(undefined, 'UTC', fromTime);
        expect(nextSend.toISOString()).toBe('2025-01-16T08:00:00.000Z');
      });
    });

    describe('error handling', () => {
      it('falls back to 24 hours when cron is invalid', () => {
        const fromTime = new Date('2025-01-15T10:00:00Z');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const nextSend = template.testCalculateNextSendAt(
          { cron: 'invalid-cron' },
          'UTC',
          fromTime
        );

        expect(nextSend.toISOString()).toBe('2025-01-16T10:00:00.000Z');
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('send', () => {
    it('processes users and returns batch result', async () => {
      const template = new TestBatchTemplate();
      const mockSender: ChannelSender = {
        send: vi.fn().mockResolvedValue({ sent: true, messageId: 'msg-123' }),
      };

      const input: BatchInput = {
        templateName: 'test.template',
        users: [
          {
            userId: '11111111-1111-1111-1111-111111111111',
            tenantId: '22222222-2222-2222-2222-222222222222',
            email: 'test@example.com',
            timezone: 'UTC',
            lastSentAt: null,
          },
        ],
        channel: 'email',
        runTimestamp: new Date('2025-01-15T10:00:00Z'),
      };

      const result = await template.send(input, mockSender);

      expect(result.success).toBe(true);
      expect(result.totalUsers).toBe(1);
      expect(result.sentCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(mockSender.send).toHaveBeenCalledOnce();
    });
  });

  describe('getDefinition', () => {
    it('returns the static definition', () => {
      const template = new TestBatchTemplate();
      const definition = template.getDefinition();

      expect(definition.name).toBe('test.template');
      expect(definition.isBatchTemplate).toBe(true);
    });
  });

  describe('getDefaultChannels', () => {
    it('returns default channels from definition', () => {
      const template = new TestBatchTemplate();
      expect(template.getDefaultChannels()).toEqual(['email']);
    });
  });
});

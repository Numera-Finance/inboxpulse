/**
 * Preferences Service
 *
 * Manages user notification preferences including:
 * - Subscription management
 * - Channel preferences
 * - Frequency settings
 * - Batch scheduling
 */

import { injectable, inject } from 'tsyringe';
import { eq, and, isNull, lte, or, sql, type Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { NotificationChannel } from '../types/core';
import {
  NOTIFICATION_TEMPLATES,
  getAllTemplates,
  getTemplate,
  type TemplateDefinition,
  type TemplateBatchInterval,
} from '../templates/template-definitions';

export interface UserPreference {
  templateName: string;
  enabled: boolean;
  channels: NotificationChannel[];
  frequency: 'immediate' | 'batched';
  batchInterval: TemplateBatchInterval | null;
  payload: Record<string, unknown> | null;
  lastSentAt: Date | null;
  nextSendAt: Date | null;
}

export interface UserPreferenceWithDefaults extends UserPreference {
  // Template metadata
  label: string;
  description: string;
  category: string;
}

export interface UpdatePreferencesParams {
  enabled?: boolean;
  channels?: NotificationChannel[];
  frequency?: 'immediate' | 'batched';
  batchInterval?: TemplateBatchInterval | null;
  payload?: Record<string, unknown> | null;
}

export interface BatchEligibleUser {
  userId: string;
  tenantId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  timezone: string;
  lastSentAt: Date | null;
  batchInterval: TemplateBatchInterval | null;
  payload: Record<string, unknown> | null;
}

@injectable()
export class PreferencesService {
  constructor(
    @inject('Database') private db: Database,
    @inject('UserNotificationPreferencesTable') private preferencesTable: any,
    @inject('UsersTable') private usersTable: any
  ) {}

  /**
   * Get user's preference for a specific template
   */
  async getPreference(
    userId: string,
    templateName: string,
    header: RequestHeader
  ): Promise<UserPreference | null> {
    const result = await this.db
      .select()
      .from(this.preferencesTable)
      .where(
        and(
          eq(this.preferencesTable.userId, userId),
          eq(this.preferencesTable.templateName, templateName),
          eq(this.preferencesTable.tenantId, header.tenantId)
        )
      )
      .limit(1);

    if (!result[0]) return null;

    const row = result[0] as any;
    return {
      templateName: row.templateName,
      enabled: row.enabled,
      channels: row.channels || [],
      frequency: row.frequency,
      batchInterval: row.batchInterval,
      payload: row.payload,
      lastSentAt: row.lastSentAt,
      nextSendAt: row.nextSendAt,
    };
  }

  /**
   * Get all preferences for a user, merged with template defaults
   * Returns all templates with user's preferences or defaults
   */
  async getAllPreferencesWithDefaults(
    userId: string,
    header: RequestHeader
  ): Promise<UserPreferenceWithDefaults[]> {
    // Get all user's stored preferences
    const storedPrefs = await this.db
      .select()
      .from(this.preferencesTable)
      .where(
        and(
          eq(this.preferencesTable.userId, userId),
          eq(this.preferencesTable.tenantId, header.tenantId)
        )
      );

    const storedPrefsMap = new Map<string, any>();
    for (const pref of storedPrefs) {
      storedPrefsMap.set((pref as any).templateName, pref);
    }

    // Merge with all template definitions
    const templates = getAllTemplates();
    return templates.map(template => {
      const stored = storedPrefsMap.get(template.name);

      if (stored) {
        return {
          templateName: template.name,
          label: template.label,
          description: template.description,
          category: template.category,
          enabled: stored.enabled,
          channels: stored.channels || template.defaultChannels,
          frequency: stored.frequency || template.defaultFrequency,
          batchInterval: stored.batchInterval ?? template.defaultBatchInterval,
          payload: stored.payload,
          lastSentAt: stored.lastSentAt,
          nextSendAt: stored.nextSendAt,
        };
      }

      // Return defaults
      return {
        templateName: template.name,
        label: template.label,
        description: template.description,
        category: template.category,
        enabled: template.defaultEnabled,
        channels: template.defaultChannels,
        frequency: template.defaultFrequency,
        batchInterval: template.defaultBatchInterval,
        payload: null,
        lastSentAt: null,
        nextSendAt: null,
      };
    });
  }

  /**
   * Update user's preference for a template (upsert)
   */
  async updatePreference(
    userId: string,
    templateName: string,
    params: UpdatePreferencesParams,
    header: RequestHeader
  ): Promise<UserPreference> {
    const template = getTemplate(templateName);
    if (!template) {
      throw new Error(`Unknown template: ${templateName}`);
    }

    const existing = await this.getPreference(userId, templateName, header);

    if (existing) {
      // Update existing preference
      const result = await this.db
        .update(this.preferencesTable)
        .set({
          ...(params.enabled !== undefined && { enabled: params.enabled }),
          ...(params.channels !== undefined && { channels: params.channels }),
          ...(params.frequency !== undefined && { frequency: params.frequency }),
          ...(params.batchInterval !== undefined && { batchInterval: params.batchInterval }),
          ...(params.payload !== undefined && { payload: params.payload }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(this.preferencesTable.userId, userId),
            eq(this.preferencesTable.templateName, templateName),
            eq(this.preferencesTable.tenantId, header.tenantId)
          )
        )
        .returning();

      const row = result[0] as any;
      return {
        templateName: row.templateName,
        enabled: row.enabled,
        channels: row.channels || [],
        frequency: row.frequency,
        batchInterval: row.batchInterval,
        payload: row.payload,
        lastSentAt: row.lastSentAt,
        nextSendAt: row.nextSendAt,
      };
    } else {
      // Create new preference
      const result = await this.db
        .insert(this.preferencesTable)
        .values({
          tenantId: header.tenantId,
          userId,
          templateName,
          enabled: params.enabled ?? template.defaultEnabled,
          channels: params.channels ?? template.defaultChannels,
          frequency: params.frequency ?? template.defaultFrequency,
          batchInterval: params.batchInterval ?? template.defaultBatchInterval,
          payload: params.payload ?? null,
        })
        .returning();

      const row = result[0] as any;
      return {
        templateName: row.templateName,
        enabled: row.enabled,
        channels: row.channels || [],
        frequency: row.frequency,
        batchInterval: row.batchInterval,
        payload: row.payload,
        lastSentAt: row.lastSentAt,
        nextSendAt: row.nextSendAt,
      };
    }
  }

  /**
   * Delete user's preference (revert to defaults)
   */
  async deletePreference(
    userId: string,
    templateName: string,
    header: RequestHeader
  ): Promise<void> {
    await this.db
      .delete(this.preferencesTable)
      .where(
        and(
          eq(this.preferencesTable.userId, userId),
          eq(this.preferencesTable.templateName, templateName),
          eq(this.preferencesTable.tenantId, header.tenantId)
        )
      );
  }

  /**
   * Get users eligible for batch notification
   * Two queries:
   * 1. Users with preference row where nextSendAt <= now
   * 2. Users with no preference row (never sent)
   */
  async getBatchEligibleUsers(
    templateName: string,
    header: RequestHeader
  ): Promise<BatchEligibleUser[]> {
    const template = getTemplate(templateName);
    if (!template || !template.isBatchTemplate) {
      return [];
    }

    const now = new Date();

    // Query 1: Users with explicit preferences due now
    const explicitDue = await this.db
      .select({
        userId: this.preferencesTable.userId,
        tenantId: this.preferencesTable.tenantId,
        email: this.usersTable.email,
        firstName: this.usersTable.firstName,
        lastName: this.usersTable.lastName,
        timezone: this.usersTable.timezone,
        lastSentAt: this.preferencesTable.lastSentAt,
        batchInterval: this.preferencesTable.batchInterval,
        payload: this.preferencesTable.payload,
      })
      .from(this.preferencesTable)
      .innerJoin(this.usersTable, eq(this.preferencesTable.userId, this.usersTable.id))
      .where(
        and(
          eq(this.preferencesTable.templateName, templateName),
          eq(this.preferencesTable.tenantId, header.tenantId),
          eq(this.preferencesTable.enabled, true),
          eq(this.preferencesTable.frequency, 'batched'),
          lte(this.preferencesTable.nextSendAt, now)
        )
      );

    // Query 2: Users with no preference row (never sent, use defaults)
    // This is more complex - need to find users who DON'T have a preference row
    const neverSentResult = await this.db.execute(sql`
      SELECT
        u.id as "userId",
        u.tenant_id as "tenantId",
        u.email,
        u.first_name as "firstName",
        u.last_name as "lastName",
        COALESCE(u.timezone, 'UTC') as timezone,
        NULL as "lastSentAt",
        NULL as "batchInterval",
        NULL as payload
      FROM users u
      WHERE u.tenant_id = ${header.tenantId}
        AND u.row_status = 0
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_preferences p
          WHERE p.user_id = u.id
            AND p.template_name = ${templateName}
        )
    `);

    // Convert raw result to typed array
    // drizzle execute returns an array directly
    const resultArray = Array.isArray(neverSentResult) ? neverSentResult : [];
    const neverSent: BatchEligibleUser[] = resultArray.map((row: any) => ({
      userId: row.userId,
      tenantId: row.tenantId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      timezone: row.timezone || 'UTC',
      lastSentAt: null,
      batchInterval: null,
      payload: null,
    }));

    // Combine results
    const allUsers: BatchEligibleUser[] = [
      ...explicitDue.map(row => ({
        userId: row.userId,
        tenantId: row.tenantId,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        timezone: row.timezone || 'UTC',
        lastSentAt: row.lastSentAt,
        batchInterval: row.batchInterval as TemplateBatchInterval | null,
        payload: row.payload as Record<string, unknown> | null,
      })),
      ...neverSent,
    ];

    return allUsers;
  }

  /**
   * Update batch scheduling after sending
   */
  async updateBatchSchedule(
    userId: string,
    templateName: string,
    lastSentAt: Date,
    nextSendAt: Date,
    header: RequestHeader
  ): Promise<void> {
    const existing = await this.getPreference(userId, templateName, header);

    if (existing) {
      // Update existing
      await this.db
        .update(this.preferencesTable)
        .set({
          lastSentAt,
          nextSendAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(this.preferencesTable.userId, userId),
            eq(this.preferencesTable.templateName, templateName),
            eq(this.preferencesTable.tenantId, header.tenantId)
          )
        );
    } else {
      // Create with defaults
      const template = getTemplate(templateName);
      if (!template) return;

      await this.db
        .insert(this.preferencesTable)
        .values({
          tenantId: header.tenantId,
          userId,
          templateName,
          enabled: template.defaultEnabled,
          channels: template.defaultChannels,
          frequency: template.defaultFrequency,
          batchInterval: template.defaultBatchInterval,
          lastSentAt,
          nextSendAt,
        });
    }
  }

  /**
   * Check if a template is enabled for a user
   */
  async isEnabled(
    userId: string,
    templateName: string,
    header: RequestHeader
  ): Promise<boolean> {
    const pref = await this.getPreference(userId, templateName, header);

    if (pref) {
      return pref.enabled;
    }

    // No preference - use template default
    const template = getTemplate(templateName);
    return template?.defaultEnabled ?? true;
  }
}

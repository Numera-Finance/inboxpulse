/**
 * Action Service
 *
 * Handles notification actions (approve, reject, acknowledge, etc.)
 * Supports both individual and batch actions
 */

import { injectable, inject } from 'tsyringe';
import { eq, and, inArray, type Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { Notification } from '../types/core';
import { NotificationRepository } from '../repositories/notification-repository';
import { ActionTokenService, type ValidateTokenResult } from './action-token-service';

export interface ActionHandlerResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ActionHandler {
  /**
   * Execute the action
   * @returns Result data to store
   */
  execute(
    notification: Notification,
    actionType: string,
    actionData: Record<string, unknown>,
    userId: string
  ): Promise<ActionHandlerResult>;
}

export interface PerformActionParams {
  notificationId: string;
  actionType: string;
  actionData?: Record<string, unknown>;
}

export interface PerformBatchActionParams {
  notificationIds: string[];
  actionType: string;
  actionData?: Record<string, unknown>;
}

export interface ActionResult {
  notificationId: string;
  success: boolean;
  error?: string;
  result?: Record<string, unknown>;
}

export interface BatchActionResult {
  total: number;
  successful: number;
  failed: number;
  results: ActionResult[];
}

@injectable()
export class ActionService {
  private handlers: Map<string, ActionHandler> = new Map();

  constructor(
    @inject('Database') private db: Database,
    @inject('NotificationRepository') private notificationRepo: NotificationRepository,
    @inject('NotificationActionsTable') private actionsTable: any,
    @inject('NotificationBatchActionsTable') private batchActionsTable: any,
    @inject('ActionTokenService') private tokenService: ActionTokenService
  ) {}

  /**
   * Register an action handler
   */
  registerHandler(actionType: string, handler: ActionHandler): void {
    this.handlers.set(actionType, handler);
  }

  /**
   * Perform action via token (one-click from email)
   */
  async performActionViaToken(token: string): Promise<ActionResult> {
    // Validate token
    const validationResult = await this.tokenService.validate(token);

    if (!validationResult.valid || !validationResult.payload) {
      return {
        notificationId: '',
        success: false,
        error: validationResult.error || 'Invalid token',
      };
    }

    const { nid, tid, uid, act, jti } = validationResult.payload;

    // Create header for tenant context
    const header: RequestHeader = {
      tenantId: tid,
      userId: uid,
      permissions: [],
    };

    // Perform the action
    const result = await this.performAction(
      { notificationId: nid, actionType: act },
      header
    );

    // Mark token as used (one-time use)
    if (result.success) {
      await this.tokenService.consumeToken(jti, nid);
    }

    return result;
  }

  /**
   * Perform action on a single notification
   */
  async performAction(
    params: PerformActionParams,
    header: RequestHeader
  ): Promise<ActionResult> {
    const { notificationId, actionType, actionData = {} } = params;

    // Get notification
    const notification = await this.notificationRepo.findById(notificationId, header);
    if (!notification) {
      return {
        notificationId,
        success: false,
        error: 'Notification not found',
      };
    }

    // Check if action already taken
    const existingAction = await this.findExistingAction(notificationId, actionType);
    if (existingAction) {
      return {
        notificationId,
        success: false,
        error: 'Action already taken on this notification',
      };
    }

    // Get handler
    const handler = this.handlers.get(actionType);

    // Execute handler if registered
    let handlerResult: ActionHandlerResult = { success: true, result: {} };
    if (handler) {
      handlerResult = await handler.execute(
        notification as Notification,
        actionType,
        actionData,
        header.userId
      );

      if (!handlerResult.success) {
        // Log failed action
        await this.logAction(
          notification as Notification,
          actionType,
          actionData,
          'failed',
          handlerResult.error,
          header
        );

        return {
          notificationId,
          success: false,
          error: handlerResult.error,
        };
      }
    }

    // Log successful action
    await this.logAction(
      notification as Notification,
      actionType,
      { ...actionData, ...(handlerResult.result || {}) },
      'completed',
      undefined,
      header
    );

    return {
      notificationId,
      success: true,
      result: handlerResult.result,
    };
  }

  /**
   * Perform batch action on multiple notifications
   */
  async performBatchAction(
    params: PerformBatchActionParams,
    header: RequestHeader
  ): Promise<BatchActionResult> {
    const { notificationIds, actionType, actionData = {} } = params;

    // Create batch action record
    const batchAction = await this.db
      .insert(this.batchActionsTable)
      .values({
        tenantId: header.tenantId,
        userId: header.userId,
        actionType,
        notificationIds,
        actionData,
        status: 'processing',
      })
      .returning();

    const batchActionId = batchAction[0].id;

    // Process each notification
    const results: ActionResult[] = [];
    for (const notificationId of notificationIds) {
      const result = await this.performAction(
        { notificationId, actionType, actionData },
        header
      );
      results.push(result);

      // Link individual action to batch
      if (result.success) {
        await this.db
          .update(this.actionsTable)
          .set({ batchActionId })
          .where(
            and(
              eq(this.actionsTable.notificationId, notificationId),
              eq(this.actionsTable.actionType, actionType)
            )
          );
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    // Update batch status
    await this.db
      .update(this.batchActionsTable)
      .set({
        status: failed === 0 ? 'completed' : failed === results.length ? 'failed' : 'partial',
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(this.batchActionsTable.id, batchActionId));

    return {
      total: notificationIds.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Generate action token for a notification
   */
  generateActionToken(
    notification: Notification,
    actionType: string,
    expiresInSeconds?: number
  ): { token: string; expiresAt: Date } {
    return this.tokenService.generate({
      notificationId: notification.id,
      tenantId: notification.tenantId,
      userId: notification.userId,
      actionType,
      expiresInSeconds,
    });
  }

  /**
   * Find existing action for a notification
   */
  private async findExistingAction(
    notificationId: string,
    actionType: string
  ): Promise<any | null> {
    const result = await this.db
      .select()
      .from(this.actionsTable)
      .where(
        and(
          eq(this.actionsTable.notificationId, notificationId),
          eq(this.actionsTable.actionType, actionType),
          eq(this.actionsTable.status, 'completed')
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Log action to database
   */
  private async logAction(
    notification: Notification,
    actionType: string,
    actionData: Record<string, unknown>,
    status: 'pending' | 'completed' | 'failed',
    errorMessage: string | undefined,
    header: RequestHeader
  ): Promise<void> {
    await this.db.insert(this.actionsTable).values({
      tenantId: notification.tenantId,
      userId: header.userId,
      notificationId: notification.id,
      actionType,
      actionData,
      status,
      errorMessage,
      processedAt: status !== 'pending' ? new Date() : null,
    });
  }
}

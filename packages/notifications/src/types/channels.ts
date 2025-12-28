/**
 * Channel adapter interfaces
 */

import type { RenderedContent, UserResolver } from './interfaces';
import type { NotificationChannel, Notification } from './core';

export interface ChannelSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BaseChannel {
  send(
    notification: Notification,
    renderedContent: RenderedContent,
    userResolver: UserResolver
  ): Promise<ChannelSendResult>;
  
  validateAddress(address: string): boolean;
  
  getChannelName(): NotificationChannel;
}

export type { NotificationChannel } from './core';

/**
 * Base channel adapter interface implementation
 */

import type { BaseChannel, ChannelSendResult } from '../types/channels';
import type { Notification } from '../types/core';
import type { RenderedContent, UserResolver } from '../types/interfaces';

export abstract class BaseChannelAdapter implements BaseChannel {
  abstract getChannelName(): import('../types/core').NotificationChannel;
  abstract validateAddress(address: string): boolean;
  abstract send(
    notification: Notification,
    renderedContent: RenderedContent,
    userResolver: UserResolver
  ): Promise<ChannelSendResult>;
}

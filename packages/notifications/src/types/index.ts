/**
 * Public type exports
 */

export * from './core';
export * from './channels';

// Re-export interfaces with explicit names to avoid conflicts
export type {
  NotificationDataContext,
  Template,
  RenderedContent,
  TemplateRenderResult,
  RenderOptions,
  TemplateProvider,
  NotificationUser,
  UserNotificationPreferences,
  UserResolver,
  ChannelAddress as ChannelAddressInterface,
} from './interfaces';

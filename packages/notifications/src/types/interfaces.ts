/**
 * Pluggable interfaces for template provider and user resolver
 */

import type { NotificationChannel, SubscriptionConditions } from './core';

export interface NotificationDataContext {
  notificationType: string;
  data: Record<string, unknown>;
}

export interface Template {
  id: string;
  typeId: string;
  channel: NotificationChannel;
  locale?: string;
  content: string | (() => string);
  version: number;
  variables: string[];
}

export interface RenderedContent {
  html?: string;
  text?: string;
  blocks?: unknown[];
  subject?: string;
  title?: string;
}

export interface TemplateRenderResult {
  hasContent: boolean;
  content?: RenderedContent;
  reason?: 'no_data_access' | 'empty_content' | 'template_error' | 'missing_data';
  error?: string;
}

export interface RenderOptions {
  locale?: string;
  dataLoader?: (key: string) => Promise<unknown>;
  dataAccessChecker?: (dataContext: NotificationDataContext) => Promise<boolean>;
  userId?: string;
  tenantId?: string;
}

export interface TemplateProvider {
  getTemplate(
    typeId: string,
    channel: NotificationChannel,
    locale?: string
  ): Promise<Template | null>;
  
  renderTemplate(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<TemplateRenderResult>;
  
  getFallbackTemplate(channel: NotificationChannel): Promise<Template | null>;
  
  templateExists(typeId: string, channel: NotificationChannel): Promise<boolean>;
}

export interface NotificationUser {
  id: string;
  tenantId: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  timezone?: string;
  locale?: string;
  isActive: boolean;
}

export interface UserNotificationPreferences {
  enabled: boolean;
  channels: NotificationChannel[];
  frequency: 'immediate' | 'batched';
  batchInterval?: {
    type: 'minutes' | 'hours' | 'end_of_day' | 'custom';
    value?: number;
    scheduledFor?: Date;
  } | null;
  quietHours?: {
    start: string;
    end: string;
    timezone: string;
  } | null;
  timezone?: string | null;
}

export interface UserResolver {
  getUser(userId: string, tenantId: string): Promise<NotificationUser | null>;
  getUserChannelAddress(userId: string, channel: NotificationChannel): Promise<ChannelAddress | null>;
  getUserPreferences(userId: string, typeId: string): Promise<UserNotificationPreferences | null>;
  getSubscribers(tenantId: string, typeId: string): Promise<string[]>;
  getUserTimezone(userId: string): Promise<string | null>;
  getUserLocale(userId: string): Promise<string | null>;
  userExists(userId: string, tenantId: string): Promise<boolean>;
  tenantActive(tenantId: string): Promise<boolean>;
  getUserPermissions(userId: string): Promise<string[]>;
  userHasPermission(userId: string, permission: string): Promise<boolean>;
  userMatchesConditions(userId: string, conditions: SubscriptionConditions): Promise<boolean>;
  createDataAccessChecker(userId: string, tenantId: string): (context: NotificationDataContext) => Promise<boolean>;
}

export interface ChannelAddress {
  id: string;
  tenantId: string;
  userId: string;
  channel: NotificationChannel;
  address: string;
  isVerified: boolean;
  isDisabled: boolean;
  verifiedAt?: Date | null;
  bounceCount: number;
  complaintCount: number;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

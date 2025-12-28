/**
 * Core notification types
 */

export type NotificationChannel = 'email' | 'slack' | 'gchat' | 'sms' | 'mobile_push';

export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

export type NotificationStatus =
  | 'pending'
  | 'batched'
  | 'sent'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'skipped'
  | 'read';

export type BatchStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'partially_sent';

export type BatchInterval =
  | { type: 'immediate' }
  | { type: 'minutes'; value: number }
  | { type: 'hours'; value: number }
  | { type: 'end_of_day' }
  | { type: 'custom'; scheduledFor: Date };

export interface SubscriptionConditions {
  hasCustomers?: boolean;
  hasManager?: boolean;
  [key: string]: unknown;
}

export interface TemplateConfig {
  channels: Record<NotificationChannel, string>;
  dataLoaderEnabled?: boolean;
  variableMapping?: Record<string, string>;
}

export interface DeduplicationConfig {
  strategy: 'overwrite' | 'create_new' | 'ignore';
  eventKeyFields: string[];
  updateWindowMinutes: number;
}

export interface QuietHours {
  start: string; // HH:mm format
  end: string; // HH:mm format
  timezone: string; // IANA timezone
}

export interface NotificationType {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  category?: 'alerts' | 'approvals' | 'digests' | 'system' | null;
  defaultChannels: NotificationChannel[];
  defaultFrequency: 'immediate' | 'batched';
  defaultBatchInterval?: BatchInterval | null;
  requiredPermission?: string | null;
  autoSubscribeEnabled: boolean;
  subscriptionConditions?: SubscriptionConditions | null;
  requiresAction: boolean;
  defaultExpiresAfterHours?: number | null;
  defaultPriority: NotificationPriority;
  templateConfig?: TemplateConfig | null;
  deduplicationConfig?: DeduplicationConfig | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserNotificationPreference {
  id: string;
  tenantId: string;
  userId: string;
  notificationTypeId: string;
  enabled: boolean;
  channels: NotificationChannel[];
  frequency: 'immediate' | 'batched';
  batchInterval?: BatchInterval | null;
  quietHours?: QuietHours | null;
  timezone?: string | null;
  subscriptionSource: 'manual' | 'auto';
  autoSubscribedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActionItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface DeliveryAttempt {
  channel: NotificationChannel;
  attemptedAt: Date;
  status: 'sent' | 'failed';
  error?: string;
}

export interface EngagementData {
  openedAt?: Date;
  openedCount: number;
  clickedAt?: Date;
  clickedCount: number;
  clickedLinks: string[];
}

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  notificationTypeId: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  actionItems?: ActionItem[] | null;
  status: NotificationStatus;
  priority: NotificationPriority;
  scheduledFor?: Date | null;
  expiresAt?: Date | null;
  sentAt?: Date | null;
  readAt?: Date | null;
  batchId?: string | null;
  channel?: NotificationChannel | null;
  eventKey?: string | null;
  eventVersion?: number | null;
  idempotencyKey?: string | null;
  deliveryAttempts: DeliveryAttempt[];
  engagement?: EngagementData | null;
  locale?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AggregatedContent {
  title: string;
  summary?: string;
  items: AggregatedItem[];
  actions?: ActionItem[];
}

export interface AggregatedItem {
  notificationId: string;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface NotificationBatch {
  id: string;
  tenantId: string;
  userId: string;
  notificationTypeId: string;
  channel: NotificationChannel;
  batchInterval: BatchInterval;
  status: BatchStatus;
  scheduledFor: Date;
  sentAt?: Date | null;
  aggregatedContent?: AggregatedContent | null;
  deliveryAttempts: DeliveryAttempt[];
  createdAt: Date;
  updatedAt: Date;
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

// Re-export NotificationUser from interfaces
export type { NotificationUser } from './interfaces';

import { container } from 'tsyringe';
import { createDatabase, type Database } from '@crm/database';
// Import schemas
import {
  tenants,
  users,
  notificationTypes,
  userNotificationPreferences,
  notificationBatches,
  notifications,
  userChannelAddresses,
  notificationAuditLog,
  notificationBounceComplaints,
} from '../schemas';

// Notification imports
import {
  NotificationRepository,
  NotificationTypeRepository,
  NotificationService,
  DeliveryService,
  PreferencesService,
  ChannelRegistry,
  EmailChannel,
  SesProvider,
  PostmarkProvider,
} from '@crm/notifications';
import { CrmUserResolver } from '../user-resolver';
import { BatchRepository } from '../repositories/batch-repository';

export function setupContainer() {
  // Initialize database with notification-specific schemas
  const db = createDatabase({
    tenants,
    users,
    notificationTypes,
    userNotificationPreferences,
    notificationBatches,
    notifications,
    userChannelAddresses,
    notificationAuditLog,
    notificationBounceComplaints,
  });

  // Register database
  container.register<Database>('Database', { useValue: db });

  // Register API base URL for service-to-service calls
  const apiBaseUrl = process.env.SERVICE_API_URL || 'http://localhost:4001';
  container.register('ApiBaseUrl', { useValue: apiBaseUrl });

  // Register notification repositories
  container.register('NotificationRepository', {
    useFactory: () => new NotificationRepository(db, notifications),
  });
  container.register('NotificationTypeRepository', {
    useFactory: () => new NotificationTypeRepository(db, notificationTypes),
  });
  container.register('BatchRepository', {
    useFactory: () => new BatchRepository(db, notificationBatches),
  });

  // Register table references for services that need direct access
  container.register('UserNotificationPreferencesTable', { useValue: userNotificationPreferences });

  // Register user resolver
  container.register('UserResolver', { useClass: CrmUserResolver });

  // Setup channel registry with email provider
  const channelRegistry = new ChannelRegistry();

  // Configure email provider based on environment
  const emailProvider = process.env.EMAIL_PROVIDER === 'postmark'
    ? new PostmarkProvider({
      serverToken: process.env.POSTMARK_API_TOKEN || '',
      messageStream: process.env.POSTMARK_MESSAGE_STREAM,
    })
    : new SesProvider({
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    });

  const emailChannel = new EmailChannel({
    provider: emailProvider,
    fromEmail: process.env.NOTIFICATION_FROM_EMAIL || 'notifications@example.com',
    fromName: process.env.NOTIFICATION_FROM_NAME || 'Notifications',
    replyTo: process.env.NOTIFICATION_REPLY_TO,
    unsubscribeBaseUrl: process.env.NOTIFICATION_UNSUBSCRIBE_URL,
    includeUnsubscribeHeaders: true,
  });

  channelRegistry.register(emailChannel);
  container.register('ChannelRegistry', { useValue: channelRegistry });

  // Register template provider (using react-email templates)
  const { templateProvider } = require('../templates/registry');
  container.register('TemplateProvider', {
    useValue: templateProvider,
  });

  // Register core services
  container.register(NotificationService, { useClass: NotificationService });
  container.register(DeliveryService, { useClass: DeliveryService });
  container.register(PreferencesService, { useClass: PreferencesService });
}

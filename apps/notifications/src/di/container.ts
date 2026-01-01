import { container } from 'tsyringe';
import { createDatabase, type Database } from '@crm/database';
// Import schemas
import {
  tenants,
  users,
  userNotificationPreferences,
  notificationBatches,
  notifications,
} from '../schemas';

// Notification imports
import {
  NotificationRepository,
  PreferencesService,
} from '@crm/notifications';
import { BatchRepository } from '../repositories/batch-repository';

export function setupContainer() {
  // Initialize database with notification-specific schemas
  const db = createDatabase({
    tenants,
    users,
    userNotificationPreferences,
    notificationBatches,
    notifications,
  });

  // Register database
  container.register<Database>('Database', { useValue: db });

  // Register API base URL for service-to-service calls
  const apiBaseUrl = process.env.SERVICE_API_URL || 'http://localhost:4001';
  container.register('ApiBaseUrl', { useValue: apiBaseUrl });

  // Register notification repository (for future history/audit)
  container.register('NotificationRepository', {
    useFactory: () => new NotificationRepository(db, notifications),
  });

  // Register batch repository
  container.register('BatchRepository', {
    useFactory: () => new BatchRepository(db, notificationBatches),
  });

  // Register table references for services that need direct access
  container.register('UserNotificationPreferencesTable', { useValue: userNotificationPreferences });
  container.register('UsersTable', { useValue: users });

  // Register preferences service
  container.register(PreferencesService, { useClass: PreferencesService });
}

import { inngest } from './instance';
import { container } from 'tsyringe';
import {
  getNotificationFunctions,
  type InngestFunctionDeps,
  DeliveryService,
  PreferencesService,
  NotificationRepository,
} from '@crm/notifications';
import type { Database } from '@crm/database';
import { BatchRepository } from '../repositories/batch-repository';

// Re-export inngest instance for backwards compatibility
export { inngest };

/**
 * Get dependencies for Inngest functions
 * Uses the DI container to resolve services
 */
async function getDeps(): Promise<InngestFunctionDeps> {
  const db = container.resolve<Database>('Database');
  const deliveryService = container.resolve<DeliveryService>(DeliveryService);
  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
  const batchRepo = container.resolve<BatchRepository>('BatchRepository');

  return {
    db,
    deliveryService,
    preferencesService,
    notificationRepo,
    batchRepo,
  };
}

/**
 * All Inngest functions for this service
 * Exported for registration with Inngest
 */
export const inngestFunctions = getNotificationFunctions(inngest, getDeps);

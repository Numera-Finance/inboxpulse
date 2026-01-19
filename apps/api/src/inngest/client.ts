import { inngest } from './instance';
import { createAnalyzeEmailFunction } from '../emails/inngest/functions';
import { createRebuildAccessibleCustomersFunction } from '../users/inngest/functions';
import { createEscalationNotificationCronFunction } from '../tasks/inngest/functions';
import { createGmailWatchRenewalCronFunction } from '../integrations/inngest/functions';

// Re-export inngest instance for backwards compatibility
export { inngest };

/**
 * All Inngest functions for this service
 * Exported for registration with Inngest
 *
 * NOTE: This file should only be imported by the route handler that registers
 * functions with Inngest. Services should import from './instance' instead
 * to avoid circular dependencies.
 */
export const inngestFunctions = [
  createAnalyzeEmailFunction(inngest),
  createRebuildAccessibleCustomersFunction(inngest),
  createEscalationNotificationCronFunction(inngest),
  createGmailWatchRenewalCronFunction(inngest),
];

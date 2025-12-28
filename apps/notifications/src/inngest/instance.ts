import { Inngest } from 'inngest';

/**
 * Inngest client instance for notifications service
 * Separated from function registrations to avoid circular dependencies
 *
 * Required environment variables:
 * - INNGEST_EVENT_KEY: Event key for sending/publishing events to Inngest
 * - INNGEST_SIGNING_KEY: Signing key for receiving/verifying webhooks from Inngest
 *   (Both found in Inngest dashboard -> Settings -> Keys)
 */
export const inngest = new Inngest({
  id: 'crm-notifications',
  // SDK automatically reads INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY from environment
});

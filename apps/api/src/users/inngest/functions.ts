import { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { UserRepository } from '../repository';
import { logger } from '../../utils/logger';

/**
 * Creates the Inngest function to rebuild user_accessible_customers.
 * Uses 5-minute debounce per tenant to batch rapid changes (e.g., bulk import,
 * reassigning managers, etc.).
 * 
 * Triggered by 'user/access.rebuild' event sent from UserService
 */
export const createRebuildAccessibleCustomersFunction = (inngest: Inngest) => {
  return inngest.createFunction(
    {
      id: 'rebuild-accessible-customers',
      name: 'Rebuild User Accessible Customers',
      debounce: {
        key: 'event.data.tenantId',
        period: '10s', // Short debounce for batching rapid changes
      },
      retries: 3,
    },
    { event: 'user/access.rebuild' },
    async ({ event, step }) => {
      const { tenantId } = event.data;

      return await step.run('rebuild', async () => {
        logger.info({ tenantId }, 'Starting rebuild of accessible customers');

        const userRepository = container.resolve(UserRepository);
        return userRepository.rebuildAccessibleCustomers(tenantId);
      });
    }
  );
};

import { Inngest } from 'inngest';
import { logger } from '../../utils/logger';
import { internalFetch } from '../../utils/internal-fetch';
import { getEnv } from '../../env';

/**
 * Creates the Inngest cron function to renew Gmail watches before they expire.
 *
 * Gmail watches expire after 7 days. This cron runs every 4 hours and renews
 * watches that are expiring within 2 days, ensuring continuous email sync.
 *
 * Calls the Gmail service's /api/watch/renew-expiring endpoint which handles
 * the actual watch renewal logic.
 */
export const createGmailWatchRenewalCronFunction = (inngest: Inngest) => {
  return inngest.createFunction(
    {
      id: 'gmail-watch-renewal-cron',
      name: 'Gmail Watch Renewal Cron',
      retries: 3,
    },
    { cron: '0 */4 * * *' }, // Run every 4 hours at minute 0
    async ({ step }) => {
      const gmailServiceUrl = getEnv().SERVICE_GMAIL_URL;

      const result = await step.run('renew-expiring-watches', async () => {
        logger.info('Starting Gmail watch renewal cron');

        const response = await internalFetch(`${gmailServiceUrl}/api/watch/renew-expiring`, {
          method: 'GET',
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, error: errorText },
            'Gmail watch renewal request failed'
          );
          throw new Error(`Watch renewal failed: ${response.status} ${errorText}`);
        }

        const data = await response.json() as {
          success: boolean;
          summary?: {
            checked: number;
            renewed: number;
            failed: number;
          };
          error?: string;
        };

        if (!data.success) {
          logger.error({ error: data.error }, 'Gmail watch renewal returned failure');
          throw new Error(data.error || 'Watch renewal failed');
        }

        logger.info(
          {
            checked: data.summary?.checked,
            renewed: data.summary?.renewed,
            failed: data.summary?.failed,
          },
          'Gmail watch renewal cron completed'
        );

        return data.summary;
      });

      return result;
    }
  );
};

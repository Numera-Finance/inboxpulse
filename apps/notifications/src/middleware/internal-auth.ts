import { Context, Next } from 'hono';
import { logger } from '../utils/logger';

const SERVICE_API_KEY_HEADER = 'x-internal-api-key';

/**
 * Middleware to verify internal API key for service-to-service calls
 *
 * This protects internal routes from unauthorized access.
 * Requires SERVICE_API_KEY env var and x-internal-api-key header.
 */
export async function verifyServiceApiKey(c: Context, next: Next) {
  const apiKey = c.req.header(SERVICE_API_KEY_HEADER);
  const expectedApiKey = process.env.SERVICE_API_KEY;

  if (!expectedApiKey) {
    logger.error('SERVICE_API_KEY environment variable is not set');
    return c.json({ error: 'Server misconfiguration' }, 500);
  }

  if (!apiKey || apiKey !== expectedApiKey) {
    logger.warn(
      {
        path: c.req.path,
        method: c.req.method,
        hasApiKey: !!apiKey,
      },
      'Unauthorized internal API request'
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}

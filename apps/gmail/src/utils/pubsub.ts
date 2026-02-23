import { getEnv } from '../env';

/**
 * Verify Pub/Sub push authentication
 * https://cloud.google.com/pubsub/docs/push#setting_up_for_push_authentication
 */
export async function verifyPubSubToken(authHeader: string | undefined): Promise<boolean> {
  // If no verification token is configured, allow requests
  // This is typical when using default Pub/Sub push without OIDC
  const expectedToken = getEnv().PUBSUB_VERIFICATION_TOKEN;

  if (!expectedToken) {
    // Note: Using console.log here as this is an info-level message and logger may not be available
    console.log('[PubSub] PUBSUB_VERIFICATION_TOKEN not set, allowing request (using default Pub/Sub authentication)');
    return true;
  }

  // If token is configured, verify it
  if (!authHeader) {
    return false;
  }

  const token = authHeader.replace('Bearer ', '');
  return token === expectedToken;
}

/**
 * Decode Pub/Sub message data
 */
export function decodePubSubMessage(data: string): any {
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error: any) {
    console.error('[PubSub] Failed to decode Pub/Sub message:', {
      error: error.message,
      dataLength: data?.length,
      dataPreview: data?.substring(0, 50),
    });
    throw new Error('Invalid Pub/Sub message format');
  }
}

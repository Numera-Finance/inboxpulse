import { AuthBaseClient } from '../base-client';

/**
 * Client for login-history API operations.
 */
export class LoginHistoryClient extends AuthBaseClient {
  /**
   * Export the last 30 days of login activity for the current tenant as CSV.
   * Admin-only on the server side.
   */
  async exportCsv(signal?: AbortSignal): Promise<Blob> {
    return this.getBlob('/api/login-history/export', signal);
  }
}

import type { EmailCollection, ApiResponse, TATMetricRow } from '@crm/shared';
import { BaseClient } from '../base-client';
import type { AnalyzedEmailSearchRequest, AnalyzedEmailSearchResponse, AnalyzedEmail, AnalyzedEmailExportItem } from './types';

/**
 * Email input type for bulk insert API
 * This is the API contract - not tied to database schema
 */
export interface NewEmailInput {
  tenantId: string;
  threadId: string;
  integrationId?: string | null;
  provider: string;
  messageId: string;
  subject: string;
  body?: string | null;
  fromEmail: string;
  fromName?: string | null;
  tos?: Array<{ email: string; name?: string }> | null;
  ccs?: Array<{ email: string; name?: string }> | null;
  bccs?: Array<{ email: string; name?: string }> | null;
  priority?: string;
  labels?: string[] | null;
  receivedAt: Date | string;
  metadata?: Record<string, any> | null;
}

/**
 * Email response type from API
 */
export interface EmailResponse {
  id: string;
  tenantId: string;
  threadId: string;
  integrationId?: string | null;
  provider: string;
  messageId: string;
  subject: string;
  body?: string | null;
  fromEmail: string;
  fromName?: string | null;
  tos?: Array<{ email: string; name?: string }> | null;
  ccs?: Array<{ email: string; name?: string }> | null;
  bccs?: Array<{ email: string; name?: string }> | null;
  priority: string;
  labels?: string[] | null;
  receivedAt: string;
  metadata?: Record<string, any> | null;
  signals?: number[] | null;
  analysisStatus?: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Response from getByCustomer API
 */
export interface EmailsByCustomerResponse {
  emails: EmailResponse[];
  total: number;
  count: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Client for email-related API operations
 */
export class EmailClient extends BaseClient {
  /**
   * Bulk insert emails with threads (new provider-agnostic format)
   * API will send to Inngest for async processing
   */
  async bulkInsertWithThreads(
    tenantId: string,
    integrationId: string,
    emailCollections: EmailCollection[],
    runId?: string // Optional - for tracking run status updates
  ): Promise<{ insertedCount: number; skippedCount: number; threadsCreated: number }> {
    // Log the request details for debugging
    console.log('[EmailClient] Calling bulkInsertWithThreads', {
      baseUrl: this.baseUrl,
      endpoint: '/api/emails/bulk-with-threads',
      tenantId,
      integrationId,
      runId,
      emailCollectionsCount: emailCollections.length,
      totalEmails: emailCollections.reduce((sum, col) => sum + col.emails.length, 0),
    });

    try {
      const result = await this.post<{ insertedCount: number; skippedCount: number; threadsCreated: number }>(
        '/api/emails/bulk-with-threads',
        { tenantId, integrationId, emailCollections, runId }
      );

      console.log('[EmailClient] bulkInsertWithThreads succeeded', {
        insertedCount: result.insertedCount,
        skippedCount: result.skippedCount,
        threadsCreated: result.threadsCreated,
      });

      return result;
    } catch (error: any) {
      console.error('[EmailClient] bulkInsertWithThreads FAILED', {
        baseUrl: this.baseUrl,
        endpoint: '/api/emails/bulk-with-threads',
        tenantId,
        integrationId,
        runId,
        error: {
          message: error.message,
          stack: error.stack,
          status: error.status,
          responseBody: error.responseBody,
        },
      });
      throw error;
    }
  }

  /**
   * Bulk insert emails (legacy method for backward compatibility)
   */
  async bulkInsert(emails: NewEmailInput[]): Promise<{ insertedCount: number; skippedCount: number }> {
    return await this.post<{ insertedCount: number; skippedCount: number }>(
      '/api/emails/bulk',
      { emails }
    );
  }

  /**
   * Check if email exists
   */
  async exists(tenantId: string, provider: string, messageId: string): Promise<boolean> {
    const response = await this.get<{ exists: boolean }>(
      `/api/emails/exists?tenantId=${encodeURIComponent(tenantId)}&provider=${encodeURIComponent(provider)}&messageId=${encodeURIComponent(messageId)}`
    );
    return response?.exists ?? false;
  }

  /**
   * Get emails by customer (via domain matching)
   * Supports filtering by sentiment, signal (upsell/churn), TAT violations, and date range
   */
  async getByCustomer(
    tenantId: string,
    customerId: string,
    options?: {
      limit?: number;
      offset?: number;
      sentiment?: 'positive' | 'negative' | 'neutral';
      signal?: 'upsell' | 'churn';
      tatViolation?: boolean;
      dateFrom?: string;
      dateTo?: string;
      query?: string;
    }
  ): Promise<EmailsByCustomerResponse> {
    const params = new URLSearchParams({ tenantId });
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.sentiment) params.set('sentiment', options.sentiment);
    if (options?.signal) params.set('signal', options.signal);
    if (options?.tatViolation) params.set('tatViolation', 'true');
    if (options?.dateFrom) params.set('dateFrom', options.dateFrom);
    if (options?.dateTo) params.set('dateTo', options.dateTo);
    if (options?.query) params.set('query', options.query);

    const response = await this.get<ApiResponse<EmailsByCustomerResponse>>(
      `/api/emails/customer/${encodeURIComponent(customerId)}?${params.toString()}`
    );

    if (!response?.data) {
      return { emails: [], total: 0, count: 0, limit: options?.limit || 50, offset: options?.offset || 0, hasMore: false };
    }

    return response.data;
  }

  // ===========================================================================
  // Dashboard Statistics
  // ===========================================================================

  /**
   * Get dashboard email statistics
   */
  async getDashboardStats(
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<{ total: number; analyzed: number }> {
    const params = new URLSearchParams();
    if (filters?.customerId) params.set('customerId', filters.customerId);
    if (filters?.dateFrom) params.set('from', filters.dateFrom);
    if (filters?.dateTo) params.set('to', filters.dateTo);

    const queryString = params.toString();
    const url = queryString ? `/api/emails/stats?${queryString}` : '/api/emails/stats';
    const response = await this.get<ApiResponse<{ total: number; analyzed: number }>>(url);

    return response?.data ?? { total: 0, analyzed: 0 };
  }

  /**
   * Get sentiment distribution for dashboard
   */
  async getSentimentStats(
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<{ positive: number; neutral: number; negative: number }> {
    const params = new URLSearchParams();
    if (filters?.customerId) params.set('customerId', filters.customerId);
    if (filters?.dateFrom) params.set('from', filters.dateFrom);
    if (filters?.dateTo) params.set('to', filters.dateTo);

    const queryString = params.toString();
    const url = queryString ? `/api/emails/sentiment-stats?${queryString}` : '/api/emails/sentiment-stats';
    const response = await this.get<ApiResponse<{ positive: number; neutral: number; negative: number }>>(url);

    return response?.data ?? { positive: 0, neutral: 0, negative: 0 };
  }

  /**
   * Get upsell opportunity count for dashboard
   */
  async getUpsellCount(
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<number> {
    const params = new URLSearchParams();
    if (filters?.customerId) params.set('customerId', filters.customerId);
    if (filters?.dateFrom) params.set('from', filters.dateFrom);
    if (filters?.dateTo) params.set('to', filters.dateTo);

    const queryString = params.toString();
    const url = queryString ? `/api/emails/upsell-count?${queryString}` : '/api/emails/upsell-count';
    const response = await this.get<ApiResponse<number>>(url);

    return response?.data ?? 0;
  }

  /**
   * Get sentiment trend data for dashboard (6 months)
   */
  async getSentimentTrend(
    filters?: {
      customerId?: string;
    }
  ): Promise<Array<{ month: string; positive: number; neutral: number; negative: number }>> {
    const params = new URLSearchParams();
    if (filters?.customerId) params.set('customerId', filters.customerId);

    const queryString = params.toString();
    const url = queryString ? `/api/emails/sentiment-trend?${queryString}` : '/api/emails/sentiment-trend';
    const response = await this.get<ApiResponse<Array<{ month: string; positive: number; neutral: number; negative: number }>>>(url);

    return response?.data ?? [];
  }

  /**
   * Get email volume trend data for dashboard (4 weeks)
   */
  async getEmailVolumeTrend(
    filters?: {
      customerId?: string;
    }
  ): Promise<Array<{ week: string; totalEmails: number; escalations: number }>> {
    const params = new URLSearchParams();
    if (filters?.customerId) params.set('customerId', filters.customerId);

    const queryString = params.toString();
    const url = queryString ? `/api/emails/volume-trend?${queryString}` : '/api/emails/volume-trend';
    const response = await this.get<ApiResponse<Array<{ week: string; totalEmails: number; escalations: number }>>>(url);

    return response?.data ?? [];
  }

  /**
   * Get TAT (Turn Around Time) metrics for dashboard
   * Returns SLA breach counts grouped by customer and controller
   */
  async getTATMetrics(
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<TATMetricRow[]> {
    const params = new URLSearchParams();
    if (filters?.customerId) params.set('customerId', filters.customerId);
    if (filters?.dateFrom) params.set('from', filters.dateFrom);
    if (filters?.dateTo) params.set('to', filters.dateTo);

    const queryString = params.toString();
    const url = queryString ? `/api/emails/tat-metrics?${queryString}` : '/api/emails/tat-metrics';
    const response = await this.get<ApiResponse<TATMetricRow[]>>(url);

    return response?.data ?? [];
  }

  // ===========================================================================
  // Analyzed Email Search
  // ===========================================================================

  /**
   * Search analyzed emails with optional task overlay
   */
  async searchAnalyzed(
    request: AnalyzedEmailSearchRequest
  ): Promise<AnalyzedEmailSearchResponse> {
    const response = await this.post<ApiResponse<AnalyzedEmailSearchResponse>>(
      '/api/emails/analyzed/search',
      request
    );

    return (response as unknown as ApiResponse<AnalyzedEmailSearchResponse>)?.data ?? {
      items: [],
      total: 0,
      limit: request.limit ?? 50,
      offset: request.offset ?? 0,
    };
  }

  /**
   * Export analyzed emails with comments and contact roles (no pagination)
   */
  async exportAnalyzed(
    request: AnalyzedEmailSearchRequest
  ): Promise<AnalyzedEmailExportItem[]> {
    const response = await this.post<ApiResponse<AnalyzedEmailExportItem[]>>(
      '/api/emails/analyzed/export',
      request
    );

    return (response as unknown as ApiResponse<AnalyzedEmailExportItem[]>)?.data ?? [];
  }

  /**
   * Get a single analyzed email by ID with task overlay
   */
  async getAnalyzedById(emailId: string): Promise<AnalyzedEmail | null> {
    const response = await this.get<ApiResponse<AnalyzedEmail>>(
      `/api/emails/analyzed/${encodeURIComponent(emailId)}`
    );

    return response?.data ?? null;
  }
}

// Re-export TATMetricRow from shared package
export type { TATMetricRow } from '@crm/shared';

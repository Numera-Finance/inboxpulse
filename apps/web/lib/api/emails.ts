import { getEmailClient } from './clients';
import type { EmailsByCustomerResponse, EmailResponse } from '@crm/clients';

export type { EmailsByCustomerResponse, EmailResponse };

/**
 * Get emails for a customer (via domain matching)
 * Supports filtering by sentiment and signal (upsell/churn)
 */
export async function getEmailsByCustomer(
  tenantId: string,
  customerId: string,
  options?: {
    limit?: number;
    offset?: number;
    sentiment?: 'positive' | 'negative' | 'neutral';
    signal?: 'upsell' | 'churn';
  }
): Promise<EmailsByCustomerResponse> {
  return getEmailClient().getByCustomer(tenantId, customerId, options);
}

// Dashboard Statistics

export interface DashboardEmailStats {
  total: number;
  analyzed: number;
}

export interface DashboardSentimentStats {
  positive: number;
  neutral: number;
  negative: number;
}

/**
 * Get dashboard email statistics
 */
export async function getDashboardEmailStats(
  filters?: {
    customerId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<DashboardEmailStats> {
  return getEmailClient().getDashboardStats(filters);
}

/**
 * Get sentiment distribution for dashboard
 */
export async function getDashboardSentimentStats(
  filters?: {
    customerId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<DashboardSentimentStats> {
  return getEmailClient().getSentimentStats(filters);
}

/**
 * Get upsell opportunity count for dashboard
 */
export async function getDashboardUpsellCount(
  filters?: {
    customerId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<number> {
  return getEmailClient().getUpsellCount(filters);
}


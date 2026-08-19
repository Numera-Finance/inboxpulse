import { getEmailClient } from './clients';
import type { EmailsByCustomerResponse, EmailResponse, TATMetricRow, UpdateEmailSignalsRequest, UpdateEmailSignalsResponse } from '@crm/clients';

export type { EmailsByCustomerResponse, EmailResponse, TATMetricRow };

/**
 * Manually override an email's signals (sentiment / churn / tags).
 * Replaces the signal set, locks it against re-analysis, and logs the change.
 */
export async function updateEmailSignals(
  emailId: string,
  request: UpdateEmailSignalsRequest
): Promise<UpdateEmailSignalsResponse> {
  return getEmailClient().updateSignals(emailId, request);
}

/**
 * Get emails for a customer (via domain matching)
 * Supports filtering by sentiment, signal (upsell/churn), TAT violations, and date range
 */
export async function getEmailsByCustomer(
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

export interface DashboardSentimentTrendData {
  month: string;
  positive: number;
  neutral: number;
  negative: number;
}

/**
 * Get sentiment trend data for dashboard (6 months)
 */
export async function getDashboardSentimentTrend(
  filters?: {
    customerId?: string;
  }
): Promise<DashboardSentimentTrendData[]> {
  return getEmailClient().getSentimentTrend(filters);
}

export interface DashboardEmailVolumeTrendData {
  week: string;
  totalEmails: number;
  escalations: number;
}

/**
 * Get email volume trend data for dashboard (4 weeks)
 */
export async function getDashboardEmailVolumeTrend(
  filters?: {
    customerId?: string;
  }
): Promise<DashboardEmailVolumeTrendData[]> {
  return getEmailClient().getEmailVolumeTrend(filters);
}

/**
 * Get TAT (Turn Around Time) metrics for dashboard
 * Returns SLA breach counts grouped by customer and controller
 */
export async function getDashboardTATMetrics(
  filters?: {
    customerId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<TATMetricRow[]> {
  return getEmailClient().getTATMetrics(filters);
}


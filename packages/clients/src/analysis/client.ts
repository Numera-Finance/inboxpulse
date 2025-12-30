import type { Email, AnalysisType, AnalysisConfig } from '@crm/shared';
import { BaseClient } from '../base-client';

/**
 * Response types from analysis service
 */
export interface DomainExtractionResponse {
  success: boolean;
  data?: {
    customers: Array<{
      id: string;
      domains: string[];
    }>;
  };
  error?: any;
}

export interface ContactExtractionResponse {
  success: boolean;
  data?: {
    contacts: Array<{
      id: string;
      email: string;
      name?: string;
      customerId?: string;
    }>;
  };
  error?: any;
}

export interface ClassificationResult {
  category: 'spam' | 'marketing' | 'transactional' | 'automated' | 'business';
  confidence: number;
  stage: string;
  reasoning?: string;
}

export interface FilterOptions {
  enabled: boolean;
  skipHuggingFace?: boolean;
  skipLLM?: boolean;
  filterCategories?: Array<'spam' | 'marketing' | 'automated' | 'transactional'>;
}

export interface AnalysisResponse {
  success: boolean;
  data?: {
    results: Record<string, any>;
    filtered?: boolean;
    filterResult?: ClassificationResult;
    cached?: boolean;
  };
  error?: any;
}

/**
 * Client for analysis service API operations
 */
export class AnalysisClient extends BaseClient {
  constructor() {
    super();
    // Override base URL to point to analysis service
    // Default to localhost:4003 for development, or use SERVICE_ANALYSIS_URL env var
    this.baseUrl = process.env.SERVICE_ANALYSIS_URL!;
  }

  /**
   * Extract domains from email and create/update customers
   * Always-run analysis (sync)
   */
  async extractDomains(
    tenantId: string,
    email: Email
  ): Promise<DomainExtractionResponse['data']> {
    const response = await this.post<DomainExtractionResponse>(
      '/api/analysis/domain-extract',
      { tenantId, email }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Domain extraction failed');
    }

    return response.data;
  }

  /**
   * Extract contacts from email and create/update them, linking to customers
   * Always-run analysis (sync)
   * Optionally pass customers from domain extraction
   */
  async extractContacts(
    tenantId: string,
    email: Email,
    customers?: Array<{ id: string; domains: string[] }>
  ): Promise<ContactExtractionResponse['data']> {
    const response = await this.post<ContactExtractionResponse>(
      '/api/analysis/contact-extract',
      { tenantId, email, customers }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Contact extraction failed');
    }

    return response.data;
  }

  /**
   * Analyze email with specified analysis types
   * Conditional analyses (can be async)
   */
  async analyze(
    tenantId: string,
    email: Email,
    options?: {
      threadContext?: string;
      analysisTypes?: AnalysisType[];
      config?: Partial<AnalysisConfig>;
      filter?: FilterOptions;
    }
  ): Promise<AnalysisResponse['data']> {
    const response = await this.post<AnalysisResponse>(
      '/api/analysis/analyze',
      {
        tenantId,
        email,
        threadContext: options?.threadContext,
        analysisTypes: options?.analysisTypes,
        config: options?.config,
        filter: options?.filter,
      }
    );

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Analysis failed');
    }

    return response.data;
  }

  /**
   * Summarize thread context for a specific analysis type
   * Used to generate/update thread summaries
   */
  async summarizeThread(
    analysisType: string,
    prompt: string,
    model: string = 'gpt-4o-mini'
  ): Promise<{ summary: string; modelUsed: string; tokens?: { prompt: number; completion: number; total: number } }> {
    const response = await this.post<{
      success: boolean;
      data?: {
        summary: string;
        modelUsed: string;
        tokens?: { prompt: number; completion: number; total: number };
      };
      error?: any;
    }>('/api/analysis/summarize', {
      analysisType,
      prompt,
      model,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Thread summarization failed');
    }

    return response.data;
  }
}

import { z } from 'zod';
import type { Email, AnalysisType, AnalysisConfig } from '@crm/shared';
import { BaseClient } from '../base-client';

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

/**
 * Zod schemas for the pure-extraction payload returned by /analyze. Single
 * source of truth used by both the producer (apps/analysis) and the consumer
 * (apps/api). The client below runs the response through `extractedPayloadSchema`
 * so a shape regression on either side fails loudly with a validation error.
 */
export const extractedDomainSchema = z.object({
  domain: z.string(),
  inferredName: z.string(),
});

export const extractedContactSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  /**
   * The customer-domain key this contact belongs to (top-level domain for
   * corporate addresses, pseudo-domain for personal ones). Analysis is the
   * single source of truth for this mapping — the API consumes it verbatim.
   */
  customerDomain: z.string(),
});

export const extractedPayloadSchema = z.object({
  domains: z.array(extractedDomainSchema),
  contacts: z.array(extractedContactSchema),
});

export type ExtractedDomain = z.infer<typeof extractedDomainSchema>;
export type ExtractedContact = z.infer<typeof extractedContactSchema>;
export type ExtractedPayload = z.infer<typeof extractedPayloadSchema>;

export interface AnalysisResponse {
  success: boolean;
  data?: {
    results: Record<string, any>;
    extracted: ExtractedPayload;
    filtered?: boolean;
    filterResult?: ClassificationResult;
    cached?: boolean;
  };
  error?: any;
}

/**
 * Client for the analysis service.
 *
 * The analysis service is a pure analyzer — given an email, it returns
 * structured extraction + analysis results. It does NOT write to the
 * business database. All persistence is the API service's job, performed
 * inside a single transaction so partial-write inconsistency cannot occur.
 *
 * Therefore there is exactly one HTTP call exposed here for the email
 * pipeline: `analyze`. The caller is expected to use the returned
 * `extracted` payload to drive customer/contact persistence on its side.
 */
export class AnalysisClient extends BaseClient {
  constructor() {
    super();
    this.baseUrl = process.env.SERVICE_ANALYSIS_URL!;
  }

  /**
   * Run all analyses on an email and return the structured result, including
   * the extracted participants needed by the API service to persist customers
   * and contacts.
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

    // Validate the extraction payload shape at the boundary. If analysis
    // changes the response shape (e.g., drops `customerDomain`), we fail here
    // with a descriptive error instead of producing broken customer links
    // silently downstream.
    const extracted = extractedPayloadSchema.parse(response.data.extracted);
    return { ...response.data, extracted };
  }

  /**
   * Summarize thread context for a specific analysis type.
   * Used to generate/update thread summaries.
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

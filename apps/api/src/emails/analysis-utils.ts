import type { AnalysisType, AnalysisResult, NewEmailAnalysis } from './analysis-schema';

/**
 * Extract commonly queried fields from analysis result to columns
 * This enables efficient indexing and querying while preserving full result in JSONB
 */
export function extractAnalysisFields(
  analysisType: AnalysisType,
  result: AnalysisResult
): Partial<NewEmailAnalysis> {
  const extracted: Partial<NewEmailAnalysis> = {};

  // Guard against null/undefined results from failed LLM calls
  if (!result || typeof result !== 'object') {
    return extracted;
  }

  // Extract confidence (applies to all analysis types)
  if ('confidence' in result && typeof result.confidence === 'number') {
    extracted.confidence = result.confidence.toString();
  }

  // Extract type-specific fields
  switch (analysisType) {
    case 'sentiment':
      if ('value' in result && typeof result.value === 'string') {
        extracted.sentimentValue = result.value;
      }
      break;

    case 'escalation':
      if ('detected' in result && typeof result.detected === 'boolean') {
        extracted.detected = result.detected;
      }
      if ('urgency' in result && typeof result.urgency === 'string') {
        extracted.urgency = result.urgency;
      }
      break;

    case 'churn':
      if ('riskLevel' in result && typeof result.riskLevel === 'string') {
        extracted.riskLevel = result.riskLevel;
      }
      break;

    case 'upsell':
    case 'kudos':
    case 'competitor':
      if ('detected' in result && typeof result.detected === 'boolean') {
        extracted.detected = result.detected;
      }
      break;

    case 'signature-extraction':
      // Signature extraction doesn't have extracted fields
      // Full result is stored in JSONB
      break;

    case 'context-search-string':
      // The query itself is only ever read back whole, never filtered on, so it
      // stays in JSONB. `confidence` is already extracted above.
      break;
  }

  return extracted;
}

/**
 * Helper to create a NewEmailAnalysis record from analysis result
 */
export function createEmailAnalysisRecord(
  emailId: string,
  tenantId: string,
  analysisType: AnalysisType,
  result: AnalysisResult,
  metadata?: {
    modelUsed?: string;
    reasoning?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }
): NewEmailAnalysis {
  const extractedFields = extractAnalysisFields(analysisType, result);

  return {
    emailId,
    tenantId,
    analysisType,
    result: result as any, // Full result stored in JSONB
    ...extractedFields, // Extracted fields for indexing
    modelUsed: metadata?.modelUsed,
    reasoning: metadata?.reasoning,
    promptTokens: metadata?.promptTokens,
    completionTokens: metadata?.completionTokens,
    totalTokens: metadata?.totalTokens,
  };
}

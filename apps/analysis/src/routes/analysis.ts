import { Hono } from 'hono';
import { toStructuredError, sanitizeErrorForClient } from '@crm/shared';
import { DomainExtractionService } from '../services/domain-extraction';
import { ContactExtractionService } from '../services/contact-extraction';
import { EmailFilterService, type ClassificationResult, type EmailCategory } from '../services/email-filter';
import { AnalysisExecutor } from '../framework/executor';
import { AnalysisConfigLoader } from '../framework/config-loader';
import { AIService, type ModelConfig } from '../services/ai-service';
import { analysisRegistry } from '../framework/registry';
import { analysisCacheService } from '../services/cache-service';
import { emailSchema, analysisTypeSchema } from '@crm/shared';
import { logger } from '../utils/logger';
import { z } from 'zod';
import type { ApiResponse } from '@crm/shared';
import type { AnalysisType, AnalysisConfig } from '@crm/shared';

const app = new Hono();

// Pure-extraction services. These do NOT touch the DB — they only return
// extracted data, which apps/api persists in its own transaction.
const domainService = new DomainExtractionService();
const contactService = new ContactExtractionService();
const aiService = new AIService();
const analysisExecutor = new AnalysisExecutor(aiService, analysisRegistry);
const emailFilterService = new EmailFilterService(aiService);

// Schema for model config
const modelConfigSchema = z.object({
  primary: z.string(),
  fallback: z.string().optional(),
});

// Schema for analysis config (partial — will merge with defaults)
const analysisConfigSchema = z.object({
  enabledAnalyses: z.record(z.string(), z.boolean()).optional(),
  modelConfigs: z.record(z.string(), modelConfigSchema).optional(),
  analysisSettings: z.record(z.string(), z.any()).optional(),
  promptVersions: z.record(z.string(), z.string()).optional(),
  customPrompts: z.record(z.string(), z.string()).optional(),
}).optional();

// Schema for filter model config (optional override for LLM classification)
const filterModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'xai']),
  model: z.string(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
}).optional();

// Schema for filter options
const filterOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  skipHuggingFace: z.boolean().default(false),
  skipLLM: z.boolean().default(false),
  filterCategories: z.array(z.enum(['spam', 'marketing', 'automated', 'transactional'])).default(['spam', 'marketing']),
  llmModel: filterModelConfigSchema,
}).optional();

const analyzeRequestSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
  threadContext: z.string().optional(),
  // Strict — unknown / removed types fail at the boundary with a 400
  // instead of being silently filtered out by the executor.
  analysisTypes: z.array(analysisTypeSchema).optional(),
  config: analysisConfigSchema,
  filter: filterOptionsSchema,
});

/**
 * Build the extracted-participants payload that the API service uses to drive
 * its DB writes (customers + contacts) inside a single transaction.
 */
function buildExtractedPayload(email: Parameters<typeof domainService.extractDomains>[0]) {
  return {
    domains: domainService.extractDomains(email).map((d) => ({
      domain: d.domain,
      inferredName: d.inferredName,
    })),
    contacts: contactService.extractContacts(email),
  };
}

/**
 * POST /api/analysis/analyze
 *
 * Pure analysis — runs domain/contact extraction (regex) and the LLM analyses
 * (sentiment / escalation / upsell / churn / kudos / competitor /
 * signature-extraction) and returns the structured result. Does NOT persist
 * anything to the business database. All writes happen in apps/api inside a
 * single transaction so partial-write inconsistency is impossible.
 *
 * Note: this endpoint still uses its own analysis_cache table to avoid
 * re-running expensive LLM calls on retries — that's local cache, not
 * business data.
 */
app.post('/analyze', async (c) => {
  try {
    const body = await c.req.json();
    const validated = analyzeRequestSchema.parse(body);
    const messageId = validated.email.messageId;

    logger.info(
      { tenantId: validated.tenantId, emailId: messageId },
      'Analysis request received'
    );

    // Run email filter if enabled
    if (validated.filter?.enabled) {
      const filterOptions = validated.filter;
      const filterResult = await emailFilterService.classify(validated.email, {
        llmModel: filterOptions.llmModel as ModelConfig | undefined,
        skipHuggingFace: filterOptions.skipHuggingFace,
        skipLLM: filterOptions.skipLLM,
        tenantId: validated.tenantId,
      });

      const categoriesToFilter: readonly EmailCategory[] =
        filterOptions.filterCategories || ['spam', 'marketing'];
      if (categoriesToFilter.includes(filterResult.category)) {
        logger.info(
          {
            tenantId: validated.tenantId,
            emailId: messageId,
            category: filterResult.category,
            confidence: filterResult.confidence,
            stage: filterResult.stage,
          },
          'Email filtered out, skipping analysis'
        );

        // Even when filtered, return the extraction so apps/api can still
        // create the participant rows (they're business-correct regardless
        // of the analysis verdict).
        return c.json<ApiResponse<{
          filtered: true;
          filterResult: ClassificationResult;
          extracted: ReturnType<typeof buildExtractedPayload>;
          results: Record<string, any>;
        }>>({
          success: true,
          data: {
            filtered: true,
            filterResult,
            extracted: buildExtractedPayload(validated.email),
            results: {},
          },
        });
      }

      logger.info(
        {
          tenantId: validated.tenantId,
          emailId: messageId,
          category: filterResult.category,
          confidence: filterResult.confidence,
          stage: filterResult.stage,
        },
        'Email passed filter, proceeding with analysis'
      );

      (c as any).filterResult = filterResult;
    }

    // Merge provided config with defaults
    const configLoader = new AnalysisConfigLoader();
    const config: AnalysisConfig = configLoader.mergeWithDefaults({
      tenantId: validated.tenantId,
      ...validated.config,
    });

    // Determine which analyses to run. `analysisTypes` is already validated
    // by the schema (analysisTypeSchema), so no cast is needed.
    const analysisTypes: AnalysisType[] = (validated.analysisTypes &&
      validated.analysisTypes.length > 0)
      ? validated.analysisTypes
      : (configLoader.getEnabledAnalysisTypes(config) as AnalysisType[]);

    // Always include extraction in the response, even when no analyses are
    // requested.
    const extracted = buildExtractedPayload(validated.email);

    if (analysisTypes.length === 0) {
      logger.info({ tenantId: validated.tenantId }, 'No analyses specified or enabled');
      const filterResult = (c as any).filterResult;
      return c.json<ApiResponse<{
        results: Record<string, any>;
        extracted: ReturnType<typeof buildExtractedPayload>;
        filterResult?: ClassificationResult;
      }>>({
        success: true,
        data: {
          results: {},
          extracted,
          filterResult,
        },
      });
    }

    // Generate model ID for caching
    const modelId = analysisTypes
      .map((type) => config.modelConfigs[type]?.primary || 'default')
      .sort()
      .join('|');

    const cachedResults = await analysisCacheService.get(messageId, modelId);
    if (cachedResults) {
      logger.info(
        { tenantId: validated.tenantId, emailId: messageId, modelId },
        'Returning cached analysis results'
      );
      const filterResult = (c as any).filterResult;
      return c.json<ApiResponse<{
        results: typeof cachedResults;
        cached: true;
        extracted: ReturnType<typeof buildExtractedPayload>;
        filterResult?: ClassificationResult;
      }>>({
        success: true,
        data: { results: cachedResults, cached: true, extracted, filterResult },
      });
    }

    const threadContext = validated.threadContext
      ? { threadContext: validated.threadContext }
      : undefined;

    const results = await analysisExecutor.executeBatch(
      analysisTypes,
      validated.email,
      validated.tenantId,
      config,
      threadContext
    );

    const resultsObject: Record<string, any> = {};
    for (const [type, result] of results.entries()) {
      resultsObject[type] = result.result;
    }

    await analysisCacheService.set(messageId, modelId, validated.tenantId, resultsObject);

    logger.info(
      {
        tenantId: validated.tenantId,
        emailId: messageId,
        analysisCount: results.size,
        analysisTypes: Array.from(results.keys()),
      },
      'Analysis completed successfully'
    );

    const filterResult = (c as any).filterResult;
    return c.json<ApiResponse<{
      results: typeof resultsObject;
      cached: false;
      extracted: ReturnType<typeof buildExtractedPayload>;
      filterResult?: ClassificationResult;
    }>>({
      success: true,
      data: { results: resultsObject, cached: false, extracted, filterResult },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);

    logger.error(
      { error: structuredError, path: c.req.path, method: c.req.method },
      'Analysis failed'
    );

    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      { success: false, error: sanitizedError },
      sanitizedError.statusCode as any
    );
  }
});

/**
 * POST /api/analysis/async/analyze
 * Async analysis endpoint (same logic, different route for future Inngest integration)
 */
app.post('/async/analyze', async (c) => {
  return app.fetch(c.req.raw);
});

const filterRequestSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
  skipHuggingFace: z.boolean().default(false),
  skipLLM: z.boolean().default(false),
  llmModel: filterModelConfigSchema,
});

/**
 * POST /api/analysis/filter
 * Standalone email classification endpoint
 * Useful for testing different models or pre-filtering emails before analysis
 */
app.post('/filter', async (c) => {
  try {
    const body = await c.req.json();
    const validated = filterRequestSchema.parse(body);

    logger.info(
      { tenantId: validated.tenantId, emailId: validated.email.messageId },
      'Email filter request received'
    );

    const result = await emailFilterService.classify(validated.email, {
      llmModel: validated.llmModel as ModelConfig | undefined,
      skipHuggingFace: validated.skipHuggingFace,
      skipLLM: validated.skipLLM,
      tenantId: validated.tenantId,
    });

    logger.info(
      {
        tenantId: validated.tenantId,
        emailId: validated.email.messageId,
        category: result.category,
        confidence: result.confidence,
        stage: result.stage,
      },
      'Email classification completed'
    );

    return c.json<ApiResponse<{ classification: ClassificationResult }>>({
      success: true,
      data: { classification: result },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);
    logger.error(
      { error: structuredError, path: c.req.path, method: c.req.method },
      'Email filter failed'
    );
    const sanitizedError = sanitizeErrorForClient(structuredError);
    return c.json<ApiResponse<never>>(
      { success: false, error: sanitizedError },
      sanitizedError.statusCode as any
    );
  }
});

const summarizeRequestSchema = z.object({
  analysisType: z.string(),
  prompt: z.string(),
  model: z.string().optional().default('gemini-2.5-flash'),
});

/**
 * POST /api/analysis/summarize
 * Generate thread summary for a specific analysis type
 * Used by API service to maintain thread-level summaries
 */
app.post('/summarize', async (c) => {
  try {
    const body = await c.req.json();
    const validated = summarizeRequestSchema.parse(body);

    logger.info(
      { analysisType: validated.analysisType, model: validated.model },
      'Thread summarization request received'
    );

    const getProviderFromModel = (model: string): 'openai' | 'anthropic' | 'google' => {
      if (model.includes('gpt') || model.includes('openai')) return 'openai';
      if (model.includes('claude') || model.includes('anthropic')) return 'anthropic';
      if (model.includes('gemini') || model.includes('google')) return 'google';
      return 'google';
    };

    const response = await aiService.generateText({
      model: {
        provider: getProviderFromModel(validated.model),
        model: validated.model,
        temperature: 0.3,
        maxTokens: 500,
      },
      prompt: [
        {
          role: 'system',
          content: `You are a thread summarizer for ${validated.analysisType} analysis. Generate concise, informative summaries that capture trends and key insights.`,
        },
        { role: 'user', content: validated.prompt },
      ],
      labels: { tenantId: validated.analysisType },
    });

    const summary = response.text.trim();

    logger.info(
      {
        analysisType: validated.analysisType,
        summaryLength: summary.length,
        model: validated.model,
      },
      'Thread summary generated'
    );

    return c.json<ApiResponse<{ summary: string; modelUsed: string; tokens?: any }>>({
      success: true,
      data: {
        summary,
        modelUsed: validated.model,
        tokens: response.usage
          ? {
              prompt: response.usage.promptTokens || 0,
              completion: response.usage.completionTokens || 0,
              total: response.usage.totalTokens || 0,
            }
          : undefined,
      },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);
    logger.error(
      { error: structuredError, path: c.req.path, method: c.req.method },
      'Thread summarization failed'
    );
    const sanitizedError = sanitizeErrorForClient(structuredError);
    return c.json<ApiResponse<never>>(
      { success: false, error: sanitizedError },
      sanitizedError.statusCode as any
    );
  }
});

export default app;

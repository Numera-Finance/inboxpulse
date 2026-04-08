import { Hono } from 'hono';
import { toStructuredError, sanitizeErrorForClient } from '@crm/shared';
import { DomainExtractionService } from '../services/domain-extraction';
import { ContactExtractionService } from '../services/contact-extraction';
import { SignatureExtractionService } from '../services/signature-extraction';
import { EmailFilterService, type ClassificationResult, type EmailCategory } from '../services/email-filter';
import { AnalysisExecutor } from '../framework/executor';
import { AnalysisConfigLoader } from '../framework/config-loader';
import { AIService, type ModelConfig } from '../services/ai-service';
import { analysisRegistry } from '../framework/registry';
import { analysisCacheService } from '../services/cache-service';
import { emailSchema, DEFAULT_ANALYSIS_CONFIG } from '@crm/shared';
import { logger } from '../utils/logger';
import { z } from 'zod';
import type { ApiResponse } from '@crm/shared';
import type { AnalysisType, AnalysisConfig } from '@crm/shared';

const app = new Hono();

// Create service instances (no DI needed)
const domainService = new DomainExtractionService();
const contactService = new ContactExtractionService();
const aiService = new AIService();
const signatureService = new SignatureExtractionService(aiService);
const analysisExecutor = new AnalysisExecutor(aiService, analysisRegistry);
const emailFilterService = new EmailFilterService(aiService);

const domainExtractRequestSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
});

const contactExtractRequestSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
  customers: z.array(z.object({
    id: z.uuid(),
    domains: z.array(z.string()), // Array of domains
  })).optional(),
});

const signatureExtractRequestSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
});

// Schema for model config
const modelConfigSchema = z.object({
  primary: z.string(),
  fallback: z.string().optional(),
});

// Schema for analysis config (partial - will merge with defaults)
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
  enabled: z.boolean().default(false), // Whether to run email filter before analysis
  skipHuggingFace: z.boolean().default(false), // Skip HuggingFace stages
  skipLLM: z.boolean().default(false), // Skip LLM classification stage
  filterCategories: z.array(z.enum(['spam', 'marketing', 'automated', 'transactional'])).default(['spam', 'marketing']), // Categories to filter out
  llmModel: filterModelConfigSchema, // Optional model override for LLM classification
}).optional();

const analyzeRequestSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
  threadContext: z.string().optional(), // Thread context string (API service should build this)
  analysisTypes: z.array(z.string()).optional(), // Which analyses to run
  config: analysisConfigSchema, // Optional: override model configs, settings, etc.
  filter: filterOptionsSchema, // Optional: email filter settings
});

/**
 * POST /api/analysis/domain-extract
 * Extract domains from email and create/update customers
 */
app.post('/domain-extract', async (c) => {
  try {
    const body = await c.req.json();
    const validated = domainExtractRequestSchema.parse(body);

    logger.info({ tenantId: validated.tenantId, emailId: validated.email.messageId }, 'Domain extraction request received');

    const customers = await domainService.extractAndCreateCustomers(validated.tenantId, validated.email);

    logger.info({ tenantId: validated.tenantId, customersCreated: customers.length }, 'Domain extraction completed');

    return c.json<ApiResponse<{ customers: typeof customers }>>({
      success: true,
      data: {
        customers,
      },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);

    // Log full error details internally
    logger.error(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      'Domain extraction failed'
    );

    // Sanitize error before sending to client
    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: sanitizedError,
      },
      sanitizedError.statusCode as any
    );
  }
});

/**
 * POST /api/analysis/contact-extract
 * Extract contacts from email and create/update them, linking to customers
 */
app.post('/contact-extract', async (c) => {
  try {
    const body = await c.req.json();
    const validated = contactExtractRequestSchema.parse(body);

    logger.info({ tenantId: validated.tenantId, emailId: validated.email.messageId }, 'Contact extraction request received');

    // If customers are provided, use them; otherwise extract domains first
    let customers: Array<{ id: string; domains: string[] }> = validated.customers || [];

    if (customers.length === 0) {
      logger.info({ tenantId: validated.tenantId }, 'No customers provided, extracting domains first');
      customers = await domainService.extractAndCreateCustomers(validated.tenantId, validated.email);
    }

    const contacts = await contactService.extractAndCreateContacts(validated.tenantId, validated.email, customers);

    logger.info({ tenantId: validated.tenantId, contactsCreated: contacts.length }, 'Contact extraction completed');

    return c.json<ApiResponse<{ contacts: typeof contacts; customers: typeof customers }>>({
      success: true,
      data: {
        contacts,
        customers,
      },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);

    // Log full error details internally
    logger.error(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      'Contact extraction failed'
    );

    // Sanitize error before sending to client
    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: sanitizedError,
      },
      sanitizedError.statusCode as any
    );
  }
});

/**
 * POST /api/analysis/signature-extract
 * Detect and extract signature from email, update contact if found
 */
app.post('/signature-extract', async (c) => {
  try {
    const body = await c.req.json();
    const validated = signatureExtractRequestSchema.parse(body);

    logger.info({ tenantId: validated.tenantId, emailId: validated.email.messageId }, 'Signature extraction request received');

    // Detect and extract signature (two-step process)
    const result = await signatureService.detectAndExtractSignature(
      validated.tenantId,
      validated.email,
      { tenantId: validated.tenantId }
    );

    if (!result) {
      logger.info({ tenantId: validated.tenantId, emailId: validated.email.messageId }, 'No signature detected');
      return c.json<ApiResponse<{ hasSignature: false }>>({
        success: true,
        data: {
          hasSignature: false,
        },
      });
    }

    logger.info(
      {
        tenantId: validated.tenantId,
        emailId: validated.email.messageId,
        contactId: result.contactId,
        signatureFields: Object.keys(result.signature).filter((k) => result.signature[k as keyof typeof result.signature]),
      },
      'Signature extraction completed'
    );

    return c.json<ApiResponse<typeof result>>({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);

    // Log full error details internally
    logger.error(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      'Signature extraction failed'
    );

    // Sanitize error before sending to client
    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: sanitizedError,
      },
      sanitizedError.statusCode as any
    );
  }
});

/**
 * POST /api/analysis/analyze
 * Unified analysis endpoint using the new framework
 * Uses registry + executor + config loader
 * Includes caching to avoid duplicate LLM costs on retries
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

      // Check if email should be filtered out
      const categoriesToFilter: readonly EmailCategory[] = filterOptions.filterCategories || ['spam', 'marketing'];
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

        return c.json<ApiResponse<{
          filtered: true;
          filterResult: ClassificationResult;
          results: Record<string, any>;
        }>>({
          success: true,
          data: {
            filtered: true,
            filterResult,
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

      // Store filterResult to return with response (even when not filtered)
      (c as any).filterResult = filterResult;
    }

    // Merge provided config with defaults
    const configLoader = new AnalysisConfigLoader();
    const config: AnalysisConfig = configLoader.mergeWithDefaults({
      tenantId: validated.tenantId,
      ...validated.config,
    });

    // Determine which analyses to run
    let analysisTypes: AnalysisType[];
    if (validated.analysisTypes && validated.analysisTypes.length > 0) {
      // Use provided types
      analysisTypes = validated.analysisTypes as AnalysisType[];
    } else {
      // Use enabled analyses from config, but exclude domain-extraction and contact-extraction
      // These are handled separately via /domain-extract and /contact-extract endpoints
      const enabledTypes = configLoader.getEnabledAnalysisTypes(config) as AnalysisType[];
      analysisTypes = enabledTypes.filter(
        (type) => type !== 'domain-extraction' && type !== 'contact-extraction'
      );
    }

    if (analysisTypes.length === 0) {
      logger.info({ tenantId: validated.tenantId }, 'No analyses specified or enabled');
      return c.json<ApiResponse<{ results: Record<string, any> }>>({
        success: true,
        data: {
          results: {},
        },
      });
    }

    // Generate model ID for caching (based on primary models in config)
    const modelId = analysisTypes
      .map((type) => config.modelConfigs[type]?.primary || 'default')
      .sort()
      .join('|');

    // Check cache first
    const cachedResults = await analysisCacheService.get(messageId, modelId);
    if (cachedResults) {
      logger.info(
        {
          tenantId: validated.tenantId,
          emailId: messageId,
          modelId,
        },
        'Returning cached analysis results'
      );
      const filterResult = (c as any).filterResult;
      return c.json<ApiResponse<{ results: typeof cachedResults; cached: true; filterResult?: ClassificationResult }>>({
        success: true,
        data: {
          results: cachedResults,
          cached: true,
          filterResult,
        },
      });
    }

    // Use thread context if provided (API service should build this)
    const threadContext = validated.threadContext
      ? { threadContext: validated.threadContext }
      : undefined;

    // Execute analyses
    const results = await analysisExecutor.executeBatch(
      analysisTypes,
      validated.email,
      validated.tenantId,
      config,
      threadContext
    );

    // Convert Map to object for JSON response
    const resultsObject: Record<string, any> = {};
    for (const [type, result] of results.entries()) {
      resultsObject[type] = result.result;
    }

    // Cache the results for future retries
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
    return c.json<ApiResponse<{ results: typeof resultsObject; cached: false; filterResult?: ClassificationResult }>>({
      success: true,
      data: {
        results: resultsObject,
        cached: false,
        filterResult,
      },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);

    logger.error(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      'Analysis failed'
    );

    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: sanitizedError,
      },
      sanitizedError.statusCode as any
    );
  }
});

/**
 * POST /api/analysis/async/analyze
 * Async analysis endpoint (same logic, different route for future Inngest integration)
 */
app.post('/async/analyze', async (c) => {
  // For now, same implementation as /analyze
  // In the future, this will queue the analysis via Inngest
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
      data: {
        classification: result,
      },
    });
  } catch (error: unknown) {
    const structuredError = toStructuredError(error);

    logger.error(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      'Email filter failed'
    );

    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: sanitizedError,
      },
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

    // Determine provider from model name
    const getProviderFromModel = (model: string): 'openai' | 'anthropic' | 'google' => {
      if (model.includes('gpt') || model.includes('openai')) return 'openai';
      if (model.includes('claude') || model.includes('anthropic')) return 'anthropic';
      if (model.includes('gemini') || model.includes('google')) return 'google';
      return 'google'; // Default to Google Gemini
    };

    // Generate summary using LLM
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
        {
          role: 'user',
          content: validated.prompt,
        },
      ],
      labels: {
        tenantId: validated.analysisType, // Use analysisType as identifier
      },
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
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      'Thread summarization failed'
    );

    const sanitizedError = sanitizeErrorForClient(structuredError);

    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: sanitizedError,
      },
      sanitizedError.statusCode as any
    );
  }
});

export default app;

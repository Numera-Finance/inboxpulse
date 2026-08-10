import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import type { Email } from '@crm/shared';
import type { AnalysisType, AnalysisConfig } from '@crm/shared';
import { AIService, type ModelConfig as AIServiceModelConfig } from '../services/ai-service';
import type { PromptMessage } from '../services/ai-types';
import { AnalysisRegistry } from './registry';
import type { AnalysisDefinition, AnalysisResult, BatchAnalysisResult, ThreadContext } from './types';
import { logger } from '../utils/logger';

/**
 * Render a recipient list as one prompt line: `Nina Patel <nina@acme.com>, ops@acme.com`.
 *
 * Bcc is deliberately never rendered by the caller. A blind recipient is
 * invisible to everyone on the thread, and a search string built from one would
 * leak that they were copied the moment a reader saw the results.
 */
function formatAddressList(
  addresses: Array<{ name?: string; email: string }> | undefined
): string {
  if (!addresses?.length) return '';

  return addresses
    .map((a) => {
      const email = a.email?.trim();
      if (!email) return '';
      const name = a.name?.trim();
      return name ? `${name} <${email}>` : email;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Analysis Executor
 * Handles execution of single and batch analyses with fallback support
 */
@injectable()
export class AnalysisExecutor {
  constructor(
    @inject(AIService) private aiService: AIService,
    @inject(AnalysisRegistry) private registry: AnalysisRegistry
  ) {}

  /**
   * Execute a single analysis
   * Handles prompt building, model fallback, and validation
   */
  async executeSingle(
    type: AnalysisType,
    email: Email,
    tenantId: string,
    config: AnalysisConfig,
    threadContext?: ThreadContext
  ): Promise<AnalysisResult> {
    const definition = this.registry.get(type);
    if (!definition) {
      throw new Error(`Analysis definition not found for type: ${type}`);
    }

    // Use model config from provided config, or fallback to definition default
    const modelConfigFromRequest = config.modelConfigs[type];
    const primaryModel = modelConfigFromRequest?.primary || definition.models.primary;
    const fallbackModel = modelConfigFromRequest?.fallback || definition.models.fallback;

    // Build prompt
    const prompt = definition.buildPrompt
      ? definition.buildPrompt(email, threadContext)
      : this.buildSinglePrompt(definition, email, threadContext);

    // Convert model config to AI service format
    const modelConfig = this.convertModelConfig(primaryModel, fallbackModel);

    // Execute with fallback
    try {
      const result = await this.executeWithFallback(
        modelConfig,
        prompt,
        definition.module.schema,
        {
          tenantId,
          traceId: `analysis-${type}-${email.messageId}-${Date.now()}`,
          tags: [type, 'single'],
          metadata: {
            emailId: email.messageId,
            analysisType: type,
          },
        },
        definition.settings.maxRetries
      );

      return {
        type,
        result: this.applyPostProcess(definition, result.object, email, tenantId),
        modelUsed: modelConfig.primary.model,
        reasoning: result.reasoning,
        usage: result.usage && result.usage.totalTokens !== undefined
          ? {
              promptTokens: result.usage.promptTokens ?? 0,
              completionTokens: result.usage.completionTokens ?? 0,
              totalTokens: result.usage.totalTokens,
            }
          : undefined,
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, type, emailId: email.messageId, tenantId },
        'Failed to execute single analysis'
      );
      throw error;
    }
  }

  /**
   * Build batched schema combining multiple module schemas
   */
  buildBatchedSchema(definitions: AnalysisDefinition[]): z.ZodSchema<any> {
    const schemaFields: Record<string, z.ZodSchema<any>> = {};

    for (const definition of definitions) {
      // Use module name as field name in batched schema
      schemaFields[definition.module.name] = definition.module.schema;
    }

    return z.object(schemaFields);
  }

  /**
   * Build batched prompt combining module instructions + email + thread context
   */
  buildBatchedPrompt(
    definitions: AnalysisDefinition[],
    email: Email,
    threadContext?: ThreadContext
  ): string | PromptMessage[] {
    // Combine all module instructions
    const instructions = definitions
      .map((def) => `## ${def.name}\n${def.module.instructions}`)
      .join('\n\n');

    // Build email context
    const emailContext = this.buildEmailContext(email, threadContext);

    // Combine into final prompt
    const prompt = `${instructions}\n\n${emailContext}`;

    return prompt;
  }

  /**
   * Execute batch call with combined schema and prompt
   */
  async executeBatchCall(
    definitions: AnalysisDefinition[],
    email: Email,
    tenantId: string,
    config: AnalysisConfig,
    threadContext?: ThreadContext
  ): Promise<BatchAnalysisResult> {
    if (definitions.length === 0) {
      return new Map();
    }

    // Use model config from request config, or fallback to definition default
    // Use the first definition's model config as base
    const primaryDefinition = definitions[0];
    const modelConfigFromRequest = config.modelConfigs[primaryDefinition.type];
    const primaryModel = modelConfigFromRequest?.primary || primaryDefinition.models.primary;
    const fallbackModel = modelConfigFromRequest?.fallback || primaryDefinition.models.fallback;
    const modelConfig = this.convertModelConfig(primaryModel, fallbackModel);

    // Build batched schema and prompt
    const batchedSchema = this.buildBatchedSchema(definitions);
    const batchedPrompt = this.buildBatchedPrompt(definitions, email, threadContext);

    logger.debug(
      {
        tenantId,
        emailId: email.messageId,
        analysisCount: definitions.length,
        analysisTypes: definitions.map((d) => d.type),
      },
      'Executing batch analysis call'
    );

    try {
      const result = await this.aiService.generateStructuredOutput({
        model: modelConfig.primary,
        prompt: batchedPrompt,
        schema: batchedSchema,
        labels: {
          tenantId,
          traceId: `batch-analysis-${email.messageId}-${Date.now()}`,
          tags: ['batch', ...definitions.map((d) => d.type)],
          metadata: {
            emailId: email.messageId,
            analysisTypes: definitions.map((d) => d.type),
            analysisCount: definitions.length,
          },
        },
        maxRetries: 1,
      });

      // Convert result to BatchAnalysisResult map
      const batchResult = new Map<AnalysisType, AnalysisResult>();
      const resultObject = result.object as Record<string, any>;

      for (const definition of definitions) {
        const moduleResult = resultObject[definition.module.name];
        if (moduleResult !== undefined) {
          batchResult.set(definition.type, {
            type: definition.type,
            result: this.applyPostProcess(definition, moduleResult, email, tenantId),
            modelUsed: modelConfig.primary.model,
            reasoning: result.reasoning,
            usage: result.usage && result.usage.totalTokens !== undefined
              ? {
                  promptTokens: result.usage.promptTokens ?? 0,
                  completionTokens: result.usage.completionTokens ?? 0,
                  totalTokens: result.usage.totalTokens,
                }
              : undefined,
          });
        }
      }

      logger.info(
        {
          tenantId,
          emailId: email.messageId,
          successCount: batchResult.size,
          totalCount: definitions.length,
        },
        'Batch analysis call completed'
      );

      return batchResult;
    } catch (error: any) {
      logger.warn(
        {
          error: error.message,
          tenantId,
          emailId: email.messageId,
          analysisCount: definitions.length,
        },
        'Batch analysis call failed, will fallback to individual calls'
      );
      throw error;
    }
  }

  /**
   * Execute analyses individually in parallel
   */
  async executeIndividualCalls(
    definitions: AnalysisDefinition[],
    email: Email,
    tenantId: string,
    config: AnalysisConfig,
    threadContext?: ThreadContext
  ): Promise<BatchAnalysisResult> {
    logger.debug(
      {
        tenantId,
        emailId: email.messageId,
        analysisCount: definitions.length,
      },
      'Executing individual analysis calls'
    );

    // Execute all analyses in parallel
    const promises = definitions.map((definition) =>
      this.executeSingle(definition.type, email, tenantId, config, threadContext).catch((error: any) => {
        logger.error(
          { error: error.message, type: definition.type, emailId: email.messageId, tenantId },
          'Individual analysis call failed'
        );
        // Return error result instead of throwing
        return {
          type: definition.type,
          result: null,
          modelUsed: 'unknown',
          error: error.message,
        } as AnalysisResult;
      })
    );

    const results = await Promise.all(promises);

    // Convert to map
    const batchResult = new Map<AnalysisType, AnalysisResult>();
    for (const result of results) {
      batchResult.set(result.type, result);
    }

    logger.info(
      {
        tenantId,
        emailId: email.messageId,
        successCount: results.filter((r) => !('error' in r)).length,
        totalCount: definitions.length,
      },
      'Individual analysis calls completed'
    );

    return batchResult;
  }

  /**
   * Execute batch with hybrid approach: try batch first, fallback to individual
   */
  async executeBatch(
    types: AnalysisType[],
    email: Email,
    tenantId: string,
    config: AnalysisConfig,
    threadContext?: ThreadContext
  ): Promise<BatchAnalysisResult> {
    // Get definitions for requested types. Schema validation at the route
    // boundary should already reject unknown types — this fallback exists as
    // defense-in-depth (e.g., for internal callers that bypass HTTP). Warn
    // loudly when it fires so any drift between the type union and the
    // registry is visible in logs.
    const definitions: AnalysisDefinition[] = [];
    const unknownTypes: string[] = [];
    for (const type of types) {
      const def = this.registry.get(type);
      if (def) definitions.push(def);
      else unknownTypes.push(type);
    }
    if (unknownTypes.length > 0) {
      logger.warn(
        { tenantId, unknownTypes, requestedTypes: types },
        'Unknown analysis types passed to executor — these were skipped. ' +
        'This is likely a bug: the route schema should have rejected these.'
      );
    }

    if (definitions.length === 0) {
      logger.warn({ tenantId, types }, 'No valid analysis definitions found for requested types');
      return new Map();
    }

    const validDefinitions = definitions;

    // Try batch first (only if more than one analysis)
    if (validDefinitions.length > 1) {
      try {
        return await this.executeBatchCall(validDefinitions, email, tenantId, config, threadContext);
      } catch (error: any) {
        logger.debug(
          { error: error.message, tenantId, emailId: email.messageId },
          'Batch call failed, falling back to individual calls'
        );
        // Fall through to individual calls
      }
    }

    // Fallback to individual calls
    return await this.executeIndividualCalls(validDefinitions, email, tenantId, config, threadContext);
  }

  /**
   * Helper: Build single prompt from definition
   */
  private buildSinglePrompt(
    definition: AnalysisDefinition,
    email: Email,
    threadContext?: ThreadContext
  ): string {
    const emailContext = this.buildEmailContext(email, threadContext);
    return `${definition.module.instructions}\n\n${emailContext}`;
  }

  /**
   * Run a module's optional correction pass over its own output.
   *
   * Never allowed to fail the analysis: a postProcess that throws leaves an
   * otherwise-valid result unusable, so the raw model output is kept and the
   * fault is logged. The hook is a safety net, not a gate.
   */
  private applyPostProcess(
    definition: AnalysisDefinition,
    result: unknown,
    email: Email,
    tenantId: string
  ): unknown {
    const postProcess = definition.module.postProcess;
    if (!postProcess) return result;

    try {
      return postProcess(result, email);
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          tenantId,
          emailId: email.messageId,
          analysisType: definition.type,
        },
        'postProcess threw — keeping the raw model output'
      );
      return result;
    }
  }

  /**
   * Helper: Build email context string
   * - From: sender identity (used by signature-extraction's ownership rule, harmless to others)
   * - To / Cc: recipients. context-search-string builds queries around the
   *            participants, and upsell's "is this service already in flight"
   *            rule reads the To and Cc lines for our own staff — it had been
   *            asked to judge from addresses the prompt never carried.
   * - Body: dequoted reply content
   * - Signature: dequoted reply with signature attached, for signature-extraction to find
   *             the signature within
   * - Thread Context: optional prior-thread summary
   */
  private buildEmailContext(email: Email, threadContext?: ThreadContext): string {
    const fromName = email.from?.name?.trim();
    const fromEmail = email.from?.email?.trim();
    const fromLine = fromEmail
      ? fromName
        ? `From: ${fromName} <${fromEmail}>`
        : `From: ${fromEmail}`
      : '';

    let context = '';
    if (fromLine) context += `${fromLine}\n`;

    const toLine = formatAddressList(email.tos);
    if (toLine) context += `To: ${toLine}\n`;

    const ccLine = formatAddressList(email.ccs);
    if (ccLine) context += `Cc: ${ccLine}\n`;

    context += `Email Subject: ${email.subject}\n\n`;
    context += `Email Body:\n${email.body || ''}\n\n`;

    if (email.signature) {
      context += `Email Signature:\n${email.signature}\n\n`;
    }

    if (threadContext?.threadContext) {
      context += `Thread Context:\n${threadContext.threadContext}\n\n`;
    }

    return context;
  }

  /**
   * Helper: Convert shared ModelConfig to AIService ModelConfig
   */
  private convertModelConfig(
    primary: string,
    fallback?: string
  ): { primary: AIServiceModelConfig; fallback?: AIServiceModelConfig } {
    const primaryConfig = this.parseModelString(primary);
    const fallbackConfig = fallback ? this.parseModelString(fallback) : undefined;

    return {
      primary: primaryConfig,
      fallback: fallbackConfig,
    };
  }

  /**
   * Helper: Parse model string (e.g., 'gemini-2.5-pro') to provider and model
   */
  private parseModelString(modelString: string): AIServiceModelConfig {
    // Simple heuristic: check model name prefix
    if (modelString.startsWith('gpt-') || modelString.startsWith('o1-') || modelString.startsWith('o3-')) {
      return {
        provider: 'openai',
        model: modelString,
        temperature: 0.7,
        maxTokens: 4000,
      };
    } else if (modelString.startsWith('claude-') || modelString.startsWith('haiku-') || modelString.startsWith('sonnet-') || modelString.startsWith('opus-')) {
      return {
        provider: 'anthropic',
        model: modelString,
        temperature: 0.7,
        maxTokens: 4000,
      };
    } else if (modelString.startsWith('gemini-') || modelString.includes('gemini')) {
      return {
        provider: 'google',
        model: modelString,
        temperature: 0.7,
        maxTokens: 4000,
      };
    } else if (modelString.startsWith('grok-') || modelString.includes('xai')) {
      return {
        provider: 'xai',
        model: modelString,
        temperature: 0.7,
        maxTokens: 4000,
      };
    }

    // Default to Google Gemini if unknown
    logger.warn({ modelString }, 'Unknown model string, defaulting to Google Gemini');
    return {
      provider: 'google',
      model: modelString,
      temperature: 0.7,
      maxTokens: 4000,
    };
  }

  /**
   * Helper: Execute with fallback model support
   */
  private async executeWithFallback(
    modelConfig: { primary: AIServiceModelConfig; fallback?: AIServiceModelConfig },
    prompt: string | PromptMessage[],
    schema: z.ZodSchema<any>,
    labels: { tenantId: string; traceId?: string; tags?: string[]; metadata?: Record<string, any> },
    maxRetries?: number
  ): Promise<{ object: any; reasoning?: string; usage?: any }> {
    try {
      // Try primary model first
      const result = await this.aiService.generateStructuredOutput({
        model: modelConfig.primary,
        prompt,
        schema,
        labels,
        maxRetries: maxRetries ?? 1,
      });
      return result;
    } catch (error: any) {
      // If primary fails and fallback exists, try fallback
      if (modelConfig.fallback) {
        logger.warn(
          {
            primaryModel: modelConfig.primary.model,
            fallbackModel: modelConfig.fallback.model,
            error: error.message,
          },
          'Primary model failed, trying fallback'
        );

        try {
          const result = await this.aiService.generateStructuredOutput({
            model: modelConfig.fallback,
            prompt,
            schema,
            labels: {
              ...labels,
              tags: [...(labels.tags || []), 'fallback'],
            },
            maxRetries: maxRetries ?? 1,
          });
          return result;
        } catch (fallbackError: any) {
          logger.error(
            {
              primaryModel: modelConfig.primary.model,
              fallbackModel: modelConfig.fallback.model,
              error: fallbackError.message,
            },
            'Both primary and fallback models failed'
          );
          throw fallbackError;
        }
      }

      // No fallback, throw original error
      throw error;
    }
  }
}

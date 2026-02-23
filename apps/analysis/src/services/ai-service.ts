import { injectable } from 'tsyringe';
import { generateText, generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { xai } from '@ai-sdk/xai';
import { Langfuse } from 'langfuse';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { getEnv } from '../env';
import type { PromptMessage } from './ai-types';

/**
 * Supported AI providers
 */
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'xai';

/**
 * Model configuration
 */
export interface ModelConfig {
  provider: AIProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Observability labels for tracing and monitoring
 */
export interface ObservabilityLabels {
  traceId?: string;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

/**
 * Options for generateText
 */
export interface GenerateTextOptions {
  model: ModelConfig;
  prompt: string | PromptMessage[];
  labels?: ObservabilityLabels;
  maxRetries?: number;
}

/**
 * Result from generateText with optional reasoning
 */
export interface GenerateTextResult {
  text: string;
  reasoning?: string; // Captured reasoning/thinking steps if available
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Options for generateStructuredOutput
 */
export interface GenerateStructuredOutputOptions<T extends z.ZodTypeAny> {
  model: ModelConfig;
  prompt: string | PromptMessage[];
  schema: T;
  labels?: ObservabilityLabels;
  maxRetries?: number;
}

/**
 * Result from generateStructuredOutput with optional reasoning
 */
export interface GenerateStructuredOutputResult<T> {
  object: T;
  reasoning?: string; // Captured reasoning/thinking steps if available
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * AI Service for LLM operations with validation and observability
 */
@injectable()
export class AIService {
  private langfuse: Langfuse | null = null;

  constructor() {
    // Initialize Langfuse if enabled
    const env = getEnv();
    if (env.LANGFUSE_ENABLED === 'true' && env.LANGFUSE_SECRET_KEY) {
      try {
        this.langfuse = new Langfuse({
          secretKey: env.LANGFUSE_SECRET_KEY,
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          baseUrl: env.LANGFUSE_BASE_URL,
        });
        logger.info('Langfuse initialized for observability');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ error: message }, 'Failed to initialize Langfuse, continuing without observability');
      }
    }
  }

  /**
   * Get the AI model instance based on provider
   */
  private getModel(provider: AIProvider, modelName: string) {
    switch (provider) {
      case 'openai':
        return openai(modelName);
      case 'anthropic':
        return anthropic(modelName);
      case 'google':
        return google(modelName);
      case 'xai':
        return xai(modelName);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Generate text using generateText
   * Validates input and output, retries on validation failure
   * Returns text and optional reasoning if available
   */
  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const { model, prompt, labels, maxRetries = 1 } = options;

    // Validate input
    this.validateInput(prompt, model);

    let attempt = 0;
    let lastValidationError: string | null = null;

    while (attempt <= maxRetries) {
      try {
        logger.debug(
          {
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            model: model.model,
            provider: model.provider,
            tenantId: labels?.tenantId,
          },
          'Generating text'
        );

        // Build the prompt - include validation error if retrying
        const finalPrompt = this.buildPrompt(prompt, lastValidationError, attempt);

        // Generate text with Langfuse integration via Vercel AI SDK
        const generateTextOptions: any = {
          model: this.getModel(model.provider, model.model),
          temperature: model.temperature,
          maxTokens: model.maxTokens,
        };

        // Handle prompt type (string or PromptMessage[])
        if (typeof finalPrompt === 'string') {
          generateTextOptions.prompt = finalPrompt;
        } else {
          generateTextOptions.messages = finalPrompt;
        }

        // Pass Langfuse to Vercel AI SDK for automatic tracing
        if (this.langfuse) {
          generateTextOptions.langfuse = this.langfuse;
          generateTextOptions.experimental_traceId = labels?.traceId;
          generateTextOptions.experimental_userId = labels?.userId;
          generateTextOptions.experimental_sessionId = labels?.sessionId;
          generateTextOptions.experimental_tags = labels?.tags;
          generateTextOptions.experimental_metadata = {
            provider: model.provider,
            model: model.model,
            tenantId: labels?.tenantId,
            attempt: attempt + 1,
            captureReasoning: true, // Indicate we want to capture reasoning
            ...labels?.metadata,
          };
        }

        const result = await generateText(generateTextOptions);

        const text = result.text;
        
        // Capture reasoning if available (some models like o1, o3 provide reasoning)
        // Check multiple possible properties where reasoning might be stored
        const reasoning = 
          (result as any).reasoning || 
          (result as any).thinking || 
          (result as any).reasoningSteps ||
          (result as any).experimental_providerMetadata?.reasoning ||
          undefined;

        // Log reasoning capture for debugging
        if (reasoning) {
          logger.debug(
            {
              model: model.model,
              reasoningLength: reasoning.length,
              tenantId: labels?.tenantId,
            },
            'Reasoning captured from model response'
          );
        }

        logger.info(
          {
            attempt: attempt + 1,
            model: model.model,
            textLength: text.length,
            hasReasoning: !!reasoning,
            reasoningLength: reasoning?.length,
            usage: result.usage,
            tenantId: labels?.tenantId,
          },
          'Text generated successfully'
        );

        return {
          text,
          reasoning: reasoning || undefined, // Explicitly ensure it's undefined if not present
          usage: result.usage,
        };
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error during text generation';
        
        logger.error(
          {
            attempt: attempt + 1,
            error: errorMessage,
            model: model.model,
            tenantId: labels?.tenantId,
          },
          'Text generation failed'
        );

        // If this is the last attempt, throw
        if (attempt >= maxRetries) {
          throw new Error(`Text generation failed after ${maxRetries + 1} attempts: ${errorMessage}`);
        }

        // For retry, we'll use the error message as validation feedback
        lastValidationError = errorMessage;
        attempt++;
      }
    }

    throw new Error('Text generation failed - unexpected state');
  }

  /**
   * Generate structured output using generateObject
   * Validates input and output schema, retries on validation failure
   * Returns structured object and optional reasoning if available
   */
  async generateStructuredOutput<T extends z.ZodTypeAny>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<GenerateStructuredOutputResult<z.infer<T>>> {
    const { model, prompt, schema, labels, maxRetries = 1 } = options;

    // Validate input
    this.validateInput(prompt, model);
    this.validateSchema(schema);

    let attempt = 0;
    let lastValidationError: string | null = null;

    while (attempt <= maxRetries) {
      try {
        logger.debug(
          {
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            model: model.model,
            provider: model.provider,
            tenantId: labels?.tenantId,
          },
          'Generating structured output'
        );

        logger.debug(
          {
            model: model.model,
            provider: model.provider,
            tenantId: labels?.tenantId,
          },
          'About to call generateObject'
        );

        // Build the prompt - include validation error if retrying
        const finalPrompt = this.buildPrompt(prompt, lastValidationError, attempt);

        // Generate structured output with Langfuse integration via Vercel AI SDK
        const generateObjectOptions: any = {
          model: this.getModel(model.provider, model.model),
          schema,
          temperature: model.temperature,
          maxTokens: model.maxTokens,
        };

        // Handle prompt type (string or PromptMessage[])
        if (typeof finalPrompt === 'string') {
          generateObjectOptions.prompt = finalPrompt;
        } else {
          generateObjectOptions.messages = finalPrompt;
        }

        // Pass Langfuse to Vercel AI SDK for automatic tracing
        if (this.langfuse) {
          generateObjectOptions.langfuse = this.langfuse;
          generateObjectOptions.experimental_traceId = labels?.traceId;
          generateObjectOptions.experimental_userId = labels?.userId;
          generateObjectOptions.experimental_sessionId = labels?.sessionId;
          generateObjectOptions.experimental_tags = labels?.tags;
          generateObjectOptions.experimental_metadata = {
            provider: model.provider,
            model: model.model,
            tenantId: labels?.tenantId,
            attempt: attempt + 1,
            captureReasoning: true, // Indicate we want to capture reasoning
            ...labels?.metadata,
          };
        }

        const result = await generateObject(generateObjectOptions);

        // Debug: Log the full result object to see what we got
        logger.debug(
          {
            attempt: attempt + 1,
            model: model.model,
            provider: model.provider,
            resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
            hasObject: 'object' in result,
            objectType: result?.object ? typeof result.object : 'undefined',
            objectKeys: result?.object && typeof result.object === 'object' ? Object.keys(result.object) : [],
            rawResult: JSON.stringify(result, null, 2),
            tenantId: labels?.tenantId,
          },
          'Raw generateObject result received'
        );

        const output = result.object as z.infer<T>;
        
        // Capture reasoning if available (some models like o1, o3 provide reasoning)
        // Check multiple possible properties where reasoning might be stored
        const reasoning = 
          (result as any).reasoning || 
          (result as any).thinking || 
          (result as any).reasoningSteps ||
          (result as any).experimental_providerMetadata?.reasoning ||
          undefined;

        // Log reasoning capture for debugging
        if (reasoning) {
          logger.debug(
            {
              model: model.model,
              reasoningLength: reasoning.length,
              tenantId: labels?.tenantId,
            },
            'Reasoning captured from model response'
          );
        }

        // Validate output against schema (should already be valid, but double-check)
        const validationResult = schema.safeParse(output);
        if (!validationResult.success) {
          const validationError = this.formatValidationError(validationResult.error);
          
          logger.warn(
            {
              attempt: attempt + 1,
              validationError,
              model: model.model,
              tenantId: labels?.tenantId,
            },
            'Generated output failed validation, retrying'
          );

          // Retry with validation error feedback
          lastValidationError = validationError;
          attempt++;
          continue;
        }

        logger.info(
          {
            attempt: attempt + 1,
            model: model.model,
            outputKeys: output && typeof output === 'object' ? Object.keys(output) : [],
            hasReasoning: !!reasoning,
            reasoningLength: reasoning?.length,
            usage: result.usage,
            tenantId: labels?.tenantId,
          },
          'Structured output generated successfully'
        );

        return {
          object: output,
          reasoning: reasoning || undefined, // Explicitly ensure it's undefined if not present
          usage: result.usage,
        };
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error during structured output generation';
        
        // Debug: Log full error details including stack and any response data
        logger.error(
          {
            attempt: attempt + 1,
            error: errorMessage,
            errorType: error?.constructor?.name,
            errorStack: error?.stack,
            errorDetails: error?.cause ? JSON.stringify(error.cause, null, 2) : undefined,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
            model: model.model,
            provider: model.provider,
            tenantId: labels?.tenantId,
          },
          'Structured output generation failed'
        );

        // If this is the last attempt, throw
        if (attempt >= maxRetries) {
          throw new Error(`Structured output generation failed after ${maxRetries + 1} attempts: ${errorMessage}`);
        }

        // For retry, use the error message as validation feedback
        lastValidationError = errorMessage;
        attempt++;
      }
    }

    throw new Error('Structured output generation failed - unexpected state');
  }

  /**
   * Validate input prompt
   */
  private validateInput(prompt: string | PromptMessage[], model: ModelConfig): void {
    if (typeof prompt === 'string') {
      if (!prompt || prompt.trim().length === 0) {
        throw new Error('Prompt cannot be empty');
      }
    } else if (Array.isArray(prompt)) {
      if (prompt.length === 0) {
        throw new Error('Prompt messages array cannot be empty');
      }
    } else {
      throw new Error('Prompt must be a string or array of PromptMessage');
    }

    if (!model.provider || !model.model) {
      throw new Error('Model provider and model name are required');
    }
  }

  /**
   * Validate Zod schema
   */
  private validateSchema(schema: z.ZodTypeAny): void {
    if (!schema || typeof schema.parse !== 'function') {
      throw new Error('Schema must be a valid Zod schema');
    }
  }

  /**
   * Build prompt with validation error feedback if retrying
   */
  private buildPrompt(
    originalPrompt: string | PromptMessage[],
    validationError: string | null,
    attempt: number
  ): string | PromptMessage[] {
    // If no validation error or first attempt, return original prompt
    if (!validationError || attempt === 0) {
      return originalPrompt;
    }

    // Add validation error feedback to prompt
    const errorFeedback = `\n\nPrevious attempt failed validation:\n${validationError}\n\nPlease fix the output to match the required format.`;

    if (typeof originalPrompt === 'string') {
      return originalPrompt + errorFeedback;
    } else {
      // For message arrays, append error feedback as a system message
      return [
        ...originalPrompt,
        {
          role: 'system' as const,
          content: `The previous response failed validation. ${errorFeedback}`,
        },
      ];
    }
  }

  /**
   * Format Zod validation error for feedback
   */
  private formatValidationError(error: z.ZodError): string {
    const issues = error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `${path}: ${issue.message}`;
    });
    return issues.join('; ');
  }
}

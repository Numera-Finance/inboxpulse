import { z } from 'zod';
import type { AnalysisType, ModelConfig, AnalysisSettings } from '@crm/shared';
import type { Email } from '@crm/shared';
import type { PromptMessage } from '../services/ai-types';

/**
 * Analysis module - defines the prompt instructions and schema for an analysis type
 * Similar to email-analyzer's module pattern
 */
export interface AnalysisModule {
  name: string;
  description: string;
  instructions: string;  // Concise prompt instructions for the LLM
  schema: z.ZodSchema<any>;  // Zod schema for output validation
  version?: string;  // Optional version for tracking (e.g., 'v1.0')
}

/**
 * Analysis definition - complete configuration for an analysis type
 * Combines module (prompt + schema) with execution settings
 */
export interface AnalysisDefinition {
  type: AnalysisType;
  name: string;
  
  // Module-based prompt (like email-analyzer pattern)
  module: AnalysisModule;
  
  // Model configuration with fallback
  models: ModelConfig;
  
  // Execution settings
  settings: {
    timeout?: number;  // milliseconds
    maxRetries?: number;
    priority?: number;  // Higher = runs first
    alwaysRun?: boolean;  // For domain/contact extraction (always executed)
    dependencies?: AnalysisType[];  // Which analyses must complete first
  };
  
  // Optional: Custom prompt builder function
  // If provided, overrides module.instructions
  buildPrompt?: (email: Email, context?: ThreadContext) => string | PromptMessage[];
}

/**
 * Thread context for analyses that require it
 */
export interface ThreadContext {
  threadContext?: string;  // Formatted thread summary/history
  previousEmail?: any;  // Previous email analysis result
}

/**
 * Analysis execution result
 */
export interface AnalysisResult<T = any> {
  type: AnalysisType;
  result: T;
  modelUsed: string;  // Which model was actually used (primary or fallback)
  reasoning?: string;  // Reasoning/thinking steps if available
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Batch analysis result
 * Maps analysis type to its result
 */
export type BatchAnalysisResult = Map<AnalysisType, AnalysisResult>;

import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisExecutor } from '../executor';
import { AnalysisRegistry } from '../registry';
import { AIService } from '../../services/ai-service';
import { allAnalysisDefinitions } from '../../analyses/definitions';
import { DEFAULT_ANALYSIS_CONFIG } from '@crm/shared';
import type { Email, AnalysisConfig } from '@crm/shared';
import type { AnalysisType } from '@crm/shared';

describe('AnalysisExecutor', () => {
  let executor: AnalysisExecutor;
  let mockAIService: any;
  let registry: AnalysisRegistry;
  let mockConfig: AnalysisConfig;

  const mockEmail: Email = {
    provider: 'gmail',
    messageId: 'test-email-123',
    threadId: 'test-thread-456',
    subject: 'Test Email',
    body: 'This is a test email.',
    from: {
      email: 'test@example.com',
      name: 'Test User',
    },
    tos: [{ email: 'recipient@example.com' }],
    ccs: [],
    bccs: [],
    receivedAt: new Date(),
  };

  beforeEach(() => {
    // Mock AIService. Smart implementation: looks at the requested Zod schema
    // shape to figure out whether the call is single (one module's schema) or
    // batched (object with one entry per module), and returns a matching value.
    mockAIService = {
      generateStructuredOutput: vi.fn().mockImplementation(async (opts: any) => {
        const stub: Record<string, any> = {
          sentiment: { value: 'positive', confidence: 0.9 },
          escalation: { detected: false, confidence: 0.9 },
          upsell: { detected: false, confidence: 0.9 },
          churn: { riskLevel: 'low', confidence: 0.9, indicators: [] },
          kudos: { detected: false, confidence: 0.9 },
          competitor: { detected: false, confidence: 0.9 },
          'signature-extraction': {},
        };
        // Derive object keys from the Zod schema shape (works for batched
        // calls — z.object({sentiment: …, escalation: …})). For single-analysis
        // calls the schema doesn't have our analysis keys, so fall back to a
        // generic sentiment-shaped result.
        const shape =
          (opts.schema?._def?.shape && typeof opts.schema._def.shape === 'function'
            ? opts.schema._def.shape()
            : opts.schema?._def?.shape) ?? null;
        let object: Record<string, any> = stub.sentiment;
        if (shape && Object.keys(shape).some((k) => k in stub)) {
          object = {};
          for (const k of Object.keys(shape)) {
            object[k] = stub[k] ?? {};
          }
        }
        return {
          object,
          reasoning: undefined,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
      }),
    };

    // Setup registry
    registry = new AnalysisRegistry();
    registry.registerAll(allAnalysisDefinitions);

    // Mock config
    mockConfig = {
      tenantId: 'test-tenant',
      ...DEFAULT_ANALYSIS_CONFIG,
      enabledAnalyses: {
        ...DEFAULT_ANALYSIS_CONFIG.enabledAnalyses,
        'sentiment': true,
        'escalation': false,
      },
    };

    executor = new AnalysisExecutor(mockAIService, registry);
  });

  describe('buildBatchedSchema', () => {
    it('should combine multiple module schemas', () => {
      const definitions = [
        allAnalysisDefinitions.find(d => d.type === 'sentiment')!,
        allAnalysisDefinitions.find(d => d.type === 'escalation')!,
      ].filter(Boolean);

      const schema = executor.buildBatchedSchema(definitions);
      
      expect(schema).toBeDefined();
      // Schema should be a Zod object schema
      expect(typeof schema.parse).toBe('function');
    });
  });

  describe('buildBatchedPrompt', () => {
    it('should combine module instructions and email context', () => {
      const definitions = [
        allAnalysisDefinitions.find(d => d.type === 'sentiment')!,
      ].filter(Boolean);

      const prompt = executor.buildBatchedPrompt(definitions, mockEmail);
      
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('Sentiment Analysis');
      expect(prompt).toContain(mockEmail.subject);
      expect(prompt).toContain(mockEmail.body);
    });

    it('should include thread context when provided', () => {
      const definitions = [
        allAnalysisDefinitions.find(d => d.type === 'sentiment')!,
      ].filter(Boolean);

      const threadContext = {
        threadContext: 'Previous thread messages...',
      };

      const prompt = executor.buildBatchedPrompt(definitions, mockEmail, threadContext);
      
      expect(prompt).toContain('Thread Context');
      expect(prompt).toContain('Previous thread messages');
    });
  });

  describe('executeSingle', () => {
    it('should execute single analysis', async () => {
      const result = await executor.executeSingle(
        'sentiment',
        mockEmail,
        'test-tenant',
        mockConfig
      );

      expect(result.type).toBe('sentiment');
      expect(result.result).toBeDefined();
      expect(result.modelUsed).toBeDefined();
      expect(mockAIService.generateStructuredOutput).toHaveBeenCalled();
    });

    it('should throw error if definition not found', async () => {
      await expect(
        executor.executeSingle('unknown' as AnalysisType, mockEmail, 'test-tenant', mockConfig)
      ).rejects.toThrow();
    });
  });

  describe('executeBatch', () => {
    it('should execute batch of analyses', async () => {
      const types: AnalysisType[] = ['sentiment'];
      
      const results = await executor.executeBatch(types, mockEmail, 'test-tenant', mockConfig);
      
      expect(results.size).toBeGreaterThan(0);
      expect(results.has('sentiment')).toBe(true);
    });

    it('should execute all analyses regardless of thread context', async () => {
      const types: AnalysisType[] = ['sentiment', 'escalation'];
      
      const results = await executor.executeBatch(types, mockEmail, 'test-tenant', mockConfig);
      
      // All analyses should run regardless of thread context
      expect(results.has('sentiment')).toBe(true);
      expect(results.has('escalation')).toBe(true);
    });

    it('should execute analyses even without thread context', async () => {
      const types: AnalysisType[] = ['escalation', 'churn'];
      
      const results = await executor.executeBatch(types, mockEmail, 'test-tenant', mockConfig);
      
      // Analyses should run even without thread context
      expect(results.size).toBeGreaterThan(0);
    });
  });
});

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../prompt-builder';
import { sentimentAnalysisDefinition, escalationAnalysisDefinition } from '../../analyses/definitions';
import type { Email } from '@crm/shared';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  const mockEmail: Email = {
    provider: 'gmail',
    messageId: 'test-email-123',
    threadId: 'test-thread-456',
    subject: 'Test Email Subject',
    body: 'This is a test email body with some content.',
    from: {
      email: 'sender@example.com',
      name: 'Test Sender',
    },
    tos: [{ email: 'recipient@example.com' }],
    ccs: [],
    bccs: [],
    receivedAt: new Date(),
  };

  describe('buildPromptSections', () => {
    it('should build prompt sections with cache markers', () => {
      const definitions = [sentimentAnalysisDefinition, escalationAnalysisDefinition];
      const sections = builder.buildPromptSections(definitions, mockEmail);

      expect(sections.length).toBeGreaterThan(0);
      
      // First section should be cacheable (instructions)
      expect(sections[0].cacheable).toBe(true);
      expect(sections[0].cacheKey).toBeDefined();
      
      // Email section should not be cacheable
      const emailSection = sections.find(s => s.content.includes('Email Subject'));
      expect(emailSection?.cacheable).toBe(false);
    });

    it('should include thread context when provided', () => {
      const definitions = [sentimentAnalysisDefinition];
      const threadContext = {
        threadContext: 'Previous email in thread...',
      };
      
      const sections = builder.buildPromptSections(definitions, mockEmail, threadContext);
      
      const threadSection = sections.find(s => s.content.includes('Thread Context'));
      expect(threadSection).toBeDefined();
      expect(threadSection?.cacheable).toBe(true);
    });
  });

  describe('buildPrompt', () => {
    it('should combine sections into single prompt', () => {
      const definitions = [sentimentAnalysisDefinition];
      const sections = builder.buildPromptSections(definitions, mockEmail);
      const prompt = builder.buildPrompt(sections);

      expect(prompt).toContain('Sentiment Analysis');
      expect(prompt).toContain('Email Subject');
      expect(prompt).toContain(mockEmail.subject);
    });
  });

  describe('buildPromptMessages', () => {
    it('should build PromptMessage array', () => {
      const definitions = [sentimentAnalysisDefinition];
      const sections = builder.buildPromptSections(definitions, mockEmail);
      const messages = builder.buildPromptMessages(sections);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toHaveProperty('role');
      expect(messages[0]).toHaveProperty('content');
    });

    it('should separate cacheable and dynamic content', () => {
      const definitions = [sentimentAnalysisDefinition];
      const sections = builder.buildPromptSections(definitions, mockEmail);
      const messages = builder.buildPromptMessages(sections);

      // Should have system message for cacheable content
      const systemMessage = messages.find(m => m.role === 'system');
      expect(systemMessage).toBeDefined();
      
      // Should have user message for dynamic content
      const userMessage = messages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
    });
  });

  describe('buildCacheKey', () => {
    it('should build cache key from definitions and IDs', () => {
      const definitions = [sentimentAnalysisDefinition, escalationAnalysisDefinition];
      const cacheKey = builder.buildCacheKey(definitions, 'email-123', 'thread-456');

      expect(cacheKey).toContain('sentiment');
      expect(cacheKey).toContain('escalation');
      expect(cacheKey).toContain('email-123');
      expect(cacheKey).toContain('thread-456');
    });

    it('should handle missing IDs', () => {
      const definitions = [sentimentAnalysisDefinition];
      const cacheKey = builder.buildCacheKey(definitions);

      expect(cacheKey).toContain('sentiment');
      expect(cacheKey).toContain('no-email');
      expect(cacheKey).toContain('no-thread');
    });
  });
});

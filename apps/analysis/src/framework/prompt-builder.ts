import type { Email } from '@crm/shared';
import type { AnalysisDefinition, ThreadContext } from './types';
import type { PromptMessage } from '../services/ai-types';

/**
 * Cache marker interface for prompt sections
 * Used to identify which parts of prompts can be cached
 */
export interface CacheMarker {
  type: 'static' | 'dynamic' | 'email' | 'thread';
  content: string;
  cacheKey?: string;
}

/**
 * Prompt section with cache information
 */
export interface PromptSection {
  content: string;
  cacheable: boolean;
  cacheKey?: string;
}

/**
 * Prompt builder with caching support
 * Similar to email-analyzer's approach for cache-optimized prompts
 */
export class PromptBuilder {
  /**
   * Build prompt sections with cache markers
   * Identifies which parts can be cached for Vercel AI SDK
   */
  buildPromptSections(
    definitions: AnalysisDefinition[],
    email: Email,
    threadContext?: ThreadContext
  ): PromptSection[] {
    const sections: PromptSection[] = [];

    // Section 1: Static instructions (cacheable)
    const instructions = definitions
      .map((def) => `## ${def.name}\n${def.module.instructions}`)
      .join('\n\n');

    sections.push({
      content: instructions,
      cacheable: true,
      cacheKey: `instructions-${definitions.map(d => d.type).sort().join('-')}`,
    });

    // Section 2: Email content (partially cacheable - subject is static, body might change)
    const emailSection = this.buildEmailSection(email);
    sections.push({
      content: emailSection,
      cacheable: false, // Email content is dynamic
    });

    // Section 3: Thread context (cacheable if thread hasn't changed)
    if (threadContext?.threadContext) {
      sections.push({
        content: `\n\nThread Context:\n${threadContext.threadContext}`,
        cacheable: true,
        cacheKey: `thread-${threadContext.threadContext.substring(0, 50)}`, // Use hash in production
      });
    }

    return sections;
  }

  /**
   * Build complete prompt from sections
   */
  buildPrompt(sections: PromptSection[]): string {
    return sections.map((s) => s.content).join('\n\n');
  }

  /**
   * Build prompt as PromptMessage[] for Vercel AI SDK
   * Includes cache control hints
   */
  buildPromptMessages(
    sections: PromptSection[]
  ): PromptMessage[] {
    const messages: PromptMessage[] = [];

    // Combine cacheable sections
    const cacheableContent: string[] = [];
    const dynamicContent: string[] = [];

    for (const section of sections) {
      if (section.cacheable) {
        cacheableContent.push(section.content);
      } else {
        dynamicContent.push(section.content);
      }
    }

    // System message with cacheable instructions
    if (cacheableContent.length > 0) {
      messages.push({
        role: 'system',
        content: cacheableContent.join('\n\n'),
      });
    }

    // User message with dynamic content
    if (dynamicContent.length > 0) {
      messages.push({
        role: 'user',
        content: dynamicContent.join('\n\n'),
      });
    } else if (cacheableContent.length > 0) {
      // If all content is cacheable, still need a user message
      messages.push({
        role: 'user',
        content: 'Please analyze the email.',
      });
    }

    return messages;
  }

  /**
   * Build email section
   */
  private buildEmailSection(email: Email): string {
    let section = `Email Subject: ${email.subject}\n\n`;
    section += `Email Body:\n${email.body || ''}`;
    return section;
  }

  /**
   * Build cache key for prompt sections
   * Used to identify identical prompts for caching
   */
  buildCacheKey(
    definitions: AnalysisDefinition[],
    emailId?: string,
    threadId?: string
  ): string {
    const parts = [
      definitions.map((d) => d.type).sort().join('-'),
      emailId || 'no-email',
      threadId || 'no-thread',
    ];
    return parts.join('::');
  }
}

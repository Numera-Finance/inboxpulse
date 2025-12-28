/**
 * Filesystem-based template provider
 * Loads templates from filesystem
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { TemplateProvider, Template, TemplateRenderResult, RenderOptions, RenderedContent } from '../../types/interfaces';
import type { NotificationChannel } from '../../types/core';

export interface FilesystemTemplateProviderOptions {
  basePath: string;
}

export class FilesystemTemplateProvider implements TemplateProvider {
  constructor(private options: FilesystemTemplateProviderOptions) {}

  async getTemplate(
    typeId: string,
    channel: NotificationChannel,
    locale?: string
  ): Promise<Template | null> {
    try {
      // Try locale-specific template first
      if (locale) {
        const localePath = this.resolveTemplatePath(typeId, channel, locale);
        const template = await this.loadTemplate(localePath);
        if (template) return template;
      }
      
      // Fall back to default template
      const defaultPath = this.resolveTemplatePath(typeId, channel, 'default');
      return await this.loadTemplate(defaultPath);
    } catch (error) {
      return null;
    }
  }

  async renderTemplate(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<TemplateRenderResult> {
    try {
      // Check data access if checker provided
      if (options?.dataAccessChecker && options.userId && options.tenantId) {
        const hasAccess = await options.dataAccessChecker({
          notificationType: template.typeId,
          data,
        });
        
        if (!hasAccess) {
          return {
            hasContent: false,
            reason: 'no_data_access',
          };
        }
      }
      
      // Render template based on channel
      const content = await this.render(template, data, options);
      
      // Check if content is empty
      if (!content || (content.html && content.html.trim() === '')) {
        return {
          hasContent: false,
          reason: 'empty_content',
        };
      }
      
      return {
        hasContent: true,
        content,
      };
    } catch (error: any) {
      return {
        hasContent: false,
        reason: 'template_error',
        error: error.message,
      };
    }
  }

  async getFallbackTemplate(channel: NotificationChannel): Promise<Template | null> {
    try {
      const fallbackPath = join(this.options.basePath, 'default', channel, 'default.tsx');
      return await this.loadTemplate(fallbackPath);
    } catch {
      return null;
    }
  }

  async templateExists(typeId: string, channel: NotificationChannel): Promise<boolean> {
    try {
      const path = this.resolveTemplatePath(typeId, channel, 'default');
      await readFile(path, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private resolveTemplatePath(
    typeId: string,
    channel: NotificationChannel,
    locale: string
  ): string {
    // Convert typeId to path (e.g., "escalation_alert" -> "escalation-alert")
    const typePath = typeId.replace(/_/g, '-');
    const extension = channel === 'email' ? 'tsx' : channel === 'slack' || channel === 'gchat' ? 'json' : 'txt';
    return join(this.options.basePath, typePath, channel, `${locale}.${extension}`);
  }

  private async loadTemplate(path: string): Promise<Template | null> {
    try {
      const content = await readFile(path, 'utf-8');
      // For now, return raw content - actual template compilation happens in render
      return {
        id: path,
        typeId: '', // Will be set by caller
        channel: 'email' as NotificationChannel, // Will be set by caller
        content,
        version: 1,
        variables: [], // Extract from template if needed
      };
    } catch {
      return null;
    }
  }

  private async render(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<RenderedContent> {
    // Template rendering logic
    // For email: compile React component to HTML
    // For Slack: compile JSON template with variable substitution
    // For SMS: simple text substitution
    
    // Placeholder - actual implementation will use react-email, etc.
    return {
      html: '<html><body>Template rendered</body></html>',
      text: 'Template rendered',
    };
  }
}

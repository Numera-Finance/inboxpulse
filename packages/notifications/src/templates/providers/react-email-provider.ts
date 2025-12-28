/**
 * React Email Template Provider
 *
 * Renders email templates using react-email
 * Templates are React components that compile to HTML
 */

import type {
  TemplateProvider,
  Template,
  TemplateRenderResult,
  RenderOptions,
  RenderedContent,
} from '../../types/interfaces';
import type { NotificationChannel } from '../../types/core';

export interface ReactEmailTemplate {
  /** Template ID (matches notification type ID) */
  id: string;
  /** React component that renders the email */
  component: React.ComponentType<any>;
  /** Subject line template (can include {{variables}}) */
  subject: string;
  /** Supported locales */
  locales?: string[];
}

export interface ReactEmailProviderConfig {
  /** Registered templates by typeId */
  templates: Map<string, ReactEmailTemplate>;
  /** Default locale */
  defaultLocale?: string;
  /** Fallback template for missing types */
  fallbackTemplate?: ReactEmailTemplate;
}

export class ReactEmailTemplateProvider implements TemplateProvider {
  private templates: Map<string, ReactEmailTemplate>;
  private defaultLocale: string;
  private fallbackTemplate?: ReactEmailTemplate;
  private renderFn: ((component: React.ReactElement) => Promise<string>) | null = null;

  constructor(config: ReactEmailProviderConfig) {
    this.templates = config.templates;
    this.defaultLocale = config.defaultLocale || 'en';
    this.fallbackTemplate = config.fallbackTemplate;
  }

  /**
   * Lazily load react-email render function
   */
  private async getRenderFn(): Promise<(component: React.ReactElement) => Promise<string>> {
    if (!this.renderFn) {
      const { render } = await import('@react-email/render');
      this.renderFn = render;
    }
    return this.renderFn;
  }

  async getTemplate(
    typeId: string,
    channel: NotificationChannel,
    locale?: string
  ): Promise<Template | null> {
    // Only handle email channel
    if (channel !== 'email') {
      return null;
    }

    const template = this.templates.get(typeId);
    if (!template) {
      return null;
    }

    return {
      id: template.id,
      typeId,
      channel: 'email',
      locale: locale || this.defaultLocale,
      content: template.subject, // Subject template
      version: 1,
      variables: this.extractVariables(template.subject),
    };
  }

  async renderTemplate(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<TemplateRenderResult> {
    try {
      const registeredTemplate = this.templates.get(template.typeId);
      if (!registeredTemplate) {
        return {
          hasContent: false,
          reason: 'template_error',
          error: `Template not found: ${template.typeId}`,
        };
      }

      // Check data access if checker provided
      if (options?.dataAccessChecker) {
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

      // Load additional data if dataLoader provided
      let enrichedData = { ...data };
      if (options?.dataLoader) {
        // Allow templates to request additional data
        const additionalData = await this.loadAdditionalData(data, options.dataLoader);
        enrichedData = { ...enrichedData, ...additionalData };
      }

      // Render React component to HTML
      const render = await this.getRenderFn();
      const Component = registeredTemplate.component;
      // Use React.createElement to handle both function and class components
      const { createElement } = await import('react');
      const element = createElement(Component, enrichedData);
      const html = await render(element);

      // Generate plain text version (strip HTML)
      const text = this.htmlToText(html);

      // Interpolate subject
      const subject = this.interpolate(registeredTemplate.subject, enrichedData);

      return {
        hasContent: true,
        content: {
          html,
          text,
          subject,
        },
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
    if (channel !== 'email' || !this.fallbackTemplate) {
      return null;
    }

    return {
      id: 'fallback',
      typeId: 'fallback',
      channel: 'email',
      content: this.fallbackTemplate.subject,
      version: 1,
      variables: [],
    };
  }

  async templateExists(typeId: string, channel: NotificationChannel): Promise<boolean> {
    if (channel !== 'email') {
      return false;
    }
    return this.templates.has(typeId);
  }

  /**
   * Register a template
   */
  registerTemplate(template: ReactEmailTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Extract {{variables}} from template string
   */
  private extractVariables(template: string): string[] {
    const matches = template.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return matches.map(m => m.replace(/\{\{|\}\}/g, ''));
  }

  /**
   * Interpolate {{variables}} in string
   */
  private interpolate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(data[key] || '');
    });
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    return html
      // Remove style and script tags
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      // Replace common block elements with newlines
      .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
      // Remove all other HTML tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      // Clean up whitespace
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Load additional data for template
   */
  private async loadAdditionalData(
    data: Record<string, unknown>,
    dataLoader: (key: string) => Promise<unknown>
  ): Promise<Record<string, unknown>> {
    // Templates can specify data keys they need
    // For now, return empty - extend based on template requirements
    return {};
  }
}

/**
 * Create a simple template provider with inline templates
 */
export function createReactEmailProvider(
  templates: ReactEmailTemplate[]
): ReactEmailTemplateProvider {
  const templateMap = new Map<string, ReactEmailTemplate>();
  for (const template of templates) {
    templateMap.set(template.id, template);
  }
  return new ReactEmailTemplateProvider({ templates: templateMap });
}

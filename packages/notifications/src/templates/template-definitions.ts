/**
 * Notification Template Definitions
 *
 * Templates are defined in their respective class files and register themselves here.
 * This provides a central registry while keeping config colocated with implementation.
 */

import { z } from 'zod';

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Batch interval uses cron expressions for maximum flexibility.
 *
 * Common cron expressions:
 * - `0 8 * * *`     - Daily at 8:00 AM
 * - `0 8,20 * * *`  - Twice daily at 8:00 AM and 8:00 PM
 * - `0 *\/4 * * *`  - Every 4 hours (at minute 0)
 * - `0 *\/8 * * *`  - Every 8 hours (at minute 0)
 * - `0 9 * * 1-5`   - Weekdays at 9:00 AM
 *
 * Format: minute hour day-of-month month day-of-week
 */
export const templateBatchIntervalSchema = z.object({
  cron: z.string().min(9).max(100), // Cron expression (e.g., '0 8 * * *')
  timezone: z.string().optional(), // Override user's timezone for this schedule
});

export type TemplateBatchInterval = z.infer<typeof templateBatchIntervalSchema>;

/**
 * Helper to create common batch intervals
 */
export const BATCH_INTERVALS = {
  /** Daily at 8:00 AM in user's timezone */
  DAILY_8AM: { cron: '0 8 * * *' },
  /** Every 4 hours at minute 0 */
  EVERY_4_HOURS: { cron: '0 */4 * * *' },
  /** Every 8 hours at minute 0 */
  EVERY_8_HOURS: { cron: '0 */8 * * *' },
  /** Weekdays at 9:00 AM */
  WEEKDAYS_9AM: { cron: '0 9 * * 1-5' },
} as const;

export const templateDefinitionSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  category: z.enum(['tasks', 'escalations', 'deals', 'system']),
  defaultEnabled: z.boolean(),
  defaultFrequency: z.enum(['immediate', 'batched']),
  defaultChannels: z.array(z.enum(['email', 'sms', 'in_app', 'push'])),
  defaultBatchInterval: z.union([templateBatchIntervalSchema, z.null()]),
  // Whether this template supports batch sending
  isBatchTemplate: z.boolean(),
});

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

// =============================================================================
// Template Registry
// =============================================================================

/**
 * Central registry of all notification templates.
 * Templates register themselves when imported.
 */
const templateRegistry = new Map<string, TemplateDefinition>();

/**
 * Register a template definition.
 * Called by template classes to register their definitions.
 */
export function registerTemplate(definition: TemplateDefinition): void {
  if (templateRegistry.has(definition.name)) {
    console.warn(`Template '${definition.name}' is already registered. Overwriting.`);
  }
  // Validate the definition
  templateDefinitionSchema.parse(definition);
  templateRegistry.set(definition.name, definition);
}

/**
 * Get all registered template definitions
 */
export function getAllTemplates(): TemplateDefinition[] {
  return Array.from(templateRegistry.values());
}

/**
 * Get a template definition by name
 */
export function getTemplate(name: string): TemplateDefinition | undefined {
  return templateRegistry.get(name);
}

/**
 * Get all batch template names
 */
export function getBatchTemplateNames(): string[] {
  return Array.from(templateRegistry.values())
    .filter(t => t.isBatchTemplate)
    .map(t => t.name);
}

/**
 * Check if a template exists
 */
export function templateExists(name: string): boolean {
  return templateRegistry.has(name);
}

/**
 * Get the template registry (for testing/debugging)
 */
export function getTemplateRegistry(): ReadonlyMap<string, TemplateDefinition> {
  return templateRegistry;
}

/**
 * Clear the template registry (for testing only)
 */
export function clearTemplateRegistry(): void {
  templateRegistry.clear();
}

// =============================================================================
// Backwards Compatibility - NOTIFICATION_TEMPLATES object
// =============================================================================

/**
 * @deprecated Use getAllTemplates() or getTemplate() instead.
 * This object is populated lazily from the registry for backwards compatibility.
 */
export const NOTIFICATION_TEMPLATES: Record<string, TemplateDefinition> = new Proxy(
  {} as Record<string, TemplateDefinition>,
  {
    get(_target, prop: string) {
      return templateRegistry.get(prop);
    },
    has(_target, prop: string) {
      return templateRegistry.has(prop);
    },
    ownKeys() {
      return Array.from(templateRegistry.keys());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (templateRegistry.has(prop)) {
        return {
          enumerable: true,
          configurable: true,
          value: templateRegistry.get(prop),
        };
      }
      return undefined;
    },
  }
);

/**
 * Template Registration Entry Point
 *
 * Import this module to register all notification templates.
 * Templates are auto-registered when imported/instantiated.
 */

// Import batch templates (registration happens on instantiation via singleton export)
export * from './batch';

// Import immediate templates (registration happens on import)
export * from './immediate';

// Re-export email templates
export * from './emails';

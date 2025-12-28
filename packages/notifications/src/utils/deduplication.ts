/**
 * Event deduplication utilities
 */

import { createHash } from 'crypto';
import type { DeduplicationConfig } from '../types/core';

/**
 * Calculate event key hash from metadata fields
 */
export function calculateEventKey(
  metadata: Record<string, unknown>,
  eventKeyFields: string[]
): string {
  const values = eventKeyFields
    .map(field => {
      const value = metadata[field];
      return value ? String(value) : '';
    })
    .filter(Boolean)
    .join('|');
  
  return createHash('sha256').update(values).digest('hex');
}

/**
 * Check if event should be deduplicated based on config
 */
export function shouldDeduplicate(
  config: DeduplicationConfig,
  existingEventKey: string | null,
  newEventKey: string,
  existingCreatedAt: Date,
  updateWindowMinutes: number
): 'overwrite' | 'create_new' | 'ignore' {
  if (!existingEventKey || existingEventKey !== newEventKey) {
    return 'create_new';
  }
  
  // Check if within update window
  const now = new Date();
  const windowMs = updateWindowMinutes * 60 * 1000;
  const isWithinWindow = (now.getTime() - existingCreatedAt.getTime()) <= windowMs;
  
  if (!isWithinWindow) {
    return 'create_new'; // Outside window, create new
  }
  
  return config.strategy;
}

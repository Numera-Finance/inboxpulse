import {
  SQL,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { SearchOperator, ValidationError } from '@crm/shared';

/**
 * Coerce a string value to a Date if it looks like an ISO date string.
 * Drizzle timestamp columns call .toISOString() on values, so raw strings
 * passed from API search queries need conversion to Date objects.
 */
function coerceDate(value: unknown): number | Date {
  if (typeof value === 'string' && !isNaN(Date.parse(value))) {
    return new Date(value);
  }
  return value as number | Date;
}

/**
 * Escape special LIKE/ILIKE characters in user input.
 * Treats % and _ as literal characters, not wildcards.
 * Then wraps with % for "contains" search.
 */
export function escapeLikePattern(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}

/**
 * Build a SQL condition for a single search query.
 *
 * @param column - The database column to apply the condition to
 * @param operator - The search operator (from SearchOperator enum or string)
 * @param value - The value to compare against
 * @returns SQL condition or undefined if condition cannot be built
 */
export function buildCondition(
  column: PgColumn,
  operator: string,
  value: unknown
): SQL | undefined {
  switch (operator) {
    case SearchOperator.EQUALS:
    case 'eq':
      return eq(column, value);

    case SearchOperator.NOT_EQUALS:
    case 'ne':
      return ne(column, value);

    case SearchOperator.GREATER_THAN:
    case 'gt':
      return gt(column, coerceDate(value));

    case SearchOperator.GREATER_THAN_OR_EQUAL:
    case 'gte':
      return gte(column, coerceDate(value));

    case SearchOperator.LESS_THAN:
    case 'lt':
      return lt(column, coerceDate(value));

    case SearchOperator.LESS_THAN_OR_EQUAL:
    case 'lte':
      return lte(column, coerceDate(value));

    case SearchOperator.LIKE:
    case 'like':
      if (typeof value !== 'string') {
        throw new ValidationError('LIKE operator requires string value');
      }
      return like(column, escapeLikePattern(value));

    case SearchOperator.ILIKE:
    case 'ilike':
      if (typeof value !== 'string') {
        throw new ValidationError('ILIKE operator requires string value');
      }
      return ilike(column, escapeLikePattern(value));

    case SearchOperator.IN:
    case 'in':
      return Array.isArray(value) && value.length > 0
        ? inArray(column, value)
        : undefined;

    case SearchOperator.NOT_IN:
    case 'notIn':
      return Array.isArray(value) && value.length > 0
        ? notInArray(column, value)
        : undefined;

    case 'isNull':
      return isNull(column);

    case 'isNotNull':
      return isNotNull(column);

    default:
      throw new ValidationError(`Unknown operator: ${operator}`);
  }
}

import { and, eq, ne, gt, gte, lt, lte, like, inArray, notInArray, SQL, sql } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import type { SearchQuery } from './types';
import { SearchOperator } from './types';

/**
 * Convert search query to Drizzle SQL condition
 * 
 * @param column - Drizzle column to apply condition to
 * @param query - Search query with operator and value
 * @returns SQL condition or null if operator not supported
 */
export function buildSearchCondition<T extends PgColumn>(
  column: T,
  query: SearchQuery
): SQL | null {
  const { operator, value } = query;

  switch (operator) {
    case SearchOperator.EQUALS:
      return eq(column, value as any);
    
    case SearchOperator.NOT_EQUALS:
      return ne(column, value as any);
    
    case SearchOperator.GREATER_THAN:
      return gt(column, value as any);
    
    case SearchOperator.GREATER_THAN_OR_EQUAL:
      return gte(column, value as any);
    
    case SearchOperator.LESS_THAN:
      return lt(column, value as any);
    
    case SearchOperator.LESS_THAN_OR_EQUAL:
      return lte(column, value as any);
    
    case SearchOperator.LIKE:
      if (typeof value !== 'string') {
        throw new Error(`LIKE operator requires string value, got ${typeof value}`);
      }
      return like(column, value);
    
    case SearchOperator.IN:
      if (!Array.isArray(value)) {
        throw new Error(`IN operator requires array value, got ${typeof value}`);
      }
      return inArray(column, value as any[]);
    
    case SearchOperator.NOT_IN:
      if (!Array.isArray(value)) {
        throw new Error(`NOT_IN operator requires array value, got ${typeof value}`);
      }
      return notInArray(column, value as any[]);
    
    default:
      return null;
  }
}

/**
 * Build multiple search conditions combined with AND
 * 
 * @param conditions - Array of SQL conditions
 * @returns Combined condition using AND
 */
export function combineSearchConditions(conditions: (SQL | null)[]): SQL | null {
  const validConditions = conditions.filter((c): c is SQL => c !== null);
  
  if (validConditions.length === 0) {
    return null;
  }
  
  if (validConditions.length === 1) {
    return validConditions[0];
  }
  
  return and(...validConditions) || null;
}

/**
 * Field mapping utility for search queries
 * Maps API field names to database column names
 */
export type FieldMapping = Record<string, PgColumn>;

/**
 * Build search conditions from queries using field mapping
 * 
 * @param queries - Array of search queries
 * @param fieldMapping - Map of field names to database columns
 * @returns Combined SQL condition
 */
export function buildSearchConditions(
  queries: SearchQuery[],
  fieldMapping: FieldMapping
): SQL | null {
  const conditions = queries.map((query) => {
    const column = fieldMapping[query.field];
    if (!column) {
      throw new Error(`Unknown search field: ${query.field}`);
    }
    return buildSearchCondition(column, query);
  });
  
  return combineSearchConditions(conditions);
}

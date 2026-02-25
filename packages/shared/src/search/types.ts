import { z } from 'zod';

/**
 * Search operators for query building
 */
export enum SearchOperator {
  EQUALS = 'eq',
  NOT_EQUALS = 'ne',
  GREATER_THAN = 'gt',
  GREATER_THAN_OR_EQUAL = 'gte',
  LESS_THAN = 'lt',
  LESS_THAN_OR_EQUAL = 'lte',
  /** Case-sensitive contains search. User input is escaped and wrapped with %. */
  LIKE = 'like',
  /** Case-insensitive contains search. User input is escaped and wrapped with %. */
  ILIKE = 'ilike',
  IN = 'in',
  NOT_IN = 'notIn',
}

/**
 * Single search query condition
 */
export const searchQuerySchema = z.object({
  field: z.string().min(1),
  operator: z.nativeEnum(SearchOperator),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ]),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * Search request with pagination and sorting
 */
export const searchRequestSchema = z.object({
  queries: z.array(searchQuerySchema).max(20).default([]),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  limit: z.number().int().min(1).max(2000).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  /** Optional list of related data to include (e.g., 'emailCount', 'contactCount') */
  include: z.array(z.string()).optional(),
  /** Optional ISO date string for filtering results from this date */
  dateFrom: z.string().optional(),
  /** Optional ISO date string for filtering results up to this date */
  dateTo: z.string().optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

/**
 * Search response with pagination metadata
 */
export const searchResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
  });

export type SearchResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

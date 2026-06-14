/**
 * Row status values used across entities (users, customers, etc.)
 * Mirrors the smallint column `row_status` in DB tables.
 */
export const RowStatus = {
  ACTIVE: 0,
  INACTIVE: 1,
  ARCHIVED: 2,
} as const;

export type RowStatusValue = (typeof RowStatus)[keyof typeof RowStatus];

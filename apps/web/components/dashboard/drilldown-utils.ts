import type { TileFilters } from "./tiles"

/**
 * Append the dashboard's from/to date range onto a drilldown path so the
 * destination page filters by the same range the dashboard tile counted.
 */
export function appendDateRange(path: string, filters?: TileFilters): string {
  if (!filters?.dateFrom && !filters?.dateTo) return path

  const [base, existing] = path.split("?")
  const params = new URLSearchParams(existing ?? "")

  if (filters.dateFrom) params.set("from", filters.dateFrom)
  if (filters.dateTo) params.set("to", filters.dateTo)

  return `${base}?${params.toString()}`
}

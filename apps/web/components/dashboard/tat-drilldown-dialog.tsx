"use client"

import * as React from "react"
import { Loader2, Clock, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
  InboxView,
  apiEmailToInboxItem,
  apiEmailToInboxContent,
  type InboxItem,
  type InboxFilter,
  type InboxPagination,
  type InboxPage,
  type InboxItemContent,
  type ApiEmailResponse,
} from "@/components/inbox"
import type { TATMetricRow } from "@/lib/api"
import type { TileFilters } from "./tiles"
import { getEmailsByCustomer } from "@/lib/api"
import type { EmailsByCustomerResponse } from "@/lib/api"
import { authService } from "@/lib/auth/auth-service"
import { cn } from "@/lib/utils"

interface TATDrilldownDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tatRow: TATMetricRow | null
  filters?: TileFilters
}

/**
 * Get severity level based on TAT breach counts
 */
function getSeverityLevel(row: TATMetricRow): "low" | "medium" | "high" | "critical" {
  if (row.sixPlusDays > 0) return "critical"
  if (row.fivePlusDays > 0) return "high"
  if (row.threePlusDays > 0) return "medium"
  return "low"
}

/**
 * Get severity badge variant
 */
function getSeverityBadge(severity: "low" | "medium" | "high" | "critical") {
  switch (severity) {
    case "critical":
      return { variant: "destructive" as const, label: "Critical" }
    case "high":
      return { variant: "destructive" as const, label: "High" }
    case "medium":
      return { variant: "secondary" as const, label: "Medium" }
    default:
      return { variant: "outline" as const, label: "Low" }
  }
}

export function TATDrilldownDialog({
  open,
  onOpenChange,
  tatRow,
  filters,
}: TATDrilldownDialogProps) {
  const tenantId = authService.getTenantId() || ""

  // Server-side pagination caches and in-flight tracking
  const pageCacheRef = React.useRef<Map<string, EmailsByCustomerResponse>>(new Map())
  const emailCacheRef = React.useRef<Map<string, ApiEmailResponse>>(new Map())
  const inFlightRef = React.useRef<Map<string, Promise<EmailsByCustomerResponse>>>(new Map())

  // Clear caches when tatRow or filters change
  React.useEffect(() => {
    pageCacheRef.current.clear()
    emailCacheRef.current.clear()
    inFlightRef.current.clear()
  }, [tatRow?.customerId, filters?.dateFrom, filters?.dateTo])

  // Cache key helper
  const getCacheKey = React.useCallback((filter: InboxFilter, page: number, limit: number) => {
    return `${page}_${limit}_${filter.query || ''}`;
  }, [])

  // Fetch 2 pages from API, deduplicating in-flight requests
  const fetchAndCachePages = React.useCallback(async (filter: InboxFilter, startPage: number, pageSize: number) => {
    const cacheKey = getCacheKey(filter, startPage, pageSize);
    const cached = pageCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const inFlight = inFlightRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const offset = (startPage - 1) * pageSize;
      const options: {
        limit: number;
        offset: number;
        tatViolation: boolean;
        dateFrom?: string;
        dateTo?: string;
        query?: string;
      } = {
        limit: pageSize * 2,
        offset,
        tatViolation: true,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
      };
      if (filter.query) options.query = filter.query;

      const result = await getEmailsByCustomer(tenantId, tatRow?.customerId || "", options);

      for (let i = 0; i < 2; i++) {
        const pageEmails = result.emails.slice(i * pageSize, (i + 1) * pageSize);
        if (pageEmails.length === 0) break;

        const pageNum = startPage + i;
        const pageOffset = offset + i * pageSize;
        const pageResult: EmailsByCustomerResponse = {
          emails: pageEmails,
          total: result.total,
          count: pageEmails.length,
          limit: pageSize,
          offset: pageOffset,
          hasMore: pageOffset + pageEmails.length < result.total,
        };

        pageCacheRef.current.set(getCacheKey(filter, pageNum, pageSize), pageResult);
        pageEmails.forEach(e => emailCacheRef.current.set(e.id, e));
      }

      return pageCacheRef.current.get(cacheKey)!;
    })();

    inFlightRef.current.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightRef.current.delete(cacheKey);
    }
  }, [tenantId, tatRow?.customerId, filters?.dateFrom, filters?.dateTo, getCacheKey])

  // Evict pages outside the 3-page window [current-1, current, current+1]
  const evictStalePages = React.useCallback((filter: InboxFilter, currentPage: number, limit: number) => {
    const keepPages = new Set([currentPage - 1, currentPage, currentPage + 1]);
    const keysToKeep = new Set(
      [...keepPages].filter(p => p >= 1).map(p => getCacheKey(filter, p, limit))
    );

    for (const key of pageCacheRef.current.keys()) {
      if (!keysToKeep.has(key)) {
        pageCacheRef.current.delete(key);
      }
    }

    emailCacheRef.current.clear();
    for (const pageResult of pageCacheRef.current.values()) {
      pageResult.emails.forEach(e => emailCacheRef.current.set(e.id, e));
    }
  }, [getCacheKey])

  // Email inbox callbacks for InboxView (server-side pagination)
  const emailCallbacks = React.useMemo(() => {
    if (!tatRow) return null

    return {
      onFetchItems: async (
        filter: InboxFilter,
        pagination: InboxPagination
      ): Promise<InboxPage<InboxItem>> => {
        const { page, limit } = pagination;
        const cacheKey = getCacheKey(filter, page, limit);
        let result = pageCacheRef.current.get(cacheKey);

        if (!result) {
          result = await fetchAndCachePages(filter, page, limit);
        }

        // Evict pages outside [page-1, page, page+1]
        evictStalePages(filter, page, limit);

        // Ensure next page is prefetched
        if (result.hasMore) {
          const nextKey = getCacheKey(filter, page + 1, limit);
          if (!pageCacheRef.current.has(nextKey)) {
            fetchAndCachePages(filter, page + 1, limit).catch(() => {});
          }
        }

        return {
          items: result.emails.map(apiEmailToInboxItem),
          total: result.total,
          page,
          limit,
          hasMore: result.hasMore,
        }
      },
      onFetchContent: async (itemId: string): Promise<InboxItemContent> => {
        const email = emailCacheRef.current.get(itemId)
        if (!email) {
          throw new Error(`Email not found: ${itemId}`)
        }
        return apiEmailToInboxContent(email)
      },
      onSelect: (_item: InboxItem) => {
        // No-op for now - could be extended to show email details
      },
    }
  }, [tatRow, fetchAndCachePages, getCacheKey, evictStalePages])

  if (!tatRow) return null

  const severity = getSeverityLevel(tatRow)
  const { variant, label } = getSeverityBadge(severity)
  // Sum all TAT buckets to get total breaches (each bucket is exclusive, not cumulative)
  const totalBreaches = tatRow.onePlusDays + tatRow.twoPlusDays + tatRow.threePlusDays + tatRow.fivePlusDays + tatRow.sixPlusDays

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[95vw] !max-w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-start justify-between pr-8">
            <DialogTitle className="text-xl">
              {tatRow.customerName}
            </DialogTitle>
            <Badge variant={variant} className="ml-4">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {label}
            </Badge>
          </div>
        </DialogHeader>

        {/* TAT Summary Stats */}
        <div className="px-6 py-3 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">SLA Breach Summary</span>
            <span className="text-sm text-muted-foreground">
              ({totalBreaches} total breaches)
            </span>
          </div>
          <div className="flex gap-4 text-sm">
            <StatBadge label="1+ Days" count={tatRow.onePlusDays} threshold={1} />
            <StatBadge label="2+ Days" count={tatRow.twoPlusDays} threshold={2} />
            <StatBadge label="3+ Days" count={tatRow.threePlusDays} threshold={3} />
            <StatBadge label="5+ Days" count={tatRow.fivePlusDays} threshold={5} />
            <StatBadge label="6+ Days" count={tatRow.sixPlusDays} threshold={6} />
          </div>
        </div>

        {/* Email List */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {emailCallbacks ? (
            <InboxView
              key={`tat-inbox-${tatRow.customerId}`}
              className="h-full"
              config={{
                itemType: "email",
                showSearch: true,
                showThreadCount: true,
                showSentimentFilter: false,
                searchPlaceholder: "Search emails...",
                emptyMessage: "No emails found for this customer",
                listPanelWidth: "350px",
                embedded: true,
              }}
              callbacks={emailCallbacks}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No emails available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Stat badge component for TAT summary
 */
function StatBadge({
  label,
  count,
  threshold,
}: {
  label: string
  count: number
  threshold: number
}) {
  const getColor = () => {
    if (count === 0) return "text-muted-foreground bg-muted"
    if (threshold >= 6) return "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30"
    if (threshold >= 5) return "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20"
    if (threshold >= 3) return "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20"
    if (threshold >= 2) return "text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/20"
    return "text-yellow-500 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/20"
  }

  return (
    <div className={cn("px-2 py-1 rounded-md text-xs font-medium", getColor())}>
      {label}: <span className="font-bold">{count}</span>
    </div>
  )
}

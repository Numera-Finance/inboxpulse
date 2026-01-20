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
} from "@/components/inbox"
import type { TATMetricRow } from "@/lib/api"
import { useEmailsByCustomer } from "@/lib/hooks"
import { authService } from "@/lib/auth/auth-service"
import { cn } from "@/lib/utils"

interface TATDrilldownDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tatRow: TATMetricRow | null
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
}: TATDrilldownDialogProps) {
  const tenantId = authService.getTenantId() || ""

  // Fetch emails for customer with TAT violations only
  const {
    data: emailsData,
    isLoading: isLoadingEmails,
  } = useEmailsByCustomer(tenantId, tatRow?.customerId || "", { limit: 10000, tatViolation: true })

  // Get emails array with fallback
  const emails = React.useMemo(() => {
    return emailsData?.emails || []
  }, [emailsData])

  // Email inbox callbacks for InboxView (same pattern as CustomerDrawer)
  const emailCallbacks = React.useMemo(() => {
    if (!tatRow) return null

    return {
      onFetchItems: async (
        filter: InboxFilter,
        pagination: InboxPagination
      ): Promise<InboxPage<InboxItem>> => {
        let filteredEmails = [...emails]

        if (filter.query) {
          const query = filter.query.toLowerCase()
          filteredEmails = filteredEmails.filter(
            (email) =>
              email.fromEmail.toLowerCase().includes(query) ||
              (email.fromName?.toLowerCase().includes(query) ?? false) ||
              email.subject.toLowerCase().includes(query) ||
              (email.body?.toLowerCase().includes(query) ?? false)
          )
        }

        // Paginate
        const start = (pagination.page - 1) * pagination.limit
        const paginatedEmails = filteredEmails.slice(start, start + pagination.limit)

        return {
          items: paginatedEmails.map(apiEmailToInboxItem),
          total: filteredEmails.length,
          page: pagination.page,
          limit: pagination.limit,
          hasMore: start + pagination.limit < filteredEmails.length,
        }
      },
      onFetchContent: async (itemId: string): Promise<InboxItemContent> => {
        const email = emails.find((e) => e.id === itemId)
        if (!email) {
          throw new Error(`Email not found: ${itemId}`)
        }
        return apiEmailToInboxContent(email)
      },
      onSelect: (_item: InboxItem) => {
        // No-op for now - could be extended to show email details
      },
    }
  }, [tatRow, emails])

  if (!tatRow) return null

  const severity = getSeverityLevel(tatRow)
  const { variant, label } = getSeverityBadge(severity)
  const totalBreaches = tatRow.onePlusDays

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[95vw] !max-w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-start justify-between pr-8">
            <div className="space-y-1">
              <DialogTitle className="text-xl">
                {tatRow.customerName}
              </DialogTitle>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {tatRow.controllerName && (
                  <span>Controller: {tatRow.controllerName}</span>
                )}
                {!tatRow.controllerName && (
                  <span className="text-yellow-600">Unassigned</span>
                )}
              </div>
            </div>
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
          {isLoadingEmails ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : emailCallbacks ? (
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

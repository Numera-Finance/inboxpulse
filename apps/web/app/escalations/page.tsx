"use client"

import * as React from "react"
import { useSearchParams, useNavigate, useParams } from "react-router-dom"
import { Inbox, CheckCircle } from "lucide-react"
import { ClassificationIndicator } from "@/components/ui/classification-indicator"
import { Separator } from "@/components/ui/separator"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/ui/export-button"
import { createXlsxBlob } from "@/lib/utils/export"
import {
  InboxView,
  SignalFilter,
  analyzedEmailToInboxItem,
  analyzedEmailToInboxContent,
  type InboxItem,
  type InboxFilter,
  type InboxPagination,
  type InboxPage,
  type InboxItemContent,
  type InboxSentimentFilter,
} from "@/components/inbox"
import {
  TaskFilters,
  TaskComments,
  TaskMetaInfo,
  MarkDoneDialog,
  TaskResolutionInfo,
  type TaskFilter,
} from "@/components/tasks"
import {
  useMarkTaskDone,
  useCustomers,
  taskKeys,
} from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"
import type { AnalyzedEmail, AnalyzedEmailSearchRequest } from "@crm/clients"
import { Signal, hasSignal, SIGNAL_LABELS, type SignalType } from "@crm/shared"
import { useAuth } from "@/src/contexts/AuthContext"
import { getEmailClient, getTaskClient } from "@/lib/api/clients"

export default function EscalationsPage() {
  const navigate = useNavigate()
  const { taskId: emailIdFromUrl } = useParams<{ taskId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  // Get current user ID for "Me" filter
  const { user } = useAuth()
  const currentUserId = user?.id

  // Dialog state for mark done
  const [doneDialogTaskId, setDoneDialogTaskId] = React.useState<string | null>(null)

  // Get filter state from URL search params
  // Default to "all" if no status specified (since we now show all analyzed emails)
  const statusFromUrl = searchParams.get("status") as "open" | "done" | "all" | null
  const effectiveStatus = statusFromUrl || "open"
  const assignedFromUrl = searchParams.get("assigned")
  const customerIdFromUrl = searchParams.get("customer")
  const dateFromUrl = searchParams.get("dateFrom")
  const dateToUrl = searchParams.get("dateTo")
  const signalFromUrl = searchParams.get("signal") as TaskFilter['signal'] | null
  const effectiveSignal = signalFromUrl || 'negative'

  // Task filter state (synced with URL params)
  const taskFilters = React.useMemo<TaskFilter>(() => {
    const filters: TaskFilter = {
      status: effectiveStatus,
    }

    if (assignedFromUrl) {
      if (assignedFromUrl === "unassigned") {
        filters.assignedToId = "unassigned"
      } else if (assignedFromUrl === "me") {
        filters.assignedToId = "me"
      } else if (assignedFromUrl === "team") {
        filters.assignedToId = "my-team"
      } else {
        filters.assignedToId = assignedFromUrl
      }
    } else {
      filters.assignedToId = "all"
    }

    if (customerIdFromUrl) {
      filters.customerId = customerIdFromUrl
    }

    if (dateFromUrl) {
      filters.dateFrom = new Date(dateFromUrl)
    }

    if (dateToUrl) {
      filters.dateTo = new Date(dateToUrl)
    }

    if (effectiveSignal) {
      filters.signal = effectiveSignal
    }

    return filters
  }, [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, effectiveSignal])

  // Mutations
  const markDone = useMarkTaskDone()

  // Build search request from URL params
  const buildSearchRequest = React.useCallback(
    (filter: InboxFilter, pagination: InboxPagination): AnalyzedEmailSearchRequest => {
      const request: AnalyzedEmailSearchRequest = {
        sortBy: "receivedAt",
        sortOrder: "desc",
        limit: pagination.limit,
        offset: (pagination.page - 1) * pagination.limit,
      }

      if (filter.query) {
        request.search = filter.query
      }

      // Status filter
      if (effectiveStatus && effectiveStatus !== "all") {
        request.status = effectiveStatus
      }

      // Assignee filter
      if (assignedFromUrl && assignedFromUrl !== "all") {
        if (assignedFromUrl === "unassigned") {
          request.assignedToId = "unassigned"
        } else if (assignedFromUrl === "me") {
          request.assignedToId = currentUserId || undefined
        } else if (assignedFromUrl === "team") {
          // "My Team" - server will handle subordinates filtering
        } else {
          request.assignedToId = assignedFromUrl
        }
      }

      // Customer filter
      if (customerIdFromUrl) {
        request.customerId = customerIdFromUrl
      } else if (filter.customerId) {
        request.customerId = filter.customerId
      }

      // Date filters
      if (dateFromUrl) {
        const fromDate = new Date(dateFromUrl)
        fromDate.setUTCHours(0, 0, 0, 0)
        request.dateFrom = fromDate.toISOString()
      } else if (filter.dateFrom) {
        const fromDate = new Date(filter.dateFrom)
        fromDate.setUTCHours(0, 0, 0, 0)
        request.dateFrom = fromDate.toISOString()
      }

      if (dateToUrl) {
        const toDate = new Date(dateToUrl)
        toDate.setUTCHours(23, 59, 59, 999)
        request.dateTo = toDate.toISOString()
      } else if (filter.dateTo) {
        const toDate = new Date(filter.dateTo)
        toDate.setUTCHours(23, 59, 59, 999)
        request.dateTo = toDate.toISOString()
      }

      // Signal filter
      if (effectiveSignal) {
        request.signal = effectiveSignal
      }

      return request
    },
    [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, currentUserId, effectiveSignal]
  )

  // Fetch analyzed emails callback for InboxView
  const handleFetchItems = React.useCallback(
    async (
      filter: InboxFilter,
      pagination: InboxPagination
    ): Promise<InboxPage<InboxItem<AnalyzedEmail>>> => {
      const request = buildSearchRequest(filter, pagination)
      const emailClient = getEmailClient()
      const data = await emailClient.searchAnalyzed(request)

      return {
        items: data.items.map(analyzedEmailToInboxItem),
        total: data.total,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: data.total > pagination.page * pagination.limit,
      }
    },
    [buildSearchRequest]
  )

  // Fetch email content callback for InboxView
  const handleFetchContent = React.useCallback(
    async (itemId: string): Promise<InboxItemContent> => {
      const emailClient = getEmailClient()
      const email = await emailClient.getAnalyzedById(itemId)

      if (!email) {
        throw new Error("Failed to fetch email")
      }

      // Only fetch comments if the email has an associated task
      let comments = undefined
      if (email.taskId) {
        const taskClient = getTaskClient()
        comments = await taskClient.getComments(email.taskId)
      }

      return analyzedEmailToInboxContent(email, comments)
    },
    []
  )

  // Handle item selection - navigate to email URL
  const handleSelectItem = React.useCallback(
    (item: InboxItem<unknown>) => {
      const currentParams = searchParams.toString()
      const queryString = currentParams ? `?${currentParams}` : ""
      navigate(`/escalations/${item.id}${queryString}`)
    },
    [navigate, searchParams]
  )

  // Handle mark done with problem/resolution
  const handleResolve = React.useCallback(
    async (taskId: string, problem: string, resolution: string) => {
      await markDone.mutateAsync({ id: taskId, problem, resolution })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
    },
    [markDone, queryClient]
  )

  // Handle filter changes - sync to URL params
  const handleFiltersChange = React.useCallback((newFilters: TaskFilter) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)

      // Status
      if (newFilters.status) {
        params.set("status", newFilters.status)
      } else {
        params.set("status", "all")
      }

      // Assignee
      if (newFilters.assignedToId && newFilters.assignedToId !== 'all') {
        if (newFilters.assignedToId === 'me') {
          params.set("assigned", "me")
        } else if (newFilters.assignedToId === 'my-team') {
          params.set("assigned", "team")
        } else if (newFilters.assignedToId === 'unassigned') {
          params.set("assigned", "unassigned")
        } else {
          params.set("assigned", newFilters.assignedToId)
        }
      } else {
        params.delete("assigned")
      }

      // Customer
      if (newFilters.customerId) {
        params.set("customer", newFilters.customerId)
      } else {
        params.delete("customer")
      }

      // Date range
      if (newFilters.dateFrom) {
        params.set("dateFrom", newFilters.dateFrom.toISOString())
      } else {
        params.delete("dateFrom")
      }

      if (newFilters.dateTo) {
        params.set("dateTo", newFilters.dateTo.toISOString())
      } else {
        params.delete("dateTo")
      }

      // Signal
      if (newFilters.signal) {
        params.set("signal", newFilters.signal)
      } else {
        params.delete("signal")
      }

      return params
    })
  }, [setSearchParams])

  // Memoize callbacks to prevent InboxView re-renders
  const inboxCallbacks = React.useMemo(() => ({
    onFetchItems: handleFetchItems,
    onFetchContent: handleFetchContent,
    onSelect: handleSelectItem,
  }), [handleFetchItems, handleFetchContent, handleSelectItem])

  // Memoize config to prevent re-renders
  const inboxConfig = React.useMemo(() => ({
    itemType: "email" as const,
    showSearch: true,
    showStatusFilter: false,
    showCustomer: true,
    statusFilters: [
      { value: "all" as const, label: "All" },
      { value: "open" as const, label: "Open" },
      { value: "resolved" as const, label: "Done" },
    ],
    embedded: true,
    emptyMessage: "No analyzed emails found",
    searchPlaceholder: "Search emails...",
  }), [])

  // Memoize render functions to prevent re-renders
  // Show "Done" button only for negative sentiment emails with a task
  const renderHeaderActions = React.useCallback((item: InboxItem) => {
    const email = item.originalData as AnalyzedEmail
    const isNegative = hasSignal(email?.signals, Signal.SENTIMENT_NEGATIVE)
    const hasTask = email?.taskId !== null
    const showDone = isNegative && hasTask && item.status !== "resolved"
    if (!showDone) return null
    return (
      <Button
        className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-sm"
        onClick={() => {
          if (email?.taskId) setDoneDialogTaskId(email.taskId)
        }}
      >
        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
        Resolve
      </Button>
    )
  }, [])

  const renderMetaInfo = React.useCallback((item: InboxItem) => {
    const email = item.originalData as AnalyzedEmail
    const isNegative = hasSignal(email?.signals, Signal.SENTIMENT_NEGATIVE)
    const showTaskMeta = isNegative && email?.taskId
    if (!showTaskMeta) {
      // Not negative or no task - show minimal meta info (just customer and date)
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {item.customerName && (
            <>
              <span className="text-muted-foreground">Customer</span>
              <span>{item.customerName}</span>
            </>
          )}
          <span className="text-muted-foreground">Received</span>
          <span>{item.timestamp.toLocaleDateString()}</span>
        </div>
      )
    }
    return (
      <TaskMetaInfo
        taskId={email.taskId!}
        customerName={item.customerName}
        assigneeId={email.assignedToId || undefined}
        assigneeName={email.assignedToName || undefined}
        createdAt={item.timestamp}
      />
    )
  }, [])

  const renderHeaderBadges = React.useCallback((item: InboxItem) => {
    if (!item.classification || item.classification.value === 'business') return null
    return (
      <ClassificationIndicator classification={item.classification} size="sm" showLabel />
    )
  }, [])

  const renderSidePanel = React.useCallback((item: InboxItem) => {
    const email = item.originalData as AnalyzedEmail
    const isNegative = hasSignal(email?.signals, Signal.SENTIMENT_NEGATIVE)
    if (!isNegative || !email?.taskId) {
      // Not negative or no task - no side panel
      return null
    }
    return (
      <div className="space-y-4">
        <TaskResolutionInfo taskId={email.taskId} />
        <Separator />
        <TaskComments taskId={email.taskId} variant="panel" />
      </div>
    )
  }, [])

  // Get customer name for display
  const { data: customersData } = useCustomers({
    queries: [],
    sortBy: 'name',
    sortOrder: 'asc',
    limit: 1000,
    offset: 0,
  })

  const customerName = React.useMemo(() => {
    if (!customerIdFromUrl) return null
    const customer = customersData?.items?.find(c => c.id === customerIdFromUrl)
    return customer?.name || null
  }, [customerIdFromUrl, customersData])

  // Export analyzed emails with comments to Excel
  const handleExportEscalations = React.useCallback(async (): Promise<Blob> => {
    const emailClient = getEmailClient()

    // Build export request with current filters
    const exportRequest: AnalyzedEmailSearchRequest = {}

    if (effectiveStatus && effectiveStatus !== "all") {
      exportRequest.status = effectiveStatus
    }

    if (assignedFromUrl && assignedFromUrl !== "all") {
      if (assignedFromUrl === "unassigned") {
        exportRequest.assignedToId = "unassigned"
      } else if (assignedFromUrl === "me") {
        exportRequest.assignedToId = currentUserId || undefined
      } else if (assignedFromUrl !== "team") {
        exportRequest.assignedToId = assignedFromUrl
      }
    }

    if (customerIdFromUrl) {
      exportRequest.customerId = customerIdFromUrl
    }

    if (dateFromUrl) {
      const fromDate = new Date(dateFromUrl)
      fromDate.setUTCHours(0, 0, 0, 0)
      exportRequest.dateFrom = fromDate.toISOString()
    }

    if (dateToUrl) {
      const toDate = new Date(dateToUrl)
      toDate.setUTCHours(23, 59, 59, 999)
      exportRequest.dateTo = toDate.toISOString()
    }

    if (effectiveSignal) {
      exportRequest.signal = effectiveSignal
    }

    const analyzedEmails = await emailClient.exportAnalyzed(exportRequest)

    const exportData = analyzedEmails.map(email => ({
      customerName: email.customerName || "",
      emailSubject: email.subject || "",
      from: email.fromName || email.fromEmail || "",
      receivedAt: new Date(email.receivedAt).toLocaleDateString(),
      signals: (email.signals || [])
        .map(s => SIGNAL_LABELS[s as SignalType] || "")
        .filter(Boolean)
        .join(", "),
      status: email.taskId
        ? (email.taskStatus === 1 ? "Done" : "Open")
        : "\u2014",
      assignedTo: email.assignedToName || "",
      problem: email.problem || "",
      resolution: email.resolution || "",
      completedBy: email.completedByName || "",
      completedAt: email.completedAt
        ? new Date(email.completedAt).toLocaleDateString()
        : "",
      comments: (email.comments || [])
        .map(c => {
          const time = new Date(c.createdAt).toLocaleString()
          return `[${time} - ${c.userName}]: ${c.content}`
        })
        .join("\n"),
      bookKeeping: email.contactRoles?.bookKeeping || "",
      accountant: email.contactRoles?.accountant || "",
      controller: email.contactRoles?.controller || "",
      srController: email.contactRoles?.srController || "",
    }))

    return createXlsxBlob(exportData, {
      columns: [
        { key: "customerName", header: "Customer Name", width: 30 },
        { key: "emailSubject", header: "Email Subject", width: 50 },
        { key: "from", header: "From", width: 25 },
        { key: "receivedAt", header: "Received At", width: 15 },
        { key: "signals", header: "Signals", width: 30 },
        { key: "status", header: "Status", width: 10 },
        { key: "assignedTo", header: "Assigned To", width: 20 },
        { key: "problem", header: "Problem", width: 40 },
        { key: "resolution", header: "Resolution", width: 40 },
        { key: "completedBy", header: "Completed By", width: 20 },
        { key: "completedAt", header: "Completed At", width: 15 },
        { key: "comments", header: "Comments", width: 80 },
        { key: "bookKeeping", header: "Book Keeping", width: 20 },
        { key: "accountant", header: "Accountant", width: 20 },
        { key: "controller", header: "Controller", width: 20 },
        { key: "srController", header: "Sr Controller", width: 20 },
      ],
      sheetName: "AI Analysis",
    })
  }, [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, currentUserId, effectiveSignal])

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Page Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">AI Analysis</h1>
            </div>
            <ExportButton
              onExport={handleExportEscalations}
              filename="escalations.xlsx"
            />
          </div>
          <TaskFilters
            filters={taskFilters}
            onFiltersChange={handleFiltersChange}
            alwaysVisible={['status', 'assignee', 'customer', 'date']}
            currentUserId={currentUserId}
            customerName={customerName}
            afterStatus={
              <SignalFilter
                value={(effectiveSignal || 'all') as InboxSentimentFilter}
                onChange={(v) => handleFiltersChange({ ...taskFilters, signal: v === 'all' ? undefined : v as TaskFilter['signal'] })}
                excludeNeutral
              />
            }
          />
        </div>

        {/* Main Content - InboxView */}
        <div className="flex-1 overflow-hidden">
          <InboxView
            key={searchParams.toString()}
            config={inboxConfig}
            callbacks={inboxCallbacks}
            initialFilter={{
              status: effectiveStatus === 'all' ? 'all' : 'open',
            }}
            renderHeaderActions={renderHeaderActions}
            renderMetaInfo={renderMetaInfo}
            renderHeaderBadges={renderHeaderBadges}
            renderSidePanel={renderSidePanel}
          />
        </div>

        <MarkDoneDialog
          open={!!doneDialogTaskId}
          onClose={() => setDoneDialogTaskId(null)}
          onConfirm={async (problem, resolution) => {
            if (doneDialogTaskId) {
              await handleResolve(doneDialogTaskId, problem, resolution)
              setDoneDialogTaskId(null)
            }
          }}
          isLoading={markDone.isPending}
        />
      </div>
    </AppShell>
  )
}

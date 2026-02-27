"use client"

import * as React from "react"
import { useSearchParams, useNavigate, useParams } from "react-router-dom"
import { Inbox, CheckCircle } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/ui/export-button"
import { createXlsxBlob } from "@/lib/utils/export"
import {
  InboxView,
  SignalFilter,
  apiTaskToInboxItem,
  apiTaskToInboxContent,
  type InboxItem,
  type InboxFilter,
  type InboxPagination,
  type InboxPage,
  type InboxItemContent,
  type InboxSentimentFilter,
  type TaskWithComments,
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
  useTask,
  useMarkTaskDone,
  useCustomers,
  taskKeys,
} from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"
import type { Task, TaskSearchRequest, TaskExportRequest } from "@crm/clients"
import { useAuth } from "@/src/contexts/AuthContext"
import { getTaskClient } from "@/lib/api/clients"

export default function EscalationsPage() {
  const navigate = useNavigate()
  const { taskId: taskIdFromUrl } = useParams<{ taskId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  // Get current user ID for "Me" filter
  const { user } = useAuth()
  const currentUserId = user?.id

  // Dialog state for mark done
  const [doneDialogTaskId, setDoneDialogTaskId] = React.useState<string | null>(null)

  // Get filter state from URL search params
  // Default to "open" if no status specified
  const statusFromUrl = searchParams.get("status") as "open" | "done" | "all" | null
  const effectiveStatus = statusFromUrl || "open"  // Default to "open"
  const assignedFromUrl = searchParams.get("assigned")
  const customerIdFromUrl = searchParams.get("customer")
  const dateFromUrl = searchParams.get("dateFrom")
  const dateToUrl = searchParams.get("dateTo")
  const signalFromUrl = searchParams.get("signal") as TaskFilter['signal'] | null
  const effectiveSignal = signalFromUrl || 'negative'

  // Task filter state (synced with URL params)
  const taskFilters = React.useMemo<TaskFilter>(() => {
    const filters: TaskFilter = {
      status: effectiveStatus,  // Default to 'open'
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
      // No assignee filter means "all" - set to "all" for the Select component
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

  // Data fetching
  const { data: selectedTaskData } = useTask(taskIdFromUrl || "")

  // Mutations
  const markDone = useMarkTaskDone()

  // Build search request from URL params
  const buildSearchRequest = React.useCallback(
    (filter: InboxFilter, pagination: InboxPagination): TaskSearchRequest => {
      const request: TaskSearchRequest = {
        sortBy: "createdAt",
        sortOrder: "desc",
        limit: pagination.limit,
        offset: (pagination.page - 1) * pagination.limit,
      }

      if (filter.query) {
        request.search = filter.query
      }

      // Status filter - default to "open"
      // Priority: URL param > InboxFilter > default "open"
      if (effectiveStatus === "all") {
        // "All" means show all statuses - don't set status filter
        // Backend will return all when status is undefined
      } else if (effectiveStatus) {
        request.status = effectiveStatus
      } else if (filter.status && filter.status !== "all") {
        request.status = filter.status === "resolved" ? "done" : "open"
      } else {
        // Default to open if no status specified
        request.status = "open"
      }

      // Assignee filter
      if (assignedFromUrl && assignedFromUrl !== "all") {
        if (assignedFromUrl === "unassigned") {
          request.assignedToId = "unassigned"
        } else if (assignedFromUrl === "me") {
          request.assignedToId = currentUserId || undefined
        } else if (assignedFromUrl === "team") {
          // "My Team" - server will handle subordinates filtering
          // For now we don't filter by assignee, letting scoped access handle it
        } else {
          // Specific user ID
          request.assignedToId = assignedFromUrl
        }
      }
      // If assignedFromUrl is "all" or undefined, don't set assignedToId (show all)

      // Customer filter
      if (customerIdFromUrl) {
        request.customerId = customerIdFromUrl
      } else if (filter.customerId) {
        request.customerId = filter.customerId
      }

      // Date filters - use start/end of day in UTC for inclusive date range
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

  // Fetch tasks callback for InboxView
  const handleFetchItems = React.useCallback(
    async (
      filter: InboxFilter,
      pagination: InboxPagination
    ): Promise<InboxPage<InboxItem<Task>>> => {
      const request = buildSearchRequest(filter, pagination)
      const taskClient = getTaskClient()
      const data = await taskClient.search(request)

      return {
        items: data.items.map(apiTaskToInboxItem),
        total: data.total,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: data.total > pagination.page * pagination.limit,
      }
    },
    [buildSearchRequest]
  )

  // Fetch task content callback for InboxView
  const handleFetchContent = React.useCallback(
    async (itemId: string): Promise<InboxItemContent> => {
      const taskClient = getTaskClient()

      // Use already-fetched task data if it matches, otherwise fetch it
      // This avoids duplicate API calls since useTask already fetched the task
      const existingTask = selectedTaskData?.id === itemId ? selectedTaskData : null

      // Fetch task (only if needed) and comments
      const [task, taskComments] = await Promise.all([
        existingTask ? Promise.resolve(existingTask) : taskClient.getById(itemId),
        taskClient.getComments(itemId),
      ])

      if (!task) {
        throw new Error("Failed to fetch task")
      }

      const taskWithComments: TaskWithComments = {
        ...task,
        comments: taskComments,
      }

      return apiTaskToInboxContent(taskWithComments)
    },
    [selectedTaskData]
  )

  // Handle task selection - navigate to task URL
  const handleSelectItem = React.useCallback(
    (item: InboxItem<unknown>) => {
      // Preserve current search params when navigating
      const currentParams = searchParams.toString()
      const queryString = currentParams ? `?${currentParams}` : ""
      navigate(`/escalations/${item.id}${queryString}`)
    },
    [navigate, searchParams]
  )

  // Handle mark done with problem/resolution
  const handleResolve = React.useCallback(
    async (itemId: string, problem: string, resolution: string) => {
      await markDone.mutateAsync({ id: itemId, problem, resolution })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(itemId) })
    },
    [markDone, queryClient]
  )

  // Handle filter changes - sync to URL params
  const handleFiltersChange = React.useCallback((newFilters: TaskFilter) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)

      // Status - always set the status param to preserve selection
      if (newFilters.status) {
        params.set("status", newFilters.status)
      } else {
        // Default to 'open' if not specified
        params.set("status", "open")
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
        // "all" or undefined means show all - remove param
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

  // Get the selected task from URL and convert to InboxItem
  const selectedTask = selectedTaskData || null
  const selectedInboxItem = React.useMemo(() => {
    if (!selectedTask) return null
    return apiTaskToInboxItem(selectedTask)
  }, [selectedTask])

  // Memoize callbacks to prevent InboxView re-renders
  const inboxCallbacks = React.useMemo(() => ({
    onFetchItems: handleFetchItems,
    onFetchContent: handleFetchContent,
    onSelect: handleSelectItem,
  }), [handleFetchItems, handleFetchContent, handleSelectItem])

  // Memoize config to prevent re-renders
  const inboxConfig = React.useMemo(() => ({
    itemType: "task" as const,
    showSearch: true,
    showStatusFilter: false,
    showCustomer: true,
    statusFilters: [
      { value: "all" as const, label: "All" },
      { value: "open" as const, label: "Open" },
      { value: "resolved" as const, label: "Done" },
    ],
    embedded: true,
    emptyMessage: "No tasks found",
    searchPlaceholder: "Search tasks...",
  }), [])

  // Memoize render functions to prevent re-renders
  const renderHeaderActions = React.useCallback((item: InboxItem) => {
    const showDone = (effectiveSignal === 'negative' || effectiveSignal === 'churn') && item.status !== "resolved"
    if (!showDone) return null
    return (
      <Button
        className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-sm"
        onClick={() => setDoneDialogTaskId(item.id)}
      >
        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
        Done
      </Button>
    )
  }, [effectiveSignal])

  const renderMetaInfo = React.useCallback((item: InboxItem) => (
    <TaskMetaInfo
      taskId={item.id}
      customerName={item.customerName}
      assigneeId={item.recipients?.[0]?.id}
      assigneeName={item.recipients?.[0]?.name}
      createdAt={item.timestamp}
    />
  ), [])

  const renderSidePanel = React.useCallback((item: InboxItem) => (
    <div className="space-y-4">
      <TaskResolutionInfo taskId={item.id} />
      <Separator />
      <TaskComments taskId={item.id} variant="panel" />
    </div>
  ), [])

  // Get customer name for display (if needed)
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

  // Export escalations with comments to Excel
  const handleExportEscalations = React.useCallback(async (): Promise<Blob> => {
    const taskClient = getTaskClient()

    // Build export request with current filters
    const exportRequest: TaskExportRequest = {}

    // Apply current filters
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

    // Fetch all escalations with comments and contact roles in one request
    const escalationsWithComments = await taskClient.exportWithComments(exportRequest)

    // Build export data
    const exportData = escalationsWithComments.map(escalation => ({
      customerName: escalation.customerName || "",
      emailSubject: escalation.emailSubject || escalation.title || "",
      status: escalation.status === 1 ? "Done" : "Open",
      assignedTo: escalation.assignedToName || "",
      problem: escalation.problem || "",
      resolution: escalation.resolution || "",
      completedBy: escalation.completedByName || "",
      completedAt: escalation.completedAt
        ? new Date(escalation.completedAt).toLocaleDateString()
        : "",
      comments: (escalation.comments || [])
        .map(c => {
          const time = new Date(c.createdAt).toLocaleString()
          return `[${time} - ${c.userName}]: ${c.content}`
        })
        .join("\n"),
      bookKeeping: escalation.contactRoles?.bookKeeping || "",
      accountant: escalation.contactRoles?.accountant || "",
      controller: escalation.contactRoles?.controller || "",
      srController: escalation.contactRoles?.srController || "",
    }))

    return createXlsxBlob(exportData, {
      columns: [
        { key: "customerName", header: "Customer Name", width: 30 },
        { key: "emailSubject", header: "Email Subject", width: 50 },
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
      sheetName: "Escalations",
    })
  }, [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, currentUserId, effectiveSignal])

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
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
            selectedItem={selectedInboxItem}
            renderHeaderActions={renderHeaderActions}
            renderMetaInfo={renderMetaInfo}
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

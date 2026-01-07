"use client"

import * as React from "react"
import { useSearchParams, useNavigate, useParams } from "react-router-dom"
import { Inbox, CheckCircle } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/ui/export-button"
import { createXlsxBlob } from "@/lib/utils/export"
import {
  InboxView,
  apiTaskToInboxItem,
  apiTaskToInboxContent,
  type InboxItem,
  type InboxFilter,
  type InboxPagination,
  type InboxPage,
  type InboxItemContent,
  type TaskWithComments,
} from "@/components/inbox"
import {
  TaskFilters,
  TaskComments,
  TaskCommentsBadge,
  TaskMetaInfo,
  QuickCommentPopover,
  TASK_COMMENTS_ID,
  type TaskFilter,
} from "@/components/tasks"
import { toast } from "sonner"
import {
  useTask,
  useAssignableUsers,
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

  // Get filter state from URL search params
  // Default to "open" if no status specified
  const statusFromUrl = searchParams.get("status") as "open" | "done" | "all" | null
  const effectiveStatus = statusFromUrl || "open"  // Default to "open"
  const assignedFromUrl = searchParams.get("assigned")
  const customerIdFromUrl = searchParams.get("customer")
  const dateFromUrl = searchParams.get("dateFrom")
  const dateToUrl = searchParams.get("dateTo")

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
    
    return filters
  }, [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl])

  // Data fetching
  const { data: assignableUsers = [] } = useAssignableUsers()
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

      return request
    },
    [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, currentUserId]
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

  // Handle mark done
  const handleResolve = React.useCallback(
    async (itemId: string) => {
      await markDone.mutateAsync(itemId)
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(itemId) })
    },
    [markDone, queryClient]
  )

  // Handle mark done with comment check - requires at least one comment
  const handleDoneWithCommentCheck = React.useCallback(
    async (itemId: string) => {
      const taskClient = getTaskClient()
      const comments = await taskClient.getComments(itemId)

      if (comments.length === 0) {
        toast.error("Comment required", {
          description: "Please add a comment before marking this task as done.",
        })
        return
      }

      await handleResolve(itemId)
    },
    [handleResolve]
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
    onResolve: handleResolve,
  }), [handleFetchItems, handleFetchContent, handleSelectItem, handleResolve])

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
  const renderHeaderActions = React.useCallback((item: InboxItem) => (
    item.status !== "resolved" ? (
      <div className="flex items-center gap-2">
        <QuickCommentPopover taskId={item.id} />
        <Button
          className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-sm"
          onClick={() => handleDoneWithCommentCheck(item.id)}
        >
          <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
          Done
        </Button>
      </div>
    ) : null
  ), [handleDoneWithCommentCheck])

  // Scroll to comments section when badge is clicked
  const scrollToComments = React.useCallback(() => {
    const commentsSection = document.getElementById(TASK_COMMENTS_ID)
    if (commentsSection) {
      commentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const renderHeaderBadges = React.useCallback((item: InboxItem) => (
    <TaskCommentsBadge taskId={item.id} onClick={scrollToComments} />
  ), [scrollToComments])

  const renderMetaInfo = React.useCallback((item: InboxItem) => (
    <TaskMetaInfo
      taskId={item.id}
      customerName={item.customerName}
      assigneeId={item.recipients?.[0]?.id}
      assigneeName={item.recipients?.[0]?.name}
      createdAt={item.timestamp}
    />
  ), [])

  const renderAfterContent = React.useCallback((item: InboxItem) => (
    <TaskComments taskId={item.id} />
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

    // Fetch all escalations with comments in one request
    const escalationsWithComments = await taskClient.exportWithComments(exportRequest)

    // Build export data: Customer Name, Email Subject, Comments (newline separated)
    const exportData = escalationsWithComments.map(escalation => ({
      customerName: escalation.customerName || "",
      emailSubject: escalation.emailSubject || escalation.title || "",
      comments: (escalation.comments || [])
        .map(c => `[${c.userName}]: ${c.content}`)
        .join("\n"),
    }))

    return createXlsxBlob(exportData, {
      columns: [
        { key: "customerName", header: "Customer Name", width: 30 },
        { key: "emailSubject", header: "Email Subject", width: 50 },
        { key: "comments", header: "Comments", width: 80 },
      ],
      sheetName: "Escalations",
    })
  }, [effectiveStatus, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, currentUserId])

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Page Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Escalations</h1>
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
            availableAssignees={assignableUsers}
            currentUserId={currentUserId}
            customerName={customerName}
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
            renderHeaderBadges={renderHeaderBadges}
            renderMetaInfo={renderMetaInfo}
            renderAfterContent={renderAfterContent}
          />
        </div>

      </div>
    </AppShell>
  )
}

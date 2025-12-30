"use client"

import * as React from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Inbox, Send, Loader2, Check, RotateCcw, UserPlus, Calendar } from "lucide-react"
import { format } from "date-fns"
import { AppShell } from "@/components/app-shell"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete"
import {
  useTasks,
  useTask,
  useTaskComments,
  useAssignableUsers,
  useMarkTaskDone,
  useReopenTask,
  useReassignTask,
  useAddTaskComment,
  taskKeys,
} from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"
import type { Task, TaskSearchRequest } from "@crm/clients"
import { TaskStatus } from "@crm/clients"
import { authService } from "@/lib/auth/auth-service"

export default function EscalationsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  // Get current user ID for "Me" filter
  const currentUserId = authService.getUser()?.userId

  // Get state from URL params for bookmarkable routes
  const taskIdFromUrl = searchParams.get("task")
  const statusFromUrl = searchParams.get("status") as "open" | "done" | null
  const assignedFromUrl = searchParams.get("assigned")
  const customerIdFromUrl = searchParams.get("customer")
  const dateFromUrl = searchParams.get("dateFrom")
  const dateToUrl = searchParams.get("dateTo")

  // Local state for comment input
  const [newComment, setNewComment] = React.useState("")

  // Local state for assignee filter autocomplete
  const [assigneeOpen, setAssigneeOpen] = React.useState(false)
  const [assigneeSearch, setAssigneeSearch] = React.useState("")

  // Data fetching
  const { data: assignableUsers = [] } = useAssignableUsers()
  const { data: selectedTaskData } = useTask(taskIdFromUrl || "")
  const { data: comments = [] } = useTaskComments(taskIdFromUrl || "")

  // Mutations
  const markDone = useMarkTaskDone()
  const reopen = useReopenTask()
  const reassign = useReassignTask()
  const addComment = useAddTaskComment()

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

      // Status filter
      if (statusFromUrl) {
        request.status = statusFromUrl
      } else if (filter.status && filter.status !== "all") {
        request.status = filter.status === "resolved" ? "done" : "open"
      }

      // Assignee filter
      if (assignedFromUrl) {
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

      // Customer filter
      if (customerIdFromUrl) {
        request.customerId = customerIdFromUrl
      } else if (filter.customerId) {
        request.customerId = filter.customerId
      }

      // Date filters
      if (dateFromUrl) {
        request.dateFrom = new Date(dateFromUrl)
      } else if (filter.dateFrom) {
        request.dateFrom = filter.dateFrom
      }

      if (dateToUrl) {
        request.dateTo = new Date(dateToUrl)
      } else if (filter.dateTo) {
        request.dateTo = filter.dateTo
      }

      return request
    },
    [statusFromUrl, assignedFromUrl, customerIdFromUrl, dateFromUrl, dateToUrl, currentUserId]
  )

  // Fetch tasks callback for InboxView
  const handleFetchItems = React.useCallback(
    async (
      filter: InboxFilter,
      pagination: InboxPagination
    ): Promise<InboxPage<InboxItem<Task>>> => {
      const request = buildSearchRequest(filter, pagination)

      // Use fetch directly since we need to await results
      const response = await fetch("/api/tasks/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        throw new Error("Failed to fetch tasks")
      }

      const result = await response.json()
      const data = result.data as { items: Task[]; total: number }

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
      const response = await fetch(`/api/tasks/${itemId}`, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to fetch task")
      }

      const result = await response.json()
      const task = result.data as Task

      // Fetch comments
      const commentsResponse = await fetch(`/api/tasks/${itemId}/comments`, {
        credentials: "include",
      })
      const commentsResult = await commentsResponse.json()
      const taskComments = commentsResult.data || []

      const taskWithComments: TaskWithComments = {
        ...task,
        comments: taskComments,
      }

      return apiTaskToInboxContent(taskWithComments)
    },
    []
  )

  // Handle task selection - update URL
  const handleSelectItem = React.useCallback(
    (item: InboxItem<unknown>) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        params.set("task", item.id)
        return params
      })
    },
    [setSearchParams]
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

  // Handle reopen
  const handleReopen = React.useCallback(
    async (taskId: string) => {
      await reopen.mutateAsync(taskId)
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
    },
    [reopen, queryClient]
  )

  // Handle reassign
  const handleReassign = React.useCallback(
    async (taskId: string, userId: string | null) => {
      await reassign.mutateAsync({ id: taskId, assignedToId: userId })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
    },
    [reassign, queryClient]
  )

  // Handle add comment
  const handleAddComment = React.useCallback(async () => {
    if (!taskIdFromUrl || !newComment.trim()) return
    await addComment.mutateAsync({ taskId: taskIdFromUrl, content: newComment.trim() })
    setNewComment("")
    queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskIdFromUrl) })
  }, [taskIdFromUrl, newComment, addComment, queryClient])

  // Update URL when filter changes
  const handleAssigneeChange = (value: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (value === "all") {
        params.delete("assigned")
      } else {
        params.set("assigned", value)
      }
      return params
    })
  }

  const handleCustomerChange = (customerId: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (customerId) {
        params.set("customer", customerId)
      } else {
        params.delete("customer")
      }
      return params
    })
  }

  const handleDateFromChange = (date: Date | undefined) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (date) {
        params.set("dateFrom", date.toISOString())
      } else {
        params.delete("dateFrom")
      }
      return params
    })
  }

  const handleDateToChange = (date: Date | undefined) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (date) {
        params.set("dateTo", date.toISOString())
      } else {
        params.delete("dateTo")
      }
      return params
    })
  }

  // Get the selected task from URL
  const selectedTask = selectedTaskData || null
  const isDone = selectedTask?.status === TaskStatus.DONE

  // Filter assignable users by search term (for autocomplete)
  const filteredAssignableUsers = React.useMemo(() => {
    if (!assigneeSearch) return assignableUsers
    const searchLower = assigneeSearch.toLowerCase()
    return assignableUsers.filter((user) =>
      user.name.toLowerCase().includes(searchLower)
    )
  }, [assignableUsers, assigneeSearch])

  // Get display text for assignee filter
  const assigneeDisplayText = React.useMemo(() => {
    if (!assignedFromUrl || assignedFromUrl === "all") return "All Tasks"
    if (assignedFromUrl === "me") return "My Tasks"
    if (assignedFromUrl === "team") return "My Team"
    if (assignedFromUrl === "unassigned") return "Unassigned"
    // Find user by ID
    const user = assignableUsers.find((u) => u.id === assignedFromUrl)
    return user?.name || "Select assignee..."
  }, [assignedFromUrl, assignableUsers])

  // Custom actions for task detail panel
  const customActions = taskIdFromUrl ? (
    <div className="flex items-center gap-2">
      {/* Reassign dropdown */}
      <Select
        value={selectedTask?.assignedToId || "unassigned"}
        onValueChange={(value) =>
          handleReassign(taskIdFromUrl, value === "unassigned" ? null : value)
        }
        disabled={reassign.isPending}
      >
        <SelectTrigger className="w-[140px] h-8">
          <UserPlus className="h-3 w-3 mr-1" />
          <SelectValue placeholder="Assign" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {assignableUsers.map((user) => (
            <SelectItem key={user.id} value={user.id}>
              {user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Reopen button (only shown for done tasks) */}
      {isDone && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleReopen(taskIdFromUrl)}
          disabled={reopen.isPending}
        >
          {reopen.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3 mr-1" />
          )}
          Reopen
        </Button>
      )}
    </div>
  ) : null

  // Custom header with filters
  const headerContent = (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Assignee filter */}
      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={assigneeOpen}
            className="w-[180px] h-8 justify-between"
          >
            <UserPlus className="h-3 w-3 mr-2 shrink-0" />
            <span className="truncate">{assigneeDisplayText}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search assignees..."
              value={assigneeSearch}
              onValueChange={setAssigneeSearch}
            />
            <CommandList>
              <CommandGroup heading="Quick Filters">
                <CommandItem
                  value="all"
                  onSelect={() => {
                    handleAssigneeChange("all")
                    setAssigneeOpen(false)
                    setAssigneeSearch("")
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      (!assignedFromUrl || assignedFromUrl === "all") ? "opacity-100" : "opacity-0"
                    )}
                  />
                  All Tasks
                </CommandItem>
                <CommandItem
                  value="me"
                  onSelect={() => {
                    handleAssigneeChange("me")
                    setAssigneeOpen(false)
                    setAssigneeSearch("")
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      assignedFromUrl === "me" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  My Tasks
                </CommandItem>
                <CommandItem
                  value="team"
                  onSelect={() => {
                    handleAssigneeChange("team")
                    setAssigneeOpen(false)
                    setAssigneeSearch("")
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      assignedFromUrl === "team" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  My Team
                </CommandItem>
                <CommandItem
                  value="unassigned"
                  onSelect={() => {
                    handleAssigneeChange("unassigned")
                    setAssigneeOpen(false)
                    setAssigneeSearch("")
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      assignedFromUrl === "unassigned" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  Unassigned
                </CommandItem>
              </CommandGroup>
              {filteredAssignableUsers.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Team Members">
                    {filteredAssignableUsers.map((user) => (
                      <CommandItem
                        key={user.id}
                        value={user.id}
                        onSelect={() => {
                          handleAssigneeChange(user.id)
                          setAssigneeOpen(false)
                          setAssigneeSearch("")
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            assignedFromUrl === user.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {user.name}
                        {user.id === currentUserId && (
                          <span className="ml-1 text-muted-foreground">(me)</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
              {filteredAssignableUsers.length === 0 && assigneeSearch && (
                <CommandEmpty>No users found.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Customer filter */}
      <div className="w-[200px]">
        <CustomerAutocomplete
          value={customerIdFromUrl || ""}
          onChange={handleCustomerChange}
          placeholder="Filter by customer..."
          className="h-8"
        />
      </div>

      {/* Date from */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            <Calendar className="h-3 w-3" />
            {dateFromUrl ? format(new Date(dateFromUrl), "MMM d") : "From"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarComponent
            mode="single"
            selected={dateFromUrl ? new Date(dateFromUrl) : undefined}
            onSelect={handleDateFromChange}
          />
        </PopoverContent>
      </Popover>

      {/* Date to */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            <Calendar className="h-3 w-3" />
            {dateToUrl ? format(new Date(dateToUrl), "MMM d") : "To"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarComponent
            mode="single"
            selected={dateToUrl ? new Date(dateToUrl) : undefined}
            onSelect={handleDateToChange}
          />
        </PopoverContent>
      </Popover>

      {/* Clear filters */}
      {(assignedFromUrl || customerIdFromUrl || dateFromUrl || dateToUrl) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => {
            setSearchParams((prev) => {
              const params = new URLSearchParams(prev)
              params.delete("assigned")
              params.delete("customer")
              params.delete("dateFrom")
              params.delete("dateTo")
              return params
            })
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  )

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Page Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-4">
            <Inbox className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Escalations</h1>
          </div>
          {headerContent}
        </div>

        {/* Main Content - InboxView */}
        <div className="flex-1 overflow-hidden">
          <InboxView
            config={{
              itemType: "task",
              showSearch: true,
              showStatusFilter: true,
              showCustomer: true,
              statusFilters: [
                { value: "all", label: "All" },
                { value: "open", label: "Open" },
                { value: "resolved", label: "Done" },
              ],
              embedded: true,
              emptyMessage: "No tasks found",
              searchPlaceholder: "Search tasks...",
            }}
            callbacks={{
              onFetchItems: handleFetchItems,
              onFetchContent: handleFetchContent,
              onSelect: handleSelectItem,
              onResolve: handleResolve,
            }}
            toolbarActions={customActions}
          />
        </div>

        {/* Comments Section (shown when task is selected) */}
        {taskIdFromUrl && (
          <div className="border-t border-border p-4 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Comments ({comments.length})</span>
            </div>

            {/* Comments list */}
            {comments.length > 0 && (
              <div className="space-y-2 mb-3 max-h-32 overflow-y-auto">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="text-sm p-2 bg-background rounded border"
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span className="font-medium">{comment.userName}</span>
                      <span>{format(new Date(comment.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                    <p>{comment.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment */}
            <div className="flex gap-2">
              <Textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="min-h-[60px] resize-none flex-1"
              />
              <Button
                size="sm"
                onClick={handleAddComment}
                disabled={!newComment.trim() || addComment.isPending}
              >
                {addComment.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

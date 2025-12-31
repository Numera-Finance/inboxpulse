"use client"

import * as React from "react"
import { formatDistanceToNow, formatDistance, format } from "date-fns"
import { Building2, User, Clock, Pencil, Loader2, Check, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { useAssignableUsers, useReassignTask, useTask, taskKeys } from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"
import { TaskStatus } from "@crm/clients"

interface TaskMetaInfoProps {
  taskId: string
  customerName?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  createdAt: Date
  className?: string
}

/**
 * TaskMetaInfo - Displays task metadata grid
 *
 * Shows customer, assignee (with edit capability), and open time.
 * Handles assignment changes internally using React Query.
 */
export function TaskMetaInfo({
  taskId,
  customerName,
  assigneeId,
  assigneeName,
  createdAt,
  className,
}: TaskMetaInfoProps) {
  const queryClient = useQueryClient()
  const { data: assignableUsers = [] } = useAssignableUsers()
  const { data: taskData } = useTask(taskId)
  const reassign = useReassignTask()

  // Determine if task is resolved
  const isResolved = taskData?.status === TaskStatus.DONE
  const completedAt = taskData?.completedAt ? new Date(taskData.completedAt) : null

  const [assigneeOpen, setAssigneeOpen] = React.useState(false)
  const [assigneeSearch, setAssigneeSearch] = React.useState("")
  const [isAssigning, setIsAssigning] = React.useState(false)

  // Local state for optimistic updates
  const [localAssignee, setLocalAssignee] = React.useState<{
    id: string | null
    name: string
  } | null>(null)

  // Reset local state when taskId changes
  React.useEffect(() => {
    setLocalAssignee(null)
  }, [taskId])

  // Use local state if available, otherwise fall back to props
  const displayAssignee = localAssignee ?? {
    id: assigneeId ?? null,
    name: assigneeName ?? "Unassigned",
  }

  // Filter users by search term
  const filteredUsers = React.useMemo(() => {
    if (!assigneeSearch) return assignableUsers
    const searchLower = assigneeSearch.toLowerCase()
    return assignableUsers.filter((user) =>
      user.name.toLowerCase().includes(searchLower)
    )
  }, [assignableUsers, assigneeSearch])

  const handleAssign = async (userId: string) => {
    // Find the user name for optimistic update
    const user = assignableUsers.find((u) => u.id === userId)
    if (user) {
      // Optimistically update local state
      setLocalAssignee({ id: userId, name: user.name })
    }

    setAssigneeOpen(false)
    setAssigneeSearch("")
    setIsAssigning(true)

    try {
      await reassign.mutateAsync({ id: taskId, assignedToId: userId })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
    } catch (error) {
      console.error("Failed to assign:", error)
      // Revert optimistic update on error
      setLocalAssignee(null)
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 md:grid-cols-4 gap-4 p-3 rounded-lg bg-muted/50 text-sm border-0",
        className
      )}
    >
      {customerName && (
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Building2 className="h-3 w-3" />
            Customer
          </div>
          <p className="font-medium">{customerName}</p>
        </div>
      )}
      <div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          <User className="h-3 w-3" />
          Assigned To
        </div>
        <div className="flex items-center gap-1">
          <p className="font-medium">{displayAssignee.name}</p>
          {!isResolved && (
            <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={isAssigning}
                >
                  {isAssigning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search users..."
                    value={assigneeSearch}
                    onValueChange={setAssigneeSearch}
                  />
                  <CommandList>
                    <CommandEmpty>No users found.</CommandEmpty>
                    <CommandGroup>
                      {filteredUsers.map((user) => {
                        const isSelected = displayAssignee.id === user.id
                        return (
                          <CommandItem
                            key={user.id}
                            value={user.id}
                            onSelect={() => handleAssign(user.id)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                isSelected ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {user.name}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
      {isResolved && completedAt ? (
        <>
          <div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Clock className="h-3 w-3" />
              Time to Close
            </div>
            <p className="font-medium">
              {formatDistance(completedAt, createdAt)}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <CheckCircle2 className="h-3 w-3" />
              Resolved on
            </div>
            <p className="font-medium">
              {format(completedAt, "MMM d, yyyy")}
            </p>
          </div>
        </>
      ) : (
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Clock className="h-3 w-3" />
            Open
          </div>
          <p className="font-medium">
            {formatDistanceToNow(createdAt, { addSuffix: false })}
          </p>
        </div>
      )}
    </div>
  )
}

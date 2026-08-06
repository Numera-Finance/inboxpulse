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
import { useAssignableUsers, useReassignTask, useTask } from "@/lib/hooks"
import { useAuth } from "@/src/contexts/AuthContext"
import { TaskStatus } from "@crm/clients"

interface AssignOption {
  id: string
  /** What the dropdown lists — "Me" for the current user. */
  label: string
  /** What the "Assigned To" line shows once picked — always the real name. */
  assigneeName: string
}

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
  const { data: assignableUsers = [] } = useAssignableUsers()
  const { data: taskData } = useTask(taskId)
  const reassign = useReassignTask()
  const { user } = useAuth()

  // Determine if task is resolved
  const isResolved = taskData?.status === TaskStatus.DONE
  const completedAt = taskData?.completedAt ? new Date(taskData.completedAt) : null

  // Use taskData.customerName as fallback to prevent flickering during refetch
  const displayCustomerName = customerName || taskData?.customerName

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

  // "Me" leads the list so an assignee can take an escalation back — the API
  // omits the caller from assignable users.
  const assignOptions = React.useMemo<AssignOption[]>(() => {
    const others = assignableUsers.map((u) => ({
      id: u.id,
      label: u.name,
      assigneeName: u.name,
    }))
    if (!user?.id) return others
    return [
      { id: user.id, label: "Me", assigneeName: user.name || "Me" },
      ...others,
    ]
  }, [assignableUsers, user?.id, user?.name])

  // Match on the real name too, so searching for your own name finds "Me"
  const filteredOptions = React.useMemo(() => {
    if (!assigneeSearch) return assignOptions
    const searchLower = assigneeSearch.toLowerCase()
    return assignOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(searchLower) ||
        option.assigneeName.toLowerCase().includes(searchLower)
    )
  }, [assignOptions, assigneeSearch])

  const handleAssign = async (option: AssignOption) => {
    // Optimistically update local state
    setLocalAssignee({ id: option.id, name: option.assigneeName })

    setAssigneeOpen(false)
    setAssigneeSearch("")
    setIsAssigning(true)

    try {
      // useReassignTask.onSuccess already updates the cache and invalidates lists
      await reassign.mutateAsync({ id: taskId, assignedToId: option.id })
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
      {displayCustomerName && (
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Building2 className="h-3 w-3" />
            Customer
          </div>
          <p className="font-medium">{displayCustomerName}</p>
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
                      {filteredOptions.map((option) => {
                        const isSelected = displayAssignee.id === option.id
                        return (
                          <CommandItem
                            key={option.id}
                            value={option.id}
                            onSelect={() => handleAssign(option)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                isSelected ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {option.label}
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

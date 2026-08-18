"use client"

import * as React from "react"
import { formatDistanceToNow, formatDistance, format } from "date-fns"
import { Building2, User, Clock, Pencil, Loader2, Check, CheckCircle2, UserMinus } from "lucide-react"
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
import { TaskStatus } from "@crm/clients"

/** A dropdown choice — `id: null` is the "Unassigned" entry. */
interface AssignOption {
  id: string | null
  name: string
}

interface TaskMetaInfoProps {
  taskId: string
  customerName?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  createdAt: Date
  className?: string
  /**
   * When provided, the customer becomes editable — a "Change" affordance
   * appears beside it and calls this. Used where the customer may have been
   * guessed rather than known, so the user can correct it in place.
   */
  onChangeCustomer?: () => void
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
  onChangeCustomer,
}: TaskMetaInfoProps) {
  const { data: assignableUsers = [] } = useAssignableUsers()
  const { data: taskData } = useTask(taskId)
  const reassign = useReassignTask()

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

  // Filter users by search term. The list includes the current user, so
  // taking an escalation back is just picking your own name. Removing the
  // assignment is a pinned action below the list, not a row in it.
  const filteredUsers = React.useMemo(() => {
    if (!assigneeSearch) return assignableUsers
    const searchLower = assigneeSearch.toLowerCase()
    return assignableUsers.filter((u) =>
      u.name.toLowerCase().includes(searchLower)
    )
  }, [assignableUsers, assigneeSearch])

  const handleAssign = async (option: AssignOption) => {
    // Optimistically update local state
    setLocalAssignee({ id: option.id, name: option.name })

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
      {(displayCustomerName || onChangeCustomer) && (
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Building2 className="h-3 w-3" />
            Customer
          </div>
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{displayCustomerName || "Unassigned"}</p>
            {onChangeCustomer && (
              <button
                type="button"
                onClick={onChangeCustomer}
                className="text-xs text-primary hover:underline flex-shrink-0"
              >
                Change
              </button>
            )}
          </div>
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
                      {filteredUsers.map((option) => {
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
                            {option.name}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
                {/* Pinned below the list rather than placed in it: with a
                    tenant-sized user list, a row at the bottom would need
                    scrolling to reach and a row at the top reads as just
                    another name. Removing an assignment is an action, so it
                    is worded and styled as one. */}
                {displayAssignee.id && (
                  <div className="border-t p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start font-normal text-muted-foreground hover:text-destructive"
                      onClick={() => handleAssign({ id: null, name: "Unassigned" })}
                    >
                      <UserMinus className="mr-2 h-4 w-4" />
                      Remove assignment
                    </Button>
                  </div>
                )}
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

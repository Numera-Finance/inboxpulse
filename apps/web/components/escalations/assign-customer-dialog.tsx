"use client"

import * as React from "react"
import { Check, Search, UserPlus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCustomers, useAssignContactCustomer } from "@/lib/hooks"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface AssignCustomerDialogProps {
  /** Sender address being assigned. Shown read-only — it is the thing we key on. */
  senderEmail: string
  /** Sender's display name, saved on the contact when it is created. */
  senderName?: string
  /** Customer the email currently resolves to, for context in the header. */
  currentCustomerName?: string
  open: boolean
  onClose: () => void
  onAssigned?: (customerId: string) => void
}

/**
 * Assign an escalation's sender to the right customer.
 *
 * This is the fix for the common case where nobody had added the contact, so
 * the pipeline invented a "<domain> (Auto)" placeholder and every email from
 * that sender landed on it. Assigning is retroactive — the server re-links the
 * sender's existing emails and creates any escalation tasks that were skipped
 * for want of a customer — so the dialog reports back what actually moved.
 */
export function AssignCustomerDialog({
  senderEmail,
  senderName,
  currentCustomerName,
  open,
  onClose,
  onAssigned,
}: AssignCustomerDialogProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedName, setSelectedName] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const assignMutation = useAssignContactCustomer()

  const { data: customersData } = useCustomers({
    queries: [],
    sortBy: 'name',
    sortOrder: 'asc',
    limit: 2000,
    offset: 0,
  })

  const customers = React.useMemo(() => {
    const items = customersData?.items ?? []
    if (!search) return items
    const term = search.toLowerCase()
    return items.filter(c =>
      c.name?.toLowerCase().includes(term) ||
      c.domains?.some(d => d.toLowerCase().includes(term))
    )
  }, [customersData?.items, search])

  React.useEffect(() => {
    if (open) {
      setSelectedId(null)
      setSelectedName(null)
      setSearch("")
    }
  }, [open])

  const handleAssign = async () => {
    if (!selectedId) return

    try {
      const result = await assignMutation.mutateAsync({
        email: senderEmail,
        customerId: selectedId,
        ...(senderName ? { name: senderName } : {}),
      })

      // Name the scope the server actually applied: a claimed domain covers
      // the sender's colleagues too, which is more than the user asked for and
      // worth saying out loud.
      const scope = result.domainMoved
        ? `all of ${result.domainMoved}`
        : senderEmail
      const parts = [`Assigned ${scope} to ${selectedName}`]
      if (result.emailsReassigned > 0) {
        parts.push(`${result.emailsReassigned} email${result.emailsReassigned === 1 ? '' : 's'} reassigned`)
      }
      if (result.tasksQueued > 0) {
        // Queued, not created — the tasks are made by a background job, so
        // saying "created" would promise something the list may not show yet.
        parts.push(`${result.tasksQueued} escalation${result.tasksQueued === 1 ? '' : 's'} queued`)
      }
      toast.success(parts.join(' — '))

      onAssigned?.(selectedId)
      onClose()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Assignment failed"
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Assign Customer
          </DialogTitle>
          <DialogDescription>
            {currentCustomerName
              ? `${senderEmail} is currently assigned to "${currentCustomerName}". Pick the correct customer.`
              : `Pick the customer ${senderEmail} belongs to.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 min-w-0">
          <label className="text-sm font-medium">Assign to</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>
          <div className="h-[300px] overflow-y-auto rounded-md border p-1">
            {customers.map((c) => (
              <button
                key={c.id}
                className={cn(
                  "flex items-center w-full rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
                  selectedId === c.id && "bg-accent"
                )}
                onClick={() => {
                  setSelectedId(c.id)
                  setSelectedName(c.name ?? c.domains?.[0] ?? c.id)
                }}
              >
                <Check className={cn("mr-2 h-4 w-4 flex-shrink-0", selectedId === c.id ? "opacity-100" : "opacity-0")} />
                <span className="truncate">
                  {c.name}{c.domains?.[0] ? ` (${c.domains[0]})` : ''}
                </span>
              </button>
            ))}
            {customers.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No customers found.
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Past emails from this sender are reassigned too.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={assignMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={!selectedId || assignMutation.isPending}>
            {assignMutation.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

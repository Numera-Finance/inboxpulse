"use client"

import * as React from "react"
import { GitMerge, AlertTriangle, Search, Check } from "lucide-react"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCustomers, useMergeCustomer } from "@/lib/hooks"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { Customer } from "@/lib/types"
import type { MergeCustomerResponse } from "@crm/clients"

interface MergeCustomerDialogProps {
  sourceCustomer: Customer
  open: boolean
  onClose: () => void
  onMerged: (targetCustomerId: string) => void
}

export function MergeCustomerDialog({
  sourceCustomer,
  open,
  onClose,
  onMerged,
}: MergeCustomerDialogProps) {
  const [targetId, setTargetId] = React.useState<string | null>(null)
  const [targetName, setTargetName] = React.useState<string | null>(null)
  const [step, setStep] = React.useState<"select" | "confirm">("select")
  const [search, setSearch] = React.useState("")
  const mergeMutation = useMergeCustomer()

  // Fetch customers for the picker
  const { data: customersData } = useCustomers({
    queries: [],
    sortBy: 'name',
    sortOrder: 'asc',
    limit: 2000,
    offset: 0,
  })

  const customers = React.useMemo(() => {
    const items = customersData?.items ?? []
    const filtered = items.filter(c => c.id !== sourceCustomer.id)
    if (!search) return filtered
    const term = search.toLowerCase()
    return filtered.filter(c =>
      c.name?.toLowerCase().includes(term) ||
      c.domains?.some(d => d.toLowerCase().includes(term))
    )
  }, [customersData?.items, sourceCustomer.id, search])

  // Reset state when dialog opens/closes
  React.useEffect(() => {
    if (open) {
      setTargetId(null)
      setTargetName(null)
      setStep("select")
      setSearch("")
    }
  }, [open])

  const handleConfirm = async () => {
    if (!targetId) return

    try {
      const result = await mergeMutation.mutateAsync({
        targetCustomerId: targetId,
        sourceCustomerId: sourceCustomer.id,
      }) as MergeCustomerResponse

      toast.success(
        `Merged "${sourceCustomer.name}" into "${targetName}". ` +
        `Moved ${result.movedDomains} domains, ${result.movedContacts} contacts, ` +
        `${result.movedTasks} tasks, ${result.movedEmailParticipants} emails.`
      )

      onMerged(targetId)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Merge failed"
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Merge Customer
          </DialogTitle>
          <DialogDescription>
            {step === "select"
              ? `Select the customer to merge "${sourceCustomer.name}" into.`
              : `Confirm merge of "${sourceCustomer.name}" into "${targetName}".`
            }
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">Merge into</label>
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
            <ScrollArea className="h-[300px] rounded-md border">
              <div className="p-1">
                {customers.map((c) => (
                  <button
                    key={c.id}
                    className={cn(
                      "flex items-center w-full rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
                      targetId === c.id && "bg-accent"
                    )}
                    onClick={() => {
                      setTargetId(c.id)
                      setTargetName(c.name ?? c.domains?.[0] ?? c.id)
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4 flex-shrink-0", targetId === c.id ? "opacity-100" : "opacity-0")} />
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
            </ScrollArea>
          </div>
        ) : (
          <div className="py-4 space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-50 border border-amber-200">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-800">This action cannot be undone.</p>
                <p className="text-amber-700 mt-1">
                  All domains, contacts, emails, tasks, and team assignments from
                  <strong> {sourceCustomer.name}</strong> will be moved to
                  <strong> {targetName}</strong>.
                </p>
                <p className="text-amber-700 mt-1">
                  <strong>{sourceCustomer.name}</strong> will be archived.
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mergeMutation.isPending}>
            Cancel
          </Button>
          {step === "select" ? (
            <Button
              onClick={() => setStep("confirm")}
              disabled={!targetId}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={mergeMutation.isPending}
            >
              {mergeMutation.isPending ? "Merging..." : "Merge"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import * as React from "react"
import { GitMerge, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete"
import { useMergeCustomer } from "@/lib/hooks"
import { toast } from "sonner"
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
  const mergeMutation = useMergeCustomer()

  // Reset state when dialog opens/closes
  React.useEffect(() => {
    if (open) {
      setTargetId(null)
      setTargetName(null)
      setStep("select")
    }
  }, [open])

  const handleSelectTarget = (customerId: string | null, customerName?: string) => {
    setTargetId(customerId)
    setTargetName(customerName ?? null)
  }

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
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Merge into</label>
            <CustomerAutocomplete
              value={targetId}
              onChange={handleSelectTarget}
              placeholder="Search for target customer..."
              excludeIds={[sourceCustomer.id]}
            />
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

"use client"

import * as React from "react"
import { Loader2, ArrowRight } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { UserAutocomplete } from "@/components/ui/user-autocomplete"
import type { User } from "@/lib/types"

interface TransferUserDialogProps {
  open: boolean
  onClose: () => void
  sourceUser: User | null
  onConfirm: (targetUserId: string) => void
  isLoading?: boolean
}

export function TransferUserDialog({
  open,
  onClose,
  sourceUser,
  onConfirm,
  isLoading = false,
}: TransferUserDialogProps) {
  const [targetUserId, setTargetUserId] = React.useState<string | null>(null)

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setTargetUserId(null)
    }
  }, [open])

  if (!sourceUser) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }} modal={false}>
      <DialogContent className="sm:max-w-[480px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Transfer
          </DialogTitle>
          <DialogDescription>
            Transfer all customer assignments, open tasks, and manager
            relationships from <strong>{sourceUser.name}</strong> to another
            user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Transfer to</label>
            <UserAutocomplete
              value={targetUserId}
              onChange={(value) => setTargetUserId(value)}
              excludeIds={[sourceUser.id]}
              placeholder="Select target user..."
              searchPlaceholder="Search users..."
            />
          </div>

          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground space-y-1">
            <p>The following will be transferred:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>{sourceUser.assignedCustomers.length} customer assignment{sourceUser.assignedCustomers.length !== 1 ? 's' : ''}</li>
              <li>All open tasks</li>
              <li>Manager relationships (subordinates)</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={() => targetUserId && onConfirm(targetUserId)}
            disabled={!targetUserId || isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

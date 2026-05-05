"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { TaskSignalCategory } from "@crm/shared"

interface MarkDoneDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (problem: string, resolution: string) => void
  isLoading?: boolean
  signalCategory?: TaskSignalCategory | null
}

interface DialogCopy {
  title: string
  field1Label: string
  field1Placeholder: string
  field2Label: string
  field2Placeholder: string
  confirmLabel: string
}

const COPY_BY_CATEGORY: Record<TaskSignalCategory, DialogCopy> = {
  negative: {
    title: "Mark as Resolved",
    field1Label: "Problem",
    field1Placeholder: "Describe the problem...",
    field2Label: "Resolution",
    field2Placeholder: "Describe the resolution...",
    confirmLabel: "Mark Resolved",
  },
  upsell: {
    title: "Mark as Closed",
    field1Label: "Opportunity",
    field1Placeholder: "Describe the opportunity...",
    field2Label: "Outcome",
    field2Placeholder: "Describe the outcome...",
    confirmLabel: "Mark Closed",
  },
  churn: {
    title: "Mark as Resolved",
    field1Label: "Risk",
    field1Placeholder: "Describe the risk...",
    field2Label: "Mitigation",
    field2Placeholder: "Describe the mitigation...",
    confirmLabel: "Mark Resolved",
  },
}

export function MarkDoneDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
  signalCategory,
}: MarkDoneDialogProps) {
  const [problem, setProblem] = React.useState("")
  const [resolution, setResolution] = React.useState("")

  React.useEffect(() => {
    if (!open) {
      setProblem("")
      setResolution("")
    }
  }, [open])

  const copy = COPY_BY_CATEGORY[signalCategory ?? "negative"]
  const canSubmit = problem.trim().length > 0 && resolution.trim().length > 0 && !isLoading

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="problem">{copy.field1Label}</Label>
            <Textarea
              id="problem"
              placeholder={copy.field1Placeholder}
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resolution">{copy.field2Label}</Label>
            <Textarea
              id="resolution"
              placeholder={copy.field2Placeholder}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              disabled={isLoading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onConfirm(problem.trim(), resolution.trim())}
            disabled={!canSubmit}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

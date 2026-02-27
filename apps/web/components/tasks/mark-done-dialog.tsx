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

interface MarkDoneDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (problem: string, resolution: string) => void
  isLoading?: boolean
}

export function MarkDoneDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
}: MarkDoneDialogProps) {
  const [problem, setProblem] = React.useState("")
  const [resolution, setResolution] = React.useState("")

  React.useEffect(() => {
    if (!open) {
      setProblem("")
      setResolution("")
    }
  }, [open])

  const canSubmit = problem.trim().length > 0 && resolution.trim().length > 0 && !isLoading

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Mark as Done</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="problem">Problem</Label>
            <Textarea
              id="problem"
              placeholder="Describe the problem..."
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resolution">Resolution</Label>
            <Textarea
              id="resolution"
              placeholder="Describe the resolution..."
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
            Mark Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

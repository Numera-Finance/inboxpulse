"use client"

import * as React from "react"
import { MessageSquare, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useAddTaskComment, taskKeys } from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"

interface QuickCommentPopoverProps {
  taskId: string
  onCommentAdded?: () => void
}

/**
 * QuickCommentPopover - Compact popover for adding comments quickly
 *
 * Displays a button that opens a popover with a textarea for adding comments.
 * Uses the same mutation as TaskComments for consistency.
 */
export function QuickCommentPopover({ taskId, onCommentAdded }: QuickCommentPopoverProps) {
  const queryClient = useQueryClient()
  const addComment = useAddTaskComment()

  const [open, setOpen] = React.useState(false)
  const [comment, setComment] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Reset comment when popover closes or taskId changes
  React.useEffect(() => {
    if (!open) {
      setComment("")
    }
  }, [open])

  React.useEffect(() => {
    setComment("")
    setOpen(false)
  }, [taskId])

  const handleSubmit = async () => {
    if (!comment.trim()) return

    setIsSubmitting(true)
    const commentContent = comment.trim()

    try {
      await addComment.mutateAsync({ taskId, content: commentContent })
      // Invalidate comments to refresh the list
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
      setComment("")
      setOpen(false)
      onCommentAdded?.()
    } catch (error) {
      console.error("Failed to add comment:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-sm"
        >
          <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
          Add Comment
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="text-sm font-medium">Add Comment</div>
          <Textarea
            placeholder="Enter your comment..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[100px] resize-none"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              ⌘+Enter to submit
            </span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!comment.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Send className="h-3 w-3 mr-1" />
              )}
              Submit
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

"use client"

import * as React from "react"
import { formatDistanceToNow } from "date-fns"
import { MessageSquare, Send, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { useTaskComments, useAddTaskComment, taskKeys } from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"

interface TaskComment {
  id: string
  content: string
  userId: string
  userName: string
  createdAt: Date
}

interface TaskCommentsProps {
  taskId: string
  className?: string
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * TaskComments - Standalone comments section for tasks
 *
 * Fetches and manages comments internally using React Query.
 * Handles optimistic updates for adding comments.
 */
// ID used for scroll-to-comments functionality
export const TASK_COMMENTS_ID = 'task-comments-section'

export function TaskComments({ taskId, className }: TaskCommentsProps) {
  const queryClient = useQueryClient()
  const { data: comments = [], isLoading } = useTaskComments(taskId)
  const addComment = useAddTaskComment()

  const [newComment, setNewComment] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [optimisticComments, setOptimisticComments] = React.useState<TaskComment[]>([])

  // Reset optimistic comments when taskId changes
  React.useEffect(() => {
    setOptimisticComments([])
    setNewComment("")
  }, [taskId])

  // Merge real comments with optimistic ones
  const displayComments = React.useMemo(() => {
    const realIds = new Set(comments.map(c => c.id))
    // Filter out optimistic comments that now exist in real data
    const pendingOptimistic = optimisticComments.filter(c => !realIds.has(c.id) && c.id.startsWith('temp-'))
    return [...comments, ...pendingOptimistic]
  }, [comments, optimisticComments])

  const handleSubmit = async () => {
    if (!newComment.trim()) return

    setIsSubmitting(true)
    const commentContent = newComment.trim()

    // Create optimistic comment
    const optimisticComment: TaskComment = {
      id: `temp-${Date.now()}`,
      content: commentContent,
      userId: 'current-user',
      userName: 'You',
      createdAt: new Date(),
    }

    // Add optimistic comment
    setOptimisticComments(prev => [...prev, optimisticComment])
    setNewComment("")

    try {
      await addComment.mutateAsync({ taskId, content: commentContent })
      // Invalidate to get the real comment with proper ID
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
    } catch (error) {
      console.error("Failed to add comment:", error)
      // Remove optimistic comment on error
      setOptimisticComments(prev => prev.filter(c => c.id !== optimisticComment.id))
      // Restore the comment text so user can retry
      setNewComment(commentContent)
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

  if (isLoading) {
    return (
      <div id={TASK_COMMENTS_ID} className={className}>
        <Separator className="my-4" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading comments...</span>
        </div>
      </div>
    )
  }

  return (
    <div id={TASK_COMMENTS_ID} className={className}>
      <Separator className="my-4" />
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Comments</h3>
          {displayComments.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {displayComments.length}
            </Badge>
          )}
        </div>

        {/* Comments list */}
        {displayComments.length > 0 ? (
          <div className="space-y-3">
            {displayComments.map((comment) => (
              <div
                key={comment.id}
                className="bg-muted/50 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
                      {getInitials(comment.userName)}
                    </div>
                    <span className="text-sm font-medium">{comment.userName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {comment.content}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No comments yet</p>
        )}

        {/* Add comment form */}
        <div className="space-y-2">
          <Textarea
            placeholder="Add a comment... (⌘+Enter to submit)"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[80px] resize-none"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Send className="h-3 w-3 mr-1" />
              )}
              Add Comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * TaskCommentsBadge - Small badge showing comment count with click-to-scroll
 */
export function TaskCommentsBadge({
  taskId,
  onClick
}: {
  taskId: string
  onClick?: () => void
}) {
  const { data: comments = [] } = useTaskComments(taskId)

  if (comments.length === 0) return null

  return (
    <Badge
      variant="outline"
      className="text-xs cursor-pointer hover:bg-muted"
      onClick={onClick}
    >
      <MessageSquare className="mr-1 h-3 w-3" />
      {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
    </Badge>
  )
}

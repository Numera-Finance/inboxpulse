"use client"

import * as React from "react"
import { format } from "date-fns"
import { Loader2, Check, RotateCcw, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Task, TaskComment, AssignableUser } from "@crm/clients"
import { TaskStatus } from "@crm/clients"

interface TaskDetailProps {
  task: Task | null
  comments: TaskComment[]
  assignableUsers: AssignableUser[]
  isLoading?: boolean
  isLoadingComments?: boolean
  onMarkDone: (taskId: string) => void
  onReopen: (taskId: string) => void
  onReassign: (taskId: string, assignedToId: string | null) => void
  onAddComment: (taskId: string, content: string) => void
  isMarkingDone?: boolean
  isReopening?: boolean
  isReassigning?: boolean
  isAddingComment?: boolean
}

export function TaskDetail({
  task,
  comments,
  assignableUsers,
  isLoading,
  isLoadingComments,
  onMarkDone,
  onReopen,
  onReassign,
  onAddComment,
  isMarkingDone,
  isReopening,
  isReassigning,
  isAddingComment,
}: TaskDetailProps) {
  const [newComment, setNewComment] = React.useState("")

  const handleAddComment = () => {
    if (!task || !newComment.trim()) return
    onAddComment(task.id, newComment.trim())
    setNewComment("")
  }

  const handleReassign = (value: string) => {
    if (!task) return
    const assignedToId = value === "unassigned" ? null : value
    onReassign(task.id, assignedToId)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6 space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Separator />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>Select a task to view details</p>
      </div>
    )
  }

  const isDone = task.status === TaskStatus.DONE

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Task Header */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{task.title}</h2>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Customer:</span>
                <span className="text-foreground">{task.customerName || "Unknown"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Assigned:</span>
                <span className="text-foreground">
                  {task.assignedToName || "Unassigned"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Created:</span>
                <span className="text-foreground">
                  {format(new Date(task.createdAt), "MMM d, yyyy")}
                </span>
              </div>
              {task.completedAt && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Completed:</span>
                  <span className="text-foreground">
                    {format(new Date(task.completedAt), "MMM d, yyyy")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Original Email (if from email) */}
          {task.emailId && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="font-medium text-sm text-muted-foreground">
                  Original Email
                </h3>
                {task.emailSubject && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Subject: </span>
                    <span className="font-medium">{task.emailSubject}</span>
                  </div>
                )}
                {task.emailFromEmail && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">From: </span>
                    <span>
                      {task.emailFromName || task.emailFromEmail}
                      {task.emailFromName && (
                        <span className="text-muted-foreground ml-1">
                          &lt;{task.emailFromEmail}&gt;
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {task.emailBody && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-md text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {task.emailBody.length > 500
                      ? `${task.emailBody.substring(0, 500)}...`
                      : task.emailBody}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Comments Section */}
          <Separator />
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">
              Comments ({comments.length})
            </h3>

            {isLoadingComments ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : comments.length > 0 ? (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="p-3 bg-muted/30 rounded-md space-y-1"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{comment.userName}</span>
                      <span className="text-muted-foreground text-xs">
                        {format(new Date(comment.createdAt), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No comments yet</p>
            )}

            {/* Add Comment */}
            <div className="space-y-2">
              <Textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="min-h-[80px] resize-none"
              />
              <Button
                size="sm"
                onClick={handleAddComment}
                disabled={!newComment.trim() || isAddingComment}
              >
                {isAddingComment ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Add Comment
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Action Bar */}
      <Separator />
      <div className="p-4 flex items-center justify-between gap-2 bg-muted/30">
        <Select
          value={task.assignedToId || "unassigned"}
          onValueChange={handleReassign}
          disabled={isReassigning}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Reassign to..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {assignableUsers.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isDone ? (
          <Button
            variant="outline"
            onClick={() => onReopen(task.id)}
            disabled={isReopening}
          >
            {isReopening ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Reopen
          </Button>
        ) : (
          <Button onClick={() => onMarkDone(task.id)} disabled={isMarkingDone}>
            {isMarkingDone ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Resolve
          </Button>
        )}
      </div>
    </div>
  )
}

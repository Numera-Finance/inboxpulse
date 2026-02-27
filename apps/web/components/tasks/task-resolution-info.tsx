"use client"

import { formatDistanceToNow } from "date-fns"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { useTask } from "@/lib/hooks"
import { cn } from "@/lib/utils"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

interface TaskResolutionInfoProps {
  taskId: string
  className?: string
}

export function TaskResolutionInfo({ taskId, className }: TaskResolutionInfoProps) {
  const { data: task } = useTask(taskId)

  if (!task?.problem && !task?.resolution) {
    return null
  }

  const resolverName = task.completedByName || task.assignedToName || null
  const resolvedAt = task.completedAt ? new Date(task.completedAt) : null

  return (
    <div className={cn("bg-muted/50 rounded-lg p-3", className)}>
      {resolverName && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-green-600/10 flex items-center justify-center text-green-600 text-xs font-medium">
              {getInitials(resolverName)}
            </div>
            <span className="text-sm font-medium">{resolverName}</span>
          </div>
          {resolvedAt && (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(resolvedAt, { addSuffix: true })}
            </span>
          )}
        </div>
      )}
      <div className="space-y-1.5 text-sm">
        {task.problem && (
          <div className="flex gap-1.5">
            <AlertCircle size={14} className="text-destructive mt-0.5 flex-shrink-0" />
            <p className="whitespace-pre-wrap">
              <span className="font-medium text-muted-foreground">Problem: </span>
              {task.problem}
            </p>
          </div>
        )}
        {task.resolution && (
          <div className="flex gap-1.5">
            <CheckCircle2 size={14} className="text-green-600 mt-0.5 flex-shrink-0" />
            <p className="whitespace-pre-wrap">
              <span className="font-medium text-muted-foreground">Resolution: </span>
              {task.resolution}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

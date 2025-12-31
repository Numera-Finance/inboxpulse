"use client"

import * as React from "react"
import { formatDistanceToNow } from "date-fns"
import { Circle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Task } from "@crm/clients"
import { TaskStatus } from "@crm/clients"

interface TaskListItemProps {
  task: Task
  isSelected: boolean
  onClick: () => void
}

function TaskListItem({ task, isSelected, onClick }: TaskListItemProps) {
  const isDone = task.status === TaskStatus.DONE

  return (
    <button
      className={cn(
        "w-full text-left p-3 border-b border-border hover:bg-muted/50 transition-colors",
        isSelected && "bg-muted"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {isDone ? (
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
        ) : (
          <Circle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-medium text-sm truncate">
            {task.customerName || "Unknown Customer"}
          </div>
          <div className={cn(
            "text-sm truncate",
            isDone ? "text-muted-foreground line-through" : "text-foreground"
          )}>
            {task.title}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{task.assignedToName || "Unassigned"}</span>
            <span>·</span>
            <span>
              {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

interface TaskListProps {
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (task: Task) => void
  isLoading?: boolean
}

export function TaskList({
  tasks,
  selectedTaskId,
  onSelectTask,
  isLoading,
}: TaskListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
        <p className="text-sm">No tasks found</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {tasks.map((task) => (
        <TaskListItem
          key={task.id}
          task={task}
          isSelected={task.id === selectedTaskId}
          onClick={() => onSelectTask(task)}
        />
      ))}
    </div>
  )
}

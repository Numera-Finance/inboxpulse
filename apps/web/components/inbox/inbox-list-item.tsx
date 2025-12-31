"use client"

import * as React from "react"
import { Star, Paperclip, MessageSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { SentimentIndicator } from "@/components/ui/sentiment-indicator"
import { ClassificationIndicator } from "@/components/ui/classification-indicator"
import { cn } from "@/lib/utils"
import type { InboxItem, InboxListItemProps } from "./types"

/**
 * Format timestamp to display string
 */
function formatTimestamp(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    // Today - show time
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  } else if (diffDays === 1) {
    return "Yesterday"
  } else if (diffDays < 7) {
    // This week - show day name
    return date.toLocaleDateString([], { weekday: "short" })
  } else {
    // Older - show date
    return date.toLocaleDateString([], { month: "short", day: "numeric" })
  }
}

/**
 * Get priority badge styling
 */
function getPriorityStyle(priority?: string) {
  switch (priority?.toLowerCase()) {
    case "critical":
      return "border-destructive text-destructive"
    case "high":
      return "border-amber-500 text-amber-500"
    case "medium":
      return "border-primary text-primary"
    case "low":
      return "border-muted-foreground text-muted-foreground"
    default:
      return "border-muted-foreground text-muted-foreground"
  }
}

/**
 * Get status badge styling
 */
function getStatusStyle(status?: string) {
  switch (status?.toLowerCase()) {
    case "open":
      return "border-destructive text-destructive"
    case "in_progress":
      return "border-primary text-primary"
    case "resolved":
      return "border-green-500 text-green-500"
    case "archived":
      return "border-muted-foreground text-muted-foreground"
    default:
      return "border-muted-foreground text-muted-foreground"
  }
}

/**
 * Format status for display
 */
function formatStatus(status?: string): string {
  if (!status) return ""
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * InboxListItem - Reusable list item for both emails and tasks
 *
 * Renders a compact list item with:
 * - Sender/customer name with optional star
 * - Subject line
 * - Preview text
 * - Priority and status badges
 * - Timestamp
 * - Thread count (if applicable)
 * - Attachment indicator
 *
 * Memoized to prevent unnecessary re-renders when parent state changes.
 */
export const InboxListItem = React.memo(function InboxListItem({
  item,
  isSelected,
  onClick,
  onItemClick,
  config,
  showCheckbox = false,
  isChecked = false,
  onCheckChange,
}: InboxListItemProps) {
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleClick = React.useCallback(() => {
    if (onItemClick) {
      onItemClick(item.id)
    } else if (onClick) {
      onClick()
    }
  }, [item.id, onItemClick, onClick])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 transition-colors cursor-pointer overflow-hidden",
        !item.isRead && !isSelected && "bg-primary/5",
        isSelected && "bg-accent border-l-2 border-l-primary"
      )}
    >
      <div className="flex items-start gap-3 w-full">
        {/* Checkbox for multi-select */}
        {showCheckbox && (
          <div onClick={handleCheckboxClick} className="pt-0.5 flex-shrink-0">
            <Checkbox
              checked={isChecked}
              onCheckedChange={(checked) => onCheckChange?.(checked as boolean)}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 w-0">
          {/* Header row: Sender/Customer + Assigned User + Star + Time */}
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 min-w-0 w-0 flex items-center gap-2">
              <span
                className={cn(
                  "text-sm block overflow-hidden text-ellipsis whitespace-nowrap",
                  !item.isRead ? "font-semibold" : "font-medium"
                )}
              >
                {config.showCustomer && item.customerName
                  ? item.customerName
                  : item.sender.name}
              </span>
              {/* Assigned user (for tasks) */}
              {config.itemType === 'task' && (
                <>
                  <span className="text-muted-foreground text-xs">•</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {item.recipients && item.recipients.length > 0 && item.recipients[0].name?.trim()
                      ? item.recipients[0].name
                      : "Unassigned"}
                  </span>
                </>
              )}
              {item.isStarred && (
                <Star className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />
              )}
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatTimestamp(item.timestamp)}
            </span>
          </div>

          {/* Subject line */}
          <div className="flex items-center gap-2 mb-1">
            <p
              className={cn(
                "text-sm overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 w-0",
                !item.isRead && "font-medium"
              )}
            >
              {item.subject}
            </p>
            {/* Classification indicator (spam/marketing/etc) */}
            {item.classification && item.classification.value !== 'business' && (
              <ClassificationIndicator classification={item.classification} size="sm" variant="icon" />
            )}
            {/* Sentiment indicator */}
            {item.sentiment && (
              <SentimentIndicator sentiment={item.sentiment} size="sm" variant="icon" />
            )}
            {/* Thread count */}
            {config.showThreadCount && item.threadCount && item.threadCount > 1 && (
              <div className="flex items-center gap-0.5 text-xs text-muted-foreground flex-shrink-0">
                <MessageSquare className="h-3 w-3" />
                {item.threadCount}
              </div>
            )}
            {/* Attachment indicator */}
            {item.hasAttachments && (
              <Paperclip className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            )}
          </div>

          {/* Preview text */}
          <p className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
            {item.preview}
          </p>

          {/* Badges row - show for tasks or when priority/status exists */}
          {(config.showPriority || item.status) && (item.priority || item.status) && (
            <div className="flex items-center gap-2 mt-2">
              {config.showPriority && item.priority && (
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", getPriorityStyle(item.priority))}
                >
                  {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                </Badge>
              )}
              {item.status && (
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", getStatusStyle(item.status))}
                >
                  {formatStatus(item.status)}
                </Badge>
              )}
              {/* Labels */}
              {item.labels && item.labels.length > 0 && (
                <span className="text-[10px] text-muted-foreground truncate">
                  {item.labels.slice(0, 2).join(", ")}
                  {item.labels.length > 2 && ` +${item.labels.length - 2}`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

"use client"

import * as React from "react"
import {
  Building2,
  Mail,
  Clock,
  User,
  CheckCircle,
  Trash2,
  Star,
  Archive,
  Paperclip,
  Download,
  Loader2,
  Pencil,
  Send,
  MessageSquare,
  Check,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SentimentIndicator } from "@/components/ui/sentiment-indicator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Textarea } from "@/components/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { useUsers } from "@/lib/hooks"
import type { InboxDetailPanelProps, InboxItemContent, InboxComment } from "./types"

/**
 * Format timestamp for display
 */
function formatTimestamp(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Get priority badge styling
 */
function getPriorityStyle(priority?: string) {
  switch (priority?.toLowerCase()) {
    case "critical":
      return "bg-destructive text-destructive-foreground"
    case "high":
      return "bg-amber-500 text-white"
    case "medium":
      return "bg-primary text-primary-foreground"
    case "low":
      return "bg-muted text-muted-foreground"
    default:
      return "bg-muted text-muted-foreground"
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
 * Get initials from name
 */
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * Sanitize email HTML to handle cid: URLs, remove style tags, and prevent CSS leakage
 */
function sanitizeEmailHtml(html: string): string {
  let sanitized = html;

  // Remove all <style> tags and their contents to prevent CSS leakage
  sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove style attributes from elements that could affect global styles
  sanitized = sanitized.replace(/<(html|head|body)([^>]*)>/gi, '<div$2>');
  sanitized = sanitized.replace(/<\/(html|head|body)>/gi, '</div>');

  // Replace cid: image sources with a placeholder
  sanitized = sanitized.replace(
    /<img([^>]*)\ssrc=["']cid:[^"']+["']([^>]*)>/gi,
    '<span class="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">[Embedded image]</span>'
  );

  return sanitized;
}

/**
 * Comments section component
 */
function CommentsSection({
  comments,
  itemId,
  onAddComment,
}: {
  comments?: InboxComment[]
  itemId: string
  onAddComment?: (itemId: string, content: string) => Promise<void>
}) {
  const [newComment, setNewComment] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = async () => {
    if (!newComment.trim() || !onAddComment) return
    setIsSubmitting(true)
    try {
      await onAddComment(itemId, newComment.trim())
      setNewComment("")
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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Comments</h3>
        {comments && comments.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {comments.length}
          </Badge>
        )}
      </div>

      {/* Comments list */}
      {comments && comments.length > 0 ? (
        <div className="space-y-3">
          {comments.map((comment) => (
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
                  {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
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
      {onAddComment && (
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
      )}
    </div>
  )
}

/**
 * Email message component for thread display
 */
function MessageContent({ message }: { message: InboxItemContent }) {
  return (
    <div className="mb-4">
      {/* Message header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
          {getInitials(message.from.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">{message.from.name}</p>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(message.timestamp)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {message.from.email}
          </p>
        </div>
      </div>

      {/* Recipients */}
      <div className="pl-[52px]">
        {message.to && message.to.length > 0 && (
          <div className="text-sm text-muted-foreground mb-2">
            <span>To: {message.to.map((r) => r.email).join(", ")}</span>
          </div>
        )}
        {message.cc && message.cc.length > 0 && (
          <div className="text-sm text-muted-foreground mb-2">
            <span>Cc: {message.cc.map((r) => r.email).join(", ")}</span>
          </div>
        )}

        {/* Body */}
        <div className="prose prose-sm dark:prose-invert max-w-none [&_*]:border-0">
          {message.bodyFormat === "html" ? (
            <div
              className="text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.body) }}
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-transparent p-0 m-0">
              {message.body}
            </pre>
          )}
        </div>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              {message.attachments.length} attachment
              {message.attachments.length > 1 ? "s" : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url || "#"}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors text-sm"
                >
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate max-w-[200px]">{attachment.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({formatFileSize(attachment.size)})
                  </span>
                  <Download className="h-3 w-3 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * InboxDetailPanel - Reusable detail panel for both emails and tasks
 *
 * Shows:
 * - Toolbar with actions (archive, delete, star, etc.)
 * - Item header with subject, priority, status badges
 * - Meta info grid (customer, assignee, response time, etc.)
 * - Message content/body
 * - Thread messages (for email threads)
 * - Reply/Forward actions
 */
export function InboxDetailPanel({
  item,
  content,
  isLoading,
  callbacks,
  config,
  customActions,
}: InboxDetailPanelProps) {
  const [assigneeOpen, setAssigneeOpen] = React.useState(false)
  const [assigneeSearch, setAssigneeSearch] = React.useState("")
  const [isAssigning, setIsAssigning] = React.useState(false)
  const commentsSectionRef = React.useRef<HTMLDivElement>(null)

  const scrollToComments = () => {
    commentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Local state for optimistic updates
  const [localAssignee, setLocalAssignee] = React.useState<{ id?: string; name: string } | null>(null)
  const [localComments, setLocalComments] = React.useState<InboxComment[] | null>(null)

  // Sync local state from props when item changes
  const itemId = item?.id
  React.useEffect(() => {
    if (item?.recipients?.[0]) {
      setLocalAssignee({ id: item.recipients[0].id, name: item.recipients[0].name })
    } else {
      setLocalAssignee(null)
    }
  }, [itemId]) // Only reset when item ID changes, not on every prop update

  React.useEffect(() => {
    if (content?.comments) {
      setLocalComments(content.comments)
    }
  }, [itemId]) // Only reset when item ID changes

  // Use local state if available, otherwise fall back to props
  const displayAssignee = localAssignee ?? (item?.recipients?.[0] ? { id: item.recipients[0].id, name: item.recipients[0].name } : null)
  const displayComments = localComments ?? content?.comments

  // Fetch users for assignment dropdown
  const { data: usersData } = useUsers({
    queries: [],
    sortBy: 'firstName',
    sortOrder: 'asc',
    limit: 500,
    offset: 0,
  })

  // Transform users to simple format and filter by search term
  const filteredUsers = React.useMemo(() => {
    const users = usersData?.items || []
    const transformed = users
      .filter(u => u.canLogin !== false) // Only users who can login
      .map(u => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
      }))

    if (!assigneeSearch) return transformed
    const searchLower = assigneeSearch.toLowerCase()
    return transformed.filter((user) =>
      user.name.toLowerCase().includes(searchLower)
    )
  }, [usersData, assigneeSearch])

  const handleAssign = async (userId: string) => {
    if (!callbacks.onAssign || !item) return

    // Find the user name for optimistic update
    const user = filteredUsers.find(u => u.id === userId)
    if (user) {
      // Optimistically update local state
      setLocalAssignee({ id: userId, name: user.name })
    }

    setAssigneeOpen(false)
    setAssigneeSearch("")
    setIsAssigning(true)

    try {
      await callbacks.onAssign(item.id, userId)
    } catch (error) {
      console.error("Failed to assign:", error)
      // Revert optimistic update on error
      if (item.recipients?.[0]) {
        setLocalAssignee({ id: item.recipients[0].id, name: item.recipients[0].name })
      } else {
        setLocalAssignee(null)
      }
    } finally {
      setIsAssigning(false)
    }
  }

  // Handle add comment with optimistic update
  const handleAddComment = React.useCallback(async (taskId: string, commentContent: string) => {
    if (!callbacks.onAddComment) return

    // Create optimistic comment
    const optimisticComment: InboxComment = {
      id: `temp-${Date.now()}`,
      content: commentContent,
      userId: 'current-user',
      userName: 'You',
      createdAt: new Date(),
    }

    // Optimistically add comment - use current displayComments as base if localComments is null
    setLocalComments(prev => {
      const currentComments = prev ?? content?.comments ?? []
      return [...currentComments, optimisticComment]
    })

    try {
      await callbacks.onAddComment(taskId, commentContent)
    } catch (error) {
      console.error("Failed to add comment:", error)
      // Revert optimistic update on error
      setLocalComments(prev => prev?.filter(c => c.id !== optimisticComment.id) || null)
    }
  }, [callbacks.onAddComment, content?.comments])

  // Empty state
  if (!item) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Mail className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>Select an item to view details</p>
        </div>
      </div>
    )
  }

  // Loading state - only show if we don't have content yet (prevents flash on refetch)
  if (isLoading && !content) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin opacity-50" />
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  const isTask = config.itemType === "task"
  const isEmail = config.itemType === "email"

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-1">
        <div className="flex items-center gap-1">
          {callbacks.onArchive && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => callbacks.onArchive?.([item.id])}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Archive</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {callbacks.onDelete && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => callbacks.onDelete?.([item.id])}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {(callbacks.onArchive || callbacks.onDelete) && (
            <Separator orientation="vertical" className="mx-1 h-6" />
          )}
          {callbacks.onStar && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => callbacks.onStar?.(item.id, !item.isStarred)}
                  >
                    <Star
                      className={cn(
                        "h-4 w-4",
                        item.isStarred && "fill-amber-500 text-amber-500"
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{item.isStarred ? "Unstar" : "Star"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Custom actions slot */}
          {customActions}
        </div>
      </div>

      <ScrollArea className="flex-1 h-0 min-h-0 border-0 border-t-0">
        <div className="px-4 pb-4 pt-2">
          {/* Header */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="text-xl font-semibold flex-1">{item.subject}</h2>
              {item.sentiment && (
                <SentimentIndicator sentiment={item.sentiment} size="md" showLabel />
              )}
              {/* Task-specific: Done button on same line as subject */}
              {isTask && callbacks.onResolve && item.status !== "resolved" && (
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-sm"
                  onClick={() => callbacks.onResolve?.(item.id)}
                >
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                  Done
                </Button>
              )}
            </div>
            {(item.isStarred || item.priority || item.status || (isTask && displayComments)) && (
              <div className="flex items-center gap-2 flex-wrap">
                {item.isStarred && (
                  <Badge className="bg-amber-500/10 text-amber-600 border-0 text-xs">
                    <Star className="mr-1 h-3 w-3 fill-current" />
                    Starred
                  </Badge>
                )}
                {item.priority && (
                  <Badge className={cn("text-xs", getPriorityStyle(item.priority))}>
                    {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                  </Badge>
                )}
                {item.status && (
                  <Badge
                    variant="outline"
                    className={cn("text-xs", getStatusStyle(item.status))}
                  >
                    {formatStatus(item.status)}
                  </Badge>
                )}
                {isTask && displayComments && displayComments.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-muted"
                    onClick={scrollToComments}
                  >
                    <MessageSquare className="mr-1 h-3 w-3" />
                    {displayComments.length} {displayComments.length === 1 ? 'Comment' : 'Comments'}
                  </Badge>
                )}
              </div>
            )}

            {/* Meta info grid - primarily for tasks */}
            {isTask && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-3 rounded-lg bg-muted/50 text-sm mt-3 border-0">
                {item.customerName && (
                  <div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Building2 className="h-3 w-3" />
                      Customer
                    </div>
                    <p className="font-medium">{item.customerName}</p>
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <User className="h-3 w-3" />
                    Assigned To
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="font-medium">
                      {displayAssignee?.name || "Unassigned"}
                    </p>
                    {callbacks.onAssign && (
                      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            disabled={isAssigning}
                          >
                            {isAssigning ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[220px] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Search users..."
                              value={assigneeSearch}
                              onValueChange={setAssigneeSearch}
                            />
                            <CommandList>
                              <CommandEmpty>No users found.</CommandEmpty>
                              <CommandGroup>
                                {filteredUsers.map((user) => {
                                  const isSelected = displayAssignee?.id === user.id
                                  return (
                                    <CommandItem
                                      key={user.id}
                                      value={user.id}
                                      onSelect={() => handleAssign(user.id)}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          isSelected ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                      {user.name}
                                    </CommandItem>
                                  )
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <Clock className="h-3 w-3" />
                    Open
                  </div>
                  <p className="font-medium">{formatDistanceToNow(item.timestamp, { addSuffix: false })}</p>
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          {content ? (
            <>
              <MessageContent message={content} />

              {/* Thread messages */}
              {content.threadMessages && content.threadMessages.length > 0 && (
                <div className="space-y-4 mt-4">
                  {content.threadMessages.map((message, index) => (
                    <div key={message.id || index}>
                      {index > 0 && <Separator className="my-4" />}
                      <MessageContent message={message} />
                    </div>
                  ))}
                </div>
              )}

              {/* Comments section for tasks */}
              {isTask && (
                <div ref={commentsSectionRef}>
                  <Separator className="my-4" />
                  <CommentsSection
                    comments={displayComments}
                    itemId={item.id}
                    onAddComment={handleAddComment}
                  />
                </div>
              )}
            </>
          ) : (
            // Fallback to preview if content not loaded
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                {getInitials(item.sender.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{item.sender.name}</p>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(item.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {item.sender.email}
                </p>
              </div>
            </div>
          )}

        </div>
      </ScrollArea>
    </div>
  )
}

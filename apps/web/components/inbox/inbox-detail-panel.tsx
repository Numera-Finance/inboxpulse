"use client"

import * as React from "react"
import {
  Mail,
  Trash2,
  Star,
  Archive,
  Paperclip,
  Download,
  Loader2,
  ChevronDown,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SentimentIndicator } from "@/components/ui/sentiment-indicator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  InboxDetailPanelProps,
  InboxItemContent,
  InboxParticipant,
} from "./types"
import {
  participantDetail,
  participantLabel,
  summarizeRecipients,
} from "./recipients"

/**
 * Format an absolute, full timestamp (weekday, date, year, time) for the detail
 * view. Distinct from the relative inbox-list formatter in `formatTimestamp`.
 */
function formatFullTimestamp(date: Date): string {
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
 * The one-line "to a, b, cc c" summary shown under the sender. Labels each
 * group so a mixed summary can't be misread as all-To.
 */
function RecipientSummary({
  to,
  cc,
}: {
  to: InboxParticipant[]
  cc: InboxParticipant[]
}) {
  return (
    <>
      {to.length > 0 && <>to {to.map(participantLabel).join(", ")}</>}
      {to.length > 0 && cc.length > 0 && ", "}
      {cc.length > 0 && <>cc {cc.map(participantLabel).join(", ")}</>}
    </>
  )
}

/**
 * Email message component for thread display
 */
function MessageContent({ message }: { message: InboxItemContent }) {
  // Recipients are disclosed on demand rather than given permanent rows: on a
  // reply chain the addresses are the least-read part of the header, and two
  // fixed rows push the body itself below the fold.
  const [showRecipients, setShowRecipients] = React.useState(false)

  // Selecting another item swaps `message` without remounting this component,
  // so the expanded state has to be dropped explicitly. Left alone, a message
  // with three or fewer recipients renders the expanded block while drawing no
  // chevron to close it — the toggle only exists when something is hidden.
  const [shownFor, setShownFor] = React.useState(message.id)
  if (shownFor !== message.id) {
    setShownFor(message.id)
    setShowRecipients(false)
  }

  const to = message.to ?? []
  const cc = message.cc ?? []
  const recipientCount = to.length + cc.length
  const { shownTo, shownCc, hiddenCount } = summarizeRecipients(to, cc)

  return (
    <div className="mb-4">
      {/* Message header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
          {getInitials(message.from.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <p className="font-medium text-sm truncate">{message.from.name}</p>
              <span className="text-xs text-muted-foreground truncate">
                {message.from.email}
              </span>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatFullTimestamp(message.timestamp)}
            </span>
          </div>
          <div className="flex items-center gap-x-1.5 flex-wrap min-w-0 text-xs text-muted-foreground">
            {recipientCount > 0 &&
              (hiddenCount > 0 ? (
                // More recipients than fit the summary — the whole line becomes
                // the affordance for revealing the rest.
                <button
                  type="button"
                  onClick={() => setShowRecipients((shown) => !shown)}
                  aria-expanded={showRecipients}
                  className="flex items-center gap-1 min-w-0 text-left rounded px-1 -mx-1 hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <span className="break-words [overflow-wrap:anywhere]">
                    <RecipientSummary to={shownTo} cc={shownCc} />
                  </span>
                  <span className="shrink-0">+{hiddenCount}</span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform",
                      showRecipients && "rotate-180"
                    )}
                  />
                </button>
              ) : (
                // Everyone already fits, so there is nothing to expand into.
                <span className="break-words [overflow-wrap:anywhere]">
                  <RecipientSummary to={shownTo} cc={shownCc} />
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Recipients */}
      <div className="pl-[52px]">
        {showRecipients && (
          <div className="mb-3 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground space-y-1">
            {to.length > 0 && (
              <div className="break-words [overflow-wrap:anywhere]">
                <span className="text-xs uppercase tracking-wide mr-2">To</span>
                {to.map(participantDetail).join(", ")}
              </div>
            )}
            {cc.length > 0 && (
              <div className="break-words [overflow-wrap:anywhere]">
                <span className="text-xs uppercase tracking-wide mr-2">Cc</span>
                {cc.map(participantDetail).join(", ")}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto [&_*]:border-0 [&_*]:max-w-full">
          {message.bodyFormat === "html" ? (
            <div
              className="text-sm leading-relaxed break-words [overflow-wrap:anywhere]"
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
 * InboxDetailPanel - Generic detail panel for emails and tasks
 *
 * This component is intentionally generic. Task-specific features (meta info,
 * comments, assignment) should be passed via render props.
 *
 * Shows:
 * - Toolbar with actions (archive, delete, star, etc.)
 * - Item header with subject, priority, status badges
 * - Message content/body
 * - Thread messages (for email threads)
 *
 * Render props for customization:
 * - headerActions: Actions next to subject (e.g., "Done" button)
 * - headerBadges: Additional badges (e.g., comment count)
 * - metaInfo: Meta information grid (e.g., customer, assignee)
 * - afterContent: Content after messages (e.g., comments section)
 */
export function InboxDetailPanel({
  item,
  content,
  isLoading,
  callbacks,
  config,
  customActions,
  headerActions,
  metaInfo,
  headerBadges,
  afterContent,
}: InboxDetailPanelProps) {
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

  // Loading state - show if loading and either no content or content is for a different item
  if (isLoading && (!content || content.id !== item.id)) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin opacity-50" />
          <p>Loading...</p>
        </div>
      </div>
    )
  }

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

      <div className="flex-1 h-0 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="px-4 pb-4 pt-2">
          {/* Header */}
          <div className="mb-4">
            <div className="flex items-start gap-2 mb-2">
              <h2 className="text-xl font-semibold min-w-0 flex-1">{item.subject}</h2>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.sentiment && (
                  <SentimentIndicator sentiment={item.sentiment} size="md" showLabel />
                )}
                {/* Header actions slot (e.g., "Done" button for tasks) */}
                {headerActions}
              </div>
            </div>
            {(item.isStarred || item.priority || item.status || headerBadges) && (
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
                {/* Header badges slot (e.g., comment count) */}
                {headerBadges}
              </div>
            )}

            {/* Meta info slot (e.g., customer, assignee, open time for tasks) */}
            {metaInfo && <div className="mt-3">{metaInfo}</div>}
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
                    {formatFullTimestamp(item.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {item.sender.email}
                </p>
              </div>
            </div>
          )}

          {/* After content slot - always shown when item is selected */}
          {/* Rendered outside content conditional so it can load independently */}
          {afterContent}

        </div>
      </div>
    </div>
  )
}

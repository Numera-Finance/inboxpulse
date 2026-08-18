/**
 * Adapters for converting source data to InboxItem format
 *
 * These adapters normalize different data sources (emails, escalations/tasks)
 * into the common InboxItem format used by the inbox components.
 */

import type { Email as FrontendEmail } from "@/lib/types"
import type { Escalation } from "@/lib/data"
import type { Task, TaskComment, AnalyzedEmail, AnalyzedEmailListItem, EmailThread } from "@crm/clients"
import { Signal, hasSignal } from "@crm/shared"
import type {
  InboxItem,
  InboxItemContent,
  InboxItemAdapter,
  InboxContentAdapter,
  InboxPriority,
  InboxStatus,
  InboxSentiment,
  InboxClassification,
} from "./types"
import { getClassificationFromSignals, getSentimentFromSignals } from "@crm/shared"
import { TaskStatus } from "@crm/clients"

// =============================================================================
// Email Adapters
// =============================================================================

/**
 * Convert frontend Email type to InboxItem
 */
export const emailToInboxItem: InboxItemAdapter<FrontendEmail> = (
  email
): InboxItem<FrontendEmail> => {
  // Extract sender name from email address if not available
  const senderName = extractNameFromEmail(email.from)

  // Parse date string to Date object
  const timestamp = parseDate(email.date)

  return {
    id: email.id,
    type: "email",
    subject: email.subject,
    preview: truncateText(email.body, 100),
    timestamp,
    isRead: true, // Default to read for mock data
    isStarred: false,
    sender: {
      name: senderName,
      email: email.from,
    },
    recipients: email.to
      ? [
          {
            name: extractNameFromEmail(email.to),
            email: email.to,
          },
        ]
      : [],
    hasAttachments: false,
    originalData: email,
  }
}

/**
 * Convert frontend Email type to InboxItemContent
 */
export const emailToInboxContent: InboxContentAdapter<FrontendEmail> = (
  email
): InboxItemContent => {
  const senderName = extractNameFromEmail(email.from)
  const timestamp = parseDate(email.date)

  return {
    id: email.id,
    subject: email.subject,
    body: email.body,
    bodyFormat: "text",
    from: {
      name: senderName,
      email: email.from,
    },
    to: email.to
      ? [
          {
            name: extractNameFromEmail(email.to),
            email: email.to,
          },
        ]
      : [],
    timestamp,
    attachments: [],
  }
}

// =============================================================================
// Escalation/Task Adapters
// =============================================================================

/**
 * Map escalation priority to inbox priority
 */
function mapPriority(priority: Escalation["priority"]): InboxPriority {
  const mapping: Record<Escalation["priority"], InboxPriority> = {
    Critical: "critical",
    High: "high",
    Medium: "medium",
    Low: "low",
  }
  return mapping[priority]
}

/**
 * Map escalation status to inbox status
 */
function mapStatus(status: Escalation["status"]): InboxStatus {
  const mapping: Record<Escalation["status"], InboxStatus> = {
    Open: "open",
    "In Progress": "in_progress",
    Resolved: "resolved",
  }
  return mapping[status]
}

/**
 * Convert Escalation type to InboxItem
 */
export const escalationToInboxItem: InboxItemAdapter<Escalation> = (
  escalation
): InboxItem<Escalation> => {
  // Parse created date string to Date object
  const timestamp = parseRelativeDate(escalation.created)

  // Extract sender name from contact email
  const senderName = extractNameFromEmail(escalation.contactEmail)

  return {
    id: escalation.id,
    type: "task",
    subject: escalation.title,
    preview: truncateText(escalation.description, 100),
    timestamp,
    isRead: escalation.status !== "Open", // Unread if open
    isStarred: escalation.isPremier,
    sender: {
      name: senderName,
      email: escalation.contactEmail,
    },
    recipients: [
      {
        name: escalation.assignedTo,
      },
    ],
    status: mapStatus(escalation.status),
    priority: mapPriority(escalation.priority),
    customerId: escalation.customerId,
    customerName: escalation.customerName,
    originalData: escalation,
  }
}

/**
 * Convert Escalation type to InboxItemContent
 */
export const escalationToInboxContent: InboxContentAdapter<Escalation> = (
  escalation
): InboxItemContent => {
  const timestamp = parseRelativeDate(escalation.created)
  const senderName = extractNameFromEmail(escalation.contactEmail)

  // Generate email-like body from escalation
  const body = generateEscalationBody(escalation)

  return {
    id: escalation.id,
    subject: escalation.title,
    body,
    bodyFormat: "text",
    from: {
      name: senderName,
      email: escalation.contactEmail,
    },
    to: [
      {
        name: escalation.assignedTo,
        email: "support@company.com",
      },
    ],
    timestamp,
    metadata: {
      priority: escalation.priority,
      status: escalation.status,
      responseTime: escalation.responseTime,
      lastUpdate: escalation.lastUpdate,
      isPremier: escalation.isPremier,
    },
  }
}

// =============================================================================
// API Email Adapters (for real API data)
// =============================================================================

/**
 * API Email Response type (from @crm/clients EmailResponse)
 * This matches the actual format returned by the API
 */
export interface ApiEmailResponse {
  id: string
  tenantId: string
  threadId: string
  integrationId?: string | null
  provider: string
  messageId: string
  subject: string
  body?: string | null
  fromEmail: string
  fromName?: string | null
  tos?: Array<{ email: string; name?: string }> | null
  ccs?: Array<{ email: string; name?: string }> | null
  bccs?: Array<{ email: string; name?: string }> | null
  priority: string
  labels?: string[] | null
  receivedAt: string
  metadata?: Record<string, unknown> | null
  sentiment?: string | null
  sentimentScore?: string | null
  isEscalation?: boolean | null
  signals?: number[] | null
  analysisStatus?: number | null
  createdAt: string
  updatedAt: string
}

/**
 * Parse sentiment from API response
 */
function parseSentiment(sentiment?: string | null, score?: string | null): InboxSentiment | undefined {
  if (!sentiment) return undefined
  const value = sentiment.toLowerCase() as 'positive' | 'negative' | 'neutral'
  if (!['positive', 'negative', 'neutral'].includes(value)) return undefined
  return {
    value,
    confidence: score ? parseFloat(score) : 0.5,
  }
}

/**
 * Parse classification from signals array
 */
function parseClassification(signals?: number[] | null): InboxClassification | undefined {
  if (!signals || signals.length === 0) return undefined
  const classification = getClassificationFromSignals(signals)
  if (!classification) return undefined
  return {
    value: classification,
    // Classification confidence is not stored in signals, so we omit it
  }
}

/**
 * Parse sentiment from signals array
 */
function parseSentimentFromSignals(signals?: number[] | null): InboxSentiment | undefined {
  if (!signals || signals.length === 0) return undefined
  const sentiment = getSentimentFromSignals(signals)
  if (!sentiment) return undefined
  return { value: sentiment, confidence: 0.5 }
}

/**
 * Convert API EmailResponse to InboxItem
 */
export const apiEmailToInboxItem: InboxItemAdapter<ApiEmailResponse> = (
  email
): InboxItem<ApiEmailResponse> => {
  const timestamp = new Date(email.receivedAt)

  return {
    id: email.id,
    type: "email",
    subject: email.subject || "(No Subject)",
    preview: truncateText(stripHtml(email.body || ""), 100),
    timestamp,
    isRead: true, // API doesn't track read status yet
    isStarred: false,
    sender: {
      name: email.fromName || extractNameFromEmail(email.fromEmail),
      email: email.fromEmail,
    },
    recipients: email.tos?.map((to) => ({
      name: to.name || extractNameFromEmail(to.email),
      email: to.email,
    })),
    threadId: email.threadId,
    hasAttachments: false, // API doesn't track attachments yet
    labels: email.labels || undefined,
    sentiment: parseSentiment(email.sentiment, email.sentimentScore),
    classification: parseClassification(email.signals),
    isEscalation: email.isEscalation ?? false,
    signals: email.signals ?? undefined,
    originalData: email,
  }
}

/**
 * Convert API EmailResponse to InboxItemContent
 */
export const apiEmailToInboxContent: InboxContentAdapter<ApiEmailResponse> = (
  email
): InboxItemContent => {
  const timestamp = new Date(email.receivedAt)

  return {
    id: email.id,
    subject: email.subject || "(No Subject)",
    body: email.body || "",
    bodyFormat: "html", // API emails are typically HTML
    from: {
      name: email.fromName || extractNameFromEmail(email.fromEmail),
      email: email.fromEmail,
    },
    to: email.tos?.map((to) => ({
      name: to.name || extractNameFromEmail(to.email),
      email: to.email,
    })),
    cc: email.ccs?.map((cc) => ({
      name: cc.name || extractNameFromEmail(cc.email),
      email: cc.email,
    })),
    bcc: email.bccs?.map((bcc) => ({
      name: bcc.name || extractNameFromEmail(bcc.email),
      email: bcc.email,
    })),
    timestamp,
    attachments: [], // TODO: Add attachment mapping when available
    metadata: {
      sentiment: email.sentiment,
      sentimentScore: email.sentimentScore,
      priority: email.priority,
      provider: email.provider,
    },
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract display name from email address
 * e.g., "john.doe@example.com" -> "John Doe"
 */
function extractNameFromEmail(email: string): string {
  const localPart = email.split("@")[0]
  return localPart
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/**
 * Truncate text to specified length
 */
function truncateText(text: string, maxLength: number): string {
  if (!text) return ""
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + "..."
}

/**
 * Strip HTML tags from text for preview
 */
function stripHtml(html: string): string {
  if (!html) return ""
  // Remove HTML tags and decode common entities
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr: string): Date {
  const parsed = new Date(dateStr)
  return isNaN(parsed.getTime()) ? new Date() : parsed
}

/**
 * Parse relative date string like "2 hours ago" to Date object
 */
function parseRelativeDate(relativeStr: string): Date {
  const now = new Date()

  // Match patterns like "2 hours ago", "1 day ago", "30 mins ago"
  const match = relativeStr.match(/(\d+)\s*(min|hour|day|week|month)s?\s*ago/i)

  if (!match) {
    return now
  }

  const amount = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  const msPerUnit: Record<string, number> = {
    min: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  }

  return new Date(now.getTime() - amount * (msPerUnit[unit] || 0))
}

/**
 * Generate email-like body from escalation data
 */
function generateEscalationBody(escalation: Escalation): string {
  const senderName = extractNameFromEmail(escalation.contactEmail)

  return `Dear Support Team,

${escalation.description}

We have been experiencing this issue and it's becoming increasingly critical for our operations. Our team has tried several workarounds but none have been successful.

This is affecting our production environment and we need immediate assistance to resolve this matter.

Please prioritize this request as we are a ${escalation.isPremier ? "Premier" : "Standard"} customer and this is impacting our SLA.

Best regards,
${senderName}
${escalation.customerName}`
}

// =============================================================================
// API Task Adapters (for real task data from API)
// =============================================================================

/**
 * Map API task status to inbox status
 */
function mapApiTaskStatus(status: number): InboxStatus {
  return status === TaskStatus.DONE ? "resolved" : "open"
}

/**
 * Convert API Task to InboxItem
 */
export const apiTaskToInboxItem: InboxItemAdapter<Task> = (
  task
): InboxItem<Task> => {
  const timestamp = new Date(task.createdAt)

  return {
    id: task.id,
    type: "task",
    subject: task.title,
    preview: task.emailSubject ? `Re: ${task.emailSubject}` : task.title,
    timestamp,
    isRead: task.status === TaskStatus.DONE,
    isStarred: false,
    sender: {
      name: task.emailFromName || task.emailFromEmail || task.customerName || "Unknown",
      email: task.emailFromEmail || "",
    },
    recipients: task.assignedToName
      ? [{ name: task.assignedToName, id: task.assignedToId || undefined }]
      : [],
    status: mapApiTaskStatus(task.status),
    customerId: task.customerId,
    customerName: task.customerName || undefined,
    originalData: task,
  }
}

/**
 * Extended task type with comments for content adapter
 */
export interface TaskWithComments extends Task {
  comments?: TaskComment[]
}

/**
 * Convert API Task to InboxItemContent
 */
export const apiTaskToInboxContent: InboxContentAdapter<TaskWithComments> = (
  task
): InboxItemContent => {
  const timestamp = new Date(task.createdAt)

  // Build body from email content or task title
  let body = ""
  if (task.emailBody) {
    body = task.emailBody
  } else {
    body = task.title
  }

  // Convert task comments to inbox comments
  const comments = task.comments?.map((comment) => ({
    id: comment.id,
    content: comment.content,
    userId: comment.userId,
    userName: comment.userName || "Unknown",
    createdAt: new Date(comment.createdAt),
  }))

  return {
    id: task.id,
    subject: task.title,
    body,
    bodyFormat: "html",
    from: {
      name: task.emailFromName || task.emailFromEmail || task.customerName || "Unknown",
      email: task.emailFromEmail || "",
    },
    to: task.assignedToName
      ? [{ name: task.assignedToName, id: task.assignedToId || undefined }]
      : [],
    timestamp,
    comments,
    metadata: {
      status: task.status,
      customerId: task.customerId,
      customerName: task.customerName,
      emailId: task.emailId,
      createdBySystem: task.createdBySystem,
      completedAt: task.completedAt,
    },
  }
}

// =============================================================================
// Analyzed Email Adapters (email with optional task overlay)
// =============================================================================

/**
 * Convert AnalyzedEmail to InboxItem
 * Uses the email as the primary data source with task info overlaid
 */
export const analyzedEmailToInboxItem: InboxItemAdapter<AnalyzedEmailListItem> = (
  email
): InboxItem<AnalyzedEmailListItem> => {
  const timestamp = new Date(email.receivedAt)
  const hasTask = email.taskId !== null
  const classification = parseClassification(email.signals)

  return {
    id: email.id,
    type: "email",
    subject: email.subject || "(No Subject)",
    preview: truncateText(stripHtml(email.body || ""), 100),
    timestamp,
    isRead: hasTask ? email.taskStatus === 1 : true,
    isStarred: false,
    sender: {
      name: email.fromName || extractNameFromEmail(email.fromEmail),
      email: email.fromEmail,
    },
    recipients: email.assignedToName
      ? [{ name: email.assignedToName, id: email.assignedToId || undefined }]
      : [],
    status: hasTask && hasSignal(email.signals, Signal.SENTIMENT_NEGATIVE)
      ? (email.taskStatus === 1 ? "resolved" : "open")
      : undefined,
    classification: classification?.value === 'transactional' ? classification : undefined,
    signals: email.signals ?? undefined,
    customerId: email.customerId,
    customerName: email.customerName || undefined,
    originalData: email,
  }
}

/**
 * Convert AnalyzedEmail to InboxItemContent
 */
export const analyzedEmailToInboxContent = (
  email: AnalyzedEmail,
  comments?: TaskComment[],
  thread?: EmailThread | null
): InboxItemContent => {
  const timestamp = new Date(email.receivedAt)
  const focused = thread?.messages.find((m) => m.isFocused) ?? null

  const inboxComments = comments?.map((comment) => ({
    id: comment.id,
    content: comment.content,
    userId: comment.userId,
    userName: comment.userName || "Unknown",
    createdAt: new Date(comment.createdAt),
  }))

  return {
    id: email.id,
    subject: email.subject || "(No Subject)",
    body: email.body || "",
    bodyFormat: "html",
    from: {
      name: email.fromName || extractNameFromEmail(email.fromEmail),
      email: email.fromEmail,
    },
    // Real recipients off the thread. This used to be the task's assignee,
    // which has no address at all — so the panel rendered "To:" followed by
    // nothing, and a reader could not tell who the mail had actually gone to.
    to: focused?.to.map((p) => ({ name: p.name ?? p.email, email: p.email })) ?? [],
    cc: focused?.cc.map((p) => ({ name: p.name ?? p.email, email: p.email })) ?? [],
    thread: thread ?? undefined,
    timestamp,
    comments: inboxComments,
    metadata: {
      taskId: email.taskId,
      taskStatus: email.taskStatus,
      customerId: email.customerId,
      customerName: email.customerName,
      problem: email.problem,
      resolution: email.resolution,
      completedAt: email.completedAt,
    },
  }
}

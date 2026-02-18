/**
 * Inbox Components
 *
 * A reusable inbox component system that works for both:
 * 1. Escalations/Tasks - from the escalations page
 * 2. Emails - from customer drawer or standalone inbox
 *
 * Usage:
 *
 * ```tsx
 * import { InboxView, emailToInboxItem, emailToInboxContent } from '@/components/inbox'
 *
 * // For emails
 * <InboxView
 *   config={{
 *     itemType: 'email',
 *     showSearch: true,
 *     showThreadCount: true,
 *   }}
 *   callbacks={{
 *     onFetchItems: async (filter, pagination) => {
 *       const emails = await fetchEmails(filter, pagination)
 *       return {
 *         items: emails.map(emailToInboxItem),
 *         total: emails.total,
 *         hasMore: emails.hasMore,
 *         page: pagination.page,
 *         limit: pagination.limit,
 *       }
 *     },
 *     onFetchContent: async (id) => {
 *       const email = await fetchEmail(id)
 *       return emailToInboxContent(email)
 *     },
 *     onSelect: (item) => console.log('Selected:', item),
 *     onReply: (item) => openReplyDialog(item),
 *   }}
 * />
 *
 * // For escalations/tasks
 * <InboxView
 *   config={{
 *     itemType: 'task',
 *     showSearch: true,
 *     showStatusFilter: true,
 *     showPriority: true,
 *     showCustomer: true,
 *     statusFilters: [
 *       { value: 'all', label: 'All' },
 *       { value: 'open', label: 'Open' },
 *       { value: 'in_progress', label: 'In Progress' },
 *     ],
 *   }}
 *   callbacks={{
 *     onFetchItems: async (filter, pagination) => {
 *       const escalations = await fetchEscalations(filter, pagination)
 *       return {
 *         items: escalations.map(escalationToInboxItem),
 *         total: escalations.total,
 *         hasMore: escalations.hasMore,
 *         page: pagination.page,
 *         limit: pagination.limit,
 *       }
 *     },
 *     onFetchContent: async (id) => {
 *       const escalation = await fetchEscalation(id)
 *       return escalationToInboxContent(escalation)
 *     },
 *     onSelect: (item) => console.log('Selected:', item),
 *     onResolve: (id) => resolveTask(id),
 *   }}
 * />
 * ```
 */

// Components
export { InboxView } from "./inbox-view"
export { InboxListItem } from "./inbox-list-item"
export { InboxDetailPanel } from "./inbox-detail-panel"
export { SignalFilter } from "./signal-filter"

// Types
export type {
  InboxItem,
  InboxItemContent,
  InboxParticipant,
  InboxAttachment,
  InboxPriority,
  InboxStatus,
  InboxItemType,
  InboxFilter,
  InboxPagination,
  InboxPage,
  InboxCallbacks,
  InboxConfig,
  InboxViewProps,
  InboxListItemProps,
  InboxDetailPanelProps,
  InboxItemAdapter,
  InboxContentAdapter,
  InboxSentimentFilter,
} from "./types"

// Adapters
export {
  emailToInboxItem,
  emailToInboxContent,
  escalationToInboxItem,
  escalationToInboxContent,
  apiEmailToInboxItem,
  apiEmailToInboxContent,
  apiTaskToInboxItem,
  apiTaskToInboxContent,
} from "./adapters"

export type { ApiEmailResponse, TaskWithComments } from "./adapters"

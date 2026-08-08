/**
 * Abstracted Inbox Component Types
 *
 * These types support both:
 * 1. Escalations/Tasks - from the escalations page
 * 2. Emails - from customer drawer or standalone inbox
 *
 * The design allows the same UI components to render different data sources
 * by normalizing them into a common InboxItem structure.
 */

// =============================================================================
// Core Data Structures
// =============================================================================

/**
 * Sender/Author information - works for email senders or task assignees
 */
export interface InboxParticipant {
  id?: string;
  name: string;
  email?: string;
  avatar?: string;
}

/**
 * Sentiment data for emails
 */
export interface InboxSentiment {
  value: 'positive' | 'negative' | 'neutral';
  confidence: number;
}

/**
 * Classification data for emails (spam/marketing/business/etc)
 */
export interface InboxClassification {
  value: 'spam' | 'marketing' | 'transactional' | 'automated' | 'business';
  confidence?: number;
}

/**
 * Priority levels for both tasks and emails
 */
export type InboxPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Status for tasks/escalations
 */
export type InboxStatus = 'open' | 'in_progress' | 'resolved' | 'archived';

/**
 * The type of inbox item
 */
export type InboxItemType = 'email' | 'task';

/**
 * Generic inbox item that can represent either an email or a task/escalation.
 * This is the normalized format used by all inbox components.
 */
export interface InboxItem<TOriginal = unknown> {
  /** Unique identifier */
  id: string;

  /** Type discriminator */
  type: InboxItemType;

  /** Subject line (email subject or task title) */
  subject: string;

  /** Preview text (email snippet or task description preview) */
  preview: string;

  /** When this item was created/received */
  timestamp: Date;

  /** Read/unread state */
  isRead: boolean;

  /** Starred/flagged state */
  isStarred: boolean;

  /** Primary sender/author */
  sender: InboxParticipant;

  /** Recipients (for emails) or assigned users (for tasks) */
  recipients?: InboxParticipant[];

  /** Status (primarily for tasks, but can apply to emails) */
  status?: InboxStatus;

  /** Priority level */
  priority?: InboxPriority;

  /** Labels/tags */
  labels?: string[];

  /** Associated customer */
  customerId?: string;
  customerName?: string;

  /** Thread/conversation ID for grouping */
  threadId?: string;

  /** Number of messages in thread */
  threadCount?: number;

  /** Has attachments */
  hasAttachments?: boolean;

  /** Sentiment analysis result (for emails) */
  sentiment?: InboxSentiment;

  /** Email classification (spam/marketing/business/etc) */
  classification?: InboxClassification;

  /** Whether email is flagged as an escalation */
  isEscalation?: boolean;

  /**
   * Raw analysis signal codes (see @crm/shared Signal). Drives the per-row
   * flag chips (escalation / churn / upsell / kudos / competitor) via
   * <SignalFlags>. Sentiment/classification are surfaced through their own
   * fields above.
   */
  signals?: number[];

  /** Original data for type-specific operations */
  originalData: TOriginal;
}

/**
 * Attachment information
 */
export interface InboxAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url?: string;
}

/**
 * Comment on a task
 */
export interface InboxComment {
  id: string;
  content: string;
  userId: string;
  userName: string;
  createdAt: Date;
}

/**
 * Full content for the detail view - includes body and thread context
 */
export interface InboxItemContent {
  /** Item ID */
  id: string;

  /** Subject/title */
  subject: string;

  /** Full body content */
  body: string;

  /** Body format */
  bodyFormat: 'html' | 'text' | 'markdown';

  /** Sender information */
  from: InboxParticipant;

  /** Recipients */
  to?: InboxParticipant[];
  cc?: InboxParticipant[];
  bcc?: InboxParticipant[];

  /** Attachments */
  attachments?: InboxAttachment[];

  /** When received/created */
  timestamp: Date;

  /** Thread messages (for email threads) */
  threadMessages?: InboxItemContent[];

  /** Comments (for tasks) */
  comments?: InboxComment[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Callbacks Interface
// =============================================================================

/**
 * Signal filter values for inbox
 * Includes sentiment (positive/negative/neutral), other signals (upsell/churn), and TAT violations
 */
export type InboxSentimentFilter = 'positive' | 'negative' | 'neutral' | 'upsell' | 'churn' | 'tat' | 'all';

/**
 * Filter options for fetching items
 */
export interface InboxFilter {
  /** Search query string */
  query?: string;

  /** Filter by status */
  status?: InboxStatus | 'all';

  /** Filter by priority */
  priority?: InboxPriority | 'all';

  /** Filter by sentiment */
  sentiment?: InboxSentimentFilter;

  /** Filter by labels */
  labels?: string[];

  /** Filter by customer */
  customerId?: string;

  /** Filter by read state */
  isRead?: boolean;

  /** Filter by starred state */
  isStarred?: boolean;

  /** Date range */
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Pagination options
 */
export interface InboxPagination {
  page: number;
  limit: number;
}

/**
 * Paginated response
 */
export interface InboxPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Callbacks for inbox operations.
 * These are provided by the parent component to handle data fetching and actions.
 */
export interface InboxCallbacks {
  // -------------------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------------------

  /**
   * Fetch a page of inbox items with optional filtering
   */
  onFetchItems: (
    filter: InboxFilter,
    pagination: InboxPagination
  ) => Promise<InboxPage<InboxItem>>;

  /**
   * Fetch full content for an item (for detail view).
   * The optional signal is provided by InboxView so the in-flight request
   * can be aborted when the user clicks a different item before this one
   * resolves — preventing a slow earlier response from clobbering a faster
   * later one.
   */
  onFetchContent: (itemId: string, signal?: AbortSignal) => Promise<InboxItemContent>;

  /**
   * Optional: Fetch a single item by id for selection when it isn't present in
   * the currently loaded/filtered page. Lets a deep-linked target that's
   * off-page or filtered out still open, instead of silently falling back to
   * the first item. Returns null when no such item exists.
   */
  onFetchItem?: (itemId: string, signal?: AbortSignal) => Promise<InboxItem | null>;

  /**
   * Optional: Fetch thread messages
   */
  onFetchThread?: (threadId: string) => Promise<InboxItemContent[]>;

  // -------------------------------------------------------------------------
  // Selection & Navigation
  // -------------------------------------------------------------------------

  /**
   * Called when an item is selected
   */
  onSelect: (item: InboxItem) => void;

  /**
   * Optional: Called when selection is cleared
   */
  onClearSelection?: () => void;

  // -------------------------------------------------------------------------
  // Item Actions
  // -------------------------------------------------------------------------

  /**
   * Archive items
   */
  onArchive?: (itemIds: string[]) => Promise<void>;

  /**
   * Delete items
   */
  onDelete?: (itemIds: string[]) => Promise<void>;

  /**
   * Mark items as read/unread
   */
  onMarkRead?: (itemIds: string[], read: boolean) => Promise<void>;

  /**
   * Star/unstar an item
   */
  onStar?: (itemId: string, starred: boolean) => Promise<void>;

  /**
   * Add labels to items
   */
  onAddLabels?: (itemIds: string[], labels: string[]) => Promise<void>;

  /**
   * Remove labels from items
   */
  onRemoveLabels?: (itemIds: string[], labels: string[]) => Promise<void>;

  // -------------------------------------------------------------------------
  // Email Actions
  // -------------------------------------------------------------------------

  /**
   * Reply to an email
   */
  onReply?: (item: InboxItem) => void;

  /**
   * Reply all to an email
   */
  onReplyAll?: (item: InboxItem) => void;

  /**
   * Forward an email
   */
  onForward?: (item: InboxItem) => void;

  // -------------------------------------------------------------------------
  // Task Actions
  // -------------------------------------------------------------------------

  /**
   * Assign task to user
   */
  onAssign?: (itemId: string, userId: string) => Promise<void>;

  /**
   * Update task status
   */
  onUpdateStatus?: (itemId: string, status: InboxStatus) => Promise<void>;

  /**
   * Update task priority
   */
  onUpdatePriority?: (itemId: string, priority: InboxPriority) => Promise<void>;

  /**
   * Mark task as resolved/done
   */
  onResolve?: (itemId: string) => Promise<void>;

  /**
   * Add comment to a task
   */
  onAddComment?: (itemId: string, content: string) => Promise<void>;
}

// =============================================================================
// Component Props
// =============================================================================

/**
 * Configuration for the inbox view
 */
export interface InboxConfig {
  /** Type of items being displayed */
  itemType: InboxItemType | 'mixed';

  /** Enable multi-select mode */
  multiSelect?: boolean;

  /** Show search input */
  showSearch?: boolean;

  /** Show filter tabs (status filter) */
  showStatusFilter?: boolean;

  /** Available status filters */
  statusFilters?: Array<{ value: InboxStatus | 'all'; label: string }>;

  /** Show sentiment filter dropdown */
  showSentimentFilter?: boolean;

  /** Show priority indicator */
  showPriority?: boolean;

  /** Show customer badge */
  showCustomer?: boolean;

  /** Show thread count */
  showThreadCount?: boolean;

  /** Enable keyboard navigation */
  keyboardNavigation?: boolean;

  /** Empty state message */
  emptyMessage?: string;

  /** Loading state message */
  loadingMessage?: string;

  /** Search placeholder */
  searchPlaceholder?: string;

  /** Detail panel width (default: flex-1) */
  detailPanelWidth?: string;

  /** List panel width (default: 400px) */
  listPanelWidth?: string;

  /** Embedded mode - hides header section for use inside other components */
  embedded?: boolean;
}

/**
 * Props for the main InboxView component
 */
export interface InboxViewProps {
  /** Configuration */
  config: InboxConfig;

  /** Callbacks for data and actions */
  callbacks: InboxCallbacks;

  /** Initial filter state */
  initialFilter?: InboxFilter;

  /** Initial selected item ID - used to auto-select an item when the view loads */
  initialSelectedId?: string;

  /** External selected item (controlled mode) */
  selectedItem?: InboxItem | null;

  /** Controlled sentiment filter (optional - for server-side filtering) */
  sentimentFilter?: InboxSentimentFilter;

  /** Callback when sentiment filter changes (for controlled mode) */
  onSentimentFilterChange?: (filter: InboxSentimentFilter) => void;

  /** Custom header content */
  headerContent?: React.ReactNode;

  /** Custom toolbar actions */
  toolbarActions?: React.ReactNode;

  /** Custom empty state */
  emptyState?: React.ReactNode;

  /** Custom loading state */
  loadingState?: React.ReactNode;

  /** Class name for container */
  className?: string;

  // -------------------------------------------------------------------------
  // Detail Panel Render Props
  // -------------------------------------------------------------------------

  /**
   * Render prop for header actions in detail panel
   * Receives (item, content) to render context-aware actions
   */
  renderHeaderActions?: (item: InboxItem, content: InboxItemContent | null) => React.ReactNode;

  /**
   * Render prop for meta info section in detail panel
   * Receives (item, content) to render context-aware meta info
   */
  renderMetaInfo?: (item: InboxItem, content: InboxItemContent | null) => React.ReactNode;

  /**
   * Render prop for additional header badges in detail panel
   * Receives (item, content) to render context-aware badges
   */
  renderHeaderBadges?: (item: InboxItem, content: InboxItemContent | null) => React.ReactNode;

  /**
   * Render prop for content after messages in detail panel
   * Receives (item, content) to render context-aware content
   */
  renderAfterContent?: (item: InboxItem, content: InboxItemContent | null) => React.ReactNode;

  /**
   * Render prop for a side panel next to the detail panel
   * Receives (item, content) to render context-aware content (e.g., comments)
   */
  renderSidePanel?: (item: InboxItem, content: InboxItemContent | null) => React.ReactNode;
}

/**
 * Props for InboxListItem component
 */
export interface InboxListItemProps {
  /** The inbox item to render */
  item: InboxItem;

  /** Whether this item is selected */
  isSelected: boolean;

  /** Click handler - can be a function or undefined */
  onClick?: () => void;

  /** Alternative click handler that receives item ID - for better memoization */
  onItemClick?: (itemId: string) => void;

  /** Configuration for display options */
  config: Pick<InboxConfig, 'showPriority' | 'showCustomer' | 'showThreadCount' | 'itemType'>;

  /** Optional checkbox for multi-select */
  showCheckbox?: boolean;
  isChecked?: boolean;
  onCheckChange?: (checked: boolean) => void;
}

/**
 * Props for InboxDetailPanel component
 */
export interface InboxDetailPanelProps {
  /** The selected item (null for empty state) */
  item: InboxItem | null;

  /** Full content (loaded separately) */
  content: InboxItemContent | null;

  /** Loading state */
  isLoading: boolean;

  /** Callbacks for actions */
  callbacks: Pick<
    InboxCallbacks,
    | 'onArchive'
    | 'onDelete'
    | 'onMarkRead'
    | 'onStar'
    | 'onReply'
    | 'onReplyAll'
    | 'onForward'
    | 'onResolve'
  >;

  /** Configuration */
  config: Pick<InboxConfig, 'itemType'>;

  /** Custom actions slot (toolbar right side) */
  customActions?: React.ReactNode;

  /**
   * Render prop for header actions (e.g., "Done" button for tasks)
   * Rendered inline with the subject line
   */
  headerActions?: React.ReactNode;

  /**
   * Render prop for meta info section (e.g., customer, assignee, open time for tasks)
   * Rendered below the header badges
   */
  metaInfo?: React.ReactNode;

  /**
   * Render prop for additional badges in the header (e.g., comment count)
   */
  headerBadges?: React.ReactNode;

  /**
   * Render prop for content after the main message/thread
   * (e.g., comments section for tasks)
   */
  afterContent?: React.ReactNode;
}

// =============================================================================
// Adapter Types - Convert source data to InboxItem
// =============================================================================

/**
 * Adapter function to convert source data to InboxItem
 */
export type InboxItemAdapter<TSource> = (source: TSource) => InboxItem<TSource>;

/**
 * Adapter function to convert source data to InboxItemContent
 */
export type InboxContentAdapter<TSource> = (source: TSource) => InboxItemContent;

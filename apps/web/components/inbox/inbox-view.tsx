"use client"

import * as React from "react"
import { Search, RefreshCw, Archive, Inbox, AlertTriangle, Loader2, ChevronLeft, ChevronRight, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { InboxListItem } from "./inbox-list-item"
import { InboxDetailPanel } from "./inbox-detail-panel"
import { SignalFilter } from "./signal-filter"
import { cn } from "@/lib/utils"
import type {
  InboxViewProps,
  InboxItem,
  InboxItemContent,
  InboxFilter,
  InboxStatus,
  InboxSentimentFilter,
} from "./types"

const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 600
const DEFAULT_PANEL_WIDTH = 400
const STORAGE_KEY = "inbox-panel-width"

/**
 * InboxView - Main orchestrating component for inbox UI
 *
 * Provides a Gmail-like split view with:
 * - Left panel: Search, filters, item list
 * - Right panel: Selected item details
 *
 * Supports both controlled and uncontrolled selection modes.
 * Data fetching is delegated to the parent via callbacks.
 */
export function InboxView({
  config,
  callbacks,
  initialFilter,
  initialSelectedId,
  selectedItem: controlledSelectedItem,
  sentimentFilter: controlledSentimentFilter,
  onSentimentFilterChange,
  headerContent,
  toolbarActions,
  emptyState,
  loadingState,
  className,
  renderHeaderActions,
  renderMetaInfo,
  renderHeaderBadges,
  renderAfterContent,
  renderSidePanel,
}: InboxViewProps) {
  // Internal state
  const [items, setItems] = React.useState<InboxItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [hasMore, setHasMore] = React.useState(false)
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)

  // Selection state (internal unless controlled)
  const [internalSelectedItem, setInternalSelectedItem] = React.useState<InboxItem | null>(null)
  const selectedItem = controlledSelectedItem !== undefined ? controlledSelectedItem : internalSelectedItem

  // Content loading
  const [content, setContent] = React.useState<InboxItemContent | null>(null)
  const [isLoadingContent, setIsLoadingContent] = React.useState(false)

  // Filter state (supports controlled mode for server-side filtering)
  const [filter, setFilter] = React.useState<InboxFilter>(initialFilter || {})
  const [statusFilter, setStatusFilter] = React.useState<InboxStatus | "all">("all")
  const [internalSentimentFilter, setInternalSentimentFilter] = React.useState<InboxSentimentFilter>("all")
  const sentimentFilter = controlledSentimentFilter !== undefined ? controlledSentimentFilter : internalSentimentFilter
  const setSentimentFilter = React.useCallback((value: InboxSentimentFilter) => {
    if (onSentimentFilterChange) {
      onSentimentFilterChange(value)
    } else {
      setInternalSentimentFilter(value)
    }
  }, [onSentimentFilterChange])
  const [searchQuery, setSearchQuery] = React.useState(initialFilter?.query || "")

  // Debounced search
  const searchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  // Track if initial fetch has happened to prevent double-fetch
  const initialFetchDoneRef = React.useRef(false)

  // Store callbacks in ref to avoid fetchItems depending on them
  const callbacksRef = React.useRef(callbacks)
  React.useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  // Resizable panel state
  const [panelWidth, setPanelWidth] = React.useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed) && parsed >= MIN_PANEL_WIDTH && parsed <= MAX_PANEL_WIDTH) {
          return parsed
        }
      }
    }
    return DEFAULT_PANEL_WIDTH
  })
  const [isResizing, setIsResizing] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Items per page
  const pageSize = 50

  // Fetch items - uses callbacksRef to avoid depending on callbacks prop
  const fetchItems = React.useCallback(
    async (pageNum: number) => {
      try {
        setIsLoading(true)

        const currentFilter: InboxFilter = {
          ...filter,
          query: searchQuery || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          sentiment: sentimentFilter === "all" ? undefined : sentimentFilter,
        }

        const result = await callbacksRef.current.onFetchItems(currentFilter, {
          page: pageNum,
          limit: pageSize,
        })

        setItems(result.items)
        setTotal(result.total)
        setHasMore(result.hasMore)
        setPage(pageNum)
        initialFetchDoneRef.current = true
      } catch (error) {
        console.error("Failed to fetch items:", error)
      } finally {
        setIsLoading(false)
      }
    },
    [filter, searchQuery, statusFilter, sentimentFilter]
  )

  // Pagination handlers
  const totalPages = Math.ceil(total / pageSize)
  const canGoBack = page > 1
  const canGoForward = page < totalPages

  const handlePrevPage = () => {
    if (canGoBack) {
      fetchItems(page - 1)
    }
  }

  const handleNextPage = () => {
    if (canGoForward) {
      fetchItems(page + 1)
    }
  }

  // Initial fetch on mount only
  React.useEffect(() => {
    fetchItems(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // Re-fetch when filters change (not callbacks)
  React.useEffect(() => {
    // Skip if this is the initial render (handled by mount effect)
    if (!initialFetchDoneRef.current) return
    fetchItems(1)
  }, [filter, statusFilter, sentimentFilter, fetchItems])

  // Debounced search - only after initial fetch
  React.useEffect(() => {
    // Skip if initial fetch hasn't happened yet
    if (!initialFetchDoneRef.current) return

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchItems(1)
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery, fetchItems])

  // Fetch content when selection changes - uses callbacksRef to avoid re-running on callback changes
  React.useEffect(() => {
    if (!selectedItem) {
      setContent(null)
      return
    }

    const fetchContent = async () => {
      setIsLoadingContent(true)
      try {
        const itemContent = await callbacksRef.current.onFetchContent(selectedItem.id)
        setContent(itemContent)
      } catch (error) {
        console.error("Failed to fetch content:", error)
        setContent(null)
      } finally {
        setIsLoadingContent(false)
      }
    }

    fetchContent()
  }, [selectedItem?.id])

  // Track if we're in controlled mode (selectedItem prop is provided)
  // This doesn't change during the component's lifecycle
  const isControlledRef = React.useRef(controlledSelectedItem !== undefined)

  // Handle item selection - memoized with useCallback
  // Uses refs to avoid depending on controlledSelectedItem or callbacks values
  const handleSelectItem = React.useCallback((item: InboxItem) => {
    if (!isControlledRef.current) {
      setInternalSelectedItem(item)
    }
    callbacksRef.current.onSelect(item)

    // Mark as read if unread
    if (!item.isRead && callbacksRef.current.onMarkRead) {
      callbacksRef.current.onMarkRead([item.id], true)
      // Optimistically update local state
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, isRead: true } : i))
      )
    }
  }, [])

  // Auto-select item when items load - prefer initialSelectedId, then first item
  // Only auto-select once to avoid overriding user clicks during loading transitions
  const hasAutoSelectedRef = React.useRef(false)
  React.useEffect(() => {
    if (items.length > 0 && !controlledSelectedItem && !internalSelectedItem && !hasAutoSelectedRef.current) {
      // If initialSelectedId is provided, try to find and select that item
      if (initialSelectedId) {
        const targetItem = items.find(i => i.id === initialSelectedId)
        if (targetItem) {
          hasAutoSelectedRef.current = true
          handleSelectItem(targetItem)
          return
        }
      }
      // Fall back to first item
      hasAutoSelectedRef.current = true
      handleSelectItem(items[0])
    }
  }, [items, controlledSelectedItem, internalSelectedItem, handleSelectItem, initialSelectedId])

  // Handle external URL changes (e.g., when user pastes a bookmarked link)
  // This runs when initialSelectedId changes and we have items loaded
  React.useEffect(() => {
    if (initialSelectedId && items.length > 0 && internalSelectedItem?.id !== initialSelectedId) {
      const targetItem = items.find(i => i.id === initialSelectedId)
      if (targetItem) {
        setInternalSelectedItem(targetItem)
        // Don't call handleSelectItem here to avoid infinite loop with onSelect callback
      }
    }
  }, [initialSelectedId, items, internalSelectedItem?.id])

  // Handle refresh
  const handleRefresh = () => {
    fetchItems(1)
  }

  // Keyboard navigation - enabled by default
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault()
        // Next item
        const currentIndex = items.findIndex((i) => i.id === selectedItem?.id)
        if (currentIndex < items.length - 1) {
          const nextItem = items[currentIndex + 1]
          handleSelectItem(nextItem)
          document.querySelector(`[data-item-id="${nextItem.id}"]`)?.scrollIntoView({ block: "nearest" })
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault()
        // Previous item
        const currentIndex = items.findIndex((i) => i.id === selectedItem?.id)
        if (currentIndex > 0) {
          const prevItem = items[currentIndex - 1]
          handleSelectItem(prevItem)
          document.querySelector(`[data-item-id="${prevItem.id}"]`)?.scrollIntoView({ block: "nearest" })
        }
      } else if (e.key === "e" && callbacksRef.current.onArchive && selectedItem) {
        // Archive
        callbacksRef.current.onArchive([selectedItem.id])
      } else if (e.key === "s" && callbacksRef.current.onStar && selectedItem) {
        // Star/unstar
        callbacksRef.current.onStar(selectedItem.id, !selectedItem.isStarred)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [items, selectedItem, handleSelectItem])

  // Handle panel resize
  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - containerRect.left
      const clampedWidth = Math.min(Math.max(newWidth, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH)
      setPanelWidth(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      localStorage.setItem(STORAGE_KEY, panelWidth.toString())
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing, panelWidth])

  // Count items by status for badges
  const openCount = items.filter((i) => i.status === "open").length
  const inProgressCount = items.filter((i) => i.status === "in_progress").length

  // Memoize the list item config to prevent re-renders
  const listItemConfig = React.useMemo(() => ({
    showPriority: config.showPriority,
    showCustomer: config.showCustomer,
    showThreadCount: config.showThreadCount,
    itemType: config.itemType,
  }), [config.showPriority, config.showCustomer, config.showThreadCount, config.itemType])

  // Store items in a ref to avoid handleItemClick dependency on items
  const itemsRef = React.useRef(items)
  React.useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Create stable click handler that uses ref
  const handleItemClick = React.useCallback((itemId: string) => {
    const item = itemsRef.current.find(i => i.id === itemId)
    if (item) {
      handleSelectItem(item)
    }
  }, [handleSelectItem])

  // Don't show detail panel content when list is empty (no matching items for current filters)
  const detailItem = !isLoading && items.length === 0 ? null : selectedItem

  return (
    <div ref={containerRef} className={cn("flex h-full overflow-hidden", className)}>
      {/* Left Panel - Item List */}
      <div
        className="flex-shrink-0 flex flex-col bg-background overflow-hidden"
        style={{ width: panelWidth }}
      >
        {/* Header - hidden in embedded mode */}
        {!config.embedded && (
          <div className="p-4 border-b border-border">
            {headerContent || (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Inbox className="h-5 w-5 text-primary" />
                    <h1 className="text-lg font-semibold">
                      {config.itemType === "task"
                        ? "Tasks"
                        : config.itemType === "email"
                        ? "Emails"
                        : "Inbox"}
                    </h1>
                  </div>
                  {config.showStatusFilter && (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-xs">
                        {openCount} Open
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {inProgressCount} In Progress
                      </Badge>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Search */}
            {config.showSearch && (
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={config.searchPlaceholder || "Search..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            )}

            {/* Status Filter Tabs */}
            {config.showStatusFilter && config.statusFilters && (
              <Tabs
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as InboxStatus | "all")}
              >
                <TabsList className="w-full">
                  {config.statusFilters.map((sf) => (
                    <TabsTrigger key={sf.value} value={sf.value} className="flex-1 text-xs">
                      {sf.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          {/* Search in toolbar when embedded */}
          {config.embedded && config.showSearch && (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={config.searchPlaceholder || "Search..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8"
              />
            </div>
          )}
          {/* Sentiment Filter */}
          {config.showSentimentFilter && (
            <SignalFilter value={sentimentFilter} onChange={setSentimentFilter} />
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {callbacks.onArchive && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Archive all</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {toolbarActions}
          {!config.embedded && <div className="flex-1" />}
          {/* Pagination controls */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">
              {total > 0 ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}` : '0 items'}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handlePrevPage}
                    disabled={!canGoBack || isLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous page</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleNextPage}
                    disabled={!canGoForward || isLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next page</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* List */}
        <ScrollArea className="flex-1 h-0 min-h-0 overflow-hidden">
          <div className="w-full overflow-hidden">
            {isLoading ? (
              loadingState || (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-50" />
                  <p className="text-sm">{config.loadingMessage || "Loading..."}</p>
                </div>
              )
            ) : items.length > 0 ? (
              items.map((item) => (
                <InboxListItem
                  key={item.id}
                  item={item}
                  isSelected={selectedItem?.id === item.id}
                  onItemClick={handleItemClick}
                  config={listItemConfig}
                  showCheckbox={config.multiSelect}
                />
              ))
            ) : (
              emptyState || (
                <div className="p-8 text-center text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">{config.emptyMessage || "No items found"}</p>
                </div>
              )
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          "w-1 flex-shrink-0 bg-border hover:bg-primary/50 cursor-col-resize transition-colors relative group",
          isResizing && "bg-primary/50"
        )}
        onMouseDown={handleResizeStart}
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Right Panel - Detail View + Optional Side Panel */}
      <div className="flex-1 min-w-0 flex h-full overflow-hidden" style={{ width: config.detailPanelWidth }}>
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          <InboxDetailPanel
            item={detailItem}
            content={content}
            isLoading={isLoadingContent}
            callbacks={{
              onArchive: callbacks.onArchive,
              onDelete: callbacks.onDelete,
              onMarkRead: callbacks.onMarkRead,
              onStar: callbacks.onStar,
              onReply: callbacks.onReply,
              onReplyAll: callbacks.onReplyAll,
              onForward: callbacks.onForward,
              onResolve: callbacks.onResolve ? async (itemId) => {
                await callbacks.onResolve!(itemId)
                // Refresh the list to show updated status
                fetchItems(page)
              } : undefined,
            }}
            config={{ itemType: config.itemType }}
            headerActions={detailItem && renderHeaderActions ? renderHeaderActions(detailItem, content) : undefined}
            metaInfo={detailItem && renderMetaInfo ? renderMetaInfo(detailItem, content) : undefined}
            headerBadges={detailItem && renderHeaderBadges ? renderHeaderBadges(detailItem, content) : undefined}
            afterContent={detailItem && renderAfterContent ? renderAfterContent(detailItem, content) : undefined}
          />
        </div>
        {(() => {
          const sidePanelContent = detailItem && renderSidePanel
            ? renderSidePanel(detailItem, content)
            : null
          return sidePanelContent ? (
            <div className="w-[320px] flex-shrink-0 border-l border-border h-full overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">
                  {sidePanelContent}
                </div>
              </ScrollArea>
            </div>
          ) : null
        })()}
      </div>
    </div>
  )
}

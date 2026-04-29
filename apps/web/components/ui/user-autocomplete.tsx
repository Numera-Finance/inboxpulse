"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useUsers, userKeys } from "@/lib/hooks"
import { searchUsers } from "@/lib/api"
import { SearchOperator } from "@crm/shared"
import type { SearchRequest } from "@crm/shared"

const PAGE_SIZE = 100

interface UserAutocompleteProps {
  value: string | null // userId or email depending on valueField
  onChange: (value: string | null, userName?: string, userEmail?: string) => void
  valueField?: 'id' | 'email' // Which field to use as value (default: 'id')
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  excludeIds?: Set<string> | string[]
  excludeEmails?: Set<string> | string[]
  onlyLoginable?: boolean // Only show users who can login (default: false)
  hierarchyFiltered?: boolean // Only show self + subordinates for non-admins (default: false)
  prefixOptions?: Array<{ value: string; label: string }> // Special options shown above user list (e.g., All, Me, My Team)
}

function buildSearchRequest(searchQueries: SearchRequest['queries'], offset: number): SearchRequest {
  return {
    queries: searchQueries,
    sortBy: 'firstName',
    sortOrder: 'asc',
    limit: PAGE_SIZE,
    offset,
  }
}

export function UserAutocomplete({
  value,
  onChange,
  valueField = 'id',
  placeholder = "Select user...",
  searchPlaceholder = "Search users...",
  emptyText = "No users found.",
  disabled = false,
  className,
  excludeIds,
  excludeEmails,
  onlyLoginable = false,
  hierarchyFiltered = false,
  prefixOptions,
}: UserAutocompleteProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [offset, setOffset] = React.useState(0)
  const [allItems, setAllItems] = React.useState<any[]>([])
  const [hasMore, setHasMore] = React.useState(true)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const loadingNextPage = React.useRef(false)

  // Debounce search term for server-side filtering
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset pagination when search changes
  React.useEffect(() => {
    setOffset(0)
    setAllItems([])
    setHasMore(true)
    loadingNextPage.current = false
  }, [debouncedSearch])

  // Build search queries for server-side filtering
  const searchQueries = React.useMemo(() => {
    const queries: SearchRequest['queries'] = []
    if (debouncedSearch.trim()) {
      queries.push({ field: '_search', operator: SearchOperator.EQUALS, value: debouncedSearch.trim() })
    }
    if (hierarchyFiltered) {
      queries.push({ field: '_hierarchy', operator: SearchOperator.EQUALS, value: 'subordinates' })
    }
    return queries
  }, [debouncedSearch, hierarchyFiltered])

  // Fetch current page
  const currentRequest = buildSearchRequest(searchQueries, offset)
  const { data: usersData, isLoading, isFetching, error } = useUsers(currentRequest)

  // Accumulate results as pages load + prefetch next page
  React.useEffect(() => {
    if (!usersData?.items) return
    loadingNextPage.current = false
    const newItems = usersData.items
    if (offset === 0) {
      setAllItems(newItems)
    } else {
      setAllItems(prev => {
        const existingIds = new Set(prev.map(u => u.id))
        const unique = newItems.filter(u => !existingIds.has(u.id))
        return [...prev, ...unique]
      })
    }

    const pageHasMore = newItems.length >= PAGE_SIZE
    setHasMore(pageHasMore)

    // Prefetch next page into React Query cache
    if (pageHasMore) {
      const nextRequest = buildSearchRequest(searchQueries, offset + PAGE_SIZE)
      queryClient.prefetchQuery({
        queryKey: userKeys.list(nextRequest),
        queryFn: () => searchUsers(nextRequest),
      })
    }
  }, [usersData, offset, searchQueries, queryClient])

  // Debug logging
  React.useEffect(() => {
    if (error) {
      console.error('UserAutocomplete: Error fetching users:', error)
    }
  }, [error])

  // Convert exclude arrays to Sets for efficient lookup
  const excludeIdSet = React.useMemo(() => {
    if (!excludeIds) return new Set<string>()
    return excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
  }, [excludeIds])

  const excludeEmailSet = React.useMemo(() => {
    if (!excludeEmails) return new Set<string>()
    return excludeEmails instanceof Set ? excludeEmails : new Set(excludeEmails)
  }, [excludeEmails])

  // Filter out excluded users and optionally filter by canLogin
  const users = React.useMemo(() => {
    const filtered = allItems.filter(user => {
      const currentValue = valueField === 'email' ? user.email : user.id
      if (currentValue === value) return true

      if (onlyLoginable && user.canLogin === false) return false
      if (excludeIdSet.has(user.id)) return false
      if (excludeEmailSet.has(user.email)) return false
      return true
    })

    return filtered
  }, [allItems, excludeIdSet, excludeEmailSet, value, valueField, onlyLoginable])

  // Find selected user
  const selectedUser = React.useMemo(() => {
    if (!value) return null
    return users.find(user =>
      valueField === 'email' ? user.email === value : user.id === value
    )
  }, [users, value, valueField])

  const handleSelect = (user: typeof users[0]) => {
    const newValue = valueField === 'email' ? user.email : user.id
    const name = `${user.firstName} ${user.lastName}`

    if (newValue === value) {
      onChange(null)
    } else {
      onChange(newValue, name, user.email)
    }
    setOpen(false)
  }

  // Load next page when scrolling past 70% — prefetched data will be instant
  const handleScroll = React.useCallback((e: Event) => {
    const el = e.target as HTMLElement
    if (!el || !hasMore || loadingNextPage.current) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollTop + clientHeight >= scrollHeight * 0.7) {
      loadingNextPage.current = true
      setOffset(prev => prev + PAGE_SIZE)
    }
  }, [hasMore])

  // Attach scroll listener to the CommandList element
  const commandListCallbackRef = React.useCallback((node: HTMLDivElement | null) => {
    if (listRef.current) {
      listRef.current.removeEventListener('scroll', handleScroll)
    }
    listRef.current = node
    if (node) {
      node.addEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  // Reset search input when closing, but keep offset/allItems intact so the
  // selected user remains in `allItems` and the trigger button can render its
  // name on next open. Resetting offset here would refetch the first page and
  // overwrite allItems with only the first PAGE_SIZE users, losing any picked
  // from later pages.
  React.useEffect(() => {
    if (!open) {
      setSearch("")
      setDebouncedSearch("")
      loadingNextPage.current = false
    }
  }, [open])

  const selectedPrefixOption = prefixOptions?.find(o => o.value === value)
  const displayText = selectedPrefixOption
    ? selectedPrefixOption.label
    : selectedUser
      ? `${selectedUser.firstName} ${selectedUser.lastName} (${selectedUser.email})`
      : isLoading
        ? "Loading users..."
        : placeholder

  const showInitialLoading = isLoading && allItems.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || (isLoading && allItems.length === 0)}
          className={cn("w-full justify-between bg-transparent", className)}
        >
          <span className="truncate">{displayText}</span>
          {isLoading && allItems.length === 0 ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList ref={commandListCallbackRef}>
            {prefixOptions && prefixOptions.length > 0 && (
              <>
                <CommandGroup>
                  {prefixOptions.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === option.value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {showInitialLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin mb-2" />
                Loading users...
              </div>
            ) : users.length === 0 && !isFetching ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {users.map((user) => {
                  const itemValue = valueField === 'email' ? user.email : user.id
                  const isSelected = value === itemValue
                  const name = `${user.firstName} ${user.lastName}`

                  return (
                    <CommandItem
                      key={user.id}
                      value={user.id}
                      onSelect={() => handleSelect(user)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{name} ({user.email})</span>
                    </CommandItem>
                  )
                })}
                {isFetching && (
                  <div className="py-2 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </div>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

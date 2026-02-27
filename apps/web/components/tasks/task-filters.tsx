"use client"

import * as React from "react"
import { Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete"
import { UserAutocomplete } from "@/components/ui/user-autocomplete"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

export interface TaskFilter {
  status?: 'open' | 'done' | 'all'
  assignedToId?: string | 'unassigned' | 'me' | 'my-team' | 'all'
  customerId?: string
  dateFrom?: Date
  dateTo?: Date
  signal?: 'positive' | 'negative' | 'neutral' | 'upsell' | 'churn' | 'tat'
  [key: string]: any
}

export interface FilterConfig {
  id: string
  label: string
  icon?: React.ReactNode
  type: 'status' | 'assignee' | 'customer' | 'date-range' | 'priority' | 'custom'
  options?: Array<{ value: string; label: string }>
}

interface TaskFiltersProps {
  filters: TaskFilter
  onFiltersChange: (filters: TaskFilter) => void
  alwaysVisible?: string[]  // Filter IDs to always show
  availableFilters?: FilterConfig[]  // Additional filters to add
  availableAssignees?: Array<{ id: string; name: string }> // Deprecated: no longer used, UserAutocomplete fetches its own data
  currentUserId?: string
  customerName?: string | null  // Customer name for display in badge
  afterStatus?: React.ReactNode  // Slot rendered right after the status dropdown
  className?: string
}

export function TaskFilters({
  filters,
  onFiltersChange,
  alwaysVisible = ['status', 'assignee'],
  availableFilters = [],
  availableAssignees = [],
  currentUserId,
  customerName: propCustomerName,
  afterStatus,
  className,
}: TaskFiltersProps) {
  const [dateRange, setDateRange] = React.useState<{from?: Date; to?: Date}>(() => ({
    from: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    to: filters.dateTo ? new Date(filters.dateTo) : undefined,
  }))

  // Sync dateRange with filters when they change externally
  React.useEffect(() => {
    const newFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined
    const newTo = filters.dateTo ? new Date(filters.dateTo) : undefined
    
    // Only update if dates actually changed to avoid unnecessary re-renders
    const fromChanged = newFrom?.getTime() !== dateRange.from?.getTime()
    const toChanged = newTo?.getTime() !== dateRange.to?.getTime()
    
    if (fromChanged || toChanged) {
      setDateRange({
        from: newFrom,
        to: newTo,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateFrom, filters.dateTo])

  const updateFilter = (key: keyof TaskFilter, value: any) => {
    const newFilters = { ...filters }
    if (value === undefined || value === null || value === '') {
      delete newFilters[key]
    } else {
      newFilters[key] = value
    }
    onFiltersChange(newFilters)
  }

  const clearFilter = (key: keyof TaskFilter) => {
    const newFilters = { ...filters }
    delete newFilters[key]
    onFiltersChange(newFilters)
  }

  // Default filter configs
  const defaultConfigs: FilterConfig[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'status',
      options: [
        { value: 'all', label: 'All' },
        { value: 'open', label: 'Open' },
        { value: 'done', label: 'Done' },
      ],
    },
    {
      id: 'assignee',
      label: 'Assigned To',
      type: 'assignee',
    },
    {
      id: 'customer',
      label: 'Customer',
      type: 'customer',
    },
    {
      id: 'date',
      label: 'Date Range',
      type: 'date-range',
    },
  ]

  const allConfigs = [...defaultConfigs, ...availableFilters]
  
  // All filters are now always visible (static)
  const alwaysVisibleConfigs = allConfigs

  const activeFilterCount = Object.keys(filters).filter(
    k => filters[k as keyof TaskFilter] !== undefined &&
         k !== 'status' && k !== 'assignedToId' &&
         (k !== 'dateFrom' && k !== 'dateTo')
  ).length

  // Check if any filter differs from default state
  const hasNonDefaultFilters =
    (filters.status && filters.status !== 'open') ||
    (filters.assignedToId && filters.assignedToId !== 'all') ||
    filters.customerId ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.signal

  // Use customer name from prop
  const customerName = propCustomerName || null

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Always-Visible Filters Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status Filter (Always Visible) */}
        {alwaysVisibleConfigs.find(c => c.id === 'status') && (
          <Select
            value={filters.status || 'open'}  // Default to 'open'
            onValueChange={(value) => {
              // If "all" is selected, set to undefined to clear filter, but we'll default to "open" in API
              updateFilter('status', value === 'all' ? 'all' : value)
            }}
          >
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        )}

        {afterStatus}

        {/* Assignee Filter (Always Visible) */}
        {alwaysVisibleConfigs.find(c => c.id === 'assignee') && (
          <UserAutocomplete
            value={filters.assignedToId || 'all'}
            onChange={(value) => updateFilter('assignedToId', value === 'all' ? undefined : value)}
            hierarchyFiltered
            prefixOptions={[
              { value: 'all', label: 'All' },
              { value: 'me', label: 'Me' },
              { value: 'my-team', label: 'My Team' },
              { value: 'unassigned', label: 'Unassigned' },
            ]}
            placeholder="Assigned To"
            className="h-8 w-[160px]"
          />
        )}

        {/* Customer Filter (Always Visible) */}
        {alwaysVisibleConfigs.find(c => c.id === 'customer') && (
          <div className="w-[200px]">
            <CustomerAutocomplete
              value={filters.customerId || null}
              onChange={(customerId) => {
                updateFilter('customerId', customerId || undefined)
              }}
              placeholder="Filter by customer..."
              className="h-8"
            />
          </div>
        )}

        {/* Date Range Filter (Always Visible) */}
        {alwaysVisibleConfigs.find(c => c.id === 'date') && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 ml-2 justify-start text-left font-normal",
                  !dateRange.from && !dateRange.to && "text-muted-foreground"
                )}
              >
                <Calendar className="h-4 w-4 mr-2" />
                {dateRange.from && dateRange.to ? (
                  <>
                    {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd")}
                  </>
                ) : dateRange.from ? (
                  format(dateRange.from, "MMM dd, y")
                ) : (
                  "Date Range"
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="range"
                defaultMonth={dateRange.from || new Date()}
                selected={
                  dateRange.from || dateRange.to
                    ? {
                        from: dateRange.from,
                        to: dateRange.to,
                      }
                    : undefined
                }
                onSelect={(range) => {
                  if (range) {
                    // Update local state immediately for UI feedback
                    const newRange = {
                      from: range.from,
                      to: range.to,
                    }
                    setDateRange(newRange)

                    // Batch both date updates into a single call to avoid stale state issues
                    const newFilters = { ...filters }
                    if (range.from) {
                      newFilters.dateFrom = range.from
                    } else {
                      delete newFilters.dateFrom
                    }
                    if (range.to) {
                      newFilters.dateTo = range.to
                    } else {
                      delete newFilters.dateTo
                    }
                    onFiltersChange(newFilters)
                  } else {
                    // Range cleared
                    setDateRange({ from: undefined, to: undefined })
                    const newFilters = { ...filters }
                    delete newFilters.dateFrom
                    delete newFilters.dateTo
                    onFiltersChange(newFilters)
                  }
                }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        )}

        {/* Reset Button */}
        {hasNonDefaultFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              // Reset to default state
              setDateRange({ from: undefined, to: undefined })
              onFiltersChange({
                status: 'open',
                assignedToId: 'all',
              })
            }}
          >
            Reset
          </Button>
        )}
      </div>

    </div>
  )
}

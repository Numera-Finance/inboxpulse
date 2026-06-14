"use client"

import * as React from "react"
import { subDays, startOfDay, endOfDay } from "date-fns"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete"
import { UserAutocomplete } from "@/components/ui/user-autocomplete"
import { DateRangeFilter } from "@/components/ui/date-range-filter"
import type { TileFilters } from "./tiles"

interface DashboardFiltersProps {
  filters: TileFilters
  onFiltersChange: (filters: TileFilters) => void
  className?: string
}

export function DashboardFilters({
  filters,
  onFiltersChange,
  className,
}: DashboardFiltersProps) {
  // Check if any filters are active
  const hasActiveFilters =
    filters.customerId || filters.userId || filters.dateFrom || filters.dateTo

  // Handle customer change
  const handleCustomerChange = (customerId: string | null) => {
    onFiltersChange({
      ...filters,
      customerId: customerId || undefined,
    })
  }

  // Handle user change
  const handleUserChange = (userId: string | null) => {
    onFiltersChange({
      ...filters,
      userId: userId || undefined,
    })
  }

  // Handle date range change
  const handleDateRangeChange = (dateFrom: string, dateTo: string) => {
    onFiltersChange({
      ...filters,
      dateFrom,
      dateTo,
    })
  }

  // Reset all filters
  const handleReset = () => {
    const defaultFrom = startOfDay(subDays(new Date(), 30))
    const defaultTo = endOfDay(new Date())
    onFiltersChange({
      customerId: undefined,
      userId: undefined,
      dateFrom: defaultFrom.toISOString(),
      dateTo: defaultTo.toISOString(),
    })
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Customer Filter */}
      <CustomerAutocomplete
        value={filters.customerId || null}
        onChange={handleCustomerChange}
        placeholder="All Customers"
        className="w-[200px]"
      />

      {/* User Filter */}
      <UserAutocomplete
        value={filters.userId || null}
        onChange={(userId) => handleUserChange(userId)}
        hierarchyFiltered
        placeholder="All Users"
        className="w-[200px]"
      />

      {/* Date Range Filter */}
      <DateRangeFilter
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        onChange={handleDateRangeChange}
      />

      {/* Reset Button */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4 mr-1" />
          Clear Filters
        </Button>
      )}
    </div>
  )
}

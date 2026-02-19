"use client"

import * as React from "react"
import { format, subDays, startOfDay, endOfDay } from "date-fns"
import { CalendarIcon, X } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete"
import { UserAutocomplete } from "@/components/ui/user-autocomplete"
import type { TileFilters } from "./tiles"

// Quick date presets
const DATE_PRESETS = [
  {
    label: "Today",
    getValue: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "Last 7 days",
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 7)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "Last 30 days",
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 30)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "Last 90 days",
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 90)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: "Custom",
    getValue: () => null,
  },
] as const

type PresetLabel = (typeof DATE_PRESETS)[number]["label"]

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
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(() => {
    if (filters.dateFrom && filters.dateTo) {
      return {
        from: new Date(filters.dateFrom),
        to: new Date(filters.dateTo),
      }
    }
    // Default: Last 30 days
    return {
      from: startOfDay(subDays(new Date(), 30)),
      to: endOfDay(new Date()),
    }
  })

  const [selectedPreset, setSelectedPreset] = React.useState<PresetLabel>("Last 30 days")
  const [dateOpen, setDateOpen] = React.useState(false)

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

  // Handle date range change from calendar
  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
    setSelectedPreset("Custom")
    if (range?.from && range?.to) {
      onFiltersChange({
        ...filters,
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
      })
    }
  }

  // Handle preset click
  const handlePresetClick = (preset: (typeof DATE_PRESETS)[number]) => {
    setSelectedPreset(preset.label)
    if (preset.label === "Custom") {
      // Just select Custom, don't change dates
      return
    }
    const range = preset.getValue()
    if (range) {
      setDateRange(range)
      onFiltersChange({
        ...filters,
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
      })
      setDateOpen(false)
    }
  }

  // Reset all filters
  const handleReset = () => {
    const defaultRange = {
      from: startOfDay(subDays(new Date(), 30)),
      to: endOfDay(new Date()),
    }
    setDateRange(defaultRange)
    setSelectedPreset("Last 30 days")
    onFiltersChange({
      customerId: undefined,
      userId: undefined,
      dateFrom: defaultRange.from.toISOString(),
      dateTo: defaultRange.to.toISOString(),
    })
  }

  // Format date range for display
  const formatDateRange = () => {
    if (!dateRange?.from) return "Select dates"
    if (!dateRange.to) return format(dateRange.from, "MMM d, yyyy")
    return `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`
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
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "justify-start text-left font-normal min-w-[200px]",
              !dateRange && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formatDateRange()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex">
            {/* Quick presets */}
            <div className="border-r p-2 w-32">
              <div className="space-y-1">
                {DATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant={selectedPreset === preset.label ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => handlePresetClick(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
            {/* Calendar */}
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={handleDateRangeChange}
              numberOfMonths={2}
              defaultMonth={dateRange?.from}
            />
          </div>
        </PopoverContent>
      </Popover>

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

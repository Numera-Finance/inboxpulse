"use client"

import * as React from "react"
import { format, subDays, startOfDay, endOfDay } from "date-fns"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Quick date presets
export const DATE_PRESETS = [
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

export type PresetLabel = (typeof DATE_PRESETS)[number]["label"]

interface DateRangeFilterProps {
  dateFrom?: string
  dateTo?: string
  onChange: (dateFrom: string, dateTo: string) => void
  className?: string
}

export function DateRangeFilter({
  dateFrom,
  dateTo,
  onChange,
  className,
}: DateRangeFilterProps) {
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(() => {
    if (dateFrom && dateTo) {
      return {
        from: new Date(dateFrom),
        to: new Date(dateTo),
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

  // Handle date range change from calendar
  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
    setSelectedPreset("Custom")
    if (range?.from && range?.to) {
      onChange(range.from.toISOString(), range.to.toISOString())
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
      onChange(range.from.toISOString(), range.to.toISOString())
      setDateOpen(false)
    }
  }

  // Format date range for display
  const formatDateRange = () => {
    if (!dateRange?.from) return "Select dates"
    if (!dateRange.to) return format(dateRange.from, "MMM d, yyyy")
    return `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`
  }

  return (
    <Popover open={dateOpen} onOpenChange={setDateOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal min-w-[200px]",
            !dateRange && "text-muted-foreground",
            className
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
            showOutsideDays={false}
            defaultMonth={dateRange?.from}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

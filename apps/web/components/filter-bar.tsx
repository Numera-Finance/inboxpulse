"use client"

import * as React from "react"
import { Plus, X, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"

export interface FilterOption {
  value: string
  label: string
}

export interface FilterConfig {
  key: string
  label: string
  options: FilterOption[]
}

export interface ActiveFilter {
  key: string
  value: string
  label: string
  filterLabel: string
}

interface FilterBarProps {
  filters: FilterConfig[]
  activeFilters: ActiveFilter[]
  onAddFilter: (key: string, value: string, label: string) => void
  onRemoveFilter: (key: string) => void
  className?: string
}

export function FilterBar({
  filters,
  activeFilters,
  onAddFilter,
  onRemoveFilter,
  className,
}: FilterBarProps) {
  // Filter out already-applied filters from the available options
  const availableFilters = filters.filter(
    (f) => !activeFilters.find((af) => af.key === f.key)
  )

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className || ""}`}>
      {/* Add Filter Dropdown */}
      {availableFilters.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1">
              <Plus className="h-3 w-3" />
              Filter
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {availableFilters.map((filter) => (
              <DropdownMenuSub key={filter.key}>
                <DropdownMenuSubTrigger>{filter.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  {filter.options.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() =>
                        onAddFilter(filter.key, option.value, option.label)
                      }
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Active Filters as Tags */}
      {activeFilters.map((filter) => (
        <Badge
          key={filter.key}
          variant="secondary"
          className="h-7 gap-1 pr-1 cursor-default"
        >
          <span className="text-muted-foreground">{filter.filterLabel}:</span>
          <span>{filter.label}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 hover:bg-transparent ml-1"
            onClick={() => onRemoveFilter(filter.key)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      ))}
    </div>
  )
}

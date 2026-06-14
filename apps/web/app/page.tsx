"use client"

import { useCallback, useMemo, useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { subDays, startOfDay, endOfDay } from "date-fns"
import { RefreshCw, MoreVertical } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { DashboardGrid } from "@/components/dashboard/dashboard-grid"
import { DashboardFilters } from "@/components/dashboard/dashboard-filters"
import { useDashboardLayout } from "@/lib/hooks/use-dashboard-layout"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useQueryClient } from "@tanstack/react-query"
import { dashboardKeys } from "@/lib/hooks"
import type { TileFilters } from "@/components/dashboard/tiles"

// Debounce delay for filter changes
const DEBOUNCE_MS = 500

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { layouts, isLoading: layoutsLoading, handleLayoutChange, resetLayout } = useDashboardLayout()

  // Parse filters from URL
  const filtersFromUrl = useMemo<TileFilters>(() => {
    const defaultFrom = startOfDay(subDays(new Date(), 30)).toISOString()
    const defaultTo = endOfDay(new Date()).toISOString()

    return {
      customerId: searchParams.get("customer") || undefined,
      userId: searchParams.get("user") || undefined,
      dateFrom: searchParams.get("from") || defaultFrom,
      dateTo: searchParams.get("to") || defaultTo,
    }
  }, [searchParams])

  // Local state for immediate UI updates
  const [filters, setFilters] = useState<TileFilters>(filtersFromUrl)

  // Debounced filters for API calls
  const [debouncedFilters, setDebouncedFilters] = useState<TileFilters>(filtersFromUrl)

  // Sync URL to local state when URL changes externally
  useEffect(() => {
    setFilters(filtersFromUrl)
    setDebouncedFilters(filtersFromUrl)
  }, [filtersFromUrl])

  // Debounce filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [filters])

  // Update URL when filters change immediately so other tabs stay in sync.
  useEffect(() => {
    const params = new URLSearchParams()

    if (filters.customerId) {
      params.set("customer", filters.customerId)
    }
    if (filters.userId) {
      params.set("user", filters.userId)
    }
    if (filters.dateFrom) {
      params.set("from", filters.dateFrom)
    }
    if (filters.dateTo) {
      params.set("to", filters.dateTo)
    }

    // Only update if different from current URL
    const currentParams = searchParams.toString()
    const newParams = params.toString()
    if (newParams !== currentParams) {
      setSearchParams(params, { replace: true })
    }
  }, [filters, searchParams, setSearchParams])

  // Handle filter changes from UI
  const handleFiltersChange = useCallback((newFilters: TileFilters) => {
    setFilters(newFilters)
  }, [])

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => queryClient.invalidateQueries({ queryKey: dashboardKeys.all })}
                title="Refresh data"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-muted-foreground">
              Enterprise-wide email intelligence and customer insights
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2">
            <DashboardFilters
              filters={filters}
              onFiltersChange={handleFiltersChange}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More options">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => resetLayout()}>
                  Reset Layout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Grid Layout - uses debounced filters for API calls */}
        <DashboardGrid
          filters={debouncedFilters}
          layouts={layouts}
          isLoading={layoutsLoading}
          onLayoutChange={handleLayoutChange}
        />
      </div>
    </AppShell>
  )
}

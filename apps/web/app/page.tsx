"use client"

import { useCallback, useMemo, useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { subDays, startOfDay, endOfDay } from "date-fns"
import { RotateCcw } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { DashboardGrid, useDashboardLayout } from "@/components/dashboard/dashboard-grid"
import { DashboardFilters } from "@/components/dashboard/dashboard-filters"
import { Button } from "@/components/ui/button"
import type { TileFilters } from "@/components/dashboard/tiles"

// Debounce delay for filter changes
const DEBOUNCE_MS = 500

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { resetLayout } = useDashboardLayout()

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

  // Update URL when filters change (debounced)
  useEffect(() => {
    const params = new URLSearchParams()

    if (debouncedFilters.customerId) {
      params.set("customer", debouncedFilters.customerId)
    }
    if (debouncedFilters.userId) {
      params.set("user", debouncedFilters.userId)
    }
    if (debouncedFilters.dateFrom) {
      params.set("from", debouncedFilters.dateFrom)
    }
    if (debouncedFilters.dateTo) {
      params.set("to", debouncedFilters.dateTo)
    }

    // Only update if different from current URL
    const currentParams = searchParams.toString()
    const newParams = params.toString()
    if (newParams !== currentParams) {
      setSearchParams(params, { replace: true })
    }
  }, [debouncedFilters, searchParams, setSearchParams])

  // Handle filter changes from UI
  const handleFiltersChange = useCallback((newFilters: TileFilters) => {
    setFilters(newFilters)
  }, [])

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-muted-foreground">
                Enterprise-wide email intelligence and customer insights
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetLayout}
              className="h-8"
              title="Reset layout to default"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {/* Filters */}
          <DashboardFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />
        </div>

        {/* Grid Layout - uses debounced filters for API calls */}
        <DashboardGrid filters={debouncedFilters} />
      </div>
    </AppShell>
  )
}

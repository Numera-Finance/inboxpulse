"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getDashboardClient } from "@/lib/api/clients"
import type { DashboardLayoutConfig } from "@crm/clients"

// Types from react-grid-layout
interface Layout {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
  maxW?: number
  maxH?: number
  static?: boolean
}

interface Layouts {
  [breakpoint: string]: Layout[]
}

export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 }
export const COLS = { lg: 4, md: 3, sm: 2, xs: 1 }

// Query key for dashboard layout
const DASHBOARD_LAYOUT_KEY = ["dashboard", "layout"]

export function useDashboardLayout() {
  const queryClient = useQueryClient()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch layout from API - backend handles merging missing tiles
  const { data: layouts, isLoading } = useQuery({
    queryKey: DASHBOARD_LAYOUT_KEY,
    queryFn: async () => {
      const config = await getDashboardClient().getConfig()
      return config as Layouts
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  // Mutation to save layout
  const saveMutation = useMutation({
    mutationFn: async (newLayouts: Layouts) => {
      await getDashboardClient().saveConfig(newLayouts as DashboardLayoutConfig)
    },
    onError: (error) => {
      console.error("Failed to save dashboard layout:", error)
    },
  })

  // Mutation to reset layout
  const resetMutation = useMutation({
    mutationFn: async () => {
      const config = await getDashboardClient().resetConfig()
      return config
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY })
    },
    onError: (error) => {
      console.error("Failed to reset dashboard layout:", error)
    },
  })

  // Debounced save function
  const debouncedSave = useCallback((newLayouts: Layouts) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveMutation.mutate(newLayouts)
    }, 1000) // Save after 1 second of no changes
  }, [saveMutation])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const setLayouts = useCallback((newLayouts: Layouts) => {
    // Update local cache immediately for responsive UI
    queryClient.setQueryData(DASHBOARD_LAYOUT_KEY, newLayouts)
    // Debounced save to API
    debouncedSave(newLayouts)
  }, [queryClient, debouncedSave])

  const resetLayout = useCallback(() => {
    resetMutation.mutate()
  }, [resetMutation])

  const handleLayoutChange = useCallback(
    (_currentLayout: Layout[], allLayouts: Layouts) => {
      setLayouts(allLayouts)
    },
    [setLayouts]
  )

  return {
    layouts: layouts ?? null,
    isLoading,
    setLayouts,
    resetLayout,
    handleLayoutChange,
  }
}

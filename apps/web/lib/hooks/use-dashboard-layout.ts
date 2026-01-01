"use client"

import { useState, useEffect, useCallback } from "react"
import { TILE_DEFINITIONS } from "@/components/dashboard/tiles"

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

const STORAGE_KEY = "dashboard-layout"

export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 }
export const COLS = { lg: 4, md: 3, sm: 2, xs: 1 }

/**
 * Generate layout for a given breakpoint from TILE_DEFINITIONS
 * Auto-calculates x, y positions based on column count
 */
function generateLayoutForBreakpoint(cols: number): Layout[] {
  const layouts: Layout[] = []
  let currentX = 0
  let currentY = 0
  let maxHeightInRow = 0

  for (const tileDef of TILE_DEFINITIONS) {
    const { id } = tileDef.config
    const { w, h, minW, minH } = tileDef.layout

    // Adjust width for smaller breakpoints
    const effectiveW = Math.min(w, cols)
    const effectiveMinW = minW ? Math.min(minW, cols) : undefined

    // Check if tile fits in current row
    if (currentX + effectiveW > cols) {
      // Move to next row
      currentX = 0
      currentY += maxHeightInRow
      maxHeightInRow = 0
    }

    layouts.push({
      i: id,
      x: currentX,
      y: currentY,
      w: effectiveW,
      h,
      minW: effectiveMinW,
      minH,
    })

    currentX += effectiveW
    maxHeightInRow = Math.max(maxHeightInRow, h)
  }

  return layouts
}

// Generate default layouts from TILE_DEFINITIONS
const DEFAULT_LAYOUTS: Layouts = {
  lg: generateLayoutForBreakpoint(COLS.lg),
  md: generateLayoutForBreakpoint(COLS.md),
  sm: generateLayoutForBreakpoint(COLS.sm),
  xs: generateLayoutForBreakpoint(COLS.xs),
}

export function useDashboardLayout() {
  const [layouts, setLayouts] = useState<Layouts>(() => {
    if (typeof window === "undefined") return DEFAULT_LAYOUTS
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUTS
    } catch {
      return DEFAULT_LAYOUTS
    }
  })

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
    } catch {
      // Ignore storage errors
    }
  }, [layouts])

  const resetLayout = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore storage errors
    }
  }, [])

  const handleLayoutChange = useCallback(
    (_currentLayout: Layout[], allLayouts: Layouts) => {
      setLayouts(allLayouts)
    },
    []
  )

  return { layouts, setLayouts, resetLayout, handleLayoutChange }
}

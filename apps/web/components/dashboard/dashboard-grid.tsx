"use client"

import { ResponsiveGridLayout, useContainerWidth } from "react-grid-layout"
import { useDashboardLayout, BREAKPOINTS, COLS } from "@/lib/hooks/use-dashboard-layout"
import {
  TILE_DEFINITIONS,
  StatTile,
  type TileFilters,
  type StatTileConfig,
  type ChartTileConfig,
} from "./tiles"

import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

interface DashboardGridProps {
  filters?: TileFilters
}

export function DashboardGrid({ filters }: DashboardGridProps) {
  const { layouts, handleLayoutChange } = useDashboardLayout()

  // v2 hook returns { width, mounted, containerRef }
  const { width, mounted, containerRef } = useContainerWidth({
    initialWidth: 1200,
  })

  return (
    <div ref={containerRef}>
      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={150}
          width={width}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".tile-drag-handle"
          isResizable={true}
          isDraggable={true}
          margin={[16, 16]}
          containerPadding={[0, 0]}
        >
          {TILE_DEFINITIONS.map(({ config }) => (
            <div key={config.id} className="h-full">
              {config.category === "stat" ? (
                <StatTile
                  config={config as StatTileConfig}
                  filters={filters}
                />
              ) : (
                <ChartTileRenderer
                  config={config as ChartTileConfig}
                  filters={filters}
                />
              )}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  )
}

// Renderer for chart tiles
function ChartTileRenderer({
  config,
  filters,
}: {
  config: ChartTileConfig
  filters?: TileFilters
}) {
  const Component = config.component
  return <Component filters={filters} />
}

// Export resetLayout for use in parent components
export { useDashboardLayout }

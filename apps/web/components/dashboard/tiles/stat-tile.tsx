"use client"

import type { LucideIcon } from "lucide-react"
import type { UseQueryResult } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import type { TileFilters } from "./index"

// Data returned by stat tile hooks
export interface StatTileData {
  value: string | number
  change: string
}

export interface StatTileConfig {
  id: string
  title: string
  icon: LucideIcon
  trend?: "up" | "down" | "neutral"
  category: "stat"
  // Data hook that fetches tile data based on filters
  useData: (filters?: TileFilters) => UseQueryResult<StatTileData, Error>
  // Optional path for drilldown navigation
  drilldownPath?: string
}

export interface StatTileProps {
  config: StatTileConfig
  filters?: TileFilters
}

export function StatTile({ config, filters }: StatTileProps) {
  const { data, isLoading, error, refetch } = config.useData(filters)
  const navigate = useNavigate()
  const Icon = config.icon
  const trend = config.trend ?? "neutral"

  const isClickable = !!config.drilldownPath

  const handleClick = () => {
    if (config.drilldownPath) {
      navigate(config.drilldownPath)
    }
  }

  return (
    <Card
      className={cn(
        "tile-drag-handle h-full cursor-move p-4 flex items-center",
        isClickable && "hover:bg-accent/50 transition-colors"
      )}
      onClick={handleClick}
      role={isClickable ? "button" : undefined}
    >
      <div className={cn("w-full", isClickable && "cursor-pointer")}>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Error</p>
            <p className="text-sm text-destructive">{error.message}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{config.title}</p>
              <p className="text-3xl font-bold tracking-tight">{data?.value ?? 0}</p>
              <p
                className={cn(
                  "text-sm",
                  trend === "up" && "text-success",
                  trend === "down" && "text-destructive",
                  trend === "neutral" && "text-muted-foreground",
                )}
              >
                {data?.change ?? ""}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

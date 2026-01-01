import { Users, Mail, AlertTriangle, TrendingUp } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { UseQueryResult } from "@tanstack/react-query"
import {
  useDashboardCustomers,
  useDashboardEmails,
  useDashboardEscalations,
  useDashboardOpportunities,
} from "@/lib/hooks"

// Tile filter props passed to all tiles
export interface TileFilters {
  customerId?: string
  userId?: string
  dateFrom?: string
  dateTo?: string
}

// Data returned by stat tile hooks
export interface StatTileData {
  value: string | number
  change: string
}

// Configuration for stat tiles
export interface StatTileConfig {
  id: string
  title: string
  icon: LucideIcon
  trend?: "up" | "down" | "neutral"
  category: "stat"
  useData: (filters?: TileFilters) => UseQueryResult<StatTileData, Error>
}

// Configuration for chart tiles
export interface ChartTileConfig {
  id: string
  title: string
  component: React.ComponentType<{ filters?: TileFilters }>
}

// Union type for all tile configs
export type TileConfig =
  | StatTileConfig
  | (ChartTileConfig & { category: "chart" })

// Grid layout configuration
export interface TileLayout {
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface TileDefinition {
  config: TileConfig
  layout: TileLayout
}

// Import chart components
import { SentimentChart } from "../sentiment-chart"

// =============================================================================
// TILE REGISTRY - Add new tiles here
// =============================================================================

export const TILE_DEFINITIONS: TileDefinition[] = [
  // Stat tiles
  {
    config: {
      id: "customers",
      category: "stat",
      title: "Total Customers",
      icon: Users,
      trend: "up",
      useData: useDashboardCustomers,
    },
    layout: { w: 1, h: 1, minW: 1, minH: 1 },
  },
  {
    config: {
      id: "emails",
      category: "stat",
      title: "Emails Analyzed",
      icon: Mail,
      trend: "up",
      useData: useDashboardEmails,
    },
    layout: { w: 1, h: 1, minW: 1, minH: 1 },
  },
  {
    config: {
      id: "escalations",
      category: "stat",
      title: "Active Escalations",
      icon: AlertTriangle,
      trend: "down",
      useData: useDashboardEscalations,
    },
    layout: { w: 1, h: 1, minW: 1, minH: 1 },
  },
  {
    config: {
      id: "opportunities",
      category: "stat",
      title: "Upsell Opportunities",
      icon: TrendingUp,
      trend: "up",
      useData: useDashboardOpportunities,
    },
    layout: { w: 1, h: 1, minW: 1, minH: 1 },
  },

  // Chart tiles
  {
    config: {
      id: "sentiment",
      category: "chart",
      title: "Customer Sentiment",
      component: SentimentChart,
    },
    layout: { w: 2, h: 2, minW: 2, minH: 2 },
  },
]

// Helper to get tile by ID
export function getTileDefinition(id: string): TileDefinition | undefined {
  return TILE_DEFINITIONS.find((t) => t.config.id === id)
}

// Helper to get all tile IDs
export function getTileIds(): string[] {
  return TILE_DEFINITIONS.map((t) => t.config.id)
}

// Re-export components
export { StatTile } from "./stat-tile"

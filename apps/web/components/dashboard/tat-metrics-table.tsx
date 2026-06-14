"use client"

import * as React from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardTATMetrics } from "@/lib/hooks"
import type { TileFilters } from "./tiles"
import type { TATMetricRow } from "@/lib/api"
import { cn } from "@/lib/utils"
import { TATDrilldownDialog } from "./tat-drilldown-dialog"

interface TATMetricsTableProps {
  filters?: TileFilters
}

/**
 * Get color class based on count severity
 * Higher counts = more red (worse SLA breaches)
 */
function getCountColor(count: number): string {
  if (count === 0) return "text-muted-foreground"
  if (count <= 2) return "text-yellow-500"
  if (count <= 5) return "text-orange-500"
  return "text-red-500"
}

export function TATMetricsTable({ filters }: TATMetricsTableProps) {
  const { data: metrics, isLoading, error } = useDashboardTATMetrics(filters)
  const [selectedRow, setSelectedRow] = React.useState<TATMetricRow | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const handleRowClick = (row: TATMetricRow) => {
    setSelectedRow(row)
    setDialogOpen(true)
  }

  return (
    <Card className="tile-drag-handle h-full flex flex-col cursor-move p-4">
      <span className="text-sm font-medium text-muted-foreground mb-3">
        Email Response TAT (SLA Breaches)
      </span>
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Failed to load TAT metrics
          </div>
        ) : !metrics || metrics.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No SLA breaches found
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium text-center">6 Days</th>
                  <th className="pb-2 font-medium text-center">5 Days</th>
                  <th className="pb-2 font-medium text-center">3 Days</th>
                  <th className="pb-2 font-medium text-center">2 Days</th>
                  <th className="pb-2 font-medium text-center">1 Days</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((row: TATMetricRow, index: number) => (
                  <tr
                    key={`${row.customerId}-${index}`}
                    className="border-b border-border/50 hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleRowClick(row)}
                  >
                    <td
                      className="py-2 pr-2 truncate max-w-[150px]"
                      title={row.customerName}
                    >
                      {row.customerName || "—"}
                    </td>
                    <td className={cn("py-2 text-center font-medium", getCountColor(row.sixPlusDays))}>
                      {row.sixPlusDays}
                    </td>
                    <td className={cn("py-2 text-center font-medium", getCountColor(row.fivePlusDays))}>
                      {row.fivePlusDays}
                    </td>
                    <td className={cn("py-2 text-center font-medium", getCountColor(row.threePlusDays))}>
                      {row.threePlusDays}
                    </td>
                    <td className={cn("py-2 text-center font-medium", getCountColor(row.twoPlusDays))}>
                      {row.twoPlusDays}
                    </td>
                    <td className={cn("py-2 text-center font-medium", getCountColor(row.onePlusDays))}>
                      {row.onePlusDays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TATDrilldownDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tatRow={selectedRow}
        filters={filters}
      />
    </Card>
  )
}

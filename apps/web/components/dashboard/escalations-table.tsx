"use client"

import { formatDistanceToNow } from "date-fns"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardEscalationsTable } from "@/lib/hooks"
import type { TileFilters } from "./tiles"

interface EscalationsTableProps {
  filters?: TileFilters
}

export function EscalationsTable({ filters }: EscalationsTableProps) {
  const { data: escalations, isLoading, error } = useDashboardEscalationsTable(filters)

  return (
    <Card className="tile-drag-handle h-full flex flex-col cursor-move p-4">
      <span className="text-sm font-medium text-muted-foreground mb-3">Recent Escalations</span>
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Failed to load escalations
          </div>
        ) : !escalations || escalations.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No open escalations
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Subject</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {escalations.map((task) => (
                  <tr key={task.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2 pr-2 truncate max-w-[120px]" title={task.customerName || undefined}>
                      {task.customerName || "—"}
                    </td>
                    <td className="py-2 pr-2 truncate max-w-[200px]" title={task.title}>
                      {task.title}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                    </td>
                    <td className="py-2 truncate max-w-[100px]" title={task.assignedToName || undefined}>
                      {task.assignedToName || "Unassigned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

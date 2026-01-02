"use client"

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardEmailVolumeTrend } from "@/lib/hooks"
import type { TileFilters } from "./tiles"

const COLORS = {
  totalEmails: "#3b82f6", // Blue
  escalations: "#ef4444", // Red
}

interface EmailVolumeChartProps {
  filters?: TileFilters
}

export function EmailVolumeChart({ filters }: EmailVolumeChartProps) {
  const { data, isLoading, error } = useDashboardEmailVolumeTrend(filters)

  const chartData = data?.trendData ?? []

  // Check if all values are 0
  const hasData = chartData.some(d => d['Total Emails'] > 0 || d.Escalations > 0)

  return (
    <Card className="tile-drag-handle h-full flex flex-col cursor-move p-4">
      <span className="text-sm font-medium text-muted-foreground">Email Volume & Escalations</span>
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Failed to load email volume data
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No email volume data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="week"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                  color: "hsl(var(--foreground))",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="square"
                formatter={(value) => <span className="text-sm text-foreground">{value}</span>}
              />
              <Bar
                dataKey="Total Emails"
                fill={COLORS.totalEmails}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="Escalations"
                fill={COLORS.escalations}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardSentiment } from "@/lib/hooks"
import type { TileFilters } from "./tiles"

const COLORS = {
  Positive: "#22c55e",
  Neutral: "#f59e0b",
  Negative: "#ef4444",
}

interface SentimentChartProps {
  filters?: TileFilters
}

export function SentimentChart({ filters }: SentimentChartProps) {
  const { data, isLoading, error } = useDashboardSentiment(filters)

  const chartData = data?.pieData ?? [
    { name: "Positive", value: 0 },
    { name: "Neutral", value: 0 },
    { name: "Negative", value: 0 },
  ]

  // Check if all values are 0
  const hasData = chartData.some(d => d.value > 0)

  return (
    <Card className="tile-drag-handle h-full flex flex-col cursor-move p-4">
      <span className="text-sm font-medium text-muted-foreground">Customer Sentiment Distribution</span>
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Skeleton className="h-[150px] w-[150px] rounded-full" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Failed to load sentiment data
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No sentiment data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                innerRadius={65}
                outerRadius={95}
                paddingAngle={2}
                dataKey="value"
                label={({ cx, cy, midAngle, outerRadius, name, value }) => {
                  // Don't show label for 0% values
                  if (value === 0) return null
                  const RADIAN = Math.PI / 180
                  const radius = outerRadius + 35
                  const x = cx + radius * Math.cos(-midAngle * RADIAN)
                  const y = cy + radius * Math.sin(-midAngle * RADIAN)
                  const color = COLORS[name as keyof typeof COLORS]
                  return (
                    <text
                      x={x}
                      y={y}
                      fill={color}
                      textAnchor={x > cx ? "start" : "end"}
                      dominantBaseline="central"
                      fontSize={13}
                      fontWeight={500}
                    >
                      {`${name} ${value}%`}
                    </text>
                  )
                }}
                labelLine={false}
              >
                {chartData.map((entry) => (
                  <Cell key={`cell-${entry.name}`} fill={COLORS[entry.name as keyof typeof COLORS]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [`${value}%`, '']}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                  color: "hsl(var(--foreground))",
                }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                formatter={(value) => <span className="text-sm text-foreground">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

"use client"

import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardSentimentTrend } from "@/lib/hooks"
import { useNavigate } from "react-router-dom"
import type { TileFilters } from "./tiles"

const COLORS = {
  Positive: "#22c55e",
  Neutral: "#f59e0b",
  Negative: "#ef4444",
}

interface SentimentTrendChartProps {
  filters?: TileFilters
}

export function SentimentTrendChart({ filters }: SentimentTrendChartProps) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useDashboardSentimentTrend(filters)

  const chartData = data?.trendData ?? []

  // Check if all values are 0
  const hasData = chartData.some(d => d.Positive > 0 || d.Neutral > 0 || d.Negative > 0)

  return (
    <Card className="tile-drag-handle h-full flex flex-col cursor-move p-4">
      <span className="text-sm font-medium text-muted-foreground">Sentiment Trend (6 Months)</span>
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Failed to load sentiment trend data
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No sentiment trend data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <YAxis
                tickFormatter={(value) => `${value}`}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                width={30}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-md border bg-card p-2 text-sm shadow-sm">
                      <p className="font-medium text-card-foreground mb-1">{label}</p>
                      {payload.map((entry) => (
                        <div key={entry.dataKey} className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                          <span className="text-card-foreground">{entry.name}: {entry.value}%</span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                formatter={(value) => <span className="text-sm text-foreground">{value}</span>}
              />
              <Area
                type="monotone"
                dataKey="Positive"
                stackId="1"
                stroke={COLORS.Positive}
                fill={COLORS.Positive}
                fillOpacity={0.8}
                style={{ cursor: "pointer" }}
                onClick={() => navigate('/escalations?signal=positive&status=all')}
              />
              <Area
                type="monotone"
                dataKey="Neutral"
                stackId="1"
                stroke={COLORS.Neutral}
                fill={COLORS.Neutral}
                fillOpacity={0.8}
                style={{ cursor: "pointer" }}
                onClick={() => navigate('/escalations?signal=neutral&status=all')}
              />
              <Area
                type="monotone"
                dataKey="Negative"
                stackId="1"
                stroke={COLORS.Negative}
                fill={COLORS.Negative}
                fillOpacity={0.8}
                style={{ cursor: "pointer" }}
                onClick={() => navigate('/escalations?signal=negative&status=all')}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

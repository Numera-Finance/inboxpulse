"use client"

import { Smile, Frown, Meh, TrendingUp, TrendingDown, Clock } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { InboxSentimentFilter } from "./types"

interface SignalFilterProps {
  value: InboxSentimentFilter
  onChange: (value: InboxSentimentFilter) => void
  className?: string
  excludeNeutral?: boolean
}

export function SignalFilter({ value, onChange, className, excludeNeutral }: SignalFilterProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as InboxSentimentFilter)}
    >
      <SelectTrigger className={className ?? "w-[130px] h-8"}>
        <SelectValue placeholder="Signal" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          <span className="flex items-center gap-2">All</span>
        </SelectItem>
        <SelectItem value="positive">
          <span className="flex items-center gap-2">
            <Smile className="h-3.5 w-3.5 text-green-500" />
            Positive
          </span>
        </SelectItem>
        {!excludeNeutral && (
          <SelectItem value="neutral">
            <span className="flex items-center gap-2">
              <Meh className="h-3.5 w-3.5 text-gray-500" />
              Neutral
            </span>
          </SelectItem>
        )}
        <SelectItem value="negative">
          <span className="flex items-center gap-2">
            <Frown className="h-3.5 w-3.5 text-red-500" />
            Negative
          </span>
        </SelectItem>
        <SelectItem value="upsell">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
            Upsell
          </span>
        </SelectItem>
        <SelectItem value="churn">
          <span className="flex items-center gap-2">
            <TrendingDown className="h-3.5 w-3.5 text-orange-500" />
            Churn Risk
          </span>
        </SelectItem>
        <SelectItem value="tat">
          <span className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-red-500" />
            TAT Breach
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

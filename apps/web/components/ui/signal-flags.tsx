"use client"

import * as React from "react"
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  ThumbsUp,
  Swords,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { resolveFlags, type FlagKind } from "./signal-flags-logic"

/**
 * SignalFlags — renders the analysis "action" flags for an email row as small
 * icon chips (escalation / churn / upsell / kudos / competitor).
 *
 * Sentiment and classification are intentionally NOT included here — the row
 * already renders those via <SentimentIndicator> / <ClassificationIndicator>.
 * This surfaces the remaining flags the InboxPulse design shows in the inbox
 * (e.g. "At risk", "Churn risk", "Upsell signal") without duplicating them.
 *
 * The signal → flag resolution lives in ./signal-flags-logic (pure, tested).
 */

const FLAG_ICONS: Record<FlagKind, LucideIcon> = {
  escalation: AlertTriangle,
  churn: TrendingDown,
  competitor: Swords,
  upsell: TrendingUp,
  kudos: ThumbsUp,
}

const iconSizeClasses = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
}

interface SignalFlagsProps {
  signals: number[] | null | undefined
  size?: "sm" | "md" | "lg"
  variant?: "icon" | "badge"
  /** cap the number of flags rendered (default: all) */
  max?: number
  className?: string
}

/**
 * SignalFlags
 *
 * <SignalFlags signals={item.signals} />                 // icon chips (row)
 * <SignalFlags signals={item.signals} variant="badge" /> // labelled chips
 */
export function SignalFlags({
  signals,
  size = "sm",
  variant = "icon",
  max,
  className,
}: SignalFlagsProps) {
  const flags = resolveFlags(signals)
  if (flags.length === 0) return null

  const shown = typeof max === "number" ? flags.slice(0, max) : flags

  return (
    <div className={cn("flex items-center gap-1 flex-shrink-0", className)}>
      {shown.map((flag) => {
        const Icon = FLAG_ICONS[flag.kind]
        if (variant === "badge") {
          return (
            <Badge
              key={flag.kind}
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0 gap-1 font-medium", flag.badge)}
            >
              <Icon className={iconSizeClasses.sm} />
              {flag.text}
            </Badge>
          )
        }
        return (
          <Tooltip key={flag.kind}>
            <TooltipTrigger asChild>
              <span className="inline-flex" aria-label={flag.text}>
                <Icon className={cn(iconSizeClasses[size], flag.color)} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{flag.text}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

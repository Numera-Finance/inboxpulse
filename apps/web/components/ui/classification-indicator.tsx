"use client"

import * as React from "react"
import { Ban, Megaphone, Receipt, Bot, Briefcase } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type ClassificationValue = "spam" | "marketing" | "transactional" | "automated" | "business"

export interface ClassificationData {
  value: ClassificationValue
  confidence?: number
}

interface ClassificationIndicatorProps {
  classification: ClassificationData | null | undefined
  size?: "sm" | "md" | "lg"
  showLabel?: boolean
  variant?: "icon" | "badge"
  className?: string
}

const iconSizeClasses = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
}

const iconColorClasses: Record<ClassificationValue, string> = {
  spam: "text-red-500",
  marketing: "text-orange-500",
  transactional: "text-blue-500",
  automated: "text-purple-500",
  business: "text-green-500",
}

const badgeClasses: Record<ClassificationValue, string> = {
  spam: "bg-red-500/10 text-red-600 border-red-500/20",
  marketing: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  transactional: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  automated: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  business: "bg-green-500/10 text-green-600 border-green-500/20",
}

const labelText: Record<ClassificationValue, string> = {
  spam: "Spam",
  marketing: "Marketing",
  transactional: "Transactional",
  automated: "Automated",
  business: "Business",
}

const ClassificationIcon: Record<ClassificationValue, React.ComponentType<{ className?: string }>> = {
  spam: Ban,
  marketing: Megaphone,
  transactional: Receipt,
  automated: Bot,
  business: Briefcase,
}

/**
 * ClassificationIndicator - Icon or badge indicating email classification with optional confidence tooltip
 *
 * Usage:
 * <ClassificationIndicator classification={{ value: "spam", confidence: 0.95 }} />
 * <ClassificationIndicator classification={...} variant="badge" showLabel />
 */
export function ClassificationIndicator({
  classification,
  size = "md",
  showLabel = false,
  variant = "badge",
  className,
}: ClassificationIndicatorProps) {
  if (!classification) {
    return null
  }

  const confidencePercent = classification.confidence
    ? Math.round(classification.confidence * 100)
    : null
  const tooltipText = confidencePercent
    ? `${labelText[classification.value]} (${confidencePercent}% confidence)`
    : labelText[classification.value]

  const Icon = ClassificationIcon[classification.value]

  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <Icon
              className={cn(
                "flex-shrink-0",
                iconSizeClasses[size],
                iconColorClasses[classification.value],
                className
              )}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "text-xs cursor-default",
            badgeClasses[classification.value],
            className
          )}
        >
          <Icon className={cn("flex-shrink-0 mr-1", iconSizeClasses[size])} />
          {showLabel && <span className="capitalize">{classification.value}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}

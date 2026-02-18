"use client"

import { Clock, Mail, AlertTriangle, Users, TrendingUp, TrendingDown, Minus, Tag } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Customer } from "@/lib/types"
import { cn } from "@/lib/utils"

interface CustomerCardProps {
  customer: Customer
  onClick: () => void
}

export function CustomerCard({ customer, onClick }: CustomerCardProps) {
  const sentimentIcon = {
    Positive: TrendingUp,
    Negative: TrendingDown,
    Neutral: Minus,
  }[customer.sentiment]

  const SentimentIcon = sentimentIcon

  return (
    <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer hover:border-primary/50" onClick={onClick}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground mb-1">{customer.name}</h3>
          <p className="text-sm text-muted-foreground">@{customer.domains[0]}</p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs cursor-default",
                  customer.sentiment === "Positive" && "border-green-500 text-green-500",
                  customer.sentiment === "Negative" && "border-red-500 text-red-500",
                  customer.sentiment === "Neutral" && "border-amber-500 text-amber-500",
                )}
              >
                <SentimentIcon className="mr-1 h-3 w-3" />
                {customer.sentiment}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {customer.sentimentConfidence
                ? `${customer.sentiment} (${Math.round(customer.sentimentConfidence * 100)}% confidence)`
                : customer.sentiment}
            </TooltipContent>
          </Tooltip>
          <Badge
            className={cn(
              "text-xs",
              customer.churnRisk === "Low" && "bg-green-500/10 text-green-500 border-0",
              customer.churnRisk === "Medium" && "bg-amber-500/10 text-amber-500 border-0",
              customer.churnRisk === "High" && "bg-red-500/10 text-red-500 border-0",
            )}
          >
            {customer.churnRisk} Risk
          </Badge>
        </div>
      </div>

      {customer.labels.length > 0 && (
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {customer.labels.map((label) => (
            <Badge key={label} variant="secondary" className="text-xs">
              {label}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Mail className="h-3 w-3" />
            Total Emails
          </div>
          <p className="text-lg font-semibold">{customer.totalEmails}</p>
        </div>
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <Clock className="h-3 w-3" />
            Avg TAT
          </div>
          <p className="text-lg font-semibold">{customer.avgTAT}</p>
        </div>
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <AlertTriangle className="h-3 w-3" />
            Negative
          </div>
          <p className={cn("text-lg font-semibold", customer.escalations > 0 && "text-destructive")}>
            {customer.escalations}
          </p>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Engagement</div>
          <Badge variant="outline" className="text-xs">
            {customer.engagement}
          </Badge>
        </div>
      </div>

      <div className="pt-4 border-t border-border">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          <Users className="h-3 w-3" />
          Key Contacts
        </div>
        <div className="flex flex-wrap gap-1">
          {customer.contacts.slice(0, 2).map((contact) => (
            <Badge key={contact.id} variant="secondary" className="text-xs">
              {contact.name} ({contact.title})
            </Badge>
          ))}
          {customer.contacts.length > 2 && (
            <Badge variant="secondary" className="text-xs">
              +{customer.contacts.length - 2}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Last contact: {customer.lastContact}</p>
      </div>
    </Card>
  )
}

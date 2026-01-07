"use client"

import {
  Building2,
  Mail,
  Clock,
  User,
  Calendar,
  CheckCircle,
  MoreHorizontal,
  Reply,
  Forward,
  Trash2,
  Star,
  Archive,
  Tag,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { Escalation } from "@/lib/data"
import { cn } from "@/lib/utils"

interface EscalationDetailPanelProps {
  escalation: Escalation | null
}

export function EscalationDetailPanel({ escalation }: EscalationDetailPanelProps) {
  if (!escalation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Mail className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>Select an escalation to view details</p>
        </div>
      </div>
    )
  }

  // Generate email content based on escalation
  const emailContent = {
    from: escalation.contactEmail,
    to: "support@company.com",
    date: escalation.created,
    subject: escalation.title,
    body: `Dear Support Team,

${escalation.description}

We have been experiencing this issue for some time now and it's becoming increasingly critical for our operations. Our team has tried several workarounds but none have been successful.

This is affecting our production environment and we need immediate assistance to resolve this matter.

Please prioritize this request as we are a ${escalation.isPremier ? "Premier" : "Standard"} customer and this is impacting our SLA.

Best regards,
${escalation.contactEmail
  .split("@")[0]
  .split(".")
  .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
  .join(" ")}
${escalation.customerName}`,
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Archive className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Tag className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Label</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-1">
          <Button className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-sm">
            <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
            Done
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Reply className="mr-2 h-4 w-4" />
                Reply
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Forward className="mr-2 h-4 w-4" />
                Forward
              </DropdownMenuItem>
              <DropdownMenuItem>Add Note</DropdownMenuItem>
              <DropdownMenuItem>Reassign</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Escalate Further</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6">
          {/* Email Header */}
          <div className="mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold mb-2">{escalation.title}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {escalation.isPremier && (
                    <Badge className="bg-amber-500/10 text-amber-600 border-0 text-xs">
                      <Star className="mr-1 h-3 w-3 fill-current" />
                      Premier
                    </Badge>
                  )}
                  <Badge
                    className={cn(
                      "text-xs",
                      escalation.priority === "Critical" && "bg-destructive text-destructive-foreground",
                      escalation.priority === "High" && "bg-amber-500 text-white",
                      escalation.priority === "Medium" && "bg-primary text-primary-foreground",
                      escalation.priority === "Low" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {escalation.priority}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      escalation.status === "Open" && "border-destructive text-destructive",
                      escalation.status === "In Progress" && "border-primary text-primary",
                      escalation.status === "Resolved" && "border-green-500 text-green-500",
                    )}
                  >
                    {escalation.status}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Meta info grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg bg-muted/50 text-sm">
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Building2 className="h-3 w-3" />
                  Company
                </div>
                <p className="font-medium">{escalation.customerName}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <User className="h-3 w-3" />
                  Assigned To
                </div>
                <p className="font-medium">{escalation.assignedTo}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  Response Time
                </div>
                <p className="font-medium">{escalation.responseTime}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Calendar className="h-3 w-3" />
                  Last Update
                </div>
                <p className="font-medium">{escalation.lastUpdate}</p>
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Email Content */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                {emailContent.from.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">
                    {emailContent.from
                      .split("@")[0]
                      .split(".")
                      .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
                      .join(" ")}
                  </p>
                  <span className="text-xs text-muted-foreground">{emailContent.date}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{emailContent.from}</p>
              </div>
            </div>

            <div className="pl-[52px] overflow-hidden">
              <div className="text-sm text-muted-foreground mb-4">
                <span>To: {emailContent.to}</span>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-transparent p-0 m-0 break-words">
                  {emailContent.body}
                </pre>
              </div>
            </div>
          </div>

          {/* Reply section */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 bg-transparent">
                <Reply className="mr-2 h-4 w-4" />
                Reply
              </Button>
              <Button variant="outline" className="flex-1 bg-transparent">
                <Forward className="mr-2 h-4 w-4" />
                Forward
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

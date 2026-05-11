"use client"
import { X, Reply, Forward, Trash2, Star, MoreHorizontal, Clock, User, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Email } from "@/lib/types"

interface EmailDrawerProps {
  email: Email | null
  customerName?: string
  open: boolean
  onClose: () => void
}

export function EmailDrawer({ email, customerName, open, onClose }: EmailDrawerProps) {
  if (!email) return null

  return (
    <>
      {/* Overlay - constrained to area right of sidebar so sidebar stays interactive */}
      <div
        className={`fixed top-0 right-0 bottom-0 left-[var(--sidebar-width,16rem)] bg-background/80 backdrop-blur-sm z-40 transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-2xl transform bg-background border-l border-border shadow-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Email
              </Badge>
              {customerName && (
                <Badge variant="secondary" className="text-xs">
                  <Building2 className="mr-1 h-3 w-3" />
                  {customerName}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Star className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Mark as Unread</DropdownMenuItem>
                  <DropdownMenuItem>Add to Escalation</DropdownMenuItem>
                  <DropdownMenuItem>Print</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Email Content */}
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6">
              {/* Subject */}
              <h1 className="text-xl font-semibold">{email.subject}</h1>

              {/* Metadata */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{email.from}</p>
                      <p className="text-sm text-muted-foreground">To: {email.to}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {email.date}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Email Body */}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="whitespace-pre-wrap text-foreground leading-relaxed">{email.body}</div>
              </div>
            </div>
          </ScrollArea>

          {/* Footer Actions */}
          <div className="border-t border-border p-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" className="flex-1 bg-transparent">
                <Reply className="mr-2 h-4 w-4" />
                Reply
              </Button>
              <Button variant="outline" className="flex-1 bg-transparent">
                <Forward className="mr-2 h-4 w-4" />
                Forward
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

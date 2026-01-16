"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, CheckCircle2, ExternalLink, Unplug, Pencil } from "lucide-react"
import { GMAIL_SCOPE_DESCRIPTIONS } from "@crm/shared"
import type { Integration } from "@/lib/api"
import { API_BASE_URL } from "@/lib/api"
import { GmailSettingsDrawer } from "./gmail-settings-drawer"

// Gmail logo SVG - official Google colors
function GmailLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285f4" d="M2 6.5V18c0 1.1.9 2 2 2h2.5v-8.5L2 8.2V6.5z"/>
      <path fill="#34a853" d="M17.5 20H20c1.1 0 2-.9 2-2V6.5l-4.5 3.7V20z"/>
      <path fill="#fbbc04" d="M17.5 4v7.5L22 8.2V5.6c0-2.5-2.8-3.9-4.8-2.4L17.5 4z"/>
      <path fill="#ea4335" d="M6.5 11.5V4l5.5 4.5L17.5 4v7.5L12 16l-5.5-4.5z"/>
      <path fill="#c5221f" d="M2 5.6v2.6l4.5 3.3V4l-.3-.2C4.2 1.9 2 3.1 2 5.6z"/>
    </svg>
  )
}

interface GmailIntegrationCardProps {
  integration: Integration | null
  isLoading: boolean
  isDisconnecting?: boolean
  tenantId: string
  userId?: string
  onConnect: () => void
  onDisconnect: () => void
}

export function GmailIntegrationCard({
  integration,
  isLoading,
  isDisconnecting = false,
  tenantId,
  userId,
  onConnect,
  onDisconnect
}: GmailIntegrationCardProps) {
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const isConnected = integration?.isActive === true

  const handleConnect = () => {
    if (!tenantId) {
      console.error('Cannot connect: tenantId is missing')
      return
    }
    // Redirect to OAuth flow with userId for tracking who connected
    const params = new URLSearchParams({ tenantId })
    if (userId) {
      params.set('userId', userId)
    }
    window.location.href = `${API_BASE_URL}/oauth/gmail/authorize?${params.toString()}`
  }

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getWatchStatus = () => {
    if (!integration?.watchExpiresAt) return null
    const expiresAt = new Date(integration.watchExpiresAt)
    const now = new Date()
    const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (daysUntilExpiry < 0) {
      return { status: 'expired', text: 'Watch expired', variant: 'destructive' as const }
    } else if (daysUntilExpiry <= 1) {
      return { status: 'expiring', text: 'Expiring soon', variant: 'warning' as const }
    }
    return { status: 'active', text: `Active (${daysUntilExpiry} days)`, variant: 'default' as const }
  }

  const watchStatus = getWatchStatus()

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white border shadow-sm">
              <GmailLogo className="h-7 w-7" />
            </div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">Gmail</CardTitle>
              {isConnected && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Configure Gmail settings"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {isConnected ? (
            <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">Not Connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isConnected ? (
          <div className="space-y-3">
            {/* Connected account info */}
            {integration?.connectedEmail && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{integration.connectedEmail}</span>
              </div>
            )}
            {integration?.createdByUser && (
              <p className="text-xs text-muted-foreground">
                Connected by {integration.createdByUser.fullName}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Last synced</p>
                <p className="font-medium">{formatDate(integration?.lastRunAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Watch status</p>
                {watchStatus && (
                  <Badge variant={watchStatus.variant === 'warning' ? 'secondary' : watchStatus.variant} className="mt-1">
                    {watchStatus.text}
                  </Badge>
                )}
              </div>
            </div>
            <div className="pt-2 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleConnect}
                disabled={isDisconnecting}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Reconnect
              </Button>
              <Button
                variant="destructive"
                onClick={onDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your Gmail account to automatically sync and analyze customer emails.
            </p>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Permissions requested:</strong>
              </p>
              <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                {GMAIL_SCOPE_DESCRIPTIONS.map((desc, i) => (
                  <li key={i}>{desc}</li>
                ))}
              </ul>
            </div>
            <Button
              className="w-full"
              onClick={handleConnect}
            >
              <GmailLogo className="mr-2 h-4 w-4" />
              Connect Gmail
            </Button>
          </div>
        )}
      </CardContent>

      {/* Settings Drawer */}
      {integration && (
        <GmailSettingsDrawer
          integration={integration}
          tenantId={tenantId}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </Card>
  )
}

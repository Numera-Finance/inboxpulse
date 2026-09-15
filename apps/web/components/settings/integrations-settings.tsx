"use client"

import { useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { GmailIntegrationCard } from "@/components/integrations/gmail-card"
import { useGmailIntegration, useDisconnectIntegration, integrationKeys } from "@/lib/hooks"
import { gmailAuthorizeUrl } from "@/lib/api"
import { useAuth } from "@/src/contexts/AuthContext"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"

export function IntegrationsSettings() {
  const { user } = useAuth()
  const tenantId = user?.tenantId || ''
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: gmailIntegration,
    isLoading: isGmailLoading,
  } = useGmailIntegration(tenantId)

  const disconnectMutation = useDisconnectIntegration()

  // Handle OAuth callback.
  // The API redirects to /settings?tab=integrations directly. It must not use
  // /integrations: that route is a <Navigate ... replace> which drops the query
  // string, so every outcome below arrived here as a bare page load and the user
  // was told nothing at all.
  useEffect(() => {
    const oauthStatus = searchParams.get('oauth')
    const reason = searchParams.get('reason')
    const error = searchParams.get('error')

    if (!oauthStatus && !error) return

    if (oauthStatus === 'success') {
      toast.success("Gmail Connected", { description: "Your Gmail account has been connected successfully." })
      // Refresh integration data
      queryClient.invalidateQueries({ queryKey: integrationKeys.byTenantAndSource(tenantId, 'gmail') })
    } else if (reason === 'denied') {
      // Declining consent is a decision, not a fault. It reaches here instead of
      // the raw HTML page the API used to serve on its own origin.
      toast("Gmail Not Connected", {
        description: error || "Gmail was not connected because access was declined.",
      })
    } else if (reason === 'expired') {
      // A stale consent screen is the one failure the user can fix by trying
      // again, so it gets the button rather than the same dead end as the rest.
      toast.error("Connection Timed Out", {
        description: error || "This connection request expired. Please connect Gmail again.",
        action: tenantId
          ? {
              label: "Reconnect",
              onClick: () => {
                window.location.href = gmailAuthorizeUrl({ tenantId })
              },
            }
          : undefined,
      })
    } else {
      toast.error("Connection Failed", { description: error || "Failed to connect your Gmail account. Please try again." })
    }

    // Clear URL params
    navigate('/settings?tab=integrations', { replace: true })
  }, [searchParams, navigate, queryClient, tenantId])

  const handleConnect = () => {
    // This will be handled by the card component redirecting to OAuth
  }

  const handleDisconnect = () => {
    disconnectMutation.mutate(
      { tenantId, source: 'gmail' },
      {
        onSuccess: () => {
          toast.success("Gmail Disconnected", { description: "Your Gmail account has been disconnected." })
        },
        onError: (error) => {
          toast.error("Disconnect Failed", { description: error.message || "Failed to disconnect Gmail. Please try again." })
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect your email and communication tools to sync customer data
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <GmailIntegrationCard
          integration={gmailIntegration ?? null}
          isLoading={isGmailLoading}
          isDisconnecting={disconnectMutation.isPending}
          tenantId={tenantId}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      </div>
    </div>
  )
}

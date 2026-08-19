"use client"

import { useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { GmailIntegrationCard } from "@/components/integrations/gmail-card"
import { useGmailIntegration, useDisconnectIntegration, integrationKeys } from "@/lib/hooks"
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

  // Handle OAuth callback
  useEffect(() => {
    const oauthStatus = searchParams.get('oauth')
    const error = searchParams.get('error')

    if (oauthStatus === 'success') {
      toast.success("Gmail Connected", { description: "Your Gmail account has been connected successfully." })
      // Refresh integration data
      queryClient.invalidateQueries({ queryKey: integrationKeys.byTenantAndSource(tenantId, 'gmail') })
      // Clear URL params
      navigate('/settings?tab=integrations', { replace: true })
    } else if (oauthStatus === 'error' || error) {
      toast.error("Connection Failed", { description: error || "Failed to connect your Gmail account. Please try again." })
      // Clear URL params
      navigate('/settings?tab=integrations', { replace: true })
    }
  }, [searchParams, toast, navigate, queryClient, tenantId])

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

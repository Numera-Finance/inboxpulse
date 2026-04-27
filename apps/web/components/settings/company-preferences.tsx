"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/ui/use-toast"
import { Download, Loader2 } from "lucide-react"
import { getLoginHistoryClient, getTenantClient } from "@/lib/api/clients"
import { downloadBlob } from "@/lib/utils/export"
import type { Tenant } from "@crm/clients"

export function CompanyPreferences() {
  const { toast } = useToast()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loadingTenant, setLoadingTenant] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function fetchTenant() {
      try {
        const result = await getTenantClient().getMe(controller.signal)
        setTenant(result)
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Failed to load company info:", error)
        toast({
          title: "Error",
          description: "Could not load company information.",
          variant: "destructive",
        })
      } finally {
        if (!controller.signal.aborted) {
          setLoadingTenant(false)
        }
      }
    }
    fetchTenant()
    return () => controller.abort()
  }, [toast])

  const handleExportLoginHistory = async () => {
    setExporting(true)
    try {
      const blob = await getLoginHistoryClient().exportCsv()
      const today = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `login-history-${today}.csv`)
      toast({
        title: "Export started",
        description: "Login history for the last 30 days has been downloaded.",
      })
    } catch (error) {
      console.error("Failed to export login history:", error)
      toast({
        title: "Export failed",
        description: "Could not export login history. Please try again.",
        variant: "destructive",
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Company</h2>
        <p className="text-sm text-muted-foreground">
          Organization-wide settings and audit tools
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
          <CardDescription>Read-only details about your organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingTenant ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : tenant ? (
            <>
              <div className="grid gap-1">
                <Label className="text-muted-foreground">Company Name</Label>
                <p className="text-sm font-medium">{tenant.name}</p>
              </div>
              <Separator />
              <div className="grid gap-1">
                <Label className="text-muted-foreground">Email Domains</Label>
                {tenant.domains.length > 0 ? (
                  <p className="text-sm font-medium">{tenant.domains.join(", ")}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No domains configured</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Company information unavailable.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Login History</CardTitle>
          <CardDescription>
            Download a CSV of all user logins in your organization for the last 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExportLoginHistory} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export Login History
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import * as React from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { Separator } from "@/components/ui/separator"
import {
  SettingsNav,
  UserPreferences,
  IntegrationsSettings,
  HolidaySettings,
  KeywordSettings,
  type SettingsTab,
} from "@/components/settings"
import { useAuth } from "@/src/contexts/AuthContext"

export default function SettingsPage() {
  const { isAdmin, isLoading: isAuthLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // Get active tab from URL or default to 'user'
  const tabParam = searchParams.get('tab') as SettingsTab | null
  const activeTab: SettingsTab = tabParam && ['user', 'integrations', 'holidays', 'keywords'].includes(tabParam)
    ? tabParam
    : 'user'

  const handleTabChange = (tab: SettingsTab) => {
    navigate(`/settings?tab=${tab}`, { replace: true })
  }

  // If non-admin tries to access admin-only tabs, redirect to user tab
  React.useEffect(() => {
    const adminOnlyTabs: SettingsTab[] = ['integrations', 'holidays', 'keywords']
    if (!isAuthLoading && !isAdmin && adminOnlyTabs.includes(activeTab)) {
      navigate('/settings?tab=user', { replace: true })
    }
  }, [isAdmin, isAuthLoading, activeTab, navigate])

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your application preferences and configurations
          </p>
        </div>

        <Separator />

        <div className="flex gap-8">
          <SettingsNav
            activeTab={activeTab}
            onTabChange={handleTabChange}
            showIntegrations={isAdmin}
          />

          <div className="flex-1 max-w-3xl">
            {activeTab === 'user' && <UserPreferences />}
            {activeTab === 'holidays' && isAdmin && <HolidaySettings />}
            {activeTab === 'keywords' && isAdmin && <KeywordSettings />}
            {activeTab === 'integrations' && isAdmin && <IntegrationsSettings />}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

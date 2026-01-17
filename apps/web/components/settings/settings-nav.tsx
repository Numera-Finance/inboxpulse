"use client"

import { cn } from "@/lib/utils"
import { User, Building2, Plug2, Calendar } from "lucide-react"

export type SettingsTab = 'user' | 'company' | 'integrations' | 'holidays'

interface SettingsNavProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  showIntegrations?: boolean
}

const tabs = [
  { id: 'user' as const, label: 'User Preferences', icon: User },
  { id: 'company' as const, label: 'Company Preferences', icon: Building2 },
  { id: 'holidays' as const, label: 'Holiday Calendar', icon: Calendar, adminOnly: true },
  { id: 'integrations' as const, label: 'Integrations', icon: Plug2, adminOnly: true },
]

export function SettingsNav({ activeTab, onTabChange, showIntegrations = true }: SettingsNavProps) {
  const visibleTabs = tabs.filter(tab => {
    if (tab.adminOnly && !showIntegrations) return false
    return true
  })

  return (
    <nav className="flex flex-col space-y-1 w-56 shrink-0">
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
            activeTab === tab.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <tab.icon className="h-4 w-4" />
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

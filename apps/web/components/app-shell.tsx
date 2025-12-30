"use client"

import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed"

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    // Initialize from localStorage
    if (typeof window !== "undefined") {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"
    }
    return false
  })

  // Persist to localStorage when changed
  React.useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}

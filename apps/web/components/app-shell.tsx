"use client"

import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed"

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === "undefined") return true
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    return stored === null ? true : stored === "true"
  })

  // Persist to localStorage when changed
  React.useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  return (
    <div
      className="flex h-screen overflow-hidden bg-background"
      style={{ "--sidebar-width": sidebarCollapsed ? "4rem" : "16rem" } as React.CSSProperties}
    >
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}

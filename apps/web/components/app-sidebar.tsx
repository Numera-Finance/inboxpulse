import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  LayoutDashboard,
  Inbox,
  Building2,
  Settings,
  Mail,
  PanelLeftClose,
  PanelLeft,
  Users,
  LogOut,
  SlidersHorizontal,
  ChevronsUpDown,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth, Permission, type PermissionType } from "@/src/contexts/AuthContext"

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  /** Required permissions (user needs ANY of these to see the item) */
  permissions?: PermissionType[]
  /** If true, only admins can see this item */
  adminOnly?: boolean
}

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "AI Analysis", href: "/escalations", icon: Inbox },
  { name: "Customers", href: "/customers", icon: Building2 },
  {
    name: "Users",
    href: "/users",
    icon: Users,
    permissions: [Permission.USER_ADD, Permission.USER_EDIT, Permission.USER_DEL],
  },
  { name: "Settings", href: "/settings", icon: Settings },
]

interface AppSidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, signOut, hasPermission, isAdmin } = useAuth()

  // Filter navigation items based on permissions
  const visibleNavigation = navigation.filter((item) => {
    // Admin can see everything
    if (isAdmin) return true

    // Check admin-only items
    if (item.adminOnly) return false

    // Check permission-restricted items
    if (item.permissions && item.permissions.length > 0) {
      return item.permissions.some((p) => hasPermission(p))
    }

    // No restrictions - show to everyone
    return true
  })

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-300",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          {!collapsed && (
            <Link to="/" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <Mail className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">Email Intelligence</span>
                <span className="text-xs text-muted-foreground">Customer Insights</span>
              </div>
            </Link>
          )}
          {collapsed && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary mx-auto">
              <Mail className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="flex flex-col gap-1">
            {visibleNavigation.map((item) => {
              const isActive = pathname === item.href
              const NavItem = (
                <Link
                  key={item.name}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    collapsed && "justify-center px-2",
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.name}</span>}
                </Link>
              )

              if (collapsed) {
                return (
                  <Tooltip key={item.name}>
                    <TooltipTrigger asChild>{NavItem}</TooltipTrigger>
                    <TooltipContent side="right" className="font-medium">
                      {item.name}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return NavItem
            })}
          </nav>
        </ScrollArea>

        <div className={cn("border-t border-border space-y-2", collapsed ? "p-2" : "p-3")}>
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full h-auto",
                    collapsed ? "p-1.5 justify-center" : "py-2 px-2 justify-start"
                  )}
                >
                  <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
                    <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                      {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || "U"}
                    </div>
                    {!collapsed && (
                      <>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                          {user.name && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
                        </div>
                        <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      </>
                    )}
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Preferences
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn("w-full", collapsed ? "px-2" : "justify-start")}
              >
                {collapsed ? (
                  <PanelLeft className="h-5 w-5" />
                ) : (
                  <>
                    <PanelLeftClose className="mr-2 h-5 w-5" />
                    Collapse
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Expand sidebar</TooltipContent>}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}

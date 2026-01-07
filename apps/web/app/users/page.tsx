"use client"

import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Search, Plus, Upload } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { ViewToggle } from "@/components/view-toggle"
import { UserCard } from "@/components/users/user-card"
import { UserTable } from "@/components/users/user-table"
import { UserDrawer } from "@/components/user-drawer"
import { AddUserDrawer } from "@/components/add-user-drawer"
import { type UserFormData } from "@/components/users/user-form"
import { ImportDialog } from "@/components/import-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExportButton } from "@/components/ui/export-button"
import { createXlsxBlob } from "@/lib/utils/export"
import { UserTableSkeleton } from "@/components/ui/table-skeleton"
import { useUsers, useCreateUser, useImportUsers, useUpdateUser, useSetUserCustomerAssignments } from "@/lib/hooks"
import { type User, mapUserToUser } from "@/lib/types"
import { SearchOperator } from "@crm/shared"
import { toast } from "sonner"
import { PermissionGate, usePermission, Permission } from "@/src/components/PermissionGate"

// Debounce hook for search
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value)

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export default function UsersPage() {
  const { userId } = useParams<{ userId?: string }>()
  const navigate = useNavigate()

  const [view, setView] = React.useState<"grid" | "table">("table")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [addDrawerOpen, setAddDrawerOpen] = React.useState(false)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(searchQuery, 300)

  // Fetch users using React Query
  const { data, isLoading, isError, error } = useUsers({
    queries: debouncedSearch
      ? [{ field: '_search', operator: SearchOperator.ILIKE, value: debouncedSearch }]
      : [],
    sortOrder: 'asc',
    limit: 100,
    offset: 0,
    include: ['customerAssignments'],
  })

  // Mutations
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const setCustomerAssignments = useSetUserCustomerAssignments()
  const importUsers = useImportUsers()

  // Map API response to User type
  const users: User[] = React.useMemo(() => {
    if (!data?.items) return []
    return data.items.map(mapUserToUser)
  }, [data?.items])

  // Derive drawer state from URL
  const drawerOpen = Boolean(userId)
  const selectedUser = React.useMemo(() => {
    if (!userId || !users.length) return null
    return users.find((u) => u.id === userId) ?? null
  }, [userId, users])

  // Client-side filtering for immediate feedback while debounced search loads
  const filteredUsers = React.useMemo(() => {
    if (!searchQuery || searchQuery === debouncedSearch) {
      return users
    }
    // Do client-side filtering while waiting for API
    const query = searchQuery.toLowerCase()
    return users.filter((user) =>
      user.name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      (user.role?.toLowerCase().includes(query) ?? false) ||
      (user.department?.toLowerCase().includes(query) ?? false)
    )
  }, [users, searchQuery, debouncedSearch])

  const handleSelectUser = (user: User) => {
    navigate(`/users/${user.id}`)
  }

  const handleCloseDrawer = () => {
    navigate('/users')
  }

  const handleAddUser = async (data: UserFormData) => {
    try {
      // Extract customer assignments with roles
      const customerAssignments = (data.customerAssignments || [])
        .filter(a => a.customerId)
        .map(a => ({
          customerId: a.customerId!,
          roleId: a.roleId || undefined,
        }))

      await createUser.mutateAsync({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        roleId: data.roleId ?? undefined,
        managerEmails: data.reportsTo || [],
        customerAssignments,
      })
      toast.success("User created successfully")
      setAddDrawerOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user")
    }
  }

  const handleEditUser = async (id: string, data: UserFormData) => {
    try {
      // Update basic user info including roleId and canLogin
      await updateUser.mutateAsync({
        id,
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          roleId: data.roleId ?? undefined,
          canLogin: data.canLogin,
        },
      })

      // Update customer assignments
      const customerAssignments = (data.customerAssignments || [])
        .filter(a => a.customerId)
        .map(a => ({
          customerId: a.customerId!,
          roleId: a.roleId || undefined,
        }))

      await setCustomerAssignments.mutateAsync({
        userId: id,
        assignments: customerAssignments,
      })

      toast.success("User updated successfully")
      handleCloseDrawer()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user")
    }
  }

  const handleImport = async (records: Record<string, string>[]) => {
    // Convert records to a file-like object for the API
    // For now, we'll log and show a message
    console.log("Import records:", records)
    toast.info("Import functionality coming soon")
    setImportDialogOpen(false)
  }

  const handleExport = React.useCallback(async () => {
    const exportData = filteredUsers.map(user => ({
      name: user.name,
      email: user.email,
      role: user.role || "",
      department: user.department || "",
      status: user.status,
    }))

    return createXlsxBlob(exportData, {
      columns: [
        { key: "name", header: "Name", width: 25 },
        { key: "email", header: "Email", width: 35 },
        { key: "role", header: "Role", width: 20 },
        { key: "department", header: "Department", width: 20 },
        { key: "status", header: "Status", width: 15 },
      ],
      sheetName: "Users",
    })
  }, [filteredUsers])

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users</h1>
            <p className="text-muted-foreground">Manage user access and reporting structure</p>
          </div>
          <div className="flex items-center gap-2">
            <PermissionGate permission={Permission.USER_ADD}>
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </PermissionGate>
            <ExportButton
              onExport={handleExport}
              filename="users.xlsx"
              disabled={filteredUsers.length === 0}
            />
            <PermissionGate permission={Permission.USER_ADD}>
              <Button onClick={() => setAddDrawerOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            </PermissionGate>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, role, or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <ViewToggle view={view} onViewChange={setView} />
        </div>

        {/* Loading state */}
        {isLoading && (
          <UserTableSkeleton rows={8} />
        )}

        {/* Error state */}
        {isError && (
          <div className="text-center py-12">
            <p className="text-destructive">
              Failed to load users: {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        )}

        {/* Data loaded */}
        {!isLoading && !isError && (
          <>
            {view === "grid" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredUsers.map((user) => (
                  <UserCard key={user.id} user={user} onClick={() => handleSelectUser(user)} />
                ))}
              </div>
            ) : (
              <UserTable users={filteredUsers} onSelect={handleSelectUser} />
            )}

            {filteredUsers.length === 0 && (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No users found matching your search.</p>
              </div>
            )}
          </>
        )}

        <UserDrawer
          user={selectedUser}
          open={drawerOpen}
          onClose={handleCloseDrawer}
          onSave={handleEditUser}
        />

        <AddUserDrawer
          open={addDrawerOpen}
          onClose={() => setAddDrawerOpen(false)}
          onSave={handleAddUser}
          isLoading={createUser.isPending}
        />

        <ImportDialog
          open={importDialogOpen}
          onClose={() => setImportDialogOpen(false)}
          onImport={handleImport}
          entityType="users"
        />
      </div>
    </AppShell>
  )
}

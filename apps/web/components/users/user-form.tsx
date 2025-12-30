import * as React from "react"
import { X, ChevronsUpDown, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { RoleSelect } from "@/components/ui/role-select"
import { SystemRoleSelect } from "@/components/ui/system-role-select"
import { CustomerAutocomplete } from "@/components/ui/customer-autocomplete"
import { useUsers } from "@/lib/hooks"

/**
 * Customer assignment row with role
 */
export interface CustomerAssignmentRow {
  id: string // Temporary ID for React key
  customerId: string | null
  customerName: string
  customerDomain: string
  roleId: string | null
}

export interface UserFormData {
  firstName: string
  lastName: string
  email: string
  roleId?: string | null // RBAC system role
  role?: string
  department?: string
  canLogin?: boolean // Whether user can login
  reportsTo: string[] // Manager email addresses
  customerAssignments: CustomerAssignmentRow[] // Customer assignments with roles
}

interface UserFormProps {
  initialData?: Partial<UserFormData>
  onSave: (data: UserFormData) => void
  onCancel: () => void
  isLoading?: boolean
  mode: "add" | "edit"
}

// Generate a unique ID for new rows
let rowIdCounter = 0
function generateRowId(): string {
  return `row-${Date.now()}-${++rowIdCounter}`
}

export function UserForm({
  initialData,
  onSave,
  onCancel,
  isLoading,
  mode,
}: UserFormProps) {
  const [firstName, setFirstName] = React.useState(initialData?.firstName || "")
  const [lastName, setLastName] = React.useState(initialData?.lastName || "")
  const [email, setEmail] = React.useState(initialData?.email || "")
  const [roleId, setRoleId] = React.useState<string | null>(initialData?.roleId ?? null)
  const [role, setRole] = React.useState(initialData?.role || "")
  const [department, setDepartment] = React.useState(initialData?.department || "")
  const [canLogin, setCanLogin] = React.useState(initialData?.canLogin ?? true)
  const [managerEmails, setManagerEmails] = React.useState<string[]>(initialData?.reportsTo || [])
  const [customerAssignments, setCustomerAssignments] = React.useState<CustomerAssignmentRow[]>(
    initialData?.customerAssignments || []
  )

  const [managerPopoverOpen, setManagerPopoverOpen] = React.useState(false)

  // Fetch users for manager selection
  const { data: usersData } = useUsers({
    queries: [],
    sortBy: 'firstName',
    sortOrder: 'asc',
    limit: 500,
    offset: 0,
  })

  const managers = React.useMemo(() => {
    return usersData?.items?.map(user => ({
      value: user.email,
      label: `${user.firstName} ${user.lastName} (${user.email})`,
    })) || []
  }, [usersData])

  // Get already selected customer IDs to exclude from dropdown
  const selectedCustomerIds = React.useMemo(() => {
    return new Set(customerAssignments.map(a => a.customerId).filter((id): id is string => id !== null))
  }, [customerAssignments])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Filter out empty rows
    const validAssignments = customerAssignments.filter(a => a.customerId)
    onSave({
      firstName,
      lastName,
      email,
      roleId,
      role: role || undefined,
      department: department || undefined,
      canLogin,
      reportsTo: managerEmails,
      customerAssignments: validAssignments,
    })
  }

  const toggleManager = (email: string) => {
    setManagerEmails(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    )
  }

  const addCustomerAssignment = () => {
    setCustomerAssignments(prev => [
      ...prev,
      {
        id: generateRowId(),
        customerId: null,
        customerName: '',
        customerDomain: '',
        roleId: null,
      }
    ])
  }

  const removeCustomerAssignment = (id: string) => {
    setCustomerAssignments(prev => prev.filter(a => a.id !== id))
  }

  const updateCustomerAssignment = (id: string, updates: Partial<CustomerAssignmentRow>) => {
    setCustomerAssignments(prev =>
      prev.map(a => a.id === id ? { ...a, ...updates } : a)
    )
  }

  // Get excludeIds for a specific row (exclude all selected except current)
  const getExcludeIds = (currentCustomerId: string | null): Set<string> => {
    const excludeSet = new Set<string>()
    customerAssignments.forEach(a => {
      if (a.customerId && a.customerId !== currentCustomerId) {
        excludeSet.add(a.customerId)
      }
    })
    return excludeSet
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-6 py-4 pr-8">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading || mode === "edit"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <SystemRoleSelect
              value={roleId}
              onChange={setRoleId}
              disabled={isLoading}
              placeholder="Select role..."
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="canLogin">Can Login</Label>
              <p className="text-sm text-muted-foreground">
                Allow this user to login to the application
              </p>
            </div>
            <Switch
              id="canLogin"
              checked={canLogin}
              onCheckedChange={setCanLogin}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>Reports To</Label>
            <Popover open={managerPopoverOpen} onOpenChange={setManagerPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  disabled={isLoading}
                >
                  <span className="truncate">
                    {managerEmails.length === 0
                      ? "Select managers..."
                      : `${managerEmails.length} manager${managerEmails.length > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[350px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search managers..." className="h-9" />
                  <CommandList>
                    <CommandEmpty>No managers found.</CommandEmpty>
                    <CommandGroup>
                      {managers.map((manager) => (
                        <CommandItem
                          key={manager.value}
                          value={manager.label}
                          onSelect={() => toggleManager(manager.value)}
                        >
                          <div className="flex items-center gap-2 flex-1">
                            <div
                              className={`h-4 w-4 rounded border-2 flex items-center justify-center ${
                                managerEmails.includes(manager.value)
                                  ? "bg-primary border-primary"
                                  : "border-input"
                              }`}
                            >
                              {managerEmails.includes(manager.value) && (
                                <X className="h-3 w-3 text-primary-foreground" />
                              )}
                            </div>
                            <span className="flex-1">{manager.label}</span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {managerEmails.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {managerEmails.map((email) => {
                  const manager = managers.find(m => m.value === email)
                  return (
                    <div
                      key={email}
                      className="flex items-center gap-1 px-2 py-1 bg-muted rounded-md text-sm"
                    >
                      <span>{manager?.label.split(' (')[0] || email}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4"
                        onClick={() => toggleManager(email)}
                        disabled={isLoading}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Assigned Customers</Label>

            {/* Customer assignment rows */}
            <div className="space-y-2">
              {customerAssignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center gap-2">
                  {/* Customer selector */}
                  <CustomerAutocomplete
                    value={assignment.customerId}
                    onChange={(customerId, customerName, customerDomain) => {
                      updateCustomerAssignment(assignment.id, {
                        customerId,
                        customerName: customerName || '',
                        customerDomain: customerDomain || '',
                      })
                    }}
                    excludeIds={getExcludeIds(assignment.customerId)}
                    disabled={isLoading}
                    className="flex-1"
                  />

                  {/* Role selector */}
                  <RoleSelect
                    value={assignment.roleId}
                    onChange={(roleId) => updateCustomerAssignment(assignment.id, { roleId })}
                    disabled={isLoading}
                    className="w-48"
                  />

                  {/* Remove button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeCustomerAssignment(assignment.id)}
                    disabled={isLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add customer button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCustomerAssignment}
              disabled={isLoading}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Customer
            </Button>
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-border p-6 flex items-center justify-end gap-2 shrink-0">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : mode === "add" ? "Add User" : "Save Changes"}
        </Button>
      </div>
    </form>
  )
}

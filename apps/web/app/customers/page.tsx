"use client"

import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Search, Plus, Upload } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { ViewToggle } from "@/components/view-toggle"
import { CustomerCard } from "@/components/customers/customer-card"
import { CustomerTable } from "@/components/customers/customer-table"
import { CustomerDrawer } from "@/components/customer-drawer"
import { AddCustomerDrawer, type CustomerFormData } from "@/components/add-customer-drawer"
import { ImportDialog } from "@/components/import-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExportButton } from "@/components/ui/export-button"
import { createXlsxBlob } from "@/lib/utils/export"
import { CustomerTableSkeleton } from "@/components/ui/table-skeleton"
import { useCustomers, useCustomer, useUpsertCustomer } from "@/lib/hooks"
import { type Customer, mapApiCustomerToCustomer } from "@/lib/types"
import { SearchOperator } from "@crm/shared"
import { toast } from "sonner"
import { PermissionGate, Permission } from "@/src/components/PermissionGate"

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

export default function CustomersPage() {
  const { customerId, tab, emailId } = useParams<{ customerId?: string; tab?: string; emailId?: string }>()
  const navigate = useNavigate()

  const [view, setView] = React.useState<"grid" | "table">("table")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [addDrawerOpen, setAddDrawerOpen] = React.useState(false)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(searchQuery, 300)

  // Fetch customers using React Query
  const { data, isLoading, isError, error } = useCustomers({
    queries: debouncedSearch
      ? [{ field: '_search', operator: SearchOperator.ILIKE, value: debouncedSearch }]
      : [],
    sortOrder: 'asc',
    limit: 100,
    offset: 0,
    include: ['emailCount', 'lastContactDate', 'sentiment', 'escalationCount', 'upsellCount', 'churnCount', 'positiveCount'],
  })

  // Fetch single customer when customerId is in URL (for direct link access)
  const { data: singleCustomerData, isLoading: isLoadingCustomer } = useCustomer(customerId || '')

  // Mutations
  const upsertCustomer = useUpsertCustomer()

  // Map API response to Customer type
  const customers: Customer[] = React.useMemo(() => {
    if (!data?.items) return []
    return data.items.map(mapApiCustomerToCustomer)
  }, [data?.items])

  // Derive drawer state from URL
  const drawerOpen = Boolean(customerId)
  const selectedCustomer = React.useMemo(() => {
    if (!customerId) return null
    // First try to find in loaded customers list
    const fromList = customers.find((c) => c.id === customerId)
    if (fromList) return fromList
    // Fall back to directly fetched customer data
    if (singleCustomerData) return mapApiCustomerToCustomer(singleCustomerData)
    return null
  }, [customerId, customers, singleCustomerData])

  // Client-side filtering for immediate feedback
  const filteredCustomers = React.useMemo(() => {
    if (!searchQuery || searchQuery === debouncedSearch) {
      return customers
    }
    const query = searchQuery.toLowerCase()
    return customers.filter((customer) =>
      customer.name.toLowerCase().includes(query) ||
      customer.domains.some((d) => d.toLowerCase().includes(query))
    )
  }, [customers, searchQuery, debouncedSearch])

  const handleSelectCustomer = (customer: Customer) => {
    navigate(`/customers/${customer.id}/emails`)
  }

  const handleCloseDrawer = () => {
    navigate('/customers')
  }

  const handleTabChange = (newTab: string) => {
    if (customerId) {
      navigate(`/customers/${customerId}/${newTab}`)
    }
  }

  const handleEmailSelect = (selectedEmailId: string | null) => {
    if (customerId && selectedEmailId) {
      navigate(`/customers/${customerId}/emails/${selectedEmailId}`, { replace: true })
    } else if (customerId) {
      navigate(`/customers/${customerId}/emails`, { replace: true })
    }
  }

  const handleAddCustomer = async (customerData: CustomerFormData) => {
    try {
      await upsertCustomer.mutateAsync({
        tenantId: customerData.tenantId,
        domains: customerData.domains,
        name: customerData.name,
        website: customerData.website,
        industry: customerData.industry,
      })
      toast.success("Customer created successfully")
      setAddDrawerOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create customer")
    }
  }

  const handleImport = async (records: Record<string, string>[]) => {
    console.log("Import records:", records)
    toast.info("Import functionality coming soon")
    setImportDialogOpen(false)
  }

  const handleExport = React.useCallback(async () => {
    const exportData = filteredCustomers.map(customer => ({
      name: customer.name,
      domains: customer.domains.join("; "),
      industry: customer.industry || "",
      website: customer.website || "",
    }))

    return createXlsxBlob(exportData, {
      columns: [
        { key: "name", header: "Name", width: 30 },
        { key: "domains", header: "Domains", width: 40 },
        { key: "industry", header: "Industry", width: 20 },
        { key: "website", header: "Website", width: 40 },
      ],
      sheetName: "Customers",
    })
  }, [filteredCustomers])

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
            <p className="text-muted-foreground">Manage and monitor all customer accounts</p>
          </div>
          <div className="flex items-center gap-2">
            <PermissionGate permission={Permission.CUSTOMER_ADD}>
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </PermissionGate>
            <ExportButton
              onExport={handleExport}
              filename="customers.xlsx"
              disabled={filteredCustomers.length === 0}
            />
            <PermissionGate permission={Permission.CUSTOMER_ADD}>
              <Button onClick={() => setAddDrawerOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Customer
              </Button>
            </PermissionGate>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by company, domain, contact, or labels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <ViewToggle view={view} onViewChange={setView} />
        </div>

        {/* Loading state */}
        {isLoading && (
          <CustomerTableSkeleton rows={8} />
        )}

        {/* Error state */}
        {isError && (
          <div className="text-center py-12">
            <p className="text-destructive">
              Failed to load customers: {error instanceof Error ? error.message : "Unknown error"}
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
              <div className="grid gap-4 md:grid-cols-2">
                {filteredCustomers.map((customer) => (
                  <CustomerCard key={customer.id} customer={customer} onClick={() => handleSelectCustomer(customer)} />
                ))}
              </div>
            ) : (
              <CustomerTable customers={filteredCustomers} onSelect={handleSelectCustomer} />
            )}

            {filteredCustomers.length === 0 && (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No customers found matching your search.</p>
              </div>
            )}
          </>
        )}

        <CustomerDrawer
          customer={selectedCustomer}
          open={drawerOpen}
          onClose={handleCloseDrawer}
          activeTab={tab === 'contacts' ? 'contacts' : tab === 'team' ? 'team' : 'emails'}
          onTabChange={handleTabChange}
          isLoading={Boolean(customerId) && !selectedCustomer && isLoadingCustomer}
          selectedEmailId={emailId}
          onEmailSelect={handleEmailSelect}
        />

        <AddCustomerDrawer
          open={addDrawerOpen}
          onClose={() => setAddDrawerOpen(false)}
          onSave={handleAddCustomer}
          isLoading={upsertCustomer.isPending}
        />

        <ImportDialog
          open={importDialogOpen}
          onClose={() => setImportDialogOpen(false)}
          onImport={handleImport}
          entityType="customers"
        />
      </div>
    </AppShell>
  )
}

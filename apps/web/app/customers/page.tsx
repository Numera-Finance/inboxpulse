"use client"

import * as React from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { subDays, startOfDay, endOfDay } from "date-fns"
import { Search, Plus, Upload } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { ViewToggle } from "@/components/view-toggle"
import { CustomerCard } from "@/components/customers/customer-card"
import { CustomerTable } from "@/components/customers/customer-table"
import { CustomerDrawer } from "@/components/customer-drawer"
import { AddCustomerDrawer, type CustomerFormData } from "@/components/add-customer-drawer"
import { ImportDialog } from "@/components/import-dialog"
import { ImportResultsDialog, type ImportResults } from "@/components/import-results-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExportButton } from "@/components/ui/export-button"
import { DateRangeFilter } from "@/components/ui/date-range-filter"
import { CustomerTableSkeleton } from "@/components/ui/table-skeleton"
import { useCustomers, useCustomer, useUpsertCustomer, useImportCustomers, useExportCustomers } from "@/lib/hooks"
import { type Customer, mapApiCustomerToCustomer } from "@/lib/types"
import { SearchOperator } from "@crm/shared"
import type { SignalFilterType } from "@crm/clients"
import { toast } from "sonner"
import { PermissionGate, Permission } from "@/src/components/PermissionGate"

// Map table column accessorKeys to API sortBy field names
const COLUMN_TO_SORT_FIELD: Record<string, string> = {
  name: 'name',
  totalEmails: 'emailCount',
  escalations: 'negativeCount',
  upsellCount: 'upsellCount',
  churnCount: 'churnCount',
  positiveCount: 'positiveCount',
  lastContact: 'lastContactDate',
}

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
  const [searchParams, setSearchParams] = useSearchParams()
  const signalFromUrl = searchParams.get("signal") as SignalFilterType | null

  const [view, setView] = React.useState<"grid" | "table">("table")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [addDrawerOpen, setAddDrawerOpen] = React.useState(false)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [importResults, setImportResults] = React.useState<ImportResults | null>(null)
  const [importResultsOpen, setImportResultsOpen] = React.useState(false)

  // Pagination and sorting state
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 50 })
  const [sorting, setSorting] = React.useState<Array<{ id: string; desc: boolean }>>([])
  const sortBy = sorting.length > 0 ? (COLUMN_TO_SORT_FIELD[sorting[0].id] || 'name') : 'name'
  const sortOrder = sorting.length > 0 ? (sorting[0].desc ? 'desc' : 'asc') : 'asc'

  // Date filter state (default to Last 30 days)
  const [dateFrom, setDateFrom] = React.useState(() => startOfDay(subDays(new Date(), 30)).toISOString())
  const [dateTo, setDateTo] = React.useState(() => endOfDay(new Date()).toISOString())

  const handleDateRangeChange = React.useCallback((newDateFrom: string, newDateTo: string) => {
    setDateFrom(newDateFrom)
    setDateTo(newDateTo)
    setPagination(prev => ({ ...prev, pageIndex: 0 }))
  }, [])

  // Debounce search to avoid too many API calls
  const debouncedSearch = useDebounce(searchQuery, 300)

  // Reset pagination when search or sorting changes
  React.useEffect(() => {
    setPagination(prev => ({ ...prev, pageIndex: 0 }))
  }, [debouncedSearch, sorting])

  // Fetch customers using React Query with server-side pagination
  const { data, isLoading, isError, error } = useCustomers({
    queries: debouncedSearch
      ? [{ field: '_search', operator: SearchOperator.ILIKE, value: debouncedSearch }]
      : [],
    sortBy,
    sortOrder,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    include: ['emailCount', 'lastContactDate', 'sentiment', 'escalationCount', 'upsellCount', 'churnCount', 'positiveCount', 'averageTat'],
    dateFrom,
    dateTo,
  })

  // Fetch single customer when customerId is in URL (for direct link access)
  const { data: singleCustomerData, isLoading: isLoadingCustomer } = useCustomer(customerId || '')

  // Mutations
  const upsertCustomer = useUpsertCustomer()
  const importCustomers = useImportCustomers()
  const exportCustomers = useExportCustomers()

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

  // Total count from server for pagination
  const totalCount = data?.total ?? 0

  const handleSelectCustomer = (customer: Customer) => {
    navigate(`/customers/${customer.id}/emails`)
  }

  const handleCloseDrawer = () => {
    navigate('/customers', { replace: true })
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

  const handleSignalClick = (customer: Customer, signal: string) => {
    navigate(`/customers/${customer.id}/emails?signal=${signal}`)
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

  const handleImportFile = async (file: File) => {
    try {
      const result = await importCustomers.mutateAsync(file)

      setImportDialogOpen(false)

      // If there are errors or warnings, show the results dialog
      if (result.errors.length > 0 || result.warnings.length > 0) {
        setImportResults(result)
        setImportResultsOpen(true)
      } else {
        // Only show success toast if no issues
        const messages: string[] = []
        if (result.imported > 0) {
          messages.push(`${result.imported} customer(s) created`)
        }
        if (result.updated > 0) {
          messages.push(`${result.updated} customer(s) updated`)
        }
        if (messages.length > 0) {
          toast.success(messages.join(", "))
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import customers")
    }
  }

  const handleExport = React.useCallback(async () => {
    try {
      const blob = await exportCustomers.mutateAsync()
      return blob
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export customers")
      throw err
    }
  }, [exportCustomers])

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Customers
              {data?.total !== undefined && (
                <span className="ml-2 text-base font-normal text-muted-foreground">({data.total})</span>
              )}
            </h1>
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
              disabled={customers.length === 0}
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
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by company, domain, contact, or labels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <DateRangeFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={handleDateRangeChange}
            />
          </div>
          <ViewToggle view={view} onViewChange={setView} />
        </div>

        {/* Loading state */}
        {isLoading && (
          <CustomerTableSkeleton rows={15} />
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
                {customers.map((customer) => (
                  <CustomerCard key={customer.id} customer={customer} onClick={() => handleSelectCustomer(customer)} />
                ))}
              </div>
            ) : (
              <CustomerTable
                customers={customers}
                onSelect={handleSelectCustomer}
                onSignalClick={handleSignalClick}
                pagination={pagination}
                onPaginationChange={setPagination}
                sorting={sorting}
                onSortingChange={setSorting}
                totalCount={totalCount}
              />
            )}

            {customers.length === 0 && (
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
          onMerged={(targetId) => {
            navigate(`/customers/${targetId}/emails`)
          }}
          activeTab={tab === 'contacts' ? 'contacts' : tab === 'team' ? 'team' : 'emails'}
          onTabChange={handleTabChange}
          isLoading={Boolean(customerId) && !selectedCustomer && isLoadingCustomer}
          selectedEmailId={emailId}
          onEmailSelect={handleEmailSelect}
          initialSignalFilter={signalFromUrl}
          dateFrom={dateFrom}
          dateTo={dateTo}
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
          onImportFile={handleImportFile}
          entityType="customers"
          isLoading={importCustomers.isPending}
        />

        <ImportResultsDialog
          open={importResultsOpen}
          onClose={() => setImportResultsOpen(false)}
          results={importResults}
          entityType="customers"
        />
      </div>
    </AppShell>
  )
}

"use client"

import * as React from "react"
import { VirtualizedCombobox, type ComboboxItem } from "./virtualized-combobox"
import { useCustomers } from "@/lib/hooks"

interface CustomerAutocompleteProps {
  value: string | null
  onChange: (customerId: string | null, customerName?: string, customerDomain?: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  excludeIds?: Set<string> | string[]
}

export function CustomerAutocomplete({
  value,
  onChange,
  placeholder = "Select customer...",
  searchPlaceholder = "Search customers...",
  emptyText = "No customers found.",
  disabled = false,
  className,
  excludeIds,
}: CustomerAutocompleteProps) {
  // Fetch all customers
  const { data: customersData, isLoading, error } = useCustomers({
    queries: [],
    sortBy: 'name',
    sortOrder: 'asc',
    limit: 2000,
    offset: 0,
  })

  // Convert excludeIds to Set for efficient lookup
  const excludeSet = React.useMemo(() => {
    if (!excludeIds) return new Set<string>()
    return excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
  }, [excludeIds])

  // Transform customers to ComboboxItem format
  const items = React.useMemo((): ComboboxItem[] => {
    // Ensure we have valid data before processing
    if (!customersData || !Array.isArray(customersData.items) || customersData.items.length === 0) {
      return []
    }

    const customerItems = customersData.items
      .filter(customer => customer && customer.id) // Filter out invalid customers
      .map(customer => {
        const name = customer.name || customer.domains?.[0] || 'Unknown'
        const domain = customer.domains?.[0] || ''
        return {
          value: customer.id,
          label: `${name} (${domain})`,
          searchText: `${name} ${domain}`,
          // Store extra data for the onChange callback
          _name: name,
          _domain: domain,
        }
      })

    // Filter out excluded IDs (but keep the currently selected one)
    const filtered = customerItems.filter(item =>
      !excludeSet.has(item.value) || item.value === value
    )

    // Sort by label (case-insensitive)
    return filtered.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    )
  }, [customersData, excludeSet, value])

  // Keep a map for quick lookup of customer details
  const customerMap = React.useMemo(() => {
    const map = new Map<string, { name: string; domain: string }>()
    customersData?.items?.forEach(customer => {
      map.set(customer.id, {
        name: customer.name || customer.domains[0] || 'Unknown',
        domain: customer.domains[0] || '',
      })
    })
    return map
  }, [customersData])

  const handleChange = (customerId: string | null) => {
    if (customerId) {
      const customer = customerMap.get(customerId)
      onChange(customerId, customer?.name, customer?.domain)
    } else {
      onChange(null)
    }
  }

  // Show error state if query failed
  const displayEmptyText = error 
    ? "Failed to load customers. Please try again."
    : emptyText

  return (
    <VirtualizedCombobox
      items={items}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={displayEmptyText}
      disabled={disabled || !!error}
      className={className}
      isLoading={isLoading}
    />
  )
}

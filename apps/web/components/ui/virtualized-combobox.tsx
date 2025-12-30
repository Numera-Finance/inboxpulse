"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandEmpty } from "@/components/ui/command"

export interface ComboboxItem {
  value: string
  label: string
  searchText?: string // Optional additional text to search against
}

interface VirtualizedComboboxProps {
  items: ComboboxItem[]
  value: string | null
  onChange: (value: string | null, item: ComboboxItem | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  isLoading?: boolean
}

export function VirtualizedCombobox({
  items,
  value,
  onChange,
  placeholder = "Select item...",
  searchPlaceholder = "Search...",
  emptyText = "No items found.",
  disabled = false,
  className,
  isLoading = false,
}: VirtualizedComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const parentRef = React.useRef<HTMLDivElement>(null)

  // Filter items based on search
  const filteredItems = React.useMemo(() => {
    if (!items || items.length === 0) return []
    if (!search) return items
    const searchLower = search.toLowerCase()
    return items.filter(item => {
      const labelMatch = item.label.toLowerCase().includes(searchLower)
      const searchTextMatch = item.searchText?.toLowerCase().includes(searchLower)
      return labelMatch || searchTextMatch
    })
  }, [items, search])

  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 5,
    // Ensure virtualizer updates when items change
    enabled: filteredItems.length > 0,
  })

  // Force virtualizer to remeasure when items change or popover opens
  React.useEffect(() => {
    if (open && virtualizer && filteredItems.length > 0) {
      // Small delay to ensure DOM is ready
      const timeout = setTimeout(() => {
        virtualizer.measure()
      }, 0)
      return () => clearTimeout(timeout)
    }
  }, [open, filteredItems.length, virtualizer])

  const selectedItem = React.useMemo(() => {
    return items.find((item) => item.value === value)
  }, [items, value])

  // Reset search when closing
  React.useEffect(() => {
    if (!open) {
      setSearch("")
    }
  }, [open])

  // Reset scroll position when opening
  React.useEffect(() => {
    if (open && parentRef.current) {
      parentRef.current.scrollTop = 0
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className={cn("w-full justify-between bg-transparent", className)}
        >
          <span className="truncate">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-muted-foreground">Loading...</span>
              </span>
            ) : (
              selectedItem ? selectedItem.label : placeholder
            )}
          </span>
          {isLoading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            disabled={isLoading}
          />
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <CommandEmpty>{emptyText}</CommandEmpty>
          ) : (
            <div ref={parentRef} className="max-h-[300px] overflow-y-auto">
              <div
                key={filteredItems.length}
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const item = filteredItems[virtualItem.index]
                  if (!item) return null
                  
                  const isSelected = value === item.value

                  return (
                    <div
                      key={`${item.value}-${virtualItem.index}`}
                      data-index={virtualItem.index}
                      className={cn(
                        "absolute left-0 top-0 w-full cursor-pointer select-none flex items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground",
                      )}
                      style={{
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      onClick={() => {
                        const newValue = value === item.value ? null : item.value
                        const newItem = newValue ? item : null
                        onChange(newValue, newItem)
                        setOpen(false)
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{item.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

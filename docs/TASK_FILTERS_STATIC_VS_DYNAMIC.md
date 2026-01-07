# TaskFilters: Static vs Dynamic Filter Components

## Question

Are filter components added **statically** (always visible) or **dynamically** (user adds as needed)?

---

## Two Approaches

### Approach 1: Static Filters (Always Visible)

**How it works:**
- All filter controls are always rendered and visible
- User can set/unset each filter independently
- Filters remain visible even when not active

**Example:**
```
┌────────────────────────────────────────────────────────┐
│ [Status: All ▼] [Assigned To: All ▼] [Customer: All ▼] │
│ [📅 Pick a date range]                                 │
└────────────────────────────────────────────────────────┘
```

**Pros:**
- ✅ Users see all available filters immediately
- ✅ Faster to apply filters (no need to open dropdown)
- ✅ Better for power users who know what filters exist
- ✅ Clearer UX - no hidden functionality

**Cons:**
- ❌ Takes more horizontal space
- ❌ Can be overwhelming with many filters
- ❌ Less flexible for adding custom filters

---

### Approach 2: Dynamic Filters (Add as Needed)

**How it works:**
- Starts with a "Filter" button/dropdown
- User clicks to see available filters
- User selects a filter to add it
- Active filters show as removable badges
- Filters already active are hidden from dropdown

**Example:**
```
┌────────────────────────────────────────────────────────┐
│ [+ Filter ▼] [Status: Open ✕] [Customer: Acme ✕]     │
└────────────────────────────────────────────────────────┘
```

**Current Implementation (FilterBar):**
```typescript
// User clicks "+ Filter" button
// Sees dropdown:
//   - Status (if not already active)
//   - Assignment (if not already active)
//   - Customer (if not already active)
//   - Date (if not already active)

// After selecting, filter appears as badge
```

**Pros:**
- ✅ Saves space - only shows active filters
- ✅ Cleaner UI when no filters applied
- ✅ Better for mobile/responsive design
- ✅ More scalable (can have many filter types)
- ✅ Less overwhelming for new users

**Cons:**
- ❌ Extra click to discover available filters
- ❌ Less discoverable
- ❌ Slower for power users

---

## Recommendation: Hybrid Approach

**Best of both worlds:**

1. **Common filters** → Always visible (static)
2. **Advanced filters** → Add via dropdown (dynamic)
3. **Active filters** → Show as badges with remove button

### Implementation

```typescript
interface TaskFiltersProps {
  // Always-visible filters
  alwaysVisible?: string[]  // ['status', 'assignee']
  
  // Available filters (for dropdown)
  availableFilters?: FilterConfig[]
  
  // Current filter state
  filters: TaskFilter
  onFiltersChange: (filters: TaskFilter) => void
}

// Usage:
<TaskFilters
  alwaysVisible={['status', 'assignee']}  // Always show these
  availableFilters={[
    { id: 'customer', label: 'Customer', ... },
    { id: 'date', label: 'Date Range', ... },
    { id: 'priority', label: 'Priority', ... },  // Future
  ]}
  filters={filters}
  onFiltersChange={setFilters}
/>
```

### Visual Layout

```
┌────────────────────────────────────────────────────────────┐
│ [Status: Open ▼] [Assigned To: Me ▼] [+ Filter ▼]         │
│                                                             │
│ Active Filters:                                             │
│ [Customer: Acme Corp ✕] [Date: Dec 1-15 ✕] [Clear All]    │
└────────────────────────────────────────────────────────────┘
```

**Or more compact:**

```
┌────────────────────────────────────────────────────────────┐
│ [Status: Open ▼] [Assigned To: Me ▼] [+ Filter ▼]          │
│ [Customer: Acme ✕] [Date: Dec 1-15 ✕]                        │
└────────────────────────────────────────────────────────────┘
```

---

## Detailed Hybrid Implementation

### Component Structure

```typescript
export function TaskFilters({
  alwaysVisible = ['status', 'assignee'],  // Default always-visible
  availableFilters = [],                   // Additional filters
  filters,
  onFiltersChange,
  availableAssignees = [],
  availableCustomers = [],
}: TaskFiltersProps) {
  
  // Separate filters into always-visible and addable
  const alwaysVisibleConfigs = defaultConfigs.filter(c => 
    alwaysVisible.includes(c.id)
  )
  
  const addableConfigs = [
    ...defaultConfigs.filter(c => !alwaysVisible.includes(c.id)),
    ...availableFilters,
  ].filter(c => !filters[c.id])  // Hide already-active filters
  
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Always-Visible Filters */}
      {alwaysVisibleConfigs.map(config => (
        <FilterControl
          key={config.id}
          config={config}
          value={filters[config.id]}
          onChange={(value) => updateFilter(config.id, value)}
          // ... props for specific filter types
        />
      ))}
      
      {/* Add Filter Dropdown */}
      {addableConfigs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Filter
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {addableConfigs.map(config => (
              <DropdownMenuItem
                key={config.id}
                onSelect={() => {
                  // Show filter control (could be inline or in popover)
                  addFilter(config.id)
                }}
              >
                {config.icon}
                {config.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      
      {/* Active Filters as Badges */}
      {Object.entries(filters)
        .filter(([key]) => !alwaysVisible.includes(key))
        .map(([key, value]) => (
          <FilterBadge
            key={key}
            config={allConfigs.find(c => c.id === key)}
            value={value}
            onRemove={() => clearFilter(key)}
          />
        ))}
    </div>
  )
}
```

---

## Comparison Table

| Aspect | Static | Dynamic | Hybrid |
|--------|--------|---------|--------|
| **Space Usage** | High | Low | Medium |
| **Discoverability** | High | Low | High |
| **Speed (Power Users)** | Fast | Slow | Fast |
| **Scalability** | Low | High | High |
| **Mobile Friendly** | No | Yes | Yes |
| **Complexity** | Low | Medium | Medium |

---

## Recommended Approach: Hybrid

### Rationale

1. **Common filters** (Status, Assignee) are used frequently → Always visible
2. **Advanced filters** (Customer, Date, Priority) used less → Add on demand
3. **Active filters** show as badges → Clear visual feedback
4. **Extensible** → Easy to add new filters without cluttering UI

### Configuration

```typescript
// In EscalationsPage
const filterConfig = {
  // Always show these (most common)
  alwaysVisible: ['status', 'assignee'],
  
  // Available to add (less common)
  availableFilters: [
    {
      id: 'customer',
      label: 'Customer',
      type: 'customer',
      icon: <Building2 />,
    },
    {
      id: 'date',
      label: 'Date Range',
      type: 'date-range',
      icon: <Calendar />,
    },
    // Future filters can be added here
    {
      id: 'priority',
      label: 'Priority',
      type: 'priority',
      icon: <AlertCircle />,
    },
  ],
}
```

### User Flow

**Scenario 1: Quick Filter (Status)**
1. User sees "Status" dropdown immediately
2. Clicks → Selects "Open"
3. Done ✅

**Scenario 2: Advanced Filter (Date Range)**
1. User clicks "+ Filter" button
2. Sees dropdown: "Customer", "Date Range", "Priority"
3. Clicks "Date Range"
4. Date picker appears (popover or inline)
5. Selects date range
6. Filter appears as badge
7. Can remove via ✕ button

**Scenario 3: Multiple Filters**
```
Initial: [Status: All ▼] [Assigned To: All ▼] [+ Filter ▼]

After adding Customer:
[Status: Open ▼] [Assigned To: Me ▼] [+ Filter ▼]
[Customer: Acme Corp ✕]

After adding Date:
[Status: Open ▼] [Assigned To: Me ▼] [+ Filter ▼]
[Customer: Acme Corp ✕] [Date: Dec 1-15 ✕]
```

---

## Implementation Details

### Filter State Management

```typescript
// Filter can be in one of three states:
type FilterState = 
  | 'hidden'      // Not added yet (in dropdown)
  | 'active'      // Added and has a value
  | 'inactive'    // Added but cleared (show control, no value)

// Example:
filters = {
  status: 'open',           // active (always-visible)
  assignedToId: 'me',       // active (always-visible)
  customerId: 'abc-123',    // active (added via dropdown, shows as badge)
  dateFrom: undefined,      // inactive (control visible but empty)
}
```

### Adding a Filter Dynamically

```typescript
const handleAddFilter = (filterId: string) => {
  // Option 1: Show inline control immediately
  setFilters(prev => ({
    ...prev,
    [filterId]: undefined,  // Initialize with empty value
  }))
  
  // Option 2: Show in popover/modal
  setActiveFilterPopover(filterId)
  
  // Option 3: Show as badge with empty value (user clicks to set)
  setFilters(prev => ({
    ...prev,
    [filterId]: null,  // Special "needs value" state
  }))
}
```

### Removing a Filter

```typescript
const handleRemoveFilter = (filterId: string) => {
  const newFilters = { ...filters }
  delete newFilters[filterId]
  onFiltersChange(newFilters)
  
  // Filter becomes available in dropdown again
}
```

---

## Visual Examples

### Example 1: No Filters Applied

```
┌────────────────────────────────────────┐
│ [Status: All ▼] [Assigned To: All ▼]    │
│ [+ Filter ▼]                            │
└────────────────────────────────────────┘
```

### Example 2: Common Filters Applied

```
┌────────────────────────────────────────┐
│ [Status: Open ▼] [Assigned To: Me ▼]    │
│ [+ Filter ▼]                            │
└────────────────────────────────────────┘
```

### Example 3: Advanced Filters Added

```
┌──────────────────────────────────────────────┐
│ [Status: Open ▼] [Assigned To: Me ▼]          │
│ [+ Filter ▼]                                  │
│ [Customer: Acme Corp ✕] [Date: Dec 1-15 ✕]   │
└──────────────────────────────────────────────┘
```

### Example 4: Many Filters Applied

```
┌──────────────────────────────────────────────┐
│ [Status: Open ▼] [Assigned To: Me ▼]          │
│ [+ Filter ▼]                                  │
│ [Customer: Acme ✕] [Date: Dec 1-15 ✕]         │
│ [Priority: High ✕] [Tags: urgent ✕]           │
│ [Clear All]                                   │
└──────────────────────────────────────────────┘
```

---

## Code Example: Complete Hybrid Implementation

```typescript
"use client"

import * as React from "react"
import { Plus, X, ChevronDown, User, Building2, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

export interface TaskFilter {
  status?: 'open' | 'done'
  assignedToId?: string | 'unassigned' | 'me' | 'my-team'
  customerId?: string
  dateFrom?: Date
  dateTo?: Date
  [key: string]: any
}

export interface FilterConfig {
  id: string
  label: string
  icon?: React.ReactNode
  type: 'status' | 'assignee' | 'customer' | 'date-range' | 'priority' | 'custom'
  options?: Array<{ value: string; label: string }>
}

interface TaskFiltersProps {
  filters: TaskFilter
  onFiltersChange: (filters: TaskFilter) => void
  alwaysVisible?: string[]  // Filter IDs to always show
  availableFilters?: FilterConfig[]  // Additional filters to add
  availableAssignees?: Array<{ id: string; name: string }>
  availableCustomers?: Array<{ id: string; name: string }>
}

export function TaskFilters({
  filters,
  onFiltersChange,
  alwaysVisible = ['status', 'assignee'],
  availableFilters = [],
  availableAssignees = [],
  availableCustomers = [],
}: TaskFiltersProps) {
  const [dateRange, setDateRange] = React.useState<{from?: Date; to?: Date}>({
    from: filters.dateFrom,
    to: filters.dateTo,
  })

  const updateFilter = (key: keyof TaskFilter, value: any) => {
    const newFilters = { ...filters }
    if (value === undefined || value === null || value === '') {
      delete newFilters[key]
    } else {
      newFilters[key] = value
    }
    onFiltersChange(newFilters)
  }

  const clearFilter = (key: keyof TaskFilter) => {
    const newFilters = { ...filters }
    delete newFilters[key]
    onFiltersChange(newFilters)
  }

  // Default filter configs
  const defaultConfigs: FilterConfig[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'done', label: 'Done' },
      ],
    },
    {
      id: 'assignee',
      label: 'Assigned To',
      icon: <User className="h-4 w-4" />,
      type: 'assignee',
    },
    {
      id: 'customer',
      label: 'Customer',
      icon: <Building2 className="h-4 w-4" />,
      type: 'customer',
    },
    {
      id: 'date',
      label: 'Date Range',
      icon: <Calendar className="h-4 w-4" />,
      type: 'date-range',
    },
  ]

  const allConfigs = [...defaultConfigs, ...availableFilters]
  
  // Separate into always-visible and addable
  const alwaysVisibleConfigs = allConfigs.filter(c => alwaysVisible.includes(c.id))
  const addableConfigs = allConfigs.filter(c => 
    !alwaysVisible.includes(c.id) && !filters[c.id]  // Not always-visible and not already active
  )

  const activeFilterCount = Object.keys(filters).filter(
    k => filters[k as keyof TaskFilter] !== undefined && !alwaysVisible.includes(k)
  ).length

  return (
    <div className="flex flex-col gap-2">
      {/* Always-Visible Filters Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status Filter (Always Visible) */}
        {alwaysVisibleConfigs.find(c => c.id === 'status') && (
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) => updateFilter('status', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Assignee Filter (Always Visible) */}
        {alwaysVisibleConfigs.find(c => c.id === 'assignee') && (
          <Select
            value={filters.assignedToId || ''}
            onValueChange={(value) => updateFilter('assignedToId', value || undefined)}
          >
            <SelectTrigger className="h-8 w-[160px]">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <SelectValue placeholder="Assigned To" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="me">Me</SelectItem>
              <SelectItem value="my-team">My Team</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {availableAssignees.map(user => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Add Filter Dropdown */}
        {addableConfigs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1">
                <Plus className="h-3 w-3" />
                Filter
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {addableConfigs.map(config => (
                <DropdownMenuItem
                  key={config.id}
                  onSelect={() => {
                    // Initialize filter (user will set value via popover)
                    if (config.type === 'date-range') {
                      // Show date picker immediately
                      // (handled by popover state)
                    } else if (config.type === 'customer') {
                      // Show customer picker immediately
                      // (handled by popover state)
                    } else {
                      // For simple filters, set default value
                      updateFilter(config.id as keyof TaskFilter, undefined)
                    }
                  }}
                >
                  {config.icon}
                  <span className="ml-2">{config.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Clear All Button */}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              // Clear all except always-visible filters
              const cleared: TaskFilter = {}
              alwaysVisible.forEach(key => {
                if (filters[key as keyof TaskFilter] !== undefined) {
                  cleared[key as keyof TaskFilter] = filters[key as keyof TaskFilter]
                }
              })
              onFiltersChange(cleared)
            }}
          >
            Clear ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* Active Filters Row (Badges) */}
      {Object.entries(filters).some(([key]) => !alwaysVisible.includes(key) && filters[key as keyof TaskFilter] !== undefined) && (
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(filters).map(([key, value]) => {
            if (alwaysVisible.includes(key) || value === undefined) return null
            
            const config = allConfigs.find(c => c.id === key)
            if (!config) return null

            let label = String(value)
            if (key === 'assignedToId') {
              if (value === 'me') label = 'Me'
              else if (value === 'my-team') label = 'My Team'
              else if (value === 'unassigned') label = 'Unassigned'
              else label = availableAssignees.find(u => u.id === value)?.name || label
            } else if (key === 'customerId') {
              label = availableCustomers.find(c => c.id === value)?.name || label
            } else if (key === 'dateFrom' || key === 'dateTo') {
              if (filters.dateFrom && filters.dateTo) {
                label = `${format(filters.dateFrom, "MMM dd")} - ${format(filters.dateTo, "MMM dd")}`
              } else if (filters.dateFrom) {
                label = `From ${format(filters.dateFrom, "MMM dd")}`
              } else if (filters.dateTo) {
                label = `Until ${format(filters.dateTo, "MMM dd")}`
              } else {
                return null
              }
            }

            return (
              <Badge
                key={key}
                variant="secondary"
                className="h-8 gap-1 pr-1"
              >
                <span className="text-muted-foreground">{config.label}:</span>
                <span>{label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 hover:bg-transparent ml-1"
                  onClick={() => clearFilter(key as keyof TaskFilter)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

---

## Answer to Your Question

**Filters are added DYNAMICALLY** (user adds as required), with these exceptions:

1. **Common filters** (Status, Assignee) → **Always visible** (static)
2. **Advanced filters** (Customer, Date, Priority) → **Add via dropdown** (dynamic)
3. **Active filters** → **Show as badges** (dynamic, based on what user added)

This **hybrid approach** gives you:
- ✅ Fast access to common filters
- ✅ Clean UI (doesn't clutter with unused filters)
- ✅ Scalability (can add many filter types)
- ✅ Better mobile experience

The user controls which filters are active, but common ones are always accessible.

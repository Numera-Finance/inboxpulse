# TaskFilters Component Design & Implementation Guide

## Overview

The `TaskFilters` component is an **extensible, type-safe filter system** that allows users to filter tasks by multiple criteria. It's designed to be easily extended with new filter types without modifying core logic.

---

## Component Architecture

### 1. Core Component Structure

```typescript
<TaskFilters
  filters={activeFilters}              // Current filter state
  onFiltersChange={setFilters}         // Callback when filters change
  filterConfigs={customFilters}        // Optional: Additional filters
  availableAssignees={users}            // For assignee filter
  availableCustomers={customers}        // For customer filter
/>
```

### 2. Filter State Management

```typescript
interface TaskFilter {
  status?: 'open' | 'done' | 'all'
  assignedToId?: string | 'unassigned' | 'me' | 'my-team'
  customerId?: string
  dateFrom?: Date
  dateTo?: Date
  search?: string  // Handled separately in search input
  priority?: 'low' | 'normal' | 'high' | 'critical'  // Future
}
```

---

## How It Works

### Step 1: Filter Configuration

Each filter type is defined by a `FilterConfig`:

```typescript
interface FilterConfig {
  id: string                    // Unique identifier
  label: string                 // Display label
  icon?: React.ReactNode        // Optional icon
  type: FilterType              // Filter type determines UI
  options?: FilterOption[]      // For select/dropdown filters
  component?: React.ComponentType  // For custom filters
}

type FilterType = 
  | 'status'           // Simple dropdown
  | 'assignee'         // Dropdown with scoped users
  | 'customer'         // Autocomplete dropdown
  | 'date-range'       // Date range picker
  | 'priority'         // Multi-select badges
  | 'custom'           // Custom component
```

### Step 2: Default Filter Configs

The component comes with built-in filters:

```typescript
const defaultConfigs: FilterConfig[] = [
  {
    id: 'status',
    label: 'Status',
    type: 'status',
    options: [
      { value: 'all', label: 'All' },
      { value: 'open', label: 'Open' },
      { value: 'done', label: 'Done' },
    ],
  },
  {
    id: 'assignee',
    label: 'Assigned To',
    icon: <User className="h-4 w-4" />,
    type: 'assignee',
    // Options populated from availableAssignees prop
  },
  {
    id: 'customer',
    label: 'Customer',
    icon: <Building2 className="h-4 w-4" />,
    type: 'customer',
    // Options populated from availableCustomers prop
  },
  {
    id: 'date',
    label: 'Date',
    icon: <Calendar className="h-4 w-4" />,
    type: 'date-range',
  },
]
```

### Step 3: Rendering Logic

The component renders filters based on their type:

```typescript
{allConfigs.map((config) => {
  switch (config.type) {
    case 'status':
      return <StatusFilter config={config} ... />
    
    case 'assignee':
      return <AssigneeFilter 
        config={config}
        availableUsers={availableAssignees}
        ...
      />
    
    case 'customer':
      return <CustomerFilter 
        config={config}
        availableCustomers={availableCustomers}
        ...
      />
    
    case 'date-range':
      return <DateRangeFilter config={config} ... />
    
    case 'custom':
      return <config.component {...props} />
  }
})}
```

---

## Detailed Filter Implementations

### 1. Status Filter

**Type:** `'status'`

**UI:** Simple dropdown select

**Behavior:**
- Shows: "All", "Open", "Done"
- Updates `filters.status`
- "All" clears the filter

**Code:**
```typescript
<Select
  value={filters.status || 'all'}
  onValueChange={(value) => 
    updateFilter('status', value === 'all' ? undefined : value)
  }
>
  <SelectTrigger className="h-8 w-[120px]">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All</SelectItem>
    <SelectItem value="open">Open</SelectItem>
    <SelectItem value="done">Done</SelectItem>
  </SelectContent>
</Select>
```

---

### 2. Assignee Filter (Scoped)

**Type:** `'assignee'`

**UI:** Dropdown with scoped options

**Behavior:**
- Shows: "Me", "My Team", "Unassigned", then individual users
- Only shows users the current user can assign to (self + subordinates)
- Updates `filters.assignedToId`

**Options Structure:**
```typescript
const assigneeOptions = [
  { value: 'me', label: 'Me' },
  { value: 'my-team', label: 'My Team' },
  { value: 'unassigned', label: 'Unassigned' },
  ...availableAssignees.map(u => ({
    value: u.id,
    label: u.name
  }))
]
```

**Code:**
```typescript
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
```

**Backend Handling:**
```typescript
// In TaskRepository.search()
if (options.assignedToId === 'me') {
  conditions.push(eq(tasks.assignedToId, header.userId));
} else if (options.assignedToId === 'my-team') {
  const subordinateIds = await this.getSubordinates(header.userId);
  const teamIds = [header.userId, ...subordinateIds];
  conditions.push(inArray(tasks.assignedToId, teamIds));
} else if (options.assignedToId === 'unassigned') {
  conditions.push(isNull(tasks.assignedToId));
} else if (options.assignedToId) {
  // Individual user - already scoped by taskAccessFilter
  conditions.push(eq(tasks.assignedToId, options.assignedToId));
}
```

---

### 3. Customer Filter

**Type:** `'customer'`

**UI:** Autocomplete dropdown (searchable)

**Behavior:**
- Shows list of customers user has access to
- Searchable/filterable dropdown
- Updates `filters.customerId`

**Code:**
```typescript
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" className="h-8 w-[180px]">
      <Building2 className="h-4 w-4 mr-2" />
      {filters.customerId 
        ? customers.find(c => c.id === filters.customerId)?.name
        : 'All Customers'
      }
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-[300px] p-0">
    <Command>
      <CommandInput placeholder="Search customers..." />
      <CommandList>
        <CommandEmpty>No customers found.</CommandEmpty>
        <CommandGroup>
          <CommandItem
            onSelect={() => updateFilter('customerId', undefined)}
          >
            All Customers
          </CommandItem>
          {availableCustomers.map(customer => (
            <CommandItem
              key={customer.id}
              onSelect={() => updateFilter('customerId', customer.id)}
            >
              {customer.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

---

### 4. Date Range Filter

**Type:** `'date-range'`

**UI:** Calendar popover with range selection

**Behavior:**
- Opens calendar popover
- Allows selecting date range (from/to)
- Updates `filters.dateFrom` and `filters.dateTo`
- Shows selected range in button

**Code:**
```typescript
const [dateRange, setDateRange] = React.useState<{from?: Date; to?: Date}>({
  from: filters.dateFrom,
  to: filters.dateTo,
});

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" className="h-8">
      <Calendar className="h-4 w-4 mr-2" />
      {dateRange.from ? (
        dateRange.to ? (
          <>
            {format(dateRange.from, "LLL dd")} - {format(dateRange.to, "LLL dd")}
          </>
        ) : (
          format(dateRange.from, "LLL dd, y")
        )
      ) : (
        "Pick a date range"
      )}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0" align="start">
    <Calendar
      mode="range"
      selected={{ from: dateRange.from, to: dateRange.to }}
      onSelect={(range) => {
        setDateRange(range || {});
        updateFilter('dateFrom', range?.from);
        updateFilter('dateTo', range?.to);
      }}
      numberOfMonths={2}
    />
  </PopoverContent>
</Popover>
```

---

## Extensibility: Adding New Filters

### Example 1: Add Priority Filter

**Step 1:** Define filter config in parent component:

```typescript
const priorityFilterConfig: FilterConfig = {
  id: 'priority',
  label: 'Priority',
  icon: <AlertCircle className="h-4 w-4" />,
  type: 'priority',
  options: [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'normal', label: 'Normal' },
    { value: 'low', label: 'Low' },
  ],
};
```

**Step 2:** Add to TaskFilters:

```typescript
<TaskFilters
  filters={filters}
  onFiltersChange={setFilters}
  filterConfigs={[priorityFilterConfig]}  // Add custom filter
/>
```

**Step 3:** Component automatically renders it (if type='priority' is supported)

**Step 4:** Update backend to handle priority:

```typescript
// In TaskRepository.search()
if (options.priority) {
  conditions.push(eq(tasks.priority, options.priority));
}
```

---

### Example 2: Add Custom Filter Component

**Step 1:** Create custom filter component:

```typescript
function CustomTagFilter({ 
  value, 
  onChange 
}: { 
  value?: string[];
  onChange: (value: string[]) => void;
}) {
  const availableTags = ['urgent', 'follow-up', 'escalated'];
  
  return (
    <div className="flex gap-2">
      {availableTags.map(tag => (
        <Badge
          key={tag}
          variant={value?.includes(tag) ? 'default' : 'outline'}
          onClick={() => {
            const newValue = value?.includes(tag)
              ? value.filter(t => t !== tag)
              : [...(value || []), tag];
            onChange(newValue);
          }}
        >
          {tag}
        </Badge>
      ))}
    </div>
  );
}
```

**Step 2:** Define config with custom component:

```typescript
const tagFilterConfig: FilterConfig = {
  id: 'tags',
  label: 'Tags',
  type: 'custom',
  component: CustomTagFilter,
};
```

**Step 3:** Component renders custom component:

```typescript
{config.type === 'custom' && config.component && (
  <config.component
    value={filters[config.id]}
    onChange={(value) => updateFilter(config.id, value)}
  />
)}
```

---

## Integration with Backend

### Filter State → API Request

```typescript
// Frontend: Convert filter state to API request
const searchRequest: TaskSearchRequest = {
  status: filters.status === 'all' ? undefined : filters.status,
  assignedToId: filters.assignedToId,
  customerId: filters.customerId,
  dateFrom: filters.dateFrom?.toISOString(),
  dateTo: filters.dateTo?.toISOString(),
  search: searchQuery,  // Separate from filters
  limit: 20,
  offset: 0,
};

// API call
const response = await api.post('/tasks/search', searchRequest);
```

### Backend: Process Filters

```typescript
// In TaskRepository.search()
async search(header: RequestHeader, options: TaskSearchOptions) {
  const conditions = [
    eq(tasks.tenantId, header.tenantId),
    this.taskAccessFilter(header),  // Scoped access
  ];
  
  // Status filter
  if (options.status !== undefined) {
    conditions.push(eq(tasks.status, options.status));
  }
  
  // Assignee filter (with scoped handling)
  if (options.assignedToId) {
    if (options.assignedToId === 'me') {
      conditions.push(eq(tasks.assignedToId, header.userId));
    } else if (options.assignedToId === 'my-team') {
      const subordinateIds = await this.getSubordinates(header.userId);
      conditions.push(inArray(tasks.assignedToId, [header.userId, ...subordinateIds]));
    } else if (options.assignedToId === 'unassigned') {
      conditions.push(isNull(tasks.assignedToId));
    } else {
      conditions.push(eq(tasks.assignedToId, options.assignedToId));
    }
  }
  
  // Customer filter
  if (options.customerId) {
    conditions.push(eq(tasks.customerId, options.customerId));
  }
  
  // Date range filter
  if (options.dateFrom) {
    conditions.push(gte(tasks.createdAt, options.dateFrom));
  }
  if (options.dateTo) {
    conditions.push(lte(tasks.createdAt, options.dateTo));
  }
  
  // Search filter
  if (options.search) {
    const searchCondition = this.buildFreeformSearch(options.search);
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  
  // Execute query with conditions
  // ...
}
```

---

## Complete Component Implementation

```typescript
"use client"

import * as React from "react"
import { Calendar, User, Building2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

export interface TaskFilter {
  status?: 'open' | 'done' | 'all'
  assignedToId?: string | 'unassigned' | 'me' | 'my-team'
  customerId?: string
  dateFrom?: Date
  dateTo?: Date
  [key: string]: any  // For extensibility
}

export interface FilterConfig {
  id: string
  label: string
  icon?: React.ReactNode
  type: 'status' | 'assignee' | 'customer' | 'date-range' | 'priority' | 'custom'
  options?: Array<{ value: string; label: string }>
  component?: React.ComponentType<any>
}

interface TaskFiltersProps {
  filters: TaskFilter
  onFiltersChange: (filters: TaskFilter) => void
  filterConfigs?: FilterConfig[]
  availableAssignees?: Array<{ id: string; name: string }>
  availableCustomers?: Array<{ id: string; name: string }>
}

export function TaskFilters({
  filters,
  onFiltersChange,
  filterConfigs = [],
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

  const activeFilterCount = Object.keys(filters).filter(
    k => filters[k as keyof TaskFilter] !== undefined
  ).length

  // Default filter configs
  const defaultConfigs: FilterConfig[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'status',
      options: [
        { value: 'all', label: 'All' },
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
      label: 'Date',
      icon: <Calendar className="h-4 w-4" />,
      type: 'date-range',
    },
  ]

  const allConfigs = [...defaultConfigs, ...filterConfigs]

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Status Filter */}
      <Select
        value={filters.status || 'all'}
        onValueChange={(value) => updateFilter('status', value === 'all' ? undefined : value)}
      >
        <SelectTrigger className="h-8 w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {defaultConfigs.find(c => c.id === 'status')?.options?.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Assignee Filter */}
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

      {/* Customer Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-8 w-[180px]">
            <Building2 className="h-4 w-4 mr-2" />
            {filters.customerId
              ? availableCustomers.find(c => c.id === filters.customerId)?.name || 'Customer'
              : 'All Customers'
            }
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput placeholder="Search customers..." />
            <CommandList>
              <CommandEmpty>No customers found.</CommandEmpty>
              <CommandGroup>
                <CommandItem onSelect={() => updateFilter('customerId', undefined)}>
                  All Customers
                </CommandItem>
                {availableCustomers.map(customer => (
                  <CommandItem
                    key={customer.id}
                    onSelect={() => updateFilter('customerId', customer.id)}
                  >
                    {customer.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Date Range Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-8 justify-start text-left font-normal",
              !dateRange.from && "text-muted-foreground"
            )}
          >
            <Calendar className="h-4 w-4 mr-2" />
            {dateRange.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "LLL dd")} - {format(dateRange.to, "LLL dd")}
                </>
              ) : (
                format(dateRange.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarComponent
            initialFocus
            mode="range"
            defaultMonth={dateRange.from}
            selected={{ from: dateRange.from, to: dateRange.to }}
            onSelect={(range) => {
              setDateRange(range || {})
              updateFilter('dateFrom', range?.from)
              updateFilter('dateTo', range?.to)
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      {/* Custom Filters */}
      {filterConfigs.map(config => {
        if (config.type === 'custom' && config.component) {
          const Component = config.component
          return (
            <Component
              key={config.id}
              value={filters[config.id]}
              onChange={(value: any) => updateFilter(config.id as keyof TaskFilter, value)}
            />
          )
        }
        return null
      })}

      {/* Active Filter Badges */}
      {Object.entries(filters).map(([key, value]) => {
        if (value === undefined) return null
        
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
          return null  // Handled by date range display
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

      {/* Clear All */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onFiltersChange({})}
        >
          Clear ({activeFilterCount})
        </Button>
      )}
    </div>
  )
}
```

---

## Usage Example

```typescript
function EscalationsPage() {
  const [filters, setFilters] = React.useState<TaskFilter>({})
  const { data: assignableUsers } = useAssignableUsers()
  const { data: customers } = useCustomers()

  // Convert filters to API request
  const searchRequest = React.useMemo(() => ({
    status: filters.status,
    assignedToId: filters.assignedToId,
    customerId: filters.customerId,
    dateFrom: filters.dateFrom?.toISOString(),
    dateTo: filters.dateTo?.toISOString(),
  }), [filters])

  return (
    <div>
      <TaskFilters
        filters={filters}
        onFiltersChange={setFilters}
        availableAssignees={assignableUsers || []}
        availableCustomers={customers || []}
        filterConfigs={[
          // Future: Add priority filter
          {
            id: 'priority',
            label: 'Priority',
            type: 'priority',
            options: [
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
            ],
          },
        ]}
      />
      
      {/* Task list using filters */}
      <TaskList searchRequest={searchRequest} />
    </div>
  )
}
```

---

## Key Benefits

1. **Type-Safe:** TypeScript ensures filter keys match backend
2. **Extensible:** Add new filters via `filterConfigs` prop
3. **Scoped:** Assignee filter automatically scoped to accessible users
4. **Consistent UI:** All filters follow same pattern
5. **URL Sync:** Can sync filter state with URL params for bookmarking
6. **Performance:** Filters are debounced/optimized

---

## Comparison with Current FilterBar

**Current FilterBar:**
- ✅ Extensible via configs
- ✅ Shows active filters as badges
- ❌ Only supports dropdown filters
- ❌ No date range support
- ❌ No customer autocomplete
- ❌ Not type-safe

**Proposed TaskFilters:**
- ✅ All FilterBar features
- ✅ Multiple filter types (date, autocomplete, custom)
- ✅ Type-safe with TypeScript
- ✅ Better UX (icons, better date picker)
- ✅ Scoped assignee filter built-in

---

This design provides a **robust, extensible filtering system** that can grow with future requirements while maintaining consistency and type safety.

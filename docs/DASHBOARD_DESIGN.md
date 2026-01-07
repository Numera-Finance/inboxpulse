# Dashboard Design & API Integration Plan

## Overview
This document outlines the design for connecting the Dashboard to real APIs and making it scalable for future additions.

## Current State
- Dashboard uses mock data from `lib/data.ts`
- Static tiles showing hardcoded statistics
- Basic filter UI (not connected to data)
- Two charts: SentimentChart and TurnaroundChart (using mock data)

## Proposed Architecture

### 1. Dashboard Filters Component
Create a reusable `DashboardFilters` component similar to `TaskFilters`:

**Location**: `apps/web/components/dashboard/dashboard-filters.tsx`

**Features**:
- Customer Autocomplete (scoped to user's accessible customers)
- User Dropdown (scoped to user's team/subordinates)
- Date Range Picker (using existing calendar component)
- Filter state management via URL params (for bookmarking/sharing)

**Props**:
```typescript
interface DashboardFiltersProps {
  filters: DashboardFilter
  onFiltersChange: (filters: DashboardFilter) => void
  className?: string
}

interface DashboardFilter {
  customerId?: string
  userId?: string
  dateFrom?: Date
  dateTo?: Date
}
```

### 2. Dashboard Data Hooks
Create hooks for fetching dashboard metrics:

**Location**: `apps/web/lib/hooks/use-dashboard.ts`

**Hooks**:
- `useDashboardStats(filter: DashboardFilter)` - Fetch all stat card data
- `useDashboardSentiment(filter: DashboardFilter)` - Fetch sentiment distribution
- `useDashboardTurnaround(filter: DashboardFilter)` - Fetch turnaround metrics

**API Endpoints** (to be created in `apps/api/src/analysis/`):
- `GET /api/analysis/dashboard/stats` - Returns aggregated stats
- `GET /api/analysis/dashboard/sentiment` - Returns sentiment distribution
- `GET /api/analysis/dashboard/turnaround` - Returns turnaround metrics

### 3. Scalable Tile System
Create a tile registry system for easy addition of new tiles:

**Location**: `apps/web/components/dashboard/tile-registry.ts`

**Structure**:
```typescript
interface DashboardTile {
  id: string
  component: React.ComponentType<DashboardTileProps>
  gridSpan?: 'sm' | 'md' | 'lg' | 'xl' // Grid column span
  order: number // Display order
}

interface DashboardTileProps {
  filters: DashboardFilter
  isLoading?: boolean
}
```

**Benefits**:
- Easy to add new tiles by registering them
- Consistent loading/error states
- Automatic grid layout management
- Filter-aware tiles

### 4. Stat Card Component Enhancement
Enhance `StatCard` to support:
- Loading state (skeleton)
- Error state
- Real-time data updates
- Optional trend calculation

### 5. API Service Layer
Create analysis service in API:

**Location**: `apps/api/src/analysis/dashboard-service.ts`

**Methods**:
- `getDashboardStats(filter, header)` - Aggregate stats from emails, tasks, customers
- `getSentimentDistribution(filter, header)` - Calculate sentiment breakdown
- `getTurnaroundMetrics(filter, header)` - Calculate turnaround times

**Data Sources**:
- Email analysis data (`email_analyses` table)
- Task data (`tasks` table)
- Customer data (`customers` table)
- User data (`users` table)

## Implementation Plan

### Phase 1: Filters & State Management
1. Create `DashboardFilters` component
2. Add filter state management (URL params)
3. Integrate CustomerAutocomplete and UserAutocomplete
4. Add date range picker

### Phase 2: API Integration
1. Create dashboard API endpoints
2. Create dashboard service layer
3. Create dashboard hooks
4. Update dashboard page to use hooks

### Phase 3: Tile System
1. Create tile registry
2. Refactor existing tiles to use registry
3. Remove "Avg Turnaround Time" and "Premier Accounts" tiles
4. Update grid layout to be dynamic

### Phase 4: Charts Integration
1. Connect SentimentChart to real data
2. Connect TurnaroundChart to real data
3. Add loading/error states

## File Structure

```
apps/web/
├── app/
│   └── page.tsx (Dashboard page)
├── components/
│   └── dashboard/
│       ├── dashboard-filters.tsx (NEW)
│       ├── stat-card.tsx (ENHANCED)
│       ├── sentiment-chart.tsx (ENHANCED)
│       ├── turnaround-chart.tsx (ENHANCED)
│       └── tile-registry.ts (NEW)
└── lib/
    └── hooks/
        └── use-dashboard.ts (NEW)

apps/api/
└── src/
    └── analysis/
        ├── dashboard-service.ts (NEW)
        └── routes.ts (NEW - dashboard endpoints)
```

## Filter Scoping

### Customer Filter
- Use `CustomerAutocomplete` component
- Automatically scoped to user's accessible customers (via existing scoping logic)
- "All Customers" option shows aggregate across all accessible customers

### User Filter
- Use `useAssignableUsers` hook (already scoped)
- Shows user's subordinates and team members
- "All Users" option shows aggregate across all accessible users

### Date Range Filter
- Use existing calendar range picker
- Defaults to last 30 days
- Supports custom date ranges

## Scalability Considerations

1. **Tile Registry Pattern**: New tiles can be added by registering them in the registry
2. **Filter Propagation**: All tiles receive the same filter object, ensuring consistency
3. **Lazy Loading**: Tiles can fetch data independently, allowing for progressive loading
4. **Caching**: Use React Query for automatic caching and refetching
5. **Error Boundaries**: Each tile can have its own error handling

## Performance Optimizations

1. **Parallel Data Fetching**: All dashboard queries run in parallel
2. **Debounced Filters**: Filter changes debounced to avoid excessive API calls
3. **Query Invalidation**: Smart cache invalidation based on data dependencies
4. **Virtual Scrolling**: For large datasets in charts

## Security Considerations

1. **Scoped Access**: All queries respect user's customer/user access scoping
2. **Tenant Isolation**: All queries filtered by tenant_id
3. **Permission Checks**: Verify user has permission to view dashboard data

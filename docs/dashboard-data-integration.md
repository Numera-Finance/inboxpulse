# Dashboard Data Integration - Design Plan

## Overview

Connect the dashboard to real data using a **tile-driven architecture** where each tile independently fetches its own data. Use **react-grid-layout** for a draggable, resizable grid. Add filter controls (customer, user, date range).

---

## Design Principles

1. **Independent tile data fetching** - Each tile makes its own API call
2. **Progressive loading** - Tiles render as their data arrives
3. **Fault isolation** - One tile failing doesn't break others
4. **Draggable/resizable grid** - Users can customize layout
5. **Persistent layout** - Save user preferences to localStorage
6. **URL-synced filters** - Shareable dashboard state
7. **Reuse existing APIs** - Only add new endpoints for missing aggregations
8. **Debounced filters** - 500ms delay to prevent excessive API calls

---

## Success Criteria

### Functional
- [ ] Customer filter works and is scoped correctly
- [ ] User filter works and shows subordinates only
- [ ] Date range filter works with quick presets
- [ ] All tiles show real data from APIs
- [ ] Filters persist in URL (bookmarkable)
- [ ] "Avg Turnaround Time" and "Premier Accounts" tiles removed
- [ ] Layout drag/drop/resize works
- [ ] Layout persists across sessions

### Performance
- [ ] Dashboard loads in < 2 seconds
- [ ] Filter changes update data in < 1 second
- [ ] No degradation with large datasets

---

## Grid Layout: react-grid-layout

### Why react-grid-layout?
- 19k+ GitHub stars, mature and stable
- Drag and drop tiles
- Resizable tiles
- Responsive breakpoints
- Serializable layout (save/restore)
- TypeScript support

### Installation
```bash
pnpm add react-grid-layout
pnpm add -D @types/react-grid-layout
```

### Layout Schema
```typescript
interface TileLayout {
  i: string;      // Tile ID
  x: number;      // Grid column (0-based)
  y: number;      // Grid row (0-based)
  w: number;      // Width in grid units
  h: number;      // Height in grid units
  minW?: number;  // Minimum width
  minH?: number;  // Minimum height
  static?: boolean; // Prevent drag/resize
}

// Default layout
const DEFAULT_LAYOUT: TileLayout[] = [
  { i: 'customers', x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
  { i: 'emails', x: 1, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
  { i: 'escalations', x: 2, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
  { i: 'opportunities', x: 3, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
  { i: 'sentiment', x: 0, y: 1, w: 2, h: 2, minW: 2, minH: 2 },
];
```

### Responsive Breakpoints
```typescript
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 4, md: 3, sm: 2, xs: 1, xxs: 1 };

// Different layouts per breakpoint
const RESPONSIVE_LAYOUTS = {
  lg: DEFAULT_LAYOUT,
  md: [
    { i: 'customers', x: 0, y: 0, w: 1, h: 1 },
    { i: 'emails', x: 1, y: 0, w: 1, h: 1 },
    { i: 'escalations', x: 2, y: 0, w: 1, h: 1 },
    { i: 'opportunities', x: 0, y: 1, w: 1, h: 1 },
    { i: 'sentiment', x: 1, y: 1, w: 2, h: 2 },
  ],
  sm: [/* stacked layout */],
};
```

---

## Current State

### Tiles to Remove
- Avg Turnaround Time
- Premier Accounts

### Tiles to Keep (4 stat cards + 1 chart)
- Total Customers
- Emails Analyzed
- Active Escalations
- Upsell Opportunities
- Sentiment Chart

---

## Architecture

### Component Structure

```
apps/web/
├── app/
│   └── page.tsx                       # Dashboard page
├── components/
│   └── dashboard/
│       ├── dashboard-grid.tsx         # Grid layout wrapper
│       ├── dashboard-filters.tsx      # Filter bar
│       ├── customer-combobox.tsx      # Customer autocomplete
│       ├── user-select.tsx            # User dropdown
│       ├── stat-card.tsx              # Enhanced with loading state
│       └── tiles/
│           ├── index.ts               # Tile registry
│           ├── tile-wrapper.tsx       # Base wrapper for all tiles
│           ├── customers-tile.tsx
│           ├── emails-tile.tsx
│           ├── escalations-tile.tsx
│           ├── opportunities-tile.tsx
│           └── sentiment-tile.tsx
├── lib/
│   └── hooks/
│       ├── use-dashboard-layout.ts    # Layout persistence
│       ├── use-customer-count.ts
│       ├── use-email-count.ts
│       ├── use-escalation-count.ts
│       ├── use-opportunity-count.ts
│       └── use-sentiment-stats.ts
```

### Filter State (URL-synced)

```typescript
interface DashboardFilters {
  customerId?: string;
  userId?: string;
  dateFrom: string;
  dateTo: string;
}

// Quick date presets
const DATE_PRESETS = [
  { label: 'Today', getValue: () => ({ from: startOfToday(), to: endOfToday() }) },
  { label: 'Last 7 days', getValue: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: 'Last 30 days', getValue: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: 'Last 90 days', getValue: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
  { label: 'Custom', getValue: null },
];
```

### Filter Debouncing

```typescript
// lib/hooks/use-debounced-filters.ts
export function useDebouncedFilters(filters: DashboardFilters, delay = 500) {
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, delay);

    return () => clearTimeout(timer);
  }, [filters, delay]);

  return debouncedFilters;
}

// Usage in dashboard page:
const filters = useFiltersFromUrl();
const debouncedFilters = useDebouncedFilters(filters);  // 500ms delay

// Pass debouncedFilters to tiles - prevents excessive API calls
<DashboardGrid filters={debouncedFilters} />
```

---

## Grid Component

### DashboardGrid

```tsx
// components/dashboard/dashboard-grid.tsx
"use client"

import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardGridProps {
  filters: DashboardFilters;
}

const TILE_COMPONENTS: Record<string, React.ComponentType<{ filters: DashboardFilters }>> = {
  customers: CustomersTile,
  emails: EmailsTile,
  escalations: EscalationsTile,
  opportunities: OpportunitiesTile,
  sentiment: SentimentTile,
};

export function DashboardGrid({ filters }: DashboardGridProps) {
  const { layouts, setLayouts, resetLayout } = useDashboardLayout();

  return (
    <div className="relative">
      {/* Reset button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-0 right-0 z-10"
        onClick={resetLayout}
      >
        <RotateCcw className="h-4 w-4 mr-1" />
        Reset Layout
      </Button>

      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={150}
        onLayoutChange={(_, allLayouts) => setLayouts(allLayouts)}
        draggableHandle=".tile-drag-handle"
        isResizable={true}
        isDraggable={true}
      >
        {Object.entries(TILE_COMPONENTS).map(([id, Component]) => (
          <div key={id} className="bg-card rounded-lg border overflow-hidden">
            <Component filters={filters} />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
```

### Layout Persistence Hook

```tsx
// lib/hooks/use-dashboard-layout.ts
const STORAGE_KEY = 'dashboard-layout';

export function useDashboardLayout() {
  const [layouts, setLayouts] = useState<Layouts>(() => {
    if (typeof window === 'undefined') return DEFAULT_LAYOUTS;
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_LAYOUTS;
  });

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  }, [layouts]);

  const resetLayout = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { layouts, setLayouts, resetLayout };
}
```

---

## Tile Registry

```tsx
// components/dashboard/tiles/index.ts
export interface TileDefinition {
  id: string;
  title: string;
  component: React.ComponentType<TileProps>;
  defaultLayout: { w: number; h: number; minW?: number; minH?: number };
  category: 'stat' | 'chart';
}

export const DASHBOARD_TILES: TileDefinition[] = [
  {
    id: 'customers',
    title: 'Total Customers',
    component: CustomersTile,
    defaultLayout: { w: 1, h: 1, minW: 1, minH: 1 },
    category: 'stat',
  },
  {
    id: 'emails',
    title: 'Emails Analyzed',
    component: EmailsTile,
    defaultLayout: { w: 1, h: 1, minW: 1, minH: 1 },
    category: 'stat',
  },
  {
    id: 'escalations',
    title: 'Active Escalations',
    component: EscalationsTile,
    defaultLayout: { w: 1, h: 1, minW: 1, minH: 1 },
    category: 'stat',
  },
  {
    id: 'opportunities',
    title: 'Upsell Opportunities',
    component: OpportunitiesTile,
    defaultLayout: { w: 1, h: 1, minW: 1, minH: 1 },
    category: 'stat',
  },
  {
    id: 'sentiment',
    title: 'Customer Sentiment',
    component: SentimentTile,
    defaultLayout: { w: 2, h: 2, minW: 2, minH: 2 },
    category: 'chart',
  },
];

// Adding a new tile is simple:
// 1. Create the tile component
// 2. Add entry to DASHBOARD_TILES
// 3. Layout auto-generated from defaultLayout
```

---

## Reusable State Components

### StatCardSkeleton

```tsx
// components/dashboard/stat-card-skeleton.tsx
export function StatCardSkeleton() {
  return (
    <Card className="p-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />  {/* Title */}
        <Skeleton className="h-8 w-16" />  {/* Value */}
        <Skeleton className="h-4 w-32" />  {/* Change */}
      </div>
    </Card>
  );
}
```

### StatCardError

```tsx
// components/dashboard/stat-card-error.tsx
export function StatCardError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="p-5">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Error</p>
        <p className="text-sm text-destructive">{error.message}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    </Card>
  );
}
```

---

## Error Boundaries

Each tile wrapped in an error boundary for fault isolation:

```tsx
// components/dashboard/tile-error-boundary.tsx
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class TileErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <StatCardError error={this.state.error!} />
      );
    }
    return this.props.children;
  }
}

// Usage in DashboardGrid:
{Object.entries(TILE_COMPONENTS).map(([id, Component]) => (
  <div key={id}>
    <TileErrorBoundary>
      <Component filters={filters} />
    </TileErrorBoundary>
  </div>
))}
```

---

## Tile Wrapper

```tsx
// components/dashboard/tiles/tile-wrapper.tsx
interface TileWrapperProps {
  title: string;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function TileWrapper({ title, isLoading, error, onRetry, children }: TileWrapperProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Drag handle */}
      <div className="tile-drag-handle flex items-center justify-between p-3 border-b cursor-move bg-muted/30">
        <span className="text-sm font-medium">{title}</span>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        {isLoading ? (
          <StatCardSkeleton />
        ) : error ? (
          <StatCardError error={error} onRetry={onRetry} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
```

---

## Data Sources & Hooks

### Retry Logic

All data hooks use exponential backoff for retries:

```typescript
// lib/hooks/use-dashboard-query.ts
export function useDashboardQuery<T>(
  queryKey: unknown[],
  queryFn: () => Promise<T>,
  options?: { staleTime?: number }
) {
  return useQuery({
    queryKey,
    queryFn,
    staleTime: options?.staleTime ?? 60_000,
    retry: 2,                           // 2 retries
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),  // Exponential backoff: 2s, 4s
    refetchOnWindowFocus: false,
  });
}
```

### Auto-Refresh Indicator

```tsx
// components/dashboard/refresh-indicator.tsx
export function RefreshIndicator({ lastUpdated }: { lastUpdated?: Date }) {
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    setRefreshing(false);
  };

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {lastUpdated && (
        <span>Last updated: {formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
      )}
      <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
      </Button>
    </div>
  );
}
```

### 1. Customers Tile
```typescript
export function useCustomerCount(filters: DashboardFilters) {
  return useDashboardQuery(
    ['dashboard', 'customers', filters],
    async () => {
      const result = await customerClient.search({ limit: 0 });
      return { total: result.total };
    }
  );
}
```

### 2. Emails Tile
```typescript
// New endpoint: GET /api/emails/count
export function useEmailCount(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'emails', filters],
    queryFn: () => emailClient.getCount(filters),
    staleTime: 60_000,
  });
}
```

### 3. Escalations Tile
```typescript
export function useEscalationCount(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'escalations', filters],
    queryFn: async () => {
      const result = await taskClient.search({
        status: 'open',
        customerId: filters.customerId,
        assignedToId: filters.userId,
        limit: 0,
      });
      return { active: result.total };
    },
    staleTime: 30_000,
  });
}
```

### 4. Opportunities Tile
```typescript
export function useOpportunityCount(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'opportunities', filters],
    queryFn: () => signalClient.count({ type: 'upsell', ...filters }),
    staleTime: 60_000,
  });
}
```

### 5. Sentiment Tile
```typescript
// New endpoint: GET /api/emails/sentiment-stats
export function useSentimentStats(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'sentiment', filters],
    queryFn: () => emailClient.getSentimentStats(filters),
    staleTime: 60_000,
  });
}
```

---

## New API Endpoints

### 1. `GET /api/emails/count`
```typescript
// Response: { total: number }
```

### 2. `GET /api/emails/sentiment-stats`
```typescript
// Response: { positive: number, neutral: number, negative: number }
```

---

## SQL Queries (with proper scoping)

All queries filter by `tenant_id` and respect user access via `user_customers` table.

### Total Customers

```sql
SELECT COUNT(DISTINCT c.id)
FROM customers c
WHERE c.tenant_id = :tenantId
  AND c.row_status = 0
  AND (
    :isAdmin = true
    OR c.id IN (SELECT customer_id FROM user_customers WHERE user_id = :userId)
  )
  AND (:customerId IS NULL OR c.id = :customerId)
```

### Emails Analyzed

```sql
SELECT COUNT(DISTINCT e.id)
FROM emails e
WHERE e.tenant_id = :tenantId
  AND e.analysis_status = 'completed'
  AND e.created_at >= :dateFrom AND e.created_at <= :dateTo
  AND (
    :isAdmin = true
    OR e.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = :userId)
  )
  AND (:customerId IS NULL OR e.customer_id = :customerId)
```

### Active Escalations

```sql
SELECT COUNT(*)
FROM tasks t
WHERE t.tenant_id = :tenantId
  AND t.status = 0  -- OPEN
  AND t.row_status = 0
  AND t.created_at >= :dateFrom AND t.created_at <= :dateTo
  AND (
    :isAdmin = true
    OR t.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = :userId)
  )
  AND (:customerId IS NULL OR t.customer_id = :customerId)
  AND (
    :filterUserId IS NULL
    OR t.assigned_to_id = :filterUserId
  )
```

### Upsell Opportunities

```sql
SELECT COUNT(*)
FROM email_analyses ea
INNER JOIN emails e ON ea.email_id = e.id
WHERE ea.tenant_id = :tenantId
  AND ea.analysis_type = 'upsell'
  AND ea.detected = true
  AND e.created_at >= :dateFrom AND e.created_at <= :dateTo
  AND (
    :isAdmin = true
    OR e.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = :userId)
  )
  AND (:customerId IS NULL OR e.customer_id = :customerId)
```

### Sentiment Distribution

```sql
SELECT
  ea.sentiment_value,
  COUNT(*) as count
FROM email_analyses ea
INNER JOIN emails e ON ea.email_id = e.id
WHERE ea.tenant_id = :tenantId
  AND ea.analysis_type = 'sentiment'
  AND ea.sentiment_value IS NOT NULL
  AND e.created_at >= :dateFrom AND e.created_at <= :dateTo
  AND (
    :isAdmin = true
    OR e.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = :userId)
  )
  AND (:customerId IS NULL OR e.customer_id = :customerId)
GROUP BY ea.sentiment_value
```

### Security Notes

- All queries scoped by `tenant_id` (multi-tenant isolation)
- Customer access via `user_customers` join (row-level security)
- Admin users bypass customer scoping
- User filter respects assignee visibility

---

## Dashboard Page

```tsx
// app/page.tsx
"use client"

import { DashboardGrid } from '@/components/dashboard/dashboard-grid';
import { DashboardFilters } from '@/components/dashboard/dashboard-filters';

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<DashboardFilters>(() => ({
    customerId: searchParams.get('customer') || undefined,
    userId: searchParams.get('user') || undefined,
    dateFrom: searchParams.get('from') || subDays(new Date(), 30).toISOString(),
    dateTo: searchParams.get('to') || new Date().toISOString(),
  }), [searchParams]);

  const handleFiltersChange = useCallback((newFilters: DashboardFilters) => {
    setSearchParams((params) => {
      // Update URL params...
      return params;
    });
  }, [setSearchParams]);

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Email intelligence and customer insights</p>
          </div>
          <DashboardFilters filters={filters} onFiltersChange={handleFiltersChange} />
        </div>

        {/* Grid Layout */}
        <DashboardGrid filters={filters} />
      </div>
    </AppShell>
  );
}
```

---

## CSS for Grid

```css
/* Add to global styles or component */
.react-grid-item {
  transition: all 200ms ease;
  transition-property: left, top;
}

.react-grid-item.cssTransforms {
  transition-property: transform;
}

.react-grid-item.react-draggable-dragging {
  transition: none;
  z-index: 100;
  box-shadow: 0 10px 20px rgba(0,0,0,0.1);
}

.react-grid-item.react-grid-placeholder {
  background: hsl(var(--primary) / 0.1);
  border: 2px dashed hsl(var(--primary));
  border-radius: var(--radius);
}

.react-resizable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
  bottom: 0;
  right: 0;
  cursor: se-resize;
}
```

---

## Implementation Steps

### Phase 1: Grid Setup
1. Install `react-grid-layout`
2. Create `DashboardGrid` component
3. Create `useDashboardLayout` hook for persistence
4. Add grid CSS styles
5. Remove old tiles (Avg Turnaround, Premier Accounts)

### Phase 2: Filter Infrastructure
1. Create `DashboardFilters` component
2. Create `CustomerCombobox` with autocomplete
3. Create `UserSelect` dropdown
4. Add date range picker
5. Sync filters to URL params

### Phase 3: Tile Components
1. Create `TileWrapper` with drag handle
2. Create individual tile components
3. Create data fetching hooks
4. Set up tile registry

### Phase 4: API Endpoints
1. Add `GET /api/emails/count`
2. Add `GET /api/emails/sentiment-stats`
3. Update `@crm/clients`

### Phase 5: Polish
1. Add loading skeletons
2. Add error states
3. Test responsive breakpoints
4. Test layout persistence

---

## File Changes Summary

### New Dependencies
```json
{
  "react-grid-layout": "^1.4.4",
  "@types/react-grid-layout": "^1.3.5"
}
```

### New Files
| File | Purpose |
|------|---------|
| `components/dashboard/dashboard-grid.tsx` | Grid layout wrapper |
| `components/dashboard/dashboard-filters.tsx` | Filter bar |
| `components/dashboard/customer-combobox.tsx` | Customer autocomplete |
| `components/dashboard/user-select.tsx` | User dropdown |
| `components/dashboard/stat-card-skeleton.tsx` | Loading skeleton |
| `components/dashboard/stat-card-error.tsx` | Error state with retry |
| `components/dashboard/tile-error-boundary.tsx` | Error boundary per tile |
| `components/dashboard/refresh-indicator.tsx` | Auto-refresh with timestamp |
| `components/dashboard/tiles/index.ts` | Tile registry |
| `components/dashboard/tiles/tile-wrapper.tsx` | Base tile wrapper |
| `components/dashboard/tiles/customers-tile.tsx` | Customer count |
| `components/dashboard/tiles/emails-tile.tsx` | Email count |
| `components/dashboard/tiles/escalations-tile.tsx` | Escalation count |
| `components/dashboard/tiles/opportunities-tile.tsx` | Opportunity count |
| `components/dashboard/tiles/sentiment-tile.tsx` | Sentiment chart |
| `lib/hooks/use-dashboard-layout.ts` | Layout persistence |
| `lib/hooks/use-dashboard-query.ts` | Base query with retry logic |
| `lib/hooks/use-debounced-filters.ts` | Filter debouncing (500ms) |
| `lib/hooks/use-customer-count.ts` | Data hook |
| `lib/hooks/use-email-count.ts` | Data hook |
| `lib/hooks/use-escalation-count.ts` | Data hook |
| `lib/hooks/use-opportunity-count.ts` | Data hook |
| `lib/hooks/use-sentiment-stats.ts` | Data hook |

### Modified Files
| File | Changes |
|------|---------|
| `apps/web/app/page.tsx` | Use grid, filters |
| `apps/web/package.json` | Add dependencies |
| `apps/api/src/emails/routes.ts` | Add endpoints |
| `packages/clients/src/email-client.ts` | Add methods |

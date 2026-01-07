# Dashboard Design - For Approval

## Overview
This document presents the complete design for connecting the Dashboard to real APIs, adding filters, and making it scalable for future additions.

---

## 1. UI/UX Design

### 1.1 Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Dashboard                                    [Filters Bar]       │
│ Enterprise-wide email intelligence and customer insights        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ [Customer ▼] [User ▼] [Date Range ▼] [Reset]                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│ │ Total    │ │ Emails   │ │ Active   │ │ Upsell    │         │
│ │ Customers│ │ Analyzed │ │ Escal.   │ │ Opport.   │         │
│ │   247    │ │  15.2K   │ │    8     │ │   23      │         │
│ │ +12%     │ │  +8%     │ │ 3 new    │ │  +5 this  │         │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌────────────────────────┐ ┌────────────────────────┐        │
│ │ Sentiment Distribution │ │ Turnaround Metrics      │        │
│ │      [Pie Chart]       │ │    [Bar Chart]          │        │
│ └────────────────────────┘ └────────────────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Filter Bar Design

**Components**:
- **Customer Autocomplete**: Dropdown with search, shows "All Customers" when empty
- **User Autocomplete**: Dropdown with search, shows "All Users" when empty  
- **Date Range Picker**: Button showing selected range or "Date Range", opens calendar popover
- **Reset Button**: Only visible when filters are active, clears all filters

**Visual Layout**:
```
[Customer: Acme Corp ▼] [User: John Doe ▼] [Jan 1 - Jan 31 ▼] [Reset]
```

**Filter States**:
- **Empty**: Shows placeholders ("All Customers", "All Users", "Date Range")
- **Active**: Shows selected values, Reset button appears
- **Loading**: Shows spinner in autocomplete dropdowns

### 1.3 Removed Tiles
- ❌ **Avg Turnaround Time** - Removed as requested
- ❌ **Premier Accounts** - Removed as requested

**New Grid Layout**: 4 columns (was 3) to accommodate remaining tiles

---

## 2. Component Architecture

### 2.1 DashboardFilters Component

**Location**: `apps/web/components/dashboard/dashboard-filters.tsx`

**Props**:
```typescript
interface DashboardFiltersProps {
  filters: DashboardFilter
  onFiltersChange: (filters: DashboardFilter) => void
  className?: string
}

interface DashboardFilter {
  customerId?: string      // UUID of selected customer
  userId?: string          // UUID of selected user
  dateFrom?: Date          // Start of date range
  dateTo?: Date            // End of date range
}
```

**Features**:
- Customer autocomplete (scoped to user's accessible customers)
- User autocomplete (scoped to user's subordinates via `useAssignableUsers`)
- Date range picker (calendar with range selection)
- Reset button (clears all filters)
- URL param synchronization (for bookmarking/sharing)

**Visual Design**:
```
┌────────────────────────────────────────────────────────────┐
│ [Customer: Acme Corp ▼] [User: John Doe ▼] [Jan 1-31 ▼]  │
│                                                            │
│ Customer dropdown:                                        │
│   - Search box                                            │
│   - All Customers (selected when empty)                  │
│   - Acme Corp (acme.com)                                  │
│   - TechCorp (techcorp.com)                               │
│   ...                                                     │
│                                                            │
│ User dropdown:                                            │
│   - Search box                                            │
│   - All Users (selected when empty)                       │
│   - John Doe (john@example.com)                          │
│   - Jane Smith (jane@example.com)                         │
│   ...                                                     │
│                                                            │
│ Date Range:                                               │
│   ┌─────────────────────────────────────┐                │
│   │  January 2024      February 2024   │                │
│   │  S M T W T F S    S M T W T F S    │                │
│   │        1  2  3     1  2  3  4  5   │                │
│   │  4  5  6  7  8  9 10  6  7  8  9 10│                │
│   │ 11 12 13 14 15 16 17 13 14 15 16 17│                │
│   │ [1───────31] (selected range)      │                │
│   └─────────────────────────────────────┘                │
└────────────────────────────────────────────────────────────┘
```

### 2.2 Enhanced StatCard Component

**Location**: `apps/web/components/dashboard/stat-card.tsx`

**Enhanced Props**:
```typescript
interface StatCardProps {
  title: string
  value: string | number
  change?: string              // Made optional
  icon: LucideIcon
  trend?: "up" | "down" | "neutral"
  // Note: Loading/error handled by tile component, not StatCard
}
```

**StatCardSkeleton Component** (NEW):
```typescript
// For loading state
export function StatCardSkeleton() {
  return (
    <Card className="p-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />  {/* Title */}
        <Skeleton className="h-8 w-16" />   {/* Value */}
        <Skeleton className="h-4 w-32" />  {/* Change */}
      </div>
    </Card>
  );
}
```

**StatCardError Component** (NEW):
```typescript
// For error state
export function StatCardError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="p-5">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Error</p>
        <p className="text-sm text-destructive">{error.message}</p>
        {onRetry && <Button onClick={onRetry}>Retry</Button>}
      </div>
    </Card>
  );
}
```

**Visual States**:
```
Loading State (in tile):
┌──────────┐
│ Total    │
│ ░░░░░░░░ │  (skeleton)
│ ░░░░░░░░ │
└──────────┘

Error State (in tile):
┌──────────┐
│ Total    │
│ Error    │
│ [Retry]  │
└──────────┘

Success State:
┌──────────┐
│ Total    │
│   247    │
│ +12%     │
└──────────┘
```

### 2.3 Tile Registry System

**Location**: `apps/web/components/dashboard/tile-registry.ts`

**Grid Layout Tool**: **react-grid-layout** (https://react-grid-layout.github.io/react-grid-layout/)
- ✅ Drag and drop tiles
- ✅ Resizable tiles
- ✅ Save user preferences (localStorage or backend)
- ✅ Responsive layouts (different layouts per breakpoint)
- ✅ Professional dashboard UX
- ✅ Users can customize their dashboard

**Why react-grid-layout?**:
- Industry standard for dashboard layouts
- Provides drag-and-drop and resize functionality
- Better UX than static grids
- Users can personalize their dashboard
- Supports responsive breakpoints (mobile, tablet, desktop)

**Grid Layout Implementation**:
```typescript
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-grid-resizable/css/styles.css';

// Dashboard page uses react-grid-layout
<GridLayout
  className="layout"
  layout={tileLayouts}  // Array of { i: 'tile-id', x: 0, y: 0, w: 2, h: 2 }
  cols={12}             // 12-column grid system
  rowHeight={100}       // Height per row in pixels
  width={1200}          // Container width (auto-calculated)
  isDraggable={!isViewMode}
  isResizable={!isViewMode}
  onLayoutChange={handleLayoutChange}
>
  {tiles.map(tile => (
    <div key={tile.id}>
      <tile.component filters={filters} />
    </div>
  ))}
</GridLayout>
```

**Tile Design**:
```typescript
interface DashboardTile {
  id: string
  component: React.ComponentType<DashboardTileProps>
  // Default grid layout (x, y, w, h)
  defaultLayout: {
    x: number      // Column position (0-11 for 12-column grid)
    y: number      // Row position (starts at 0)
    w: number      // Width in grid units (1-12)
    h: number      // Height in grid units (rows)
  }
  minW?: number    // Minimum width (default: 1)
  minH?: number    // Minimum height (default: 1)
  maxW?: number    // Maximum width (default: 12)
  maxH?: number    // Maximum height
  order?: number   // Display order (for initial layout)
  enabled?: boolean // Can be disabled via config
}

interface DashboardTileProps {
  filters: DashboardFilter
  // Each tile receives filters and fetches its own data
}
```

**Layout Persistence Hook**:
```typescript
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

**Default Layouts**:
```typescript
const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: 'total-customers', x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'emails-analyzed', x: 1, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'active-escalations', x: 2, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'upsell-opportunities', x: 3, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'sentiment-chart', x: 0, y: 1, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'turnaround-chart', x: 2, y: 1, w: 2, h: 2, minW: 2, minH: 2 },
  ],
  md: [
    // Responsive layout for medium screens
    { i: 'total-customers', x: 0, y: 0, w: 1, h: 1 },
    { i: 'emails-analyzed', x: 1, y: 0, w: 1, h: 1 },
    { i: 'active-escalations', x: 2, y: 0, w: 1, h: 1 },
    { i: 'upsell-opportunities', x: 0, y: 1, w: 1, h: 1 },
    { i: 'sentiment-chart', x: 1, y: 1, w: 2, h: 2 },
    { i: 'turnaround-chart', x: 0, y: 3, w: 3, h: 2 },
  ],
  sm: [
    // Stacked layout for small screens
    { i: 'total-customers', x: 0, y: 0, w: 1, h: 1 },
    { i: 'emails-analyzed', x: 0, y: 1, w: 1, h: 1 },
    { i: 'active-escalations', x: 0, y: 2, w: 1, h: 1 },
    { i: 'upsell-opportunities', x: 0, y: 3, w: 1, h: 1 },
    { i: 'sentiment-chart', x: 0, y: 4, w: 2, h: 2 },
    { i: 'turnaround-chart', x: 0, y: 6, w: 2, h: 2 },
  ],
  xs: [
    // Single column for extra small screens
    { i: 'total-customers', x: 0, y: 0, w: 1, h: 1 },
    { i: 'emails-analyzed', x: 0, y: 1, w: 1, h: 1 },
    { i: 'active-escalations', x: 0, y: 2, w: 1, h: 1 },
    { i: 'upsell-opportunities', x: 0, y: 3, w: 1, h: 1 },
    { i: 'sentiment-chart', x: 0, y: 4, w: 1, h: 2 },
    { i: 'turnaround-chart', x: 0, y: 6, w: 1, h: 2 },
  ],
};
```

**Key Design Principles**:
1. **Self-Contained Tiles**: Each tile component:
   - Receives `filters` as prop
   - Uses its own hook to fetch data
   - Manages its own loading state
   - Manages its own error state
   - Renders independently

2. **Independent Data Fetching**: 
   - Each tile makes its own API call
   - Tiles load in parallel (React Query handles this)
   - Progressive rendering (tiles appear as data arrives)
   - Error isolation (one tile failing doesn't break others)

3. **Layout Management**:
   - Default layouts defined in tile registry
   - User can drag/drop/resize tiles
   - Layout saved per user (localStorage or backend)
   - Responsive layouts (different layouts per breakpoint)

4. **Example Tile Implementation**:
```typescript
// apps/web/components/dashboard/tiles/total-customers-tile.tsx
export function TotalCustomersTile({ filters }: DashboardTileProps) {
  // Tile fetches its own data
  const { data, isLoading, error, refetch } = useDashboardCustomers(filters);
  
  // Tile handles its own states
  if (isLoading) return <StatCardSkeleton />;
  if (error) return <StatCardError error={error} onRetry={refetch} />;
  
  return (
    <StatCard
      title="Total Customers"
      value={data?.count ?? 0}
      change={data?.change}
      icon={Users}
      trend="up"
    />
  );
}
```

**Tile Wrapper Component** (with drag handle):
```typescript
// components/dashboard/tiles/tile-wrapper.tsx
interface TileWrapperProps {
  title: string;
  isLoading?: boolean;
  error?: Error | null;
  children: React.ReactNode;
}

export function TileWrapper({ title, isLoading, error, children }: TileWrapperProps) {
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
          <StatCardError error={error} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
```

**Example Tile Registration**:
```typescript
registerTile({
  id: 'total-customers',
  component: TotalCustomersTile,
  defaultLayout: {
    x: 0,  // Column 0
    y: 0,  // Row 0
    w: 1,  // 1 column wide (out of 4 for lg breakpoint)
    h: 1,  // 1 row tall
  },
  minW: 1,
  minH: 1,
  maxW: 2,
  order: 1,
});
```
```

**Example Registration**:
```typescript
registerTile({
  id: 'total-customers',
  component: TotalCustomersTile,
  gridCols: { default: 1, md: 2, lg: 3 },
  order: 1,
  enabled: true
});
```

**Grid Layout Logic**:
- Responsive: Automatically adjusts columns based on screen size
- Order-based: Tiles sorted by `order` property
- Filter-aware: All tiles receive same filter object
- Independent loading: Each tile can load independently

---

## 3. API Design

### 3.1 API Endpoint Structure

**Recommended**: Single aggregated endpoint

**Endpoint**: `GET /api/analysis/dashboard`

**Query Parameters**:
```typescript
{
  customerId?: string      // UUID - filter by customer
  userId?: string          // UUID - filter by user
  dateFrom?: string        // ISO date string - start date
  dateTo?: string          // ISO date string - end date
}
```

**Response Schema**:
```typescript
{
  stats: {
    totalCustomers: number
    emailsAnalyzed: number
    activeEscalations: number
    upsellOpportunities: number
    // Change indicators (optional)
    customersChange?: string      // e.g., "+12% from last month"
    emailsChange?: string
    escalationsChange?: string
    upsellChange?: string
  },
  sentiment: {
    positive: number      // Count or percentage
    neutral: number
    negative: number
    total: number         // Total emails analyzed
  },
  turnaround: Array<{
    userId: string
    userName: string
    avgHours: number      // Average turnaround time in hours
    taskCount: number     // Number of completed tasks
  }>
}
```

**Alternative**: Separate endpoints (if needed for independent loading)
- `GET /api/analysis/dashboard/stats`
- `GET /api/analysis/dashboard/sentiment`
- `GET /api/analysis/dashboard/turnaround`

**Recommendation**: **Single endpoint** for better performance and consistency.

### 3.2 Service Layer

**Location**: `apps/api/src/analysis/dashboard-service.ts`

**Methods** (one per endpoint):
```typescript
class DashboardService {
  /**
   * Get total customers count
   */
  async getCustomersCount(
    header: RequestHeader,
    filters: DashboardFilter
  ): Promise<{ count: number; change?: string }>
  
  /**
   * Get emails analyzed count
   */
  async getEmailsCount(
    header: RequestHeader,
    filters: DashboardFilter
  ): Promise<{ count: number; change?: string }>
  
  /**
   * Get active escalations count
   */
  async getEscalationsCount(
    header: RequestHeader,
    filters: DashboardFilter
  ): Promise<{ count: number; change?: string }>
  
  /**
   * Get upsell opportunities count
   */
  async getUpsellCount(
    header: RequestHeader,
    filters: DashboardFilter
  ): Promise<{ count: number; change?: string }>
  
  /**
   * Get sentiment distribution
   * Queries email_analyses table filtered by sentiment analysis type
   */
  async getSentimentDistribution(
    header: RequestHeader,
    filters: DashboardFilter
  ): Promise<SentimentDistribution>
  
  /**
   * Get turnaround metrics
   * Calculates avg(completedAt - createdAt) from tasks table
   */
  async getTurnaroundMetrics(
    header: RequestHeader,
    filters: DashboardFilter
  ): Promise<TurnaroundMetric[]>
}
```

### 3.3 Repository Layer

**Location**: `apps/api/src/analysis/dashboard-repository.ts`

**Methods** (one per metric):
```typescript
class DashboardRepository {
  /**
   * Count customers (scoped)
   */
  async countCustomers(header: RequestHeader, filters: DashboardFilter): Promise<number>
  
  /**
   * Count analyzed emails (scoped)
   */
  async countAnalyzedEmails(header: RequestHeader, filters: DashboardFilter): Promise<number>
  
  /**
   * Count active escalations (scoped)
   */
  async countActiveEscalations(header: RequestHeader, filters: DashboardFilter): Promise<number>
  
  /**
   * Count upsell opportunities (scoped)
   */
  async countUpsellOpportunities(header: RequestHeader, filters: DashboardFilter): Promise<number>
  
  /**
   * Get sentiment distribution (scoped)
   */
  async getSentimentDistribution(header: RequestHeader, filters: DashboardFilter): Promise<SentimentDistribution>
  
  /**
   * Get turnaround metrics (scoped)
   */
  async getTurnaroundMetrics(header: RequestHeader, filters: DashboardFilter): Promise<TurnaroundMetric[]>
  
  /**
   * Calculate change percentage (optional helper)
   * Compares current period vs previous period
   */
  async calculateChange(
    currentCount: number,
    previousCount: number,
    period: 'day' | 'week' | 'month'
  ): Promise<string>
}
```

### 3.4 Data Source Queries

**Total Customers**:
```sql
SELECT COUNT(DISTINCT c.id)
FROM customers c
WHERE c.tenant_id = ?
  AND (c.id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) OR is_admin)
  -- Optional: filter by date range if customer created_at is needed
```

**Emails Analyzed**:
```sql
SELECT COUNT(DISTINCT e.id)
FROM emails e
INNER JOIN email_participants ep ON e.id = ep.email_id
WHERE e.tenant_id = ?
  AND e.analysis_status = 'completed'
  AND e.created_at >= ? AND e.created_at <= ?
  AND (e.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) OR is_admin)
  -- Optional: filter by user via email_participants
```

**Active Escalations**:
```sql
SELECT COUNT(*)
FROM tasks t
WHERE t.tenant_id = ?
  AND t.status = 0  -- OPEN
  AND t.created_at >= ? AND t.created_at <= ?
  AND (t.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) OR is_admin)
  AND (t.assigned_to_id IN (SELECT subordinate_id FROM user_subordinates WHERE manager_id = ?) OR t.assigned_to_id = ? OR is_admin)
```

**Upsell Opportunities**:
```sql
SELECT COUNT(*)
FROM email_analyses ea
INNER JOIN emails e ON ea.email_id = e.id
WHERE ea.tenant_id = ?
  AND ea.analysis_type = 'upsell'
  AND ea.detected = true
  AND e.created_at >= ? AND e.created_at <= ?
  AND (e.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) OR is_admin)
```

**Sentiment Distribution**:
```sql
SELECT 
  ea.sentiment_value,
  COUNT(*) as count
FROM email_analyses ea
INNER JOIN emails e ON ea.email_id = e.id
WHERE ea.tenant_id = ?
  AND ea.analysis_type = 'sentiment'
  AND ea.sentiment_value IS NOT NULL
  AND e.created_at >= ? AND e.created_at <= ?
  AND (e.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) OR is_admin)
GROUP BY ea.sentiment_value
```

**Turnaround Metrics**:
```sql
SELECT 
  t.assigned_to_id as user_id,
  u.first_name || ' ' || u.last_name as user_name,
  AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600) as avg_hours,
  COUNT(*) as task_count
FROM tasks t
INNER JOIN users u ON t.assigned_to_id = u.id
WHERE t.tenant_id = ?
  AND t.status = 1  -- DONE
  AND t.completed_at IS NOT NULL
  AND t.completed_at >= ? AND t.completed_at <= ?
  AND (t.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) OR is_admin)
  AND (t.assigned_to_id IN (SELECT subordinate_id FROM user_subordinates WHERE manager_id = ?) OR t.assigned_to_id = ? OR is_admin)
GROUP BY t.assigned_to_id, u.first_name, u.last_name
ORDER BY avg_hours ASC
LIMIT 10
```

---

## 4. Frontend Hooks

### 4.1 Dashboard Hook

**Location**: `apps/web/lib/hooks/use-dashboard.ts`

**Hook**:
```typescript
export function useDashboard(filters: DashboardFilter) {
  return useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => api.getDashboardData(filters),
    staleTime: 5 * 60 * 1000,        // 5 minutes
    gcTime: 10 * 60 * 1000,          // 10 minutes
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,  // Auto-refresh every 5 minutes
  });
}
```

**Usage**:
```typescript
const { data, isLoading, error } = useDashboard(dashboardFilters);
```

---

## 5. Filter Scoping

### 5.1 Customer Filter
- **Component**: `CustomerAutocomplete`
- **Scoping**: Automatically scoped via existing `CustomerAutocomplete` logic
- **Behavior**: Shows only customers user has access to
- **Empty State**: "All Customers" - aggregates across all accessible customers

### 5.2 User Filter
- **Component**: `UserAutocomplete` (or create wrapper using `useAssignableUsers`)
- **Scoping**: Uses `useAssignableUsers` hook (already scoped to subordinates)
- **Behavior**: Shows only user's subordinates and team members
- **Empty State**: "All Users" - aggregates across all accessible users

### 5.3 Date Range Filter
- **Component**: Calendar range picker (existing component)
- **Default**: Last 30 days (on initial load)
- **URL Sync**: Filters synced to URL params for shareability
  - `?customer=<id>&user=<id>&from=<iso>&to=<iso>`
  - Allows sharing dashboard state via URL
- **Quick Filters**: Today, Last 7 days, Last 30 days, Last 90 days, Custom
- **Validation**: Max range 1 year, no future dates

---

## 6. Scalability Design

### 6.1 Adding New Tiles

**Step 1**: Create API endpoint
```typescript
// apps/api/src/analysis/routes.ts
app.get('/dashboard/new-metric', async (c) => {
  // Implementation
});
```

**Step 2**: Create hook
```typescript
// apps/web/lib/hooks/use-dashboard.ts
export function useDashboardNewMetric(filters: DashboardFilter) {
  return useQuery({
    queryKey: ['dashboard', 'new-metric', filters],
    queryFn: () => api.getDashboardNewMetric(filters),
    staleTime: 5 * 60 * 1000,
  });
}
```

**Step 3**: Create tile component (self-contained)
```typescript
// apps/web/components/dashboard/tiles/new-metric-tile.tsx
export function NewMetricTile({ filters }: DashboardTileProps) {
  // Tile fetches its own data
  const { data, isLoading, error } = useDashboardNewMetric(filters);
  
  // Tile handles its own loading/error states
  if (isLoading) return <StatCardSkeleton />;
  if (error) return <StatCardError error={error} />;
  
  return (
    <StatCard
      title="New Metric"
      value={data?.count ?? 0}
      change={data?.change}
      icon={SomeIcon}
    />
  );
}
```

**Step 4**: Register tile
```typescript
// apps/web/components/dashboard/tile-registry.ts
registerTile({
  id: 'new-metric',
  component: NewMetricTile,
  gridCols: "md:col-span-2 lg:col-span-1",  // Tailwind classes
  order: 5,
  enabled: true
});
```

**Step 5**: Tile automatically appears in dashboard
- No changes needed to dashboard page
- Automatically receives filters prop
- Fetches its own data independently
- Handles its own loading/error states

### 6.2 Adding New Charts

**Step 1**: Create chart component
```typescript
export function NewChart({ filters }: DashboardTileProps) {
  const { data } = useNewChartData(filters);
  return <Card>...</Card>;
}
```

**Step 2**: Register as chart tile (full width)
```typescript
registerTile({
  id: 'new-chart',
  component: NewChart,
  gridCols: { default: 1, lg: 2 },  // Full width on mobile, half on large
  order: 10,
});
```

---

## 7. Performance Optimizations

### 7.1 Query Optimization
- ✅ Use existing database indexes
- ✅ Batch multiple stats in single query when possible
- ✅ Use database aggregations (COUNT, AVG) instead of fetching all rows
- ✅ Limit date ranges (max 1 year)

### 7.2 Caching Strategy
- React Query caching: 5 minutes stale time per tile
- Query deduplication: React Query automatically deduplicates identical queries
- Independent caching: Each tile's data cached separately
- Smart invalidation: Invalidate specific tile cache when related data updates
  - Example: Invalidate escalations cache when task is created/updated

### 7.3 Filter Debouncing
- Debounce filter changes: 500ms delay
- Cancel pending requests when filters change (React Query handles this)
- Use React Query's `enabled` option to prevent queries until filters stable
- Each tile's query automatically refetches when filters change

### 7.4 Loading Strategy
- **Parallel Loading**: All tiles fetch simultaneously (React Query handles parallelization)
- **Progressive Rendering**: Tiles render as data arrives (independent loading states)
- **Skeleton Loaders**: Each tile shows skeleton while loading
- **Error Isolation**: One tile failing doesn't prevent others from loading
- **Independent Retry**: Each tile can retry independently on error

---

## 8. Error Handling

### 8.1 Per-Tile Error Boundaries
```typescript
<ErrorBoundary fallback={<ErrorTile />}>
  <TotalCustomersTile filters={filters} />
</ErrorBoundary>
```

### 8.2 Error States
- **Network Error**: Show retry button
- **Data Error**: Show "No data available" message
- **Permission Error**: Show "Access denied" message

### 8.3 Retry Logic
- Automatic retry: 2 retries with exponential backoff
- Manual retry: Retry button in error state

---

## 9. Security Considerations

### 9.1 Scoping
- ✅ All queries filtered by `tenant_id`
- ✅ Customer access via `user_customers` table
- ✅ User access via `user_subordinates` table
- ✅ Admin users bypass scoping

### 9.2 Permission Checks
- Verify user has permission to view dashboard
- Respect customer access restrictions
- Respect user hierarchy (subordinates only)

### 9.3 Input Validation
- Validate UUIDs for customerId and userId
- Validate date ranges (max 1 year, no future dates)
- Sanitize all inputs

---

## 10. File Structure

```
apps/web/
├── app/
│   └── page.tsx                          # Dashboard page (UPDATED - URL sync)
├── components/
│   └── dashboard/
│       ├── dashboard-filters.tsx          # NEW - Filter component (URL-synced)
│       ├── dashboard-grid.tsx            # NEW - ResponsiveGridLayout wrapper
│       ├── stat-card.tsx                 # ENHANCED - Base card component
│       ├── stat-card-skeleton.tsx        # NEW - Loading skeleton
│       ├── stat-card-error.tsx           # NEW - Error state
│       ├── sentiment-chart.tsx           # ENHANCED - Real data, self-contained
│       ├── turnaround-chart.tsx          # ENHANCED - Real data, self-contained
│       ├── tile-registry.ts              # NEW - Tile registry with default layouts
│       └── tiles/
│           ├── index.ts                   # NEW - Tile exports
│           ├── tile-wrapper.tsx          # NEW - Base wrapper with drag handle
│           ├── total-customers-tile.tsx   # NEW - Self-contained tile
│           ├── emails-analyzed-tile.tsx  # NEW - Self-contained tile
│           ├── active-escalations-tile.tsx # NEW - Self-contained tile
│           ├── upsell-opportunities-tile.tsx # NEW - Self-contained tile
│           ├── sentiment-tile.tsx       # NEW - Self-contained chart tile
│           └── turnaround-tile.tsx       # NEW - Self-contained chart tile
└── lib/
    └── hooks/
        ├── use-dashboard.ts              # NEW - Individual tile hooks (reuse existing APIs)
        └── use-dashboard-layout.ts       # NEW - Layout persistence hook

apps/api/
└── src/
    └── analysis/                         # NEW MODULE (only for missing aggregations)
        ├── dashboard-service.ts          # NEW - Business logic (one method per endpoint)
        ├── dashboard-repository.ts       # NEW - Data access (one method per metric)
        ├── routes.ts                     # NEW - API endpoints (only new ones needed)
        └── schema.ts                     # NEW - Zod schemas for requests/responses
```

**Dependencies to Add**:
```json
{
  "dependencies": {
    "react-grid-layout": "^1.4.4"
  },
  "devDependencies": {
    "@types/react-grid-layout": "^1.3.5"
  }
}
```

**CSS to Add** (global styles or component):
```css
/* Grid transitions and drag states */
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

**Key Points**:
- Each tile is a separate component that fetches its own data
- Each tile has its own hook (`useDashboardCustomers`, `useDashboardEmails`, etc.)
- Each tile has its own API endpoint (`/api/analysis/dashboard/customers`, etc.)
- Grid layout uses react-grid-layout (drag & drop, resizable)
- Layout persistence (localStorage or backend API)
- Responsive layouts (different layouts per breakpoint: lg, md, sm, xs)

---

## 11. Implementation Phases

### Phase 1: Filters & UI (Week 1)
- [ ] Create `DashboardFilters` component
- [ ] Add URL param state management
- [ ] Integrate CustomerAutocomplete
- [ ] Integrate UserAutocomplete  
- [ ] Add date range picker with quick filters
- [ ] Add default date range (Last 30 days)
- [ ] Remove "Avg Turnaround Time" tile
- [ ] Remove "Premier Accounts" tile
- [ ] Update grid layout (4 columns)

### Phase 2: API Layer (Week 1-2)
- [ ] Create `apps/api/src/analysis/` module
- [ ] Create `DashboardRepository` with aggregation queries
- [ ] Create `DashboardService` with business logic
- [ ] Create API routes (`GET /api/analysis/dashboard`)
- [ ] Add Zod schemas for validation
- [ ] Add error handling and logging
- [ ] Add request header middleware

### Phase 3: Frontend Integration (Week 2)
- [ ] Create `useDashboard` hook
- [ ] Update dashboard page to use hook
- [ ] Add loading states (skeletons)
- [ ] Add error states
- [ ] Connect stat cards to real data
- [ ] Add debouncing (500ms)

### Phase 4: Charts (Week 2-3)
- [ ] Connect SentimentChart to real data
- [ ] Connect TurnaroundChart to real data
- [ ] Add loading states for charts
- [ ] Add empty states for charts

### Phase 5: Tile System (Week 3)
- [ ] Create tile registry
- [ ] Extract tiles into separate components
- [ ] Implement responsive grid system
- [ ] Add tile configuration (enable/disable)

### Phase 6: Polish (Week 3-4)
- [ ] Add manual refresh button
- [ ] Add auto-refresh indicator
- [ ] Add last updated timestamp
- [ ] Optimize queries (verify indexes)
- [ ] Add error boundaries
- [ ] Add empty states
- [ ] Performance testing

---

## 12. Visual Mockups

### 12.1 Filter Bar (Empty State)
```
┌────────────────────────────────────────────────────────────┐
│ [All Customers ▼] [All Users ▼] [Date Range ▼]          │
└────────────────────────────────────────────────────────────┘
```

### 12.2 Filter Bar (Active State)
```
┌────────────────────────────────────────────────────────────┐
│ [Customer: Acme Corp ▼] [User: John Doe ▼] [Jan 1-31 ▼]  │
│ [Reset]                                                    │
└────────────────────────────────────────────────────────────┘
```

### 12.3 Stat Cards Grid
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Total        │ │ Emails       │ │ Active       │ │ Upsell       │
│ Customers    │ │ Analyzed     │ │ Escalations  │ │ Opportunities│
│              │ │              │ │              │ │              │
│    247       │ │   15.2K      │ │      8       │ │     23       │
│  +12% from   │ │  +8% from    │ │  3 new today │ │  +5 this week│
│  last month  │ │  last week   │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

### 12.4 Charts Grid
```
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ Sentiment Distribution       │ │ Turnaround Metrics           │
│                              │ │                              │
│        [Pie Chart]           │ │     [Bar Chart]              │
│                              │ │                              │
│  Positive: 58%               │ │  Sarah M.  [████] 2.1h      │
│  Neutral: 32%                │ │  John D.   [██████] 2.8h     │
│  Negative: 10%               │ │  Emily R.  [███] 1.5h        │
└──────────────────────────────┘ └──────────────────────────────┘
```

---

## 13. Data Flow Diagram

```
User Interaction
    │
    ├─> Select Customer Filter
    │   └─> Update URL Params
    │       └─> DashboardFilters updates state
    │           └─> Dashboard page receives new filters
    │               └─> useDashboard hook refetches
    │                   └─> API call with filters
    │                       └─> DashboardService aggregates data
    │                           └─> DashboardRepository queries DB
    │                               └─> Returns aggregated data
    │                                   └─> React Query caches result
    │                                       └─> Tiles re-render with new data
    │
    ├─> Select User Filter
    │   └─> (same flow as customer filter)
    │
    └─> Select Date Range
        └─> (same flow as customer filter)
```

---

## 14. Key Design Decisions

### Decision 1: Single vs Multiple API Endpoints
**Decision**: **Separate endpoints for each tile** (independent calls)
**Rationale**: 
- Each tile loads independently (better UX - progressive loading)
- Error isolation (one tile failing doesn't break others)
- Independent caching per metric
- Easier to optimize individual endpoints
- Tiles can have different refresh intervals if needed
- Better for scalability (can add tiles without affecting others)

### Decision 2: User Filter Scope
**Decision**: Only show subordinates (via `useAssignableUsers`)
**Rationale**: 
- Consistent with tasks page
- Respects user hierarchy
- Prevents data leakage

### Decision 3: Default Date Range
**Decision**: Default to "Last 30 days"
**Rationale**: 
- Better UX (shows data immediately)
- Common use case
- Can be cleared if needed

### Decision 4: Tile Registry Pattern
**Decision**: Use registry pattern with react-grid-layout
**Rationale**: 
- Easy to add new tiles (just register)
- Each tile is self-contained (fetches own data)
- Drag and drop functionality (better UX)
- Resizable tiles (users can customize)
- Responsive layouts (different layouts per breakpoint)
- Industry standard for dashboards
- Users can personalize their dashboard layout

### Decision 5: Self-Contained Tiles
**Decision**: Each tile fetches its own data and manages its own state
**Rationale**: 
- Better separation of concerns
- Independent error handling
- Progressive loading (tiles appear as data arrives)
- Easier to test individual tiles
- Can optimize each tile independently

### Decision 6: Filter Debouncing
**Decision**: 500ms debounce delay
**Rationale**: 
- Prevents excessive API calls (each tile refetches on filter change)
- Good balance between responsiveness and performance
- Standard practice
- React Query cancels pending requests automatically

---

## 15. Success Criteria

✅ **Functional Requirements**:
- [ ] Customer filter works and is scoped correctly
- [ ] User filter works and is scoped correctly
- [ ] Date range filter works with quick filters
- [ ] All tiles show real data from APIs
- [ ] Charts show real data
- [ ] Filters persist in URL (bookmarkable)
- [ ] "Avg Turnaround Time" tile removed
- [ ] "Premier Accounts" tile removed

✅ **Non-Functional Requirements**:
- [ ] Dashboard loads in < 2 seconds
- [ ] Filter changes update data in < 1 second
- [ ] No performance degradation with large datasets
- [ ] Proper error handling and user feedback
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Accessible (keyboard navigation, screen readers)

✅ **Scalability Requirements**:
- [ ] New tiles can be added without modifying dashboard page
- [ ] New charts can be added easily
- [ ] Filter system extensible for new filter types
- [ ] API can handle additional metrics without breaking changes

---

## 16. Open Questions

1. **Date Range Default**: Confirm "Last 30 days" as default?
2. **User Filter**: Confirm only subordinates (not all users)?
3. **Auto-refresh**: Confirm 1-minute staleTime? (or per-tile refresh intervals?)
4. **Max Date Range**: Confirm 1-year maximum?
5. **Quick Filters**: Which quick filters to include? (Today, Last 7/30/90 days, Custom?)
6. **Layout Persistence**: Start with localStorage (client-side), add backend API later?
7. **Edit Mode**: Always enabled (drag/drop always available) or toggle with "Edit Layout" button?
8. **Reset Layout Button**: Include a "Reset Layout" button in the UI?
9. **API Reuse**: Which existing APIs can we reuse vs. which need new endpoints?
   - Customers: Reuse `customerClient.search()` with `limit: 0`
   - Escalations: Reuse `taskClient.search()` with `limit: 0`
   - Emails: Need new `GET /api/emails/count` endpoint?
   - Sentiment: Need new `GET /api/emails/sentiment-stats` endpoint?
   - Turnaround: Need new endpoint or can reuse task API?
10. **Responsive Breakpoints**: Confirm breakpoints: `{ lg: 1200, md: 996, sm: 768, xs: 480 }`?
11. **Column Counts**: Confirm columns: `{ lg: 4, md: 3, sm: 2, xs: 1 }`?

---

## Approval Checklist

- [ ] UI/UX design approved
- [ ] Component architecture approved
- [ ] API design approved
- [ ] Data source queries approved
- [ ] Filter scoping approved
- [ ] Scalability design approved
- [ ] Performance optimizations approved
- [ ] Security considerations approved
- [ ] Implementation phases approved
- [ ] Open questions answered

---

## Next Steps

1. **Review this design document**
2. **Answer open questions**
3. **Approve design**
4. **Begin Phase 1 implementation**

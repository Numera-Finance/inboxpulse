# Dashboard Design Summary - Key Decisions

## Your Questions Answered

### 1. ✅ Independent Calls for Each Tile

**Decision**: **YES - Each tile makes its own independent API call**

**Architecture**:
- Each tile has its own API endpoint
- Each tile has its own React Query hook
- Each tile fetches its own data independently
- Tiles load in parallel (React Query handles this automatically)

**API Endpoints** (one per tile):
```
GET /api/analysis/dashboard/customers      → Total Customers tile
GET /api/analysis/dashboard/emails          → Emails Analyzed tile
GET /api/analysis/dashboard/escalations     → Active Escalations tile
GET /api/analysis/dashboard/upsell         → Upsell Opportunities tile
GET /api/analysis/dashboard/sentiment       → Sentiment Chart
GET /api/analysis/dashboard/turnaround      → Turnaround Chart
```

**Benefits**:
- ✅ Progressive loading (tiles appear as data arrives)
- ✅ Error isolation (one tile failing doesn't break others)
- ✅ Independent caching per metric
- ✅ Independent retry logic
- ✅ Can optimize each endpoint separately

**Example Tile Implementation**:
```typescript
// Each tile is self-contained
export function TotalCustomersTile({ filters }: DashboardTileProps) {
  // Tile fetches its own data
  const { data, isLoading, error, refetch } = useDashboardCustomers(filters);
  
  // Tile handles its own loading/error states
  if (isLoading) return <StatCardSkeleton />;
  if (error) return <StatCardError error={error} onRetry={refetch} />;
  
  return <StatCard title="Total Customers" value={data?.count} ... />;
}
```

---

### 2. ✅ Grid Layout Tool

**Decision**: **react-grid-layout** (https://react-grid-layout.github.io/react-grid-layout/)

**Why react-grid-layout?**:
- ✅ Drag and drop tiles (better UX)
- ✅ Resizable tiles (users can customize)
- ✅ Save user preferences (localStorage or backend)
- ✅ Responsive layouts (different layouts per breakpoint)
- ✅ Industry standard for dashboards
- ✅ Professional dashboard feel

**Implementation**:
```typescript
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-grid-resizable/css/styles.css';

// Dashboard page uses react-grid-layout
<GridLayout
  className="layout"
  layout={tileLayouts}  // Array of { i: 'tile-id', x: 0, y: 0, w: 3, h: 2 }
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

**Tile Registration** (with default layout):
```typescript
registerTile({
  id: 'total-customers',
  component: TotalCustomersTile,
  defaultLayout: {
    x: 0,  // Column 0
    y: 0,  // Row 0
    w: 3,  // 3 columns wide (out of 12)
    h: 2,  // 2 rows tall
  },
  minW: 2,
  minH: 2,
  maxW: 6,
  order: 1,
});
```

**Layout Persistence**:
```typescript
// Save user's custom layout
const saveLayout = (layouts: Layout[]) => {
  localStorage.setItem('dashboard-layout', JSON.stringify(layouts));
  // Or save to backend: await api.saveDashboardLayout(layouts);
};
```

**Features**:
- Drag tiles to rearrange
- Resize tiles by dragging corners
- Responsive layouts (lg, md, sm, xs breakpoints)
- Save preferences per user

---

### 3. ✅ Self-Contained Tiles

**Decision**: **YES - Each tile knows how to fetch its own data and render**

**Architecture**:
- Each tile component receives `filters` as prop
- Each tile uses its own hook to fetch data
- Each tile manages its own loading state
- Each tile manages its own error state
- Each tile renders independently

**Tile Component Structure**:
```typescript
interface DashboardTileProps {
  filters: DashboardFilter  // Only prop needed
}

// Example: Total Customers Tile
export function TotalCustomersTile({ filters }: DashboardTileProps) {
  // 1. Fetch data using tile-specific hook
  const { data, isLoading, error, refetch } = useDashboardCustomers(filters);
  
  // 2. Handle loading state
  if (isLoading) {
    return <StatCardSkeleton />;
  }
  
  // 3. Handle error state
  if (error) {
    return <StatCardError error={error} onRetry={refetch} />;
  }
  
  // 4. Render with data
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

**Hook Structure** (one per tile):
```typescript
// apps/web/lib/hooks/use-dashboard.ts

export function useDashboardCustomers(filters: DashboardFilter) {
  return useQuery({
    queryKey: ['dashboard', 'customers', filters],
    queryFn: () => api.getDashboardCustomers(filters),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDashboardEmails(filters: DashboardFilter) {
  return useQuery({
    queryKey: ['dashboard', 'emails', filters],
    queryFn: () => api.getDashboardEmails(filters),
    staleTime: 5 * 60 * 1000,
  });
}

// ... one hook per tile
```

**Dashboard Page** (minimal - just renders tiles):
```typescript
export default function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilter>({});
  
  // Get tiles from registry
  const tiles = getTiles();
  
  return (
    <AppShell>
      <DashboardFilters filters={filters} onFiltersChange={setFilters} />
      
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        {tiles.map(tile => (
          <div key={tile.id} className={tile.gridCols}>
            {/* Tile receives filters and handles everything else */}
            <tile.component filters={filters} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
```

**Benefits of Self-Contained Tiles**:
- ✅ Separation of concerns (each tile is independent)
- ✅ Easy to test (test each tile in isolation)
- ✅ Easy to add new tiles (just create component + hook + endpoint)
- ✅ Progressive loading (tiles appear as data arrives)
- ✅ Error isolation (one tile failing doesn't affect others)
- ✅ Independent optimization (can optimize each tile separately)

---

## Complete Architecture Flow

```
Dashboard Page
    │
    ├─> DashboardFilters (manages filter state)
    │   └─> Updates filters → All tiles receive new filters
    │
    └─> Tile Registry (provides list of tiles)
        └─> Renders each tile
            │
            ├─> TotalCustomersTile
            │   ├─> useDashboardCustomers(filters)
            │   │   └─> GET /api/analysis/dashboard/customers
            │   └─> Renders StatCard
            │
            ├─> EmailsAnalyzedTile
            │   ├─> useDashboardEmails(filters)
            │   │   └─> GET /api/analysis/dashboard/emails
            │   └─> Renders StatCard
            │
            ├─> ActiveEscalationsTile
            │   ├─> useDashboardEscalations(filters)
            │   │   └─> GET /api/analysis/dashboard/escalations
            │   └─> Renders StatCard
            │
            ├─> UpsellOpportunitiesTile
            │   ├─> useDashboardUpsell(filters)
            │   │   └─> GET /api/analysis/dashboard/upsell
            │   └─> Renders StatCard
            │
            ├─> SentimentChartTile
            │   ├─> useDashboardSentiment(filters)
            │   │   └─> GET /api/analysis/dashboard/sentiment
            │   └─> Renders SentimentChart
            │
            └─> TurnaroundChartTile
                ├─> useDashboardTurnaround(filters)
                │   └─> GET /api/analysis/dashboard/turnaround
                └─> Renders TurnaroundChart
```

**Key Points**:
1. Dashboard page is minimal - just renders filters and tiles
2. Each tile is completely self-contained
3. All API calls happen in parallel (React Query)
4. Each tile handles its own loading/error states
5. Filters propagate to all tiles automatically

---

## Adding a New Tile (Example)

**Step 1**: Create API endpoint
```typescript
// apps/api/src/analysis/routes.ts
app.get('/dashboard/new-metric', async (c) => {
  const filters = parseFilters(c.req.query());
  const data = await dashboardService.getNewMetric(requestHeader, filters);
  return c.json(data);
});
```

**Step 2**: Create hook
```typescript
// apps/web/lib/hooks/use-dashboard.ts
export function useDashboardNewMetric(filters: DashboardFilter) {
  return useQuery({
    queryKey: ['dashboard', 'new-metric', filters],
    queryFn: () => api.getDashboardNewMetric(filters),
  });
}
```

**Step 3**: Create tile component
```typescript
// apps/web/components/dashboard/tiles/new-metric-tile.tsx
export function NewMetricTile({ filters }: DashboardTileProps) {
  const { data, isLoading, error } = useDashboardNewMetric(filters);
  
  if (isLoading) return <StatCardSkeleton />;
  if (error) return <StatCardError error={error} />;
  
  return <StatCard title="New Metric" value={data?.count} ... />;
}
```

**Step 4**: Register tile
```typescript
// apps/web/components/dashboard/tile-registry.ts
registerTile({
  id: 'new-metric',
  component: NewMetricTile,
  gridCols: "md:col-span-2",  // Optional: span 2 columns
  order: 5,
});
```

**Done!** Tile automatically appears in dashboard with no changes to dashboard page.

---

## Summary

✅ **Independent Calls**: Each tile has its own endpoint and hook
✅ **Grid Layout**: react-grid-layout (drag & drop, resizable, customizable)
✅ **Self-Contained Tiles**: Each tile fetches its own data and renders independently

**Result**: Highly scalable, maintainable, performant, and user-customizable dashboard architecture.

**Dependencies to Add**:
```bash
pnpm add react-grid-layout @types/react-grid-layout
```

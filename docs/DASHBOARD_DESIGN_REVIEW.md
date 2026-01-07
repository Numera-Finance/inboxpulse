# Dashboard Design Plan Review

## Overall Assessment
The design plan is **solid and well-structured**. It follows existing patterns in the codebase and addresses scalability concerns. Below are detailed reviews and recommendations.

## ✅ Strengths

1. **Consistent with Existing Patterns**: The `DashboardFilters` component follows the same pattern as `TaskFilters`, ensuring consistency across the codebase.

2. **Proper Scoping**: Filter scoping correctly leverages existing customer/user access control mechanisms.

3. **URL State Management**: Using URL params for filter state enables bookmarking and sharing, which is excellent UX.

4. **Scalable Architecture**: The tile registry pattern is a good approach for extensibility.

## 🔍 Detailed Review & Recommendations

### 1. Dashboard Filters Component ✅
**Status**: Design is good, minor improvements suggested

**Recommendations**:
- ✅ Use `CustomerAutocomplete` component (already scoped)
- ✅ Use `UserAutocomplete` component (can use `useAssignableUsers` or `useUsers` with scoping)
- ✅ Date range picker using existing calendar component
- ⚠️ **Consider**: Default date range to "Last 30 days" on initial load (not just empty)
- ⚠️ **Consider**: Add "Quick Filters" (Today, Last 7 days, Last 30 days, Last 90 days, Custom)

**Implementation Notes**:
- Follow the same pattern as `TaskFilters` for consistency
- Ensure filters sync with URL params for bookmarking
- Add debouncing for filter changes (500ms) to avoid excessive API calls

### 2. API Endpoints & Service Layer ⚠️
**Status**: Needs refinement based on existing codebase structure

**Current State Analysis**:
- ✅ Email analysis data exists in `email_analyses` table with sentiment data
- ✅ Task data exists in `tasks` table
- ✅ Customer/user scoping already implemented
- ⚠️ **No existing `analysis` module** - need to decide: create new module or extend existing?

**Recommendations**:

**Option A: Create New `analysis` Module** (Recommended)
```
apps/api/src/analysis/
├── dashboard-service.ts
├── dashboard-repository.ts
├── routes.ts
└── schema.ts (if needed for dashboard-specific aggregations)
```

**Option B: Extend Existing Modules**
- Add dashboard endpoints to `apps/api/src/emails/routes.ts`
- Add dashboard methods to `EmailRepository` and `TaskRepository`
- **Pros**: Reuses existing code
- **Cons**: Mixes concerns, harder to maintain

**Recommendation**: **Option A** - Create dedicated `analysis` module for:
- Better separation of concerns
- Easier to maintain dashboard-specific logic
- Can aggregate from multiple sources (emails, tasks, customers) cleanly

**API Endpoint Design**:
```typescript
// Single aggregated endpoint (better performance)
GET /api/analysis/dashboard
Query params:
  - customerId?: string
  - userId?: string
  - dateFrom?: ISO date string
  - dateTo?: ISO date string

Response:
{
  stats: {
    totalCustomers: number
    emailsAnalyzed: number
    activeEscalations: number
    upsellOpportunities: number
    // ... other stats
  },
  sentiment: {
    positive: number
    neutral: number
    negative: number
  },
  turnaround: Array<{
    userId: string
    userName: string
    avgHours: number
  }>
}
```

**Alternative**: Separate endpoints (if data sources are independent)
- `GET /api/analysis/dashboard/stats`
- `GET /api/analysis/dashboard/sentiment`
- `GET /api/analysis/dashboard/turnaround`

**Recommendation**: **Single endpoint** - Better performance (one query), atomic updates, simpler caching.

### 3. Data Sources & Aggregation Logic 📊

**Stat Cards Data Sources**:

1. **Total Customers**
   - Source: `customers` table
   - Filter: Scoped by user's accessible customers
   - Query: `COUNT(DISTINCT customers.id) WHERE tenant_id = ? AND (customer_id IN user_customers OR is_admin)`

2. **Emails Analyzed**
   - Source: `emails` table + `email_analyses` table
   - Filter: By date range, customer, user (via email participants)
   - Query: `COUNT(DISTINCT emails.id) WHERE analysis_status = 'completed' AND date_range AND customer_id IN (...)`

3. **Active Escalations**
   - Source: `tasks` table
   - Filter: By status = 'open', customer, assigned user, date range
   - Query: `COUNT(*) WHERE status = 0 AND date_range AND customer_id IN (...) AND assigned_to_id IN (...)`

4. **Upsell Opportunities**
   - Source: `email_analyses` table
   - Filter: By analysis_type = 'upsell', detected = true, date range, customer
   - Query: `COUNT(*) WHERE analysis_type = 'upsell' AND detected = true AND date_range AND customer_id IN (...)`

**Sentiment Distribution**:
- Source: `email_analyses` table
- Filter: By analysis_type = 'sentiment', date range, customer, user
- Query: `SELECT sentiment_value, COUNT(*) FROM email_analyses WHERE analysis_type = 'sentiment' AND date_range GROUP BY sentiment_value`

**Turnaround Metrics**:
- Source: `tasks` table
- Filter: By status = 'done', date range, customer, user
- Query: Calculate `AVG(done_at - created_at)` grouped by `assigned_to_id`
- **Note**: Need to ensure `done_at` is populated when task is marked done

### 4. Scalable Tile System 🎯
**Status**: Good concept, needs refinement

**Current Design Issues**:
- Grid span system (`sm`, `md`, `lg`, `xl`) might be too rigid
- Order-based system could conflict with responsive design

**Improved Design**:
```typescript
interface DashboardTile {
  id: string
  component: React.ComponentType<DashboardTileProps>
  // Responsive grid columns (Tailwind-like)
  gridCols?: {
    default?: number  // Default: 1
    sm?: number       // sm breakpoint
    md?: number       // md breakpoint
    lg?: number       // lg breakpoint
    xl?: number       // xl breakpoint
  }
  order?: number      // Display order (lower = first)
  enabled?: boolean   // Can be disabled via config
}

// Example:
{
  id: 'total-customers',
  component: TotalCustomersTile,
  gridCols: { default: 1, md: 2, lg: 3 }, // Takes 1 col on mobile, 2 on md, 3 on lg
  order: 1
}
```

**Tile Registry Implementation**:
```typescript
// apps/web/components/dashboard/tile-registry.ts
const tileRegistry = new Map<string, DashboardTile>();

export function registerTile(tile: DashboardTile) {
  tileRegistry.set(tile.id, tile);
}

export function getTiles(): DashboardTile[] {
  return Array.from(tileRegistry.values())
    .filter(t => t.enabled !== false)
    .sort((a, b) => (a.order || 999) - (b.order || 999));
}

// Register tiles
registerTile({
  id: 'total-customers',
  component: TotalCustomersTile,
  gridCols: { default: 1, md: 2, lg: 3 },
  order: 1
});
```

**Benefits**:
- Easy to add/remove tiles
- Responsive by default
- Can be configured per environment
- Supports feature flags

### 5. Stat Card Enhancement 📈
**Status**: Good, add loading/error states

**Enhanced Interface**:
```typescript
interface StatCardProps {
  title: string
  value: string | number
  change?: string  // Make optional
  icon: LucideIcon
  trend?: "up" | "down" | "neutral"
  isLoading?: boolean
  error?: Error | null
  // Optional: Calculate trend automatically
  previousValue?: number
  trendPeriod?: string  // e.g., "vs last month"
}
```

**Loading State**: Use skeleton loader (shadcn/ui has Skeleton component)

**Error State**: Show error message or fallback value

### 6. Performance Considerations ⚡

**Current Plan Issues**:
- No mention of query optimization
- No mention of caching strategy
- No mention of data refresh intervals

**Recommendations**:

1. **Query Optimization**:
   - Use database indexes (already exist on `email_analyses.analysis_type`, `email_analyses.sentiment_value`)
   - Use materialized views for expensive aggregations (if needed)
   - Batch multiple stats in single query when possible

2. **Caching Strategy**:
   ```typescript
   // React Query config
   staleTime: 5 * 60 * 1000,  // 5 minutes
   gcTime: 10 * 60 * 1000,    // 10 minutes
   refetchOnWindowFocus: false, // Don't refetch on tab switch
   refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
   ```

3. **Debouncing Filters**:
   - Debounce filter changes by 500ms
   - Cancel pending requests when filters change
   - Use React Query's `enabled` option to prevent queries until filters are stable

4. **Parallel vs Sequential**:
   - If using separate endpoints: Fetch in parallel with `Promise.all`
   - If using single endpoint: One query is better

### 7. Security & Scoping 🔒

**Current Plan**: ✅ Good - mentions scoping and tenant isolation

**Additional Considerations**:

1. **User Filter Scoping**:
   - Use `useAssignableUsers` hook (already scoped to subordinates)
   - Or use `useUsers` with proper filtering
   - **Question**: Should dashboard show data for all users or only subordinates?
   - **Recommendation**: Only subordinates (consistent with tasks)

2. **Customer Filter Scoping**:
   - `CustomerAutocomplete` already scoped via existing logic
   - ✅ Good

3. **Date Range Validation**:
   - Validate date range (max 1 year?)
   - Prevent future dates
   - Handle timezone correctly (use UTC)

### 8. Missing Considerations ⚠️

1. **Default Date Range**:
   - Should default to "Last 30 days" on initial load
   - Add quick filter buttons (Today, Last 7 days, Last 30 days, Last 90 days)

2. **Empty States**:
   - What to show when no data for selected filters?
   - Empty state messages for each tile/chart

3. **Error Handling**:
   - Per-tile error boundaries
   - Retry logic for failed queries
   - Error messages for users

4. **Loading States**:
   - Skeleton loaders for tiles
   - Loading indicators for charts
   - Progressive loading (show tiles as data arrives)

5. **Data Refresh**:
   - Manual refresh button
   - Auto-refresh interval (configurable)
   - Last updated timestamp

6. **Export/Sharing**:
   - Export dashboard as PDF/image
   - Share dashboard URL with filters
   - Print-friendly view

## Revised Implementation Plan

### Phase 1: Filters & State Management (Week 1)
1. ✅ Create `DashboardFilters` component
2. ✅ Add filter state management (URL params)
3. ✅ Integrate CustomerAutocomplete and UserAutocomplete
4. ✅ Add date range picker with quick filters
5. ✅ Add default date range (Last 30 days)
6. ✅ Add debouncing (500ms)

### Phase 2: API Layer (Week 1-2)
1. ✅ Create `apps/api/src/analysis/` module
2. ✅ Create `DashboardRepository` (aggregation queries)
3. ✅ Create `DashboardService` (business logic)
4. ✅ Create API routes (`/api/analysis/dashboard`)
5. ✅ Add request validation (Zod schemas)
6. ✅ Add error handling and logging

### Phase 3: Frontend Integration (Week 2)
1. ✅ Create `useDashboard` hook
2. ✅ Update dashboard page to use hooks
3. ✅ Add loading states (skeletons)
4. ✅ Add error states
5. ✅ Remove "Avg Turnaround Time" and "Premier Accounts" tiles
6. ✅ Update grid layout (4 columns instead of 3)

### Phase 4: Tile System (Week 2-3)
1. ✅ Create tile registry
2. ✅ Refactor existing tiles to use registry
3. ✅ Add responsive grid system
4. ✅ Add tile configuration (enable/disable)

### Phase 5: Charts Integration (Week 3)
1. ✅ Connect SentimentChart to real data
2. ✅ Connect TurnaroundChart to real data
3. ✅ Add loading/error states for charts
4. ✅ Add empty states

### Phase 6: Polish & Optimization (Week 3-4)
1. ✅ Add manual refresh button
2. ✅ Add auto-refresh (configurable)
3. ✅ Add last updated timestamp
4. ✅ Optimize queries (indexes, caching)
5. ✅ Add error boundaries
6. ✅ Add export/share functionality (optional)

## File Structure (Revised)

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
│       ├── tile-registry.ts (NEW)
│       └── tiles/
│           ├── total-customers-tile.tsx (NEW - extracted from StatCard)
│           ├── emails-analyzed-tile.tsx (NEW)
│           ├── active-escalations-tile.tsx (NEW)
│           └── upsell-opportunities-tile.tsx (NEW)
└── lib/
    └── hooks/
        └── use-dashboard.ts (NEW)

apps/api/
└── src/
    └── analysis/
        ├── dashboard-service.ts (NEW)
        ├── dashboard-repository.ts (NEW)
        ├── routes.ts (NEW)
        └── schema.ts (NEW - Zod schemas for requests/responses)
```

## Key Decisions Needed

1. **API Structure**: Single endpoint vs multiple endpoints?
   - **Recommendation**: Single endpoint for better performance

2. **User Filter Scope**: All users or only subordinates?
   - **Recommendation**: Only subordinates (consistent with tasks)

3. **Default Date Range**: Empty or "Last 30 days"?
   - **Recommendation**: "Last 30 days" for better UX

4. **Tile System**: Registry pattern or simple array?
   - **Recommendation**: Registry pattern for extensibility

5. **Data Refresh**: Auto-refresh interval?
   - **Recommendation**: 5 minutes (configurable)

## Potential Issues & Solutions

1. **Issue**: Turnaround metrics require `done_at` timestamp
   - **Solution**: Ensure `TaskService.markDone` sets `doneAt` timestamp

2. **Issue**: Sentiment data might be sparse
   - **Solution**: Show "No data" state, don't break dashboard

3. **Issue**: Large date ranges might be slow
   - **Solution**: Limit max date range (e.g., 1 year), add query timeouts

4. **Issue**: Multiple tiles fetching same data
   - **Solution**: Use single endpoint or React Query's query deduplication

## Conclusion

The design plan is **solid** with minor improvements needed:
- ✅ Good architecture and patterns
- ✅ Proper scoping and security considerations
- ⚠️ Needs refinement on API structure (single vs multiple endpoints)
- ⚠️ Needs default date range and quick filters
- ⚠️ Needs better error/loading state handling
- ⚠️ Tile system needs responsive grid design

**Overall Grade**: A- (Excellent with minor improvements)

**Recommendation**: Proceed with implementation using the revised plan above.

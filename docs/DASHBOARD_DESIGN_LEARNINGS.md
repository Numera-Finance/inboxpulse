# Dashboard Design - Key Learnings from Plan Review

## Overview
After reviewing `/Users/manishbalsara/.claude/plans/dashboard-data-integration.md`, here are the key improvements incorporated into our design:

---

## 1. ✅ Responsive Grid Layout (CRITICAL)

**Learning**: Use `Responsive` component with `WidthProvider`, not basic `GridLayout`

**Why**: 
- Automatically handles responsive breakpoints
- Different layouts per screen size (lg, md, sm, xs)
- Better mobile experience

**Implementation**:
```typescript
import { Responsive, WidthProvider } from 'react-grid-layout';
const ResponsiveGridLayout = WidthProvider(Responsive);

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 4, md: 3, sm: 2, xs: 1, xxs: 1 };

<ResponsiveGridLayout
  layouts={layouts}  // Object with lg, md, sm, xs layouts
  breakpoints={BREAKPOINTS}
  cols={COLS}
  rowHeight={150}
/>
```

---

## 2. ✅ Tile Wrapper with Drag Handle

**Learning**: Add a `TileWrapper` component with a drag handle

**Why**:
- Better UX (clear drag affordance)
- Prevents accidental drags on tile content
- Consistent tile header styling

**Implementation**:
```typescript
<div className="tile-drag-handle flex items-center justify-between p-3 border-b cursor-move">
  <span className="text-sm font-medium">{title}</span>
  <GripVertical className="h-4 w-4 text-muted-foreground" />
</div>
```

**Usage**:
```typescript
<ResponsiveGridLayout draggableHandle=".tile-drag-handle" />
```

---

## 3. ✅ URL-Synced Filters

**Learning**: Sync filters to URL params for shareability

**Why**:
- Shareable dashboard URLs
- Browser back/forward support
- Bookmarkable filter states

**Implementation**:
```typescript
const [searchParams, setSearchParams] = useSearchParams();

const filters = useMemo(() => ({
  customerId: searchParams.get('customer') || undefined,
  userId: searchParams.get('user') || undefined,
  dateFrom: searchParams.get('from') || subDays(new Date(), 30).toISOString(),
  dateTo: searchParams.get('to') || new Date().toISOString(),
}), [searchParams]);
```

**URL Format**: `?customer=<id>&user=<id>&from=<iso>&to=<iso>`

---

## 4. ✅ Reuse Existing APIs Where Possible

**Learning**: Don't create new endpoints unnecessarily - reuse existing APIs with `limit: 0` for counts

**Why**:
- Faster implementation
- Less code to maintain
- Consistent with existing patterns

**Examples**:
```typescript
// ✅ Reuse customer search API
const result = await customerClient.search({ limit: 0 });
return { count: result.total };

// ✅ Reuse task search API
const result = await taskClient.search({ status: 'open', limit: 0 });
return { count: result.total };

// ❌ Only create new endpoints for missing aggregations
// e.g., GET /api/emails/count (if doesn't exist)
// e.g., GET /api/emails/sentiment-stats (if doesn't exist)
```

---

## 5. ✅ Layout Persistence Hook Pattern

**Learning**: Create a dedicated hook for layout persistence with reset functionality

**Why**:
- Clean separation of concerns
- Easy to swap localStorage for backend API later
- Reset functionality for user convenience

**Implementation**:
```typescript
const STORAGE_KEY = 'dashboard-layout';

export function useDashboardLayout() {
  const [layouts, setLayouts] = useState<Layouts>(() => {
    if (typeof window === 'undefined') return DEFAULT_LAYOUTS;
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_LAYOUTS;
  });

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

## 6. ✅ CSS Styling for Grid

**Learning**: Add CSS for grid transitions, drag states, and placeholder

**Why**:
- Smooth animations
- Visual feedback during drag
- Better UX

**CSS**:
```css
.react-grid-item {
  transition: all 200ms ease;
  transition-property: left, top;
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
```

---

## 7. ✅ Default Layouts Per Breakpoint

**Learning**: Define default layouts for each breakpoint (lg, md, sm, xs)

**Why**:
- Better mobile experience
- Optimized layouts per screen size
- Fallback if user hasn't customized

**Implementation**:
```typescript
const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: 'customers', x: 0, y: 0, w: 1, h: 1 },
    { i: 'emails', x: 1, y: 0, w: 1, h: 1 },
    // ... 4-column layout
  ],
  md: [
    // ... 3-column layout
  ],
  sm: [
    // ... 2-column layout
  ],
  xs: [
    // ... 1-column stacked layout
  ],
};
```

---

## 8. ✅ StaleTime Optimization

**Learning**: Use shorter staleTime (30s-60s) instead of 5 minutes

**Why**:
- More responsive to data changes
- Still benefits from caching
- Better balance for dashboard metrics

**Implementation**:
```typescript
staleTime: 60_000,  // 1 minute for most tiles
staleTime: 30_000,  // 30 seconds for dynamic tiles (escalations)
```

---

## 9. ✅ Reset Layout Button

**Learning**: Include a "Reset Layout" button in the UI

**Why**:
- User convenience
- Easy way to restore defaults
- Good UX pattern

**Implementation**:
```typescript
<Button variant="ghost" size="sm" onClick={resetLayout}>
  <RotateCcw className="h-4 w-4 mr-1" />
  Reset Layout
</Button>
```

---

## 10. ✅ Tile Registry with Default Layouts

**Learning**: Include default layout in tile registry definition

**Why**:
- Single source of truth
- Easy to add new tiles
- Automatic layout generation

**Implementation**:
```typescript
interface TileDefinition {
  id: string;
  component: React.ComponentType<TileProps>;
  defaultLayout: { w: number; h: number; minW?: number; minH?: number };
  category: 'stat' | 'chart';
}
```

---

## Summary of Changes Made

✅ **Updated**: Grid layout to use `Responsive` component
✅ **Added**: Tile wrapper with drag handle
✅ **Added**: URL-synced filters
✅ **Updated**: Hook implementations to reuse existing APIs
✅ **Added**: Layout persistence hook with reset
✅ **Added**: CSS styling for grid
✅ **Added**: Default layouts per breakpoint
✅ **Updated**: StaleTime to 30s-60s
✅ **Added**: Reset layout button
✅ **Updated**: Tile registry to include default layouts

---

## Implementation Priority

1. **Phase 1**: Grid setup (ResponsiveGridLayout, layout hook)
2. **Phase 2**: Filter infrastructure (URL sync)
3. **Phase 3**: Tile components (with wrapper)
4. **Phase 4**: API endpoints (only new ones needed)
5. **Phase 5**: Polish (CSS, reset button, responsive layouts)

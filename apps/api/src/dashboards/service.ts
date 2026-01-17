import { injectable, inject } from 'tsyringe';
import { DashboardRepository } from './repository';
import type { RequestHeader } from '@crm/shared';
import type { DashboardLayoutConfig } from './schema';

// =============================================================================
// Default Dashboard Layout Configuration
// =============================================================================

// Tile definitions with their default sizes
const TILE_DEFINITIONS = [
  // Stat tiles (1x1)
  { id: 'customers', w: 1, h: 1, minW: 1, minH: 1 },
  { id: 'emails', w: 1, h: 1, minW: 1, minH: 1 },
  { id: 'escalations', w: 1, h: 1, minW: 1, minH: 1 },
  { id: 'opportunities', w: 1, h: 1, minW: 1, minH: 1 },
  // Chart tiles (2x2)
  { id: 'sentiment', w: 2, h: 2, minW: 2, minH: 2 },
  { id: 'sentiment-trend', w: 2, h: 2, minW: 2, minH: 2 },
  { id: 'email-volume', w: 2, h: 2, minW: 2, minH: 2 },
  { id: 'escalations-table', w: 2, h: 2, minW: 2, minH: 2 },
  { id: 'tat-metrics', w: 2, h: 2, minW: 2, minH: 2 },
];

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 };
const COLS = { lg: 4, md: 3, sm: 2, xs: 1 };

/**
 * Generate layout for a given breakpoint
 */
function generateLayoutForBreakpoint(cols: number): DashboardLayoutConfig[string] {
  const layouts: DashboardLayoutConfig[string] = [];
  let currentX = 0;
  let currentY = 0;
  let maxHeightInRow = 0;

  for (const tile of TILE_DEFINITIONS) {
    const effectiveW = Math.min(tile.w, cols);
    const effectiveMinW = tile.minW ? Math.min(tile.minW, cols) : undefined;

    // Check if tile fits in current row
    if (currentX + effectiveW > cols) {
      currentX = 0;
      currentY += maxHeightInRow;
      maxHeightInRow = 0;
    }

    layouts.push({
      i: tile.id,
      x: currentX,
      y: currentY,
      w: effectiveW,
      h: tile.h,
      minW: effectiveMinW,
      minH: tile.minH,
    });

    currentX += effectiveW;
    maxHeightInRow = Math.max(maxHeightInRow, tile.h);
  }

  return layouts;
}

/**
 * Generate default layouts for all breakpoints
 */
function generateDefaultLayouts(): DashboardLayoutConfig {
  return {
    lg: generateLayoutForBreakpoint(COLS.lg),
    md: generateLayoutForBreakpoint(COLS.md),
    sm: generateLayoutForBreakpoint(COLS.sm),
    xs: generateLayoutForBreakpoint(COLS.xs),
  };
}

/**
 * Merge saved layout with tile definitions:
 * - Add any new tiles that aren't in the saved layout
 * - Update minW/minH for existing tiles to match current definitions
 * - Update w/h for existing tiles if they're smaller than minW/minH
 */
function mergeMissingTiles(savedConfig: DashboardLayoutConfig): DashboardLayoutConfig {
  const tileDefMap = new Map(TILE_DEFINITIONS.map(t => [t.id, t]));
  const result: DashboardLayoutConfig = {};

  for (const [breakpoint, savedLayout] of Object.entries(savedConfig)) {
    const cols = COLS[breakpoint as keyof typeof COLS] || 4;
    const existingIds = new Set(savedLayout.map(l => l.i));

    // Update existing tiles with current minW/minH and enforce minimum sizes
    const updatedLayout = savedLayout.map(layout => {
      const tileDef = tileDefMap.get(layout.i);
      if (tileDef) {
        const minW = tileDef.minW ? Math.min(tileDef.minW, cols) : undefined;
        const minH = tileDef.minH;
        return {
          ...layout,
          minW,
          minH,
          // Enforce minimum dimensions
          w: minW && layout.w < minW ? minW : layout.w,
          h: minH && layout.h < minH ? minH : layout.h,
        };
      }
      return layout;
    });

    // Find max Y position to place new tiles below existing ones
    let maxY = 0;
    for (const layout of updatedLayout) {
      maxY = Math.max(maxY, layout.y + layout.h);
    }

    // Add missing tiles
    let currentX = 0;
    for (const tileDef of TILE_DEFINITIONS) {
      if (!existingIds.has(tileDef.id)) {
        const w = Math.min(tileDef.w, cols);

        // Wrap to next row if needed
        if (currentX + w > cols) {
          currentX = 0;
          maxY += 2;
        }

        updatedLayout.push({
          i: tileDef.id,
          x: currentX,
          y: maxY,
          w,
          h: tileDef.h,
          minW: tileDef.minW ? Math.min(tileDef.minW, cols) : undefined,
          minH: tileDef.minH,
        });

        currentX += w;
      }
    }

    result[breakpoint] = updatedLayout;
  }

  return result;
}

@injectable()
export class DashboardService {
  constructor(
    @inject(DashboardRepository) private dashboardRepo: DashboardRepository
  ) {}

  /**
   * Get dashboard config for the current user
   * Creates default config lazily if none exists
   * Merges in any new tiles that aren't in the saved layout
   */
  async getConfig(requestHeader: RequestHeader): Promise<DashboardLayoutConfig> {
    const config = await this.dashboardRepo.findByUser(requestHeader.tenantId, requestHeader.userId);

    if (config) {
      // Merge any new tiles that aren't in the saved layout
      return mergeMissingTiles(config);
    }

    // Create default config lazily
    const defaultConfig = generateDefaultLayouts();
    await this.dashboardRepo.upsert(
      requestHeader.tenantId,
      requestHeader.userId,
      defaultConfig
    );

    return defaultConfig;
  }

  /**
   * Save dashboard config for the current user
   */
  async saveConfig(
    requestHeader: RequestHeader,
    config: DashboardLayoutConfig
  ): Promise<void> {
    await this.dashboardRepo.upsert(
      requestHeader.tenantId,
      requestHeader.userId,
      config
    );
  }

  /**
   * Reset dashboard config to default
   */
  async resetConfig(requestHeader: RequestHeader): Promise<DashboardLayoutConfig> {
    // Delete existing config
    await this.dashboardRepo.delete(requestHeader.tenantId, requestHeader.userId);

    // Create and return default config
    const defaultConfig = generateDefaultLayouts();
    await this.dashboardRepo.upsert(
      requestHeader.tenantId,
      requestHeader.userId,
      defaultConfig
    );

    return defaultConfig;
  }
}

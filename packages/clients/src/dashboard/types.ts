/**
 * Dashboard layout item (react-grid-layout format)
 */
export interface DashboardLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}

/**
 * Dashboard layout config (keyed by breakpoint)
 */
export interface DashboardLayoutConfig {
  [breakpoint: string]: DashboardLayoutItem[];
}

/**
 * Response from GET /api/dashboards/config
 */
export interface DashboardConfigResponse {
  config: DashboardLayoutConfig | null;
}

/**
 * Request for PUT /api/dashboards/config
 */
export interface SaveDashboardConfigRequest {
  config: DashboardLayoutConfig;
}

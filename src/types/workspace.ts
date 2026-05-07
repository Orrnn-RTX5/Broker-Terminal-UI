/**
 * Workspace Data Model
 * Complete type definitions for workspace persistence
 */

// Drawing Object Types
export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingStyle {
  color: string;
  lineWidth: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  fillOpacity?: number;
}

export interface DrawingObject {
  id: string;
  type: 'TREND_LINE' | 'HORIZONTAL_LINE' | 'VERTICAL_LINE' | 'FIBONACCI' |
        'SUPPORT_RESISTANCE' | 'CHANNEL' | 'RECTANGLE' | 'TRIANGLE' | 'TEXT_NOTE';
  points: DrawingPoint[];
  style: DrawingStyle;
  locked: boolean;
  visible: boolean;
  text?: string; // For text notes
  zIndex?: number;
}

// Indicator Configuration
export interface IndicatorConfig {
  id: string;
  name: string;
  type: 'OVERLAY' | 'OSCILLATOR' | 'VOLUME';
  parameters: Record<string, number | string | boolean>;
  visible: boolean;
  style: {
    colors: string[];
    lineWidth: number;
    opacity?: number;
  };
  paneIndex?: number; // For oscillators in separate panes
}

// Chart Settings
export interface ChartSettings {
  showGrid: boolean;
  showVolume: boolean;
  showCrosshair: boolean;
  priceScale: 'AUTO' | 'LOGARITHMIC' | 'PERCENTAGE';
  backgroundColor: string;
  gridColor: string;
  textColor: string;
  candleUpColor: string;
  candleDownColor: string;
  wickColor: string;
  showLegend: boolean;
  showTimescale: boolean;
  timezone: string;
}

// Chart State
export interface ChartState {
  id: string;
  symbol: string;
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
  chartType: 'candlestick' | 'line' | 'area' | 'bars' | 'heikin-ashi';
  indicators: IndicatorConfig[];
  drawings: DrawingObject[];
  settings: ChartSettings;
  priceRange?: {
    min: number;
    max: number;
  };
  timeRange?: {
    from: number;
    to: number;
  };
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Layout Configuration
export interface WindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
}

export interface PanelVisibility {
  visible: boolean;
  collapsed: boolean;
  width?: number;
  height?: number;
}

export interface LayoutConfig {
  version: string;
  theme: 'dark' | 'light';
  panels: {
    marketWatch: PanelVisibility & { width: number };
    orderBook: PanelVisibility & { width: number };
    timeSales: PanelVisibility & { width: number };
    orderEntry: PanelVisibility & { height: number };
    positions: PanelVisibility & { height: number };
    alerts: PanelVisibility & { height: number };
    navigator: PanelVisibility & { width: number };
    toolbars: PanelVisibility;
  };
  windows: Record<string, WindowPosition>;
  splitRatios?: {
    leftSidebar: number;
    rightSidebar: number;
    bottomPanel: number;
  };
}

// Market Watch Configuration
export interface MarketWatchColumn {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  sortable: boolean;
}

export interface MarketWatchConfig {
  symbols: string[];
  columns: MarketWatchColumn[];
  sortBy: string;
  sortDirection: 'asc' | 'desc';
  favorites: string[];
  groupBy?: 'category' | 'none';
  showSparklines: boolean;
  updateInterval: number;
}

// Order Panel Settings
export interface OrderPanelSettings {
  defaultVolume: number;
  defaultSlPips: number;
  defaultTpPips: number;
  confirmOrders: boolean;
  oneClickTrading: boolean;
  showCalculators: boolean;
  riskPercent: number;
}

// Complete Workspace
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  userId: string;
  accountId?: string;
  charts: ChartState[];
  layout: LayoutConfig;
  marketWatch: MarketWatchConfig;
  orderPanel: OrderPanelSettings;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  thumbnail?: string; // Base64 encoded screenshot
  isDefault?: boolean;
  tags?: string[];
}

// Workspace Metadata (for listing)
export interface WorkspaceMetadata {
  id: string;
  name: string;
  description?: string;
  userId: string;
  accountId?: string;
  chartCount: number;
  updatedAt: Date;
  thumbnail?: string;
  isDefault: boolean;
  tags: string[];
}

// Save/Load Operations
export interface SaveWorkspaceRequest {
  workspace: Workspace;
  overwrite?: boolean;
}

export interface SaveWorkspaceResponse {
  success: boolean;
  workspaceId: string;
  message?: string;
  conflict?: boolean;
  conflictVersion?: Workspace;
}

export interface LoadWorkspaceResponse {
  success: boolean;
  workspace: Workspace;
  message?: string;
}

export interface ListWorkspacesResponse {
  success: boolean;
  workspaces: WorkspaceMetadata[];
  message?: string;
}

export interface DeleteWorkspaceResponse {
  success: boolean;
  message?: string;
}

// Error Types
export interface WorkspaceError {
  code: 'NETWORK_ERROR' | 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'SERVER_ERROR';
  message: string;
  details?: any;
}

// Validation Result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Auto-save State
export interface AutoSaveState {
  enabled: boolean;
  interval: number; // milliseconds
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
  saving: boolean;
  error: WorkspaceError | null;
}

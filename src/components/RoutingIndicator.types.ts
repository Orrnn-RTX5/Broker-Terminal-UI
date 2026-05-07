/**
 * Type Definitions for RoutingIndicator Component
 * These can be imported separately if needed for API responses
 */

export type RoutingPath = 'ABOOK' | 'BBOOK' | 'CBOOK' | 'PARTIAL';

/**
 * Represents the routing decision made for an order
 */
export interface RoutingDecision {
  /** Which routing path the order will take */
  path: RoutingPath;

  /** Name of the liquidity provider (for ABOOK routing) */
  lpName?: string;

  /** Hedge percentage as decimal 0-1 (for PARTIAL routing) */
  hedgePercentage?: number;

  /** Explanation of why this routing was selected */
  reason: string;

  /** Confidence score 0-1 of the routing decision */
  confidence: number;

  /** Impact of this order on account exposure */
  exposureImpact: ExposureImpact;
}

/**
 * Exposure impact metrics for an order
 */
export interface ExposureImpact {
  /** Current exposure before order */
  current: number;

  /** Exposure after order is executed */
  after: number;

  /** Maximum allowed exposure for account/symbol */
  limit: number;

  /** Utilization percentage 0-100 */
  utilizationPercent: number;

  /** True if utilization >= 75% */
  isWarning: boolean;

  /** True if utilization >= 90% */
  isCritical: boolean;
}

/**
 * Props for the RoutingIndicator component
 */
export interface RoutingIndicatorProps {
  /** Trading symbol (e.g., 'EUR/USD', 'GBPUSD') */
  symbol: string;

  /** Order volume in lots (must be > 0) */
  volume: number;

  /** Account ID for routing decision */
  accountId: string | number;

  /** Order direction (default: 'BUY') */
  side?: 'BUY' | 'SELL';

  /** Additional CSS classes to apply */
  className?: string;
}

/**
 * API Request parameters for routing preview
 */
export interface RoutingPreviewRequest {
  symbol: string;
  volume: number;
  accountId: string | number;
  side: 'BUY' | 'SELL';
}

/**
 * API Response for routing preview
 */
export type RoutingPreviewResponse = RoutingDecision;

/**
 * Routing configuration for styling and labels
 */
export interface RoutingConfig {
  color: string;
  border: string;
  badge: string;
  text: string;
  icon: string;
}

/**
 * Status information for exposure level
 */
export interface ExposureStatus {
  level: 'safe' | 'warning' | 'critical';
  message: string;
}

/**
 * Internal component state for tooltip
 */
export interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

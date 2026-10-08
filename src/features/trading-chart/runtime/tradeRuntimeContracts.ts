import type { Position } from '../../../store/useAppStore';
import type { TradeSide } from '../presentation/tradeOverlayPresentation';
import type { ClosedTradeOverlaySnapshot } from '../../../services/tradeOverlayHistory';

export type TradeLevelRole = 'ENTRY' | 'SL' | 'TP';

export interface TradeLevelOverride {
  sl: number;
  tp: number;
}

export type TradeLevelModifyRequestId = number;

export interface ActiveTradeSnapshot {
  key: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  entryPrice: number;
  entryTime: number;
  entryExecutionTime: number;
  currentPrice: number;
  currentTime: number;
  sl?: number;
  tp?: number;
}

export type ClosedTradeSnapshot = ClosedTradeOverlaySnapshot;

export interface OverlayNodeData {
  kind: 'horizontal-line' | 'price-badge' | 'axis-price-badge' | 'price-hit-area' | 'segment' | 'marker';
  price?: number;
  time?: number;
  endPrice?: number;
  endTime?: number;
  markerSide?: TradeSide;
  startMarkerSide?: TradeSide;
  endMarkerSide?: TradeSide;
  markerAnchor?: 'candle' | 'price';
  pixelOffsetY?: number;
  resolveTime?: () => number | null;
  resolveEndPrice?: () => number | null;
  resolveEndTime?: () => number | null;
}

export type TradeOverlayLayer = 'active' | 'history';

export interface PriceLevelOptions {
  tradeKey?: string;
  role?: TradeLevelRole;
  badgeOffsetIndex?: number;
  title?: string;
  getTitle?: () => string;
  getLabel?: () => string;
  labelVariant?: 'badge' | 'lineText' | 'none';
  lineColor?: string;
  lineWidthPx?: number;
}

export interface EntryTradeControlOptions {
  /** The renderer supplies one shared axis label for each exact entry price. */
  showAxisPriceLine?: boolean;
}

export type TradePositionRecord = Position & {
  ticket?: string | number;
  positionId?: string | number;
  position_id?: string | number;
  instrument?: string;
  name?: string;
  volume_lots?: number;
  lots?: number;
  action?: string | number;
  type?: string | number;
  priceOpen?: number;
  priceCurrent?: number;
  price?: number;
  time_open?: string | number;
  time_ms?: string | number;
  price_sl?: number;
  stopLoss?: number;
  stop_loss?: number;
  price_tp?: number;
  takeProfit?: number;
  take_profit?: number;
  contractSize?: number;
  contract_size?: number;
};

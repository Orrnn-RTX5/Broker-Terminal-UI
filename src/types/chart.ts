/**
 * Shared chart-domain contracts.
 *
 * This module intentionally has no runtime imports. UI components, stores,
 * commands, and data services can depend on these contracts without creating
 * a dependency on the TradingChart implementation.
 */
export type ChartType = 'candlestick' | 'bar' | 'line' | 'area';

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  realVolume?: number;
  closed?: boolean;
}

export interface ChartSelectionIdentity<TTimeframe extends string = Timeframe> {
  symbol: string;
  timeframe: TTimeframe;
}

export interface ChartSelection extends ChartSelectionIdentity {
  chartType: ChartType;
}

export interface ChartSelectionPresentationKeyParts extends ChartSelectionIdentity<string> {
  sessionScope: string | number;
}

export interface ChartSelectionPresentationGate {
  selectionKey: string;
  livePaintAllowed: boolean;
}

export interface FirstLiveSelectionBaselineInput {
  gate: ChartSelectionPresentationGate;
  selectionKey: string;
  active: boolean;
  disposed: boolean;
  rebuilding: boolean;
  hasSeries: boolean;
  hasCurrentCandle: boolean;
}

export interface TradingViewChartTheme {
  background: string;
  text: string;
  axisText: string;
  gridVertical: string;
  gridHorizontal: string;
  scaleBorder: string;
  crosshair: string;
  candleUp: string;
  candleDown: string;
  barUp: string;
  barDown: string;
  wickUp: string;
  wickDown: string;
  line: string;
  areaTop: string;
  areaBottom: string;
  areaUpLine: string;
  areaUpTop: string;
  areaUpBottom: string;
  areaDownLine: string;
  areaDownTop: string;
  areaDownBottom: string;
  volumeUp: string;
  volumeDown: string;
}

export interface LivePriceOverlayColors {
  lineColor: string;
  badgeBackground: string;
  badgeTextColor: '#000000' | '#ffffff';
}

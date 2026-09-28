/**
 * Framework-neutral drawing contracts.
 *
 * Keep these definitions independent from renderers, catalogs, React, and the
 * drawing manager so geometry and UI modules can share them without importing
 * the concrete manager implementation.
 */
export type DrawingType =
  | 'trendline'
  | 'hline'
  | 'vline'
  | 'text'
  | 'channel'
  | 'fibonacci'
  | 'fib_extension'
  | 'measure'
  | 'freehand'
  | 'callout'
  | 'rectangle'
  | 'ellipse'
  | 'shapes'
  | 'stamp'
  | 'pattern';

export interface DrawingPoint {
  /** Unix timestamp in seconds; keeps the anchor attached while panning. */
  time: number;
  price: number;
  /** Retained for backwards compatibility with existing persisted drawings. */
  logicalIndex?: number;
  /** Freehand: fractional bar distance from the durable time anchor. */
  barOffset?: number;
  /** Vertical line: sub-bar pixel offset from timeToCoordinate(time). */
  pixelXOffset?: number;
}

export interface DrawingSeriesDataPoint {
  time: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  value?: number;
  volume?: number;
  tickVolume?: number;
  realVolume?: number;
}

export type ForecastingBar = DrawingSeriesDataPoint;

export type DrawingSeriesDataProvider = () => readonly DrawingSeriesDataPoint[];

export interface AnnotationStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  border?: boolean;
  textColor?: string;
  tableData?: string[][];
  cellWidth?: number;
  cellHeight?: number;
  imageUrl?: string;
  width?: number;
  height?: number;
  opacity?: number;
  url?: string;
  wrapWidth?: number;
  align?: 'left' | 'center' | 'right';
}

export type RegressionSource = 'open' | 'high' | 'low' | 'close' | 'hl2';

/** Planning inputs belong to the drawing, not to a fixed demo account. */
export interface PositionSizing {
  accountSize?: number;
  risk?: number;
  riskMode?: 'percent' | 'amount';
  pointValue?: number;
  lotSize?: number;
  leverage?: number;
  quantityPrecision?: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  subtype?: string;
  points: DrawingPoint[];
  text?: string;
  annotation?: AnnotationStyle;
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  fillOpacity?: number;
  selected?: boolean;
  locked?: boolean;
  serverId?: string;
  channelOffset?: number;
  rayLeft?: boolean;
  rayRight?: boolean;
  channelMidpointRatio?: number;
  regressionSource?: RegressionSource;
  regressionUpperDeviation?: number;
  regressionLowerDeviation?: number;
  showRegressionPearson?: boolean;
  pitchforkLevels?: number[];
  positionTargetPrice?: number;
  positionStopPrice?: number;
  positionEndTime?: number;
  positionEndLogicalIndex?: number;
  positionSizing?: PositionSizing;
  seriesSnapshot?: DrawingSeriesDataPoint[];
}

export type DrawingCollectionChangeReason =
  | 'added'
  | 'deleted'
  | 'cleared'
  | 'updated'
  | 'selection'
  | 'undo'
  | 'redo'
  | 'loaded';

export interface DrawingCollectionChangeDetail {
  contextId: string;
  symbol: string;
  timeframe: string;
  accountScope?: string;
  reason: DrawingCollectionChangeReason;
}

export interface DrawingHistoryEntry {
  action: 'add' | 'delete' | 'modify';
  drawing?: Drawing;
  oldDrawing?: Drawing;
  newDrawing?: Drawing;
}

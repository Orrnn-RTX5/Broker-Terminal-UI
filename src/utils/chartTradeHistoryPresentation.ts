export type TradeHistoryPositionSide = 'BUY' | 'SELL';
export type TradeHistoryLifecycle = 'OPEN' | 'CLOSE';

export interface TradeHistoryBadgeTextOptions {
  positionSide: TradeHistoryPositionSide;
  lifecycle: TradeHistoryLifecycle;
  ticketLabel?: string;
  price: number;
  digits: number;
  time: number;
  includeSeconds?: boolean;
}

export interface TradeHistoryGmtTimeOptions {
  includeSeconds?: boolean;
}

export interface TradeHistoryLabelPlacementOptions {
  anchorX: number;
  labelWidth: number;
  plotWidth: number;
  gap?: number;
  edgeInset?: number;
}

export type TradeHistoryLabelMaxWidthOptions = Omit<TradeHistoryLabelPlacementOptions, 'labelWidth'> & {
  minimumWidth?: number;
};

export interface TradeHistoryLabelPlacement {
  left: number;
  anchor: 'left' | 'right';
}

export interface TradeHistoryLabelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TradeHistoryLabelVerticalPlacementOptions {
  preferredCenterY: number;
  labelHeight: number;
  chartHeight: number;
  left: number;
  width: number;
  occupied: readonly TradeHistoryLabelRect[];
  edgeInset?: number;
  gap?: number;
}

export interface TradeHistoryLabelVerticalPlacement {
  centerY: number;
  lane: number;
  rect: TradeHistoryLabelRect;
}

/** Formats a Unix timestamp explicitly in GMT, independent of the device timezone. */
export const formatTradeHistoryGmtTime = (
  unixSeconds: number,
  { includeSeconds = false }: TradeHistoryGmtTimeOptions = {},
): string => {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return '';

  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return '';

  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return includeSeconds
    ? `${hours}:${minutes}:${seconds} GMT`
    : `${hours}:${minutes} GMT`;
};

export const buildTradeHistoryBadgeText = ({
  positionSide,
  lifecycle,
  ticketLabel = '',
  price,
  digits,
  time,
  includeSeconds = false,
}: TradeHistoryBadgeTextOptions): string => {
  const safeDigits = Number.isFinite(digits) ? Math.max(0, Math.min(10, Math.floor(digits))) : 2;
  const formattedPrice = Number.isFinite(price) ? price.toFixed(safeDigits) : '—';
  const formattedTime = formatTradeHistoryGmtTime(time, { includeSeconds });

  return [
    `${positionSide} ${lifecycle}`,
    ticketLabel.trim(),
    formattedPrice,
    formattedTime,
  ].filter(Boolean).join(' · ');
};

export const getTradeHistoryExecutionSide = (
  positionSide: TradeHistoryPositionSide,
  lifecycle: TradeHistoryLifecycle,
): TradeHistoryPositionSide => (
  lifecycle === 'OPEN'
    ? positionSide
    : positionSide === 'BUY' ? 'SELL' : 'BUY'
);

/** Display markers outside their candle; execution prices remain in the tooltip. */
export const getTradeHistoryMarkerPrice = (
  executionSide: TradeHistoryPositionSide,
  executionPrice: number,
  candle?: { high: number; low: number } | null,
): number => {
  const candleEdge = executionSide === 'BUY' ? candle?.low : candle?.high;
  return candleEdge != null && Number.isFinite(candleEdge) ? candleEdge : executionPrice;
};

/**
 * Places a history badge on the right of its marker when possible, otherwise
 * flips it to the left and clamps it inside the candle plot (before the scale).
 */
export const resolveTradeHistoryLabelPlacement = ({
  anchorX,
  labelWidth,
  plotWidth,
  gap = 14,
  edgeInset = 6,
}: TradeHistoryLabelPlacementOptions): TradeHistoryLabelPlacement => {
  const safePlotWidth = Math.max(0, Number.isFinite(plotWidth) ? plotWidth : 0);
  const safeLabelWidth = Math.max(0, Number.isFinite(labelWidth) ? labelWidth : 0);
  const safeAnchorX = Number.isFinite(anchorX) ? anchorX : edgeInset;
  const safeGap = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const safeInset = Math.max(0, Number.isFinite(edgeInset) ? edgeInset : 0);
  const maxLeft = Math.max(safeInset, safePlotWidth - safeInset - safeLabelWidth);
  const rightLeft = safeAnchorX + safeGap;
  const fitsOnRight = rightLeft + safeLabelWidth <= safePlotWidth - safeInset;
  const preferredLeft = fitsOnRight
    ? rightLeft
    : safeAnchorX - safeGap - safeLabelWidth;

  return {
    left: Math.min(maxLeft, Math.max(safeInset, preferredLeft)),
    anchor: fitsOnRight ? 'right' : 'left',
  };
};

/** Keeps the badge clear of its marker even when the plot is very narrow. */
export const getTradeHistoryLabelMaxWidth = ({
  anchorX,
  plotWidth,
  gap = 14,
  edgeInset = 6,
  minimumWidth = 24,
}: TradeHistoryLabelMaxWidthOptions): number => {
  const safePlotWidth = Math.max(0, Number.isFinite(plotWidth) ? plotWidth : 0);
  const safeAnchorX = Number.isFinite(anchorX) ? anchorX : edgeInset;
  const safeGap = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const safeInset = Math.max(0, Number.isFinite(edgeInset) ? edgeInset : 0);
  const plotCapacity = Math.max(0, safePlotWidth - safeInset * 2);
  const rightCapacity = Math.max(0, safePlotWidth - safeInset - safeAnchorX - safeGap);
  const leftCapacity = Math.max(0, safeAnchorX - safeGap - safeInset);

  return Math.min(
    plotCapacity,
    Math.max(Math.min(plotCapacity, Math.max(0, minimumWidth)), rightCapacity, leftCapacity),
  );
};

const labelsOverlap = (
  candidate: TradeHistoryLabelRect,
  occupied: TradeHistoryLabelRect,
  gap: number,
): boolean => !(
  candidate.left + candidate.width + gap <= occupied.left
  || occupied.left + occupied.width + gap <= candidate.left
  || candidate.top + candidate.height + gap <= occupied.top
  || occupied.top + occupied.height + gap <= candidate.top
);

/** Assigns nearby history badges to vertical lanes so open/close labels remain distinct. */
export const resolveTradeHistoryLabelVerticalPlacement = ({
  preferredCenterY,
  labelHeight,
  chartHeight,
  left,
  width,
  occupied,
  edgeInset = 4,
  gap = 4,
}: TradeHistoryLabelVerticalPlacementOptions): TradeHistoryLabelVerticalPlacement => {
  const safeHeight = Math.max(1, Number.isFinite(labelHeight) ? labelHeight : 22);
  const safeChartHeight = Math.max(safeHeight, Number.isFinite(chartHeight) ? chartHeight : safeHeight);
  const safeInset = Math.max(0, Number.isFinite(edgeInset) ? edgeInset : 0);
  const safeGap = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const minTop = safeInset;
  const maxTop = Math.max(minTop, safeChartHeight - safeInset - safeHeight);
  const preferredTop = (Number.isFinite(preferredCenterY) ? preferredCenterY : safeHeight / 2) - safeHeight / 2;
  const baseTop = Math.min(maxTop, Math.max(minTop, preferredTop));
  const laneStep = safeHeight + safeGap;
  const maxLane = Math.max(2, Math.min(24, occupied.length + 2));
  const lanes = [0];

  for (let lane = 1; lane <= maxLane; lane += 1) {
    lanes.push(-lane, lane);
  }

  for (const lane of lanes) {
    const top = Math.min(maxTop, Math.max(minTop, baseTop + lane * laneStep));
    const rect: TradeHistoryLabelRect = {
      left,
      top,
      width: Math.max(0, width),
      height: safeHeight,
    };
    if (!occupied.some(item => labelsOverlap(rect, item, safeGap))) {
      return { centerY: top + safeHeight / 2, lane, rect };
    }
  }

  const top = baseTop;
  const rect: TradeHistoryLabelRect = {
    left,
    top,
    width: Math.max(0, width),
    height: safeHeight,
  };
  return { centerY: top + safeHeight / 2, lane: 0, rect };
};

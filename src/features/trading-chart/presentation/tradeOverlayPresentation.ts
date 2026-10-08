export type TradeSide = 'BUY' | 'SELL';
export type TradeOverlayCardTone = TradeSide | 'SL' | 'TP';

export interface TradeOverlayCardPalette {
  background: string;
  border: string;
  text: string;
  shadow: string;
}

export const TRADE_LEVEL_OVERRIDES_STORAGE_KEY = 'rtx-trade-level-overrides-v1';
export const TRADE_LEVEL_OVERRIDE_TTL_MS = 5 * 60 * 1000;
export const TRADE_LEVEL_OPTIMISTIC_GRACE_MS = 15_000;
export const TRADE_LEVEL_HIT_AREA_PX = 24;
export const TRADE_LEVEL_MIN_DRAG_PX = 2;
export const CHART_LEVEL_MODIFY_DOUBLE_CLICK_MS = 500;
export const TRADE_LEVEL_CROSS_CLOSE_CANDIDATE_TTL_MS = 15_000;
export const TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS = 1_500;
export const TRADE_LEVEL_CROSS_REFRESH_MIN_DISPATCH_INTERVAL_MS = 3_000;
export const TRADE_LEVEL_BADGE_LEFT_INSET_PX = 16;
export const TRADE_LEVEL_BADGE_STACK_OFFSET_PX = 76;
export const TRADE_MISSING_POSITION_GRACE_MS = 30_000;

/** Candle edge to chevron tip: marker offset plus the arrow SVG tip inset. */
export const TRADE_MARKER_TIP_OFFSET_PX = 6;

export interface TradeControlRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TradeControlLayoutInput {
  key: string;
  anchorY: number;
  width: number;
  height: number;
  preferredLeft: number;
}

export interface TradeControlPlacement extends TradeControlRect {
  key: string;
  anchorY: number;
  offsetY: number;
}

/** Keep price lines fixed; move only their controls into the nearest free space. */
export const layoutTradeControls = (
  controls: readonly TradeControlLayoutInput[],
  plotWidth: number,
  plotHeight: number,
  exclusions: readonly TradeControlRect[] = [],
): TradeControlPlacement[] => {
  const inset = 6;
  const gap = 6;
  const occupied = [...exclusions];
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, value));
  return [...controls].sort((a, b) => a.anchorY - b.anchorY || a.key.localeCompare(b.key)).map(control => {
    const width = Math.min(control.width, Math.max(0, plotWidth - inset * 2));
    const height = control.height;
    const preferredTop = control.anchorY - height / 2;
    const maxTop = plotHeight - inset - height;
    const preferredLeft = clamp(control.preferredLeft, inset, plotWidth - inset - width);
    const candidateTops = [...new Set([
      preferredTop,
      ...occupied.flatMap(rect => [rect.top - gap - height, rect.top + rect.height + gap]),
    ].map(top => clamp(top, inset, maxTop)))].sort((a, b) => Math.abs(a - preferredTop) - Math.abs(b - preferredTop));
    let placement: TradeControlRect | undefined;
    for (const top of candidateTops) {
      const blockers = occupied.filter(rect => top < rect.top + rect.height + gap && top + height + gap > rect.top)
        .sort((a, b) => a.left - b.left);
      const free: Array<{ from: number; to: number }> = [];
      let start = inset;
      for (const rect of blockers) {
        if (rect.left - gap > start) free.push({ from: start, to: Math.min(plotWidth - inset, rect.left - gap) });
        start = Math.max(start, rect.left + rect.width + gap);
      }
      if (start < plotWidth - inset) free.push({ from: start, to: plotWidth - inset });
      const lefts = free.filter(range => range.to - range.from >= width)
        .map(range => clamp(preferredLeft, range.from, range.to - width))
        .sort((a, b) => Math.abs(a - preferredLeft) - Math.abs(b - preferredLeft));
      if (lefts.length) {
        placement = { left: lefts[0], top, width, height };
        break;
      }
    }
    // An overfilled pane has no collision-free solution. Keep its controls
    // near their anchors instead of moving a price line or dropping an action.
    placement ??= { left: preferredLeft, top: clamp(preferredTop, inset, maxTop), width, height };
    occupied.push(placement);
    return { ...placement, key: control.key, anchorY: control.anchorY, offsetY: placement.top + height / 2 - control.anchorY };
  });
};

/** A displaced bar changes presentation, never the price under a drag gesture. */
export const getTradeControlDragY = (pointerY: number, offsetY: number): number => (
  pointerY - (Number.isFinite(offsetY) ? offsetY : 0)
);

export const tradeControlLeaderNodes = new WeakMap<HTMLElement, HTMLElement>();

const TRADE_PLOT_CLIP_CLASS = 'rtx-trade-plot-clip';

/**
 * Trade markers and history segments live in a layer clipped to the price
 * pane, so a compressed price scale cannot push them over an axis.
 */
export const getTradePlotClipLayer = (host: HTMLElement): HTMLElement => {
  for (const child of Array.from(host.children)) {
    if (child.classList.contains(TRADE_PLOT_CLIP_CLASS)) return child as HTMLElement;
  }
  const layer = document.createElement('div');
  layer.className = TRADE_PLOT_CLIP_CLASS;
  layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none;';
  host.appendChild(layer);
  return layer;
};

export interface TradeMarkerTooltipLayout {
  x: number;
  markerY: number;
  markerSide?: TradeSide;
  plotWidth: number;
  plotHeight: number;
}

export const tradeMarkerTooltipLayouts = new WeakMap<HTMLElement, TradeMarkerTooltipLayout>();

/** Only measure and place a tooltip after it becomes visible. */
export const placeTradeMarkerTooltip = (
  target: HTMLElement,
  tooltip: HTMLElement,
): void => {
  const layout = tradeMarkerTooltipLayouts.get(target);
  if (!layout) return;
  const { x, markerY, markerSide, plotWidth, plotHeight } = layout;
  const tooltipWidth = tooltip.offsetWidth || 64;
  const hoverTargetWidth = target.offsetWidth || 14;
  const maxTooltipLeft = Math.max(6, plotWidth - tooltipWidth - 6);
  const tooltipLeft = Math.min(maxTooltipLeft, Math.max(6, x - tooltipWidth / 2));
  tooltip.style.left = `${tooltipLeft - (x - hoverTargetWidth / 2)}px`;
  tooltip.style.right = 'auto';
  tooltip.style.transform = 'none';

  const hoverTargetHeight = target.offsetHeight || 32;
  const markerTop = markerSide === 'BUY' ? markerY : markerY - hoverTargetHeight;
  const markerBottom = markerSide === 'BUY' ? markerY + hoverTargetHeight : markerY;
  const tooltipHeight = tooltip.offsetHeight || 58;
  const tooltipGap = 7;
  const fitsAbove = markerTop - tooltipGap - tooltipHeight >= 4;
  const fitsBelow = markerBottom + tooltipGap + tooltipHeight <= plotHeight - 4;
  let placeAbove = markerSide === 'BUY';
  if (placeAbove && !fitsAbove && fitsBelow) placeAbove = false;
  if (!placeAbove && !fitsBelow && fitsAbove) placeAbove = true;
  tooltip.style.bottom = placeAbove ? `calc(100% + ${tooltipGap}px)` : 'auto';
  tooltip.style.top = placeAbove ? 'auto' : `calc(100% + ${tooltipGap}px)`;
};

export const getTradeOverlayCardPalette = (
  tone: TradeOverlayCardTone,
  isLightSurface: boolean,
): TradeOverlayCardPalette => {
  const isPositiveTone = tone === 'BUY' || tone === 'TP';
  if (isLightSurface) {
    if (tone === 'BUY') {
      return {
        background: '#eff6ff',
        border: '#1746bc',
        text: '#1746bc',
        shadow: 'box-shadow:0 1px 3px rgba(15,23,42,0.12);',
      };
    }
    return isPositiveTone
      ? {
        background: '#ecfdf5',
        border: '#04685e',
        text: '#04685e',
        shadow: 'box-shadow:0 1px 3px rgba(15,23,42,0.12);',
      }
      : {
        background: '#fef2f2',
        border: '#a51f26',
        text: '#a51f26',
        shadow: 'box-shadow:0 1px 3px rgba(15,23,42,0.12);',
      };
  }

  return isPositiveTone
    ? {
      background: 'rgba(5, 46, 30, 0.9)',
      border: '#22c55e',
      text: '#bbf7d0',
      shadow: 'box-shadow:0 2px 8px rgba(0,0,0,0.28);',
    }
    : {
      background: 'rgba(69, 10, 10, 0.9)',
      border: '#ef4444',
      text: '#fecaca',
      shadow: 'box-shadow:0 2px 8px rgba(0,0,0,0.28);',
    };
};

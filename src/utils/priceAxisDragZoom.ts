/**
 * Right price-scale drag zoom. Web and desktop use the same pane-relative
 * response observed in TradingView.
 *
 * TradingView BTCUSD browser comparison: in a ~714px pane, 100px down
 * from y=459 expands the range by ~1.34; from y=159, by ~1.17. A 300px
 * upward drag from y=559 halves the range. The pane-relative ratio below
 * reproduces those observations, with edge clamping and broker min-span.
 * Scaling stays centered on the starting range. When pane geometry is
 * unavailable, a gentle exponential response provides the fallback.
 */

/** Drag distance (px) that scales the price span by e. Tuned to MT web. */
export const PRICE_AXIS_DRAG_EFOLD_PX = 1000;

/** Runaway guard: one continuous drag cannot scale beyond this factor. */
const MAX_DRAG_SCALE_FACTOR = 50;

export interface PriceAxisDragZoomInput {
  /** Visible price range captured when the drag started. */
  startFrom: number;
  startTo: number;
  /** Pointer travel since drag start: positive = downward = zoom out. */
  dragDeltaY: number;
  /** Smallest allowed price span (e.g. the symbol's minMove). */
  minSpan?: number;
  eFoldPx?: number;
  /** Price-axis geometry, captured once at pointer down. */
  paneHeight?: number;
  startY?: number;
}

export interface PriceAxisDragZoomRange {
  from: number;
  to: number;
}

export const computePriceAxisDragRange = (
  input: PriceAxisDragZoomInput,
): PriceAxisDragZoomRange | null => {
  const { startFrom, startTo, dragDeltaY } = input;
  if (!Number.isFinite(startFrom) || !Number.isFinite(startTo) || !Number.isFinite(dragDeltaY)) return null;
  const span = startTo - startFrom;
  if (!(span > 0)) return null;

  const eFoldPx = input.eFoldPx && input.eFoldPx > 0 ? input.eFoldPx : PRICE_AXIS_DRAG_EFOLD_PX;
  const paneHeight = input.paneHeight;
  const startY = input.startY;
  // TradingView's response is stronger near the bottom of the axis. Keeping
  // the denominator at the pane edge prevents a singularity on long drags.
  let rawFactor = Math.exp(dragDeltaY / eFoldPx);
  if (typeof paneHeight === 'number' && Number.isFinite(paneHeight) && paneHeight > 1
    && typeof startY === 'number' && Number.isFinite(startY)) {
    const edgePadding = (paneHeight - 1) * 0.2;
    rawFactor = (Math.max(0, paneHeight - startY) + edgePadding)
      / (Math.max(0, paneHeight - startY - dragDeltaY) + edgePadding);
  }
  const factor = Math.min(MAX_DRAG_SCALE_FACTOR, Math.max(1 / MAX_DRAG_SCALE_FACTOR, rawFactor));

  const minSpan = input.minSpan && input.minSpan > 0 ? input.minSpan : 0;
  const nextSpan = Math.max(minSpan, span * factor);
  const center = startFrom + span / 2;
  const from = center - nextSpan / 2;
  const to = center + nextSpan / 2;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return null;
  return { from, to };
};

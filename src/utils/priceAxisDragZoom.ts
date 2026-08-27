/**
 * MT5-style right price-scale drag zoom.
 *
 * Measured against the MetaTrader web terminal (AUDCAD probe, 627px pane):
 * dragging the price axis scales the visible price range around the pane
 * CENTER with a gentle exponential curve — roughly x1.2 per 200px and x1.5
 * per 400px of downward drag (zoom out), mirrored for upward drags (zoom in).
 * That fits factor = e^(dy / ~1000px).
 *
 * Lightweight-charts' native axis drag instead applies a hyperbolic factor
 * ((H - y0 + 0.2H) / (H - y + 0.2H)) that reaches x1.85 at 200px, x3.5 at
 * 400px and explodes near the pane edge, which feels jumpy. The chart
 * disables the native handler and drives this curve instead.
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
  const rawFactor = Math.exp(dragDeltaY / eFoldPx);
  const factor = Math.min(MAX_DRAG_SCALE_FACTOR, Math.max(1 / MAX_DRAG_SCALE_FACTOR, rawFactor));

  const minSpan = input.minSpan && input.minSpan > 0 ? input.minSpan : 0;
  const nextSpan = Math.max(minSpan, span * factor);
  const center = startFrom + span / 2;
  const from = center - nextSpan / 2;
  const to = center + nextSpan / 2;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return null;
  return { from, to };
};

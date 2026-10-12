interface TradeOverlayContainerSize {
  width: number;
  height: number;
}

export type TradeOverlayContainerSizeCache = WeakMap<HTMLElement, TradeOverlayContainerSize>;

export const rememberTradeOverlayContainerResize = (
  cache: TradeOverlayContainerSizeCache,
  entry: ResizeObserverEntry,
): void => {
  const element = entry.target as HTMLElement;
  const box = entry.borderBoxSize?.[0];
  if (!box || !Number.isFinite(box.inlineSize) || !Number.isFinite(box.blockSize)) {
    // A content box excludes padding and borders. Invalidate instead of using
    // it as the chart's offsetWidth/offsetHeight geometry.
    cache.delete(element);
    return;
  }
  // Retain zero sizes too: a collapsed pane must not reuse its old dimensions.
  cache.set(element, {
    width: Math.max(0, Math.round(box.inlineSize)),
    height: Math.max(0, Math.round(box.blockSize)),
  });
};

export const readTradeOverlayContainerSize = (
  cache: TradeOverlayContainerSizeCache,
  element: HTMLElement | null,
  observed: boolean,
): TradeOverlayContainerSize => {
  if (!element) return { width: 0, height: 0 };
  const cached = observed ? cache.get(element) : undefined;
  if (cached) return cached;

  // Measure once before the first observation, or after a legacy content-box
  // notification. Without an observer every call must read the current size.
  const size = { width: element.offsetWidth, height: element.offsetHeight };
  if (observed) cache.set(element, size);
  return size;
};

interface TradeControlSize {
  width: number;
  height: number;
  widthStyle: string;
  maxWidthStyle: string;
}

export type TradeControlSizeCache = WeakMap<HTMLElement, TradeControlSize>;

const rememberSize = (cache: TradeControlSizeCache, element: HTMLElement, width: number, height: number) => {
  const size = {
    width, height, widthStyle: element.style.width, maxWidthStyle: element.style.maxWidth,
  };
  if (width > 0 && height > 0) cache.set(element, size);
  else cache.delete(element);
  return size;
};

/** Border-box observations already contain padding/borders; no layout read is needed. */
export const rememberTradeControlResize = (cache: TradeControlSizeCache, entry: ResizeObserverEntry): void => {
  const element = entry.target as HTMLElement;
  const box = entry.borderBoxSize?.[0];
  if (!box || !Number.isFinite(box.inlineSize) || !Number.isFinite(box.blockSize)) {
    // Older observers only provide a content box. Measure the complete border
    // box on the next placement rather than assuming padding or border widths.
    cache.delete(element);
    return;
  }
  rememberSize(cache, element, Math.round(box.inlineSize), Math.round(box.blockSize));
};

export const readTradeControlSize = (
  cache: TradeControlSizeCache, element: HTMLElement, observed: boolean,
): { width: number; height: number } => {
  const size = observed ? cache.get(element) : undefined;
  if (size && size.widthStyle === element.style.width && size.maxWidthStyle === element.style.maxWidth) {
    return size;
  }
  // New controls, a changed chart-width constraint, or a control returning from
  // display:none need one initial measurement. Later ticks use the observer.
  return rememberSize(cache, element, element.offsetWidth, element.offsetHeight);
};

/** Retains only the latest display value while chart interaction defers paint. */
export function createDeferredQuoteOverlay<T>() {
  let pending: T | undefined;
  return {
    defer(value: T): void { pending = value; },
    clear(): void { pending = undefined; },
    take(fallback: T): T { const value = pending ?? fallback; pending = undefined; return value; },
  };
}

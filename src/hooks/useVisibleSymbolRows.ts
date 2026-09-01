import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const normalizeSymbol = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const sameSymbols = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((symbol, index) => symbol === right[index]);

export interface VisibleSymbolRowsBinding {
  visibleSymbols: string[];
  setViewportRef: (node: HTMLElement | null) => void;
  setRowRef: (symbol: string, node: HTMLElement | null) => void;
}

/**
 * Tracks the Market Watch rows that intersect their scroll viewport.
 *
 * The returned symbols are stable in catalog/watchlist order. Consumers can
 * pass them directly to quote demand so rows subscribe when they enter view and
 * unsubscribe when they leave it. IntersectionObserver is used when available;
 * the geometry fallback keeps the same behavior in older embedded runtimes.
 */
export function useVisibleSymbolRows(symbols: readonly string[]): VisibleSymbolRowsBinding {
  const orderedSymbolsKey = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))).join('\u0000');
  const orderedSymbols = useMemo(
    () => orderedSymbolsKey ? orderedSymbolsKey.split('\u0000') : [],
    [orderedSymbolsKey],
  );

  const [viewportElement, setViewportElement] = useState<HTMLElement | null>(null);
  const [visibleSymbols, setVisibleSymbols] = useState<string[]>([]);
  const visibleSetRef = useRef(new Set<string>());
  const rowElementsRef = useRef(new Map<string, HTMLElement>());
  const elementSymbolsRef = useRef(new WeakMap<Element, string>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const publishVisibleSymbols = useCallback(() => {
    const next = orderedSymbols.filter((symbol) => visibleSetRef.current.has(symbol));
    setVisibleSymbols((current) => sameSymbols(current, next) ? current : next);
  }, [orderedSymbols]);

  const setViewportRef = useCallback((node: HTMLElement | null) => {
    setViewportElement((current) => current === node ? current : node);
  }, []);

  const setRowRef = useCallback((rawSymbol: string, node: HTMLElement | null) => {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return;

    const previous = rowElementsRef.current.get(symbol);
    if (previous && previous !== node) observerRef.current?.unobserve(previous);

    if (node) {
      rowElementsRef.current.set(symbol, node);
      elementSymbolsRef.current.set(node, symbol);
      observerRef.current?.observe(node);
      return;
    }

    rowElementsRef.current.delete(symbol);
    if (visibleSetRef.current.delete(symbol)) publishVisibleSymbols();
  }, [publishVisibleSymbols]);

  useLayoutEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    visibleSetRef.current.clear();
    publishVisibleSymbols();
    if (!viewportElement || orderedSymbols.length === 0) return undefined;

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const symbol = elementSymbolsRef.current.get(entry.target);
          if (!symbol) continue;
          if (entry.isIntersecting) {
            if (!visibleSetRef.current.has(symbol)) {
              visibleSetRef.current.add(symbol);
              changed = true;
            }
          } else if (visibleSetRef.current.delete(symbol)) {
            changed = true;
          }
        }
        if (changed) publishVisibleSymbols();
      }, { root: viewportElement, threshold: 0 });

      observerRef.current = observer;
      rowElementsRef.current.forEach((element) => observer.observe(element));
      return () => {
        observer.disconnect();
        if (observerRef.current === observer) observerRef.current = null;
      };
    }

    let frameId: number | null = null;
    const refreshFromGeometry = () => {
      frameId = null;
      const rootRect = viewportElement.getBoundingClientRect();
      const layoutUnavailable = rootRect.width === 0 && rootRect.height === 0;
      const nextVisible = new Set<string>();
      rowElementsRef.current.forEach((element, symbol) => {
        const rowRect = element.getBoundingClientRect();
        if (
          layoutUnavailable
          || (rowRect.bottom > rootRect.top && rowRect.top < rootRect.bottom)
        ) {
          nextVisible.add(symbol);
        }
      });
      visibleSetRef.current = nextVisible;
      publishVisibleSymbols();
    };
    const scheduleRefresh = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(refreshFromGeometry);
    };

    viewportElement.addEventListener('scroll', scheduleRefresh, { passive: true });
    window.addEventListener('resize', scheduleRefresh);
    refreshFromGeometry();

    return () => {
      viewportElement.removeEventListener('scroll', scheduleRefresh);
      window.removeEventListener('resize', scheduleRefresh);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [orderedSymbols, publishVisibleSymbols, viewportElement]);

  return { visibleSymbols, setViewportRef, setRowRef };
}

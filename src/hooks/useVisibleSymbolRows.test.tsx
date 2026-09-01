import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibleSymbolRows } from './useVisibleSymbolRows';

class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  readonly observed = new Set<Element>();
  readonly observe = vi.fn((target: Element) => {
    this.observed.add(target);
  });
  readonly unobserve = vi.fn((target: Element) => {
    this.observed.delete(target);
  });
  readonly disconnect = vi.fn(() => {
    this.observed.clear();
  });
  readonly takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = options?.root ?? null;
    MockIntersectionObserver.instances.push(this);
  }

  emit(...entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(
      entries.map(({ target, isIntersecting }) => ({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
      } as IntersectionObserverEntry)),
      this,
    );
  }
}

const bindRows = (
  result: ReturnType<typeof renderHook<ReturnType<typeof useVisibleSymbolRows>, unknown>>['result'],
  symbols: string[],
) => {
  const viewport = document.createElement('div');
  const rows = new Map(symbols.map((symbol) => [symbol, document.createElement('div')]));

  act(() => {
    result.current.setViewportRef(viewport);
    rows.forEach((row, symbol) => result.current.setRowRef(symbol, row));
  });

  return { viewport, rows, observer: MockIntersectionObserver.instances.at(-1)! };
};

describe('useVisibleSymbolRows', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns only intersecting rows in stable watchlist order', () => {
    const symbols = ['EURUSD', 'BTCUSD', 'XAUUSD'];
    const { result } = renderHook(() => useVisibleSymbolRows(symbols));
    const { rows, observer } = bindRows(result, symbols);

    expect(observer.root).not.toBeNull();
    expect(observer.observed).toEqual(new Set(rows.values()));
    expect(result.current.visibleSymbols).toEqual([]);

    act(() => {
      observer.emit(
        { target: rows.get('XAUUSD')!, isIntersecting: true },
        { target: rows.get('EURUSD')!, isIntersecting: false },
        { target: rows.get('BTCUSD')!, isIntersecting: true },
      );
    });

    expect(result.current.visibleSymbols).toEqual(['BTCUSD', 'XAUUSD']);
  });

  it('removes rows on scroll-out and adds rows on scroll-in', () => {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY'];
    const { result } = renderHook(() => useVisibleSymbolRows(symbols));
    const { rows, observer } = bindRows(result, symbols);

    act(() => {
      observer.emit(
        { target: rows.get('EURUSD')!, isIntersecting: true },
        { target: rows.get('USDJPY')!, isIntersecting: true },
      );
    });
    expect(result.current.visibleSymbols).toEqual(['EURUSD', 'USDJPY']);

    act(() => {
      observer.emit(
        { target: rows.get('EURUSD')!, isIntersecting: false },
        { target: rows.get('GBPUSD')!, isIntersecting: true },
      );
    });

    expect(result.current.visibleSymbols).toEqual(['GBPUSD', 'USDJPY']);
  });

  it('unobserves detached rows and disconnects the observer on cleanup', () => {
    const symbols = ['EURUSD', 'GBPUSD'];
    const { result, unmount } = renderHook(() => useVisibleSymbolRows(symbols));
    const { rows, observer } = bindRows(result, symbols);
    const eurusdRow = rows.get('EURUSD')!;

    act(() => {
      observer.emit({ target: eurusdRow, isIntersecting: true });
    });
    expect(result.current.visibleSymbols).toEqual(['EURUSD']);

    act(() => {
      result.current.setRowRef('EURUSD', null);
    });

    expect(observer.unobserve).toHaveBeenCalledWith(eurusdRow);
    expect(result.current.visibleSymbols).toEqual([]);

    unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});

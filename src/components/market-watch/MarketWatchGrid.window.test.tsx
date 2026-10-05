import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { MarketWatchGrid } from './MarketWatchGrid';

let measuredHeight = 20;
let tallSymbol: string | null = null;
class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  constructor(readonly callback: ResizeObserverCallback) { ResizeObserverMock.instances.push(this); }
  observe() {} unobserve() {} disconnect() {}
  static resize() { for (const observer of this.instances) observer.callback([{ contentRect: { width: 343 } } as ResizeObserverEntry], observer as unknown as ResizeObserver); }
}
const symbols = Array.from({ length: 561 }, (_, index) => `SYMBOL${index}`);
function makeProps(): ComponentProps<typeof MarketWatchGrid> {
  return {
    actionableSymbolSet: new Set(symbols), chartOpenableSymbolSet: new Set(symbols),
    closedDailyChanges: new Map(), columns: ['symbol', 'bid', 'ask'],
    getContextMenuItems: symbol => [{ label: `Order ${symbol}`, action: vi.fn() }],
    isSymbolListLoading: false, lastPrices: new Map(), liveQuoteSymbolSet: new Set(symbols),
    marketWatchOptions: { autoArrange: true, autoRemoveExpired: false, showGrid: true, showMilliseconds: false, useSystemColors: true },
    marketWatchRowRefCallbacks: new Map(), marketWatchSelectionSymbol: symbols[0],
    onContextSelect: vi.fn(), onShowAll: vi.fn(), onSymbolSelect: vi.fn(),
    quoteEligibleSymbols: symbols, rows: symbols, setMarketWatchViewportRef: vi.fn(),
    setSortMode: vi.fn(), sortMode: null, translate: value => value,
  };
}
const row = (container: HTMLElement, symbol: string) => container.querySelector<HTMLTableRowElement>(`tr[data-symbol="${symbol}"]`);
const viewport = (container: HTMLElement) => container.querySelector<HTMLDivElement>('.rtx-market-watch__table')!;
describe('Market Watch row window', () => {
  beforeEach(() => {
    measuredHeight = 20; tallSymbol = null; ResizeObserverMock.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      const height = this.tagName === 'THEAD' ? 24 : this.dataset.symbol === tallSymbol ? measuredHeight * 2 : measuredHeight;
      return { height, width: 343, top: 0, bottom: height, left: 0, right: 343, x: 0, y: 0, toJSON() {} };
    });
  });
  afterEach(() => { cleanup(); document.documentElement.style.removeProperty('--test-font-size'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses bounded rows, exact logical indices and scrolls to the last symbol', () => {
    const view = render(<MarketWatchGrid {...makeProps()} />);
    expect(view.container.querySelectorAll('[data-symbol]').length).toBeLessThan(60);
    expect(view.container.querySelector('table')).toHaveAttribute('data-logical-row-count', '561');
    expect(row(view.container, symbols[0])).toHaveAttribute('aria-rowindex', '2');
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 11_220 } });
    expect(row(view.container, symbols[560])).toHaveAttribute('aria-rowindex', '562');
    expect(view.container.querySelectorAll('[data-symbol]').length).toBeLessThan(60);
    expect(row(view.container, symbols[0])).toHaveAttribute('tabindex', '0');
  });

  it('keeps the selected row keyboard reachable offscreen and preserves native Tab exit', () => {
    const view = render(<MarketWatchGrid {...makeProps()} />);
    const first = row(view.container, symbols[0])!;
    act(() => first.focus());
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    act(() => first.blur());
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 11_220 } });
    expect(first).toBeInTheDocument();
    expect(first).toHaveAttribute('tabindex', '0');
    expect(row(view.container, symbols[560])).toHaveAttribute('tabindex', '-1');
    view.rerender(<MarketWatchGrid {...makeProps()} marketWatchSelectionSymbol={symbols[560]} />);
    const last = row(view.container, symbols[560])!;
    expect(last).toHaveAttribute('tabindex', '0');
    expect(row(view.container, symbols[0])).not.toBeInTheDocument();
    act(() => last.focus());
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true);
  });

  it('keeps an open menu mounted after focus leaves for its portal, without moving selection on scroll', () => {
    const props = makeProps();
    const view = render(<MarketWatchGrid {...props} />);
    fireEvent.contextMenu(row(view.container, symbols[1])!);
    const menuItem = screen.getByRole('menuitem');
    menuItem.tabIndex = 0;
    act(() => menuItem.focus());
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 11_220 } });
    expect(row(view.container, symbols[1])).toBeInTheDocument();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(menuItem);
    expect(row(view.container, symbols[1])).not.toBeInTheDocument();
    expect(props.onSymbolSelect).not.toHaveBeenCalled();
  });

  it('pins a dragged row until drag ends and preserves its payload', () => {
    const view = render(<MarketWatchGrid {...makeProps()} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(row(view.container, symbols[2])!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', symbols[2]);
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 11_220 } });
    expect(row(view.container, symbols[2])).toBeInTheDocument();
    fireEvent.dragEnd(row(view.container, symbols[2])!);
    expect(row(view.container, symbols[2])).not.toBeInTheDocument();
  });

  it('does not jump back to selection on sorting and handles a pending newly added search row', () => {
    const props = makeProps();
    const scrollToSymbolRef = { current: null as ((symbol: string) => void) | null };
    const view = render(<MarketWatchGrid {...props} scrollToSymbolRef={scrollToSymbolRef} />);
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 4_000 } });
    view.rerender(<MarketWatchGrid {...props} rows={[...symbols].reverse()} scrollToSymbolRef={scrollToSymbolRef} />);
    expect(viewport(view.container).scrollTop).toBe(4_000);
    act(() => scrollToSymbolRef.current?.('NEW'));
    view.rerender(<MarketWatchGrid {...props} rows={[...symbols, 'NEW']} scrollToSymbolRef={scrollToSymbolRef} />);
    expect(row(view.container, 'NEW')).toBeInTheDocument();
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 0 } });
    view.rerender(<MarketWatchGrid {...props} rows={[...symbols, 'NEW']} scrollToSymbolRef={scrollToSymbolRef} />);
    expect(viewport(view.container).scrollTop).toBe(0);
  });

  it('measures variable heights and clears offscreen measurements while anchoring a root font change', async () => {
    tallSymbol = symbols[1];
    const view = render(<MarketWatchGrid {...makeProps()} />);
    const spacer = view.container.querySelector<HTMLTableRowElement>('.rtx-market-watch__spacer')!;
    const renderedTotal = view.container.querySelectorAll('[data-symbol]').length * 20 + 20;
    expect(Number.parseFloat(spacer.style.height) + renderedTotal).toBe(561 * 20 + 20);
    fireEvent.scroll(viewport(view.container), { target: { scrollTop: 2_020 } });
    measuredHeight = 30;
    tallSymbol = null;
    await act(async () => { document.documentElement.style.setProperty('--test-font-size', '18px'); });
    expect(viewport(view.container).scrollTop).toBe(3_000);
    expect(view.container.querySelectorAll('[data-symbol]').length).toBeLessThan(60);
  });

  it('releases row visibility and imperative bindings on unmount and session remount', () => {
    const props = makeProps();
    const callbacks = new Map(symbols.map(symbol => [symbol, vi.fn()]));
    const scrollToSymbolRef = { current: null as ((symbol: string) => void) | null };
    const view = render(<MarketWatchGrid key="session-a" {...props} marketWatchRowRefCallbacks={callbacks} scrollToSymbolRef={scrollToSymbolRef} />);
    const oldScroll = scrollToSymbolRef.current;
    act(() => oldScroll?.('NEW'));
    view.rerender(<MarketWatchGrid key="session-b" {...props} rows={[...symbols, 'NEW']} marketWatchRowRefCallbacks={callbacks} scrollToSymbolRef={scrollToSymbolRef} />);
    expect(scrollToSymbolRef.current).not.toBe(oldScroll);
    expect(viewport(view.container).scrollTop).toBe(0);
    view.unmount();
    expect(scrollToSymbolRef.current).toBeNull();
    for (const callback of callbacks.values()) if (callback.mock.calls.length) expect(callback).toHaveBeenLastCalledWith(null);
  });
});

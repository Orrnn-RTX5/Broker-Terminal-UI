import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketWatchGrid } from './MarketWatchGrid';

describe('Market Watch menu demand', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds no menus for 561 closed rows, and only builds the opened row using current options', () => {
    const rows = Array.from({ length: 561 }, (_, index) => `SYMBOL${index}`);
    const oldAction = vi.fn();
    const newAction = vi.fn();
    const menu = vi.fn((symbol: string) => [{ label: `Order ${symbol}`, action: oldAction }]);
    const props = {
      actionableSymbolSet: new Set(rows), chartOpenableSymbolSet: new Set(rows),
      closedDailyChanges: new Map<string, number>(), columns: ['symbol', 'bid'] as const,
      getContextMenuItems: menu, isSymbolListLoading: false, lastPrices: new Map(),
      liveQuoteSymbolSet: new Set(rows),
      marketWatchOptions: { autoArrange: true, autoRemoveExpired: false, showGrid: true, showMilliseconds: false, useSystemColors: true },
      marketWatchRowRefCallbacks: new Map(), marketWatchSelectionSymbol: rows[0],
      onContextSelect: vi.fn(), onShowAll: vi.fn(), onSymbolSelect: vi.fn(),
      quoteEligibleSymbols: rows, rows, setMarketWatchViewportRef: vi.fn(),
      setSortMode: vi.fn(), sortMode: null, translate: (value: string) => value,
    };
    const view = render(<MarketWatchGrid {...props} />);
    expect(menu).not.toHaveBeenCalled();
    view.rerender(<MarketWatchGrid {...props} marketWatchSelectionSymbol={rows[1]} />);
    expect(menu).not.toHaveBeenCalled();
    const row = view.container.querySelectorAll('tbody tr')[10];
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(menu).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenLastCalledWith(rows[10]);
    expect(props.onContextSelect).toHaveBeenCalledTimes(1);
    expect(props.onContextSelect).toHaveBeenCalledWith(rows[10]);
    expect(document.activeElement).toBe(row);
    const currentMenu = vi.fn((symbol: string) => [{ label: `Current ${symbol}`, action: newAction }]);
    view.rerender(<MarketWatchGrid {...props} getContextMenuItems={currentMenu} />);
    expect(currentMenu).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText(`Current ${rows[10]}`));
    expect(newAction).toHaveBeenCalledTimes(1);
    expect(oldAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const count = currentMenu.mock.calls.length;
    view.rerender(<MarketWatchGrid {...props} getContextMenuItems={currentMenu} />);
    expect(currentMenu).toHaveBeenCalledTimes(count);
  }, 30_000);
});

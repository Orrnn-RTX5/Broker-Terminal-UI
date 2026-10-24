import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { closedDailyChangeHook, marketHooks, getActiveMarketSnapshot, getRenderedRowSymbols, ResizeObserverStub } from '../layout/__tests__/MarketWatchPanel.testSupport';
import { useAppStore } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { publishMarketWatchDisplayMetadata, resetMarketWatchDisplayMetadataForTests } from '../../store/useMarketWatchDisplayMetadataStore';
import { MarketWatchPanel } from './MarketWatchPanel';

const DEFAULT_SYMBOLS = ['BTCUSD'];
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'test-broker', serverUrl: 'https://broker.test' });
  resetMarketWatchDisplayMetadataForTests();
  marketHooks.activeSymbols = DEFAULT_SYMBOLS;
  marketHooks.instrumentSymbols = DEFAULT_SYMBOLS;
  marketHooks.authorizedSymbols = DEFAULT_SYMBOLS;
  marketHooks.useActiveMarketSymbols.mockImplementation(getActiveMarketSnapshot);
  closedDailyChangeHook.values.clear();
  act(() => {
    useAppStore.setState({ isAuthenticated: false });
    useAppStore.getState().setTicks({ BTCUSD: { symbol: 'BTCUSD', bid: 65000, ask: 65001, spread: 1, dailyChange: 0.19, timestamp: Date.now() } });
  });
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});
afterEach(() => {
  act(() => useAppStore.getState().setTicks({}));
  resetMarketWatchDisplayMetadataForTests();
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

  it('aligns both daily headers with their signed values regardless of saved toggle order', () => {
    localStorage.setItem('rtx5_marketwatch_cols', JSON.stringify(['symbol', 'bid', 'ask', 'dailyChange', 'dailyChangePrice']));
    publishMarketWatchDisplayMetadata('BTCUSD', { timestamp: Date.now(), sourceTimestamp: Date.now(),
      dailyChangeInput: { mode: 'last', last: 2025, previousClose: 2000, sessionId: 'session-a' } });
    render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={vi.fn()} />);
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent?.trim())).toEqual(['Symbol', 'Bid', 'Ask', 'Change', 'Daily Change']);
    const cells = screen.getByText('BTCUSD').closest('tr')!.querySelectorAll('td');
    expect(cells[3]).toHaveTextContent('+25.00');
    expect(cells[4]).toHaveTextContent('+1.25%');
  });

  it('keeps percentage unavailable for a zero reference without borrowing an old closed percentage', () => {
    localStorage.setItem('rtx5_marketwatch_cols', JSON.stringify(['symbol', 'bid', 'ask', 'dailyChangePrice', 'dailyChange']));
    closedDailyChangeHook.values.set('BTCUSD', 99);
    publishMarketWatchDisplayMetadata('BTCUSD', { timestamp: Date.now(), sourceTimestamp: Date.now(),
      dailyChangeInput: { mode: 'last', last: 5, previousClose: 0, sessionId: 'session-a' } });
    render(<MarketWatchPanel allSymbols={DEFAULT_SYMBOLS} selectedSymbol="BTCUSD" onSymbolSelect={vi.fn()} />);
    const cells = screen.getByText('BTCUSD').closest('tr')!.querySelectorAll('td');
    expect(cells[3]).toHaveTextContent('+5.00');
    expect(cells[4]).toHaveTextContent('—');
  });

  it('sorts an unavailable percentage last without using a legacy or historical value', () => {
    marketHooks.activeSymbols = ['BTCUSD', 'XAUUSD'];
    marketHooks.instrumentSymbols = marketHooks.activeSymbols;
    marketHooks.authorizedSymbols = marketHooks.activeSymbols;
    closedDailyChangeHook.values.set('BTCUSD', 99);
    const at = Date.now();
    publishMarketWatchDisplayMetadata('BTCUSD', { timestamp: at, dailyChangeInput: { mode: 'last', last: 5, previousClose: 0, sessionId: 'session-a' } });
    publishMarketWatchDisplayMetadata('XAUUSD', { timestamp: at, dailyChangeInput: { mode: 'last', last: 97.5, previousClose: 100, sessionId: 'session-a' } });
    const { container } = render(<MarketWatchPanel allSymbols={marketHooks.activeSymbols} selectedSymbol="BTCUSD" onSymbolSelect={vi.fn()} />);
    act(() => screen.getByRole('columnheader', { name: 'Daily Change' }).click());
    expect(getRenderedRowSymbols(container)).toEqual(['XAUUSD', 'BTCUSD']);
    act(() => screen.getByRole('columnheader', { name: 'Daily Change' }).click());
    expect(getRenderedRowSymbols(container)).toEqual(['XAUUSD', 'BTCUSD']);
  });

  it('displays both price delta and percentage in the default Daily Change column across symbols', () => {
    marketHooks.activeSymbols = ['BTCUSD', 'XAUUSD'];
    marketHooks.instrumentSymbols = marketHooks.activeSymbols;
    marketHooks.authorizedSymbols = marketHooks.activeSymbols;
    const at = Date.now();
    act(() => {
      useAppStore.getState().setTicks({
        BTCUSD: { symbol: 'BTCUSD', bid: 2025, ask: 2026, spread: 1, timestamp: at },
        XAUUSD: { symbol: 'XAUUSD', bid: 4735.34, ask: 4735.57, spread: 0.23, close: 4802.69, dailyChange: -1.4023, timestamp: at },
      });
    });
    publishMarketWatchDisplayMetadata('BTCUSD', {
      timestamp: at,
      sourceTimestamp: at,
      dailyChangeInput: { mode: 'last', last: 2025, previousClose: 2000, sessionId: 'session-a' },
    });
    const { container } = render(<MarketWatchPanel allSymbols={marketHooks.activeSymbols} selectedSymbol="BTCUSD" onSymbolSelect={vi.fn()} />);

    const cols = Array.from(container.querySelectorAll('colgroup col')) as HTMLElement[];
    expect(cols.map((col) => col.style.width)).toEqual(['27.14%', '19.64%', '19.64%', '33.57%']);

    const btcCells = screen.getByText('BTCUSD').closest('tr')!.querySelectorAll('td');
    expect(btcCells[3]).toHaveTextContent('+25.00 (+1.25%)');

    const xauCells = screen.getByText('XAUUSD').closest('tr')!.querySelectorAll('td');
    expect(xauCells[3]).toHaveTextContent('-67.35 (-1.40%)');
  });



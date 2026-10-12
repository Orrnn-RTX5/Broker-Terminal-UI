import { useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type Order, type Position } from '../../store/useAppStore';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { useMarketWatchPanelModel } from './useMarketWatchPanelModel';

const fallbacks = vi.hoisted(() => ({ values: new Map() }));
vi.mock('../../hooks/useClosedMarketDailyChanges', () => ({
  useClosedMarketDailyChanges: () => fallbacks.values,
}));
vi.mock('../../hooks/useLastMarketWatchQuotes', () => ({
  useLastMarketWatchQuotes: () => fallbacks.values,
}));

const position = (id: number, symbol = 'EURUSD', volume = 0.1): Position => ({
  id, symbol, volume, side: 'BUY', openPrice: 1.1, currentPrice: 1.2,
  openTime: '2026-10-12T10:00:00Z', sl: 0, tp: 0, swap: 0, commission: 0, unrealizedPnL: 1,
});
const order = (id: string, symbol = 'GBPUSD', status: Order['status'] = 'PENDING'): Order => ({
  id, symbol, status, type: 'LIMIT', side: 'BUY', volume: 0.1, price: 1.2,
  createdAt: '2026-10-12T10:00:00Z',
});
const createModel = () => {
  const onCommit = vi.fn();
  const options = {
    accountCatalogStatus: undefined,
    activeMarketSymbols: [],
    activeSymbolsCurrent: true,
    activeSymbolsSettled: true,
    allSymbols: [],
    authenticatedMarketSymbols: [],
    dailyChangeScopeKey: null,
    detailsSymbolRequest: '',
    disabledSymbols: [],
    hiddenSymbols: [],
    isAuthenticated: false,
    manualSymbols: { watchlistId: '', symbols: [] },
    marketInstruments: [],
    popupPricesOpen: false,
    rowRefs: { current: new Map<string, HTMLTableRowElement>() },
    selectedSymbolGroupKey: null,
    sortMode: null,
  };
  const hook = renderHook(() => {
    const model = useMarketWatchPanelModel(options);
    useLayoutEffect(() => { onCommit(); });
    return model;
  });
  return { ...hook, onCommit };
};

describe('Market Watch trade symbol protection subscription', () => {
  beforeEach(() => {
    useAppStore.setState({ positions: [], orders: [], ticks: {} });
    const layout = useDockLayoutStore.getState().layout;
    useDockLayoutStore.setState({
      layout: { ...layout, root: { ...layout.root, children: [] }, floatingPanels: [] },
    });
  });

  it('does not commit for repeated P&L, price, positive-volume or same-symbol ticket changes', () => {
    useAppStore.setState({ positions: [position(1)], orders: [order('1')] });
    const model = createModel();
    const protectedSymbols = model.result.current.protectedSymbolSet;
    model.onCommit.mockClear();

    for (let index = 0; index < 20; index += 1) {
      act(() => useAppStore.setState({
        positions: [
          { ...position(1, ' eurusd ', index + 1), currentPrice: 1.3 + index, unrealizedPnL: index },
          position(index + 2),
        ].reverse(),
        orders: [order(String(index + 2), ' gbpusd ', index % 2 ? 'PENDING' : 'TRIGGERED')],
      }));
    }

    expect(model.onCommit).not.toHaveBeenCalled();
    expect(model.result.current.protectedSymbolSet).toBe(protectedSymbols);
    expect([...protectedSymbols].sort()).toEqual(['EURUSD', 'GBPUSD']);
  });

  it('updates protection immediately as positions open, close or change symbol', () => {
    const model = createModel();
    act(() => useAppStore.setState({ positions: [position(1)] }));
    expect(model.result.current.protectedSymbolSet.has('EURUSD')).toBe(true);

    act(() => useAppStore.setState({ positions: [position(1, 'XAUUSD')] }));
    expect([...model.result.current.protectedSymbolSet]).toEqual(['XAUUSD']);

    act(() => useAppStore.setState({ positions: [position(1, 'XAUUSD', 0)] }));
    expect(model.result.current.protectedSymbolSet.size).toBe(0);

    act(() => useAppStore.setState({
      positions: [{ ...position(1, 'USDJPY'), volume: undefined, quantity: 0.5 } as unknown as Position],
    }));
    expect([...model.result.current.protectedSymbolSet]).toEqual(['USDJPY']);
    act(() => useAppStore.setState({ positions: [] }));
    expect(model.result.current.protectedSymbolSet.size).toBe(0);
  });

  it('protects only pending or triggered orders and retains symbols still backed by a position', () => {
    const model = createModel();
    act(() => useAppStore.setState({ orders: [order('1')] }));
    expect(model.result.current.protectedSymbolSet.has('GBPUSD')).toBe(true);
    act(() => useAppStore.setState({ orders: [order('1', 'GBPUSD', 'FILLED')] }));
    expect(model.result.current.protectedSymbolSet.size).toBe(0);
    act(() => useAppStore.setState({
      positions: [position(1, 'GBPUSD')], orders: [order('2', 'EURUSD', 'TRIGGERED')],
    }));
    expect([...model.result.current.protectedSymbolSet].sort()).toEqual(['EURUSD', 'GBPUSD']);
    act(() => useAppStore.setState({ orders: [order('2', 'EURUSD', 'CANCELLED')] }));
    expect([...model.result.current.protectedSymbolSet]).toEqual(['GBPUSD']);
  });

  it('preserves chart and chart-tab protection when account trades are cleared', () => {
    const layout = useDockLayoutStore.getState().layout;
    useDockLayoutStore.setState({ layout: {
      ...layout,
      root: { ...layout.root, children: [{
        id: 'chart', title: 'BTCUSD,M1', component: 'Chart',
        props: { symbol: 'BTCUSD' },
        chartSymbolTabs: [{ symbol: 'ETHUSD', timeframe: 'M1' }],
      }] },
    } });
    useAppStore.setState({ positions: [position(1)], orders: [order('1')] });
    const model = createModel();
    expect([...model.result.current.protectedSymbolSet].sort()).toEqual(['BTCUSD', 'ETHUSD', 'EURUSD', 'GBPUSD']);
    act(() => useAppStore.setState({ positions: [], orders: [] }));
    expect([...model.result.current.protectedSymbolSet].sort()).toEqual(['BTCUSD', 'ETHUSD']);
  });
});

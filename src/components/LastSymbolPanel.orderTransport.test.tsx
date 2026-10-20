// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  placeMarketOrder: vi.fn(),
  closePosition: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: {
    orders: { placeMarketOrder: mocks.placeMarketOrder },
    positions: { closePosition: mocks.closePosition },
  },
}));

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: (symbol: string) => ({
    symbol,
    status: 'open',
    isOpen: true,
    label: 'Market Open',
    reason: '',
  }),
}));

import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { LastSymbolPanel } from './LastSymbolPanel';

describe('LastSymbolPanel market-order transport', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: '200002', isAuthenticated: true, authToken: 'transport-test-token' });
    useAppStore.getState().setTicks({
      EURUSD: {
        symbol: 'EURUSD',
        bid: 1.085,
        ask: 1.0852,
        spread: 0.0002,
        timestamp: Date.now(),
        digits: 5,
      },
    });
    useLastSymbolStore.setState({
      lastSymbol: 'EURUSD',
      volume: 0.01,
      autoSLTP: false,
      useRiskSizing: false,
    });
    // One-click ON: this suite covers market-order transport shape, not the
    // SUI-T9 OFF→dialog gate (covered by dedicated one-click tests).
    act(() => {
      useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: true } }));
    });
    mocks.placeMarketOrder.mockReset();
    mocks.placeMarketOrder.mockResolvedValue({ ticket: 990001 });
    mocks.closePosition.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: false } }));
  });

  it('omits the former cosmetic comment so a standard click remains WS-eligible', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LastSymbolPanel />);

    fireEvent.keyDown(window, { key: 'B', shiftKey: true });

    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(1));
    const [order, timing] = mocks.placeMarketOrder.mock.calls[0];
    expect(order).toMatchObject({
      symbol: 'EURUSD',
      side: 'buy',
      volume: 0.01,
      login: 200002,
    });
    expect(order).not.toHaveProperty('comment');
    expect(timing).toEqual({ intentAtMs: expect.any(Number) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dispatches all 20 quick orders without waiting for an earlier terminal fill', async () => {
    mocks.placeMarketOrder.mockImplementation(() => new Promise(() => {}));
    render(<LastSymbolPanel />);

    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(window, { key: index % 2 === 0 ? 'B' : 'S', shiftKey: true });
    }

    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(20));
    expect(mocks.placeMarketOrder.mock.calls.map(([order]) => order.side)).toEqual(
      Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? 'buy' : 'sell'),
    );
  });

  it('submits the exact punctuated broker contract in canonical case', async () => {
    useAppStore.getState().setTicks({
      'XAUUSD.raw': {
        symbol: 'XAUUSD.raw',
        bid: 2500,
        ask: 2500.2,
        spread: 0.2,
        timestamp: Date.now(),
        digits: 2,
      },
    });
    useLastSymbolStore.setState({ lastSymbol: ' xauusd.raw ' });
    render(<LastSymbolPanel />);

    fireEvent.keyDown(window, { key: 'B', shiftKey: true });

    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(1));
    expect(mocks.placeMarketOrder.mock.calls[0][0].symbol).toBe('XAUUSD.RAW');
  });

  it('switches the displayed symbol and quote immediately while a previous order is pending', async () => {
    useLastSymbolStore.setState({ lastTradeSide: 'BUY', lastTradeTime: 123 });
    useAppStore.getState().setTicks({
      ...useAppStore.getState().ticks,
      'XAUUSD.raw': { symbol: 'XAUUSD.raw', bid: 2500, ask: 2500.2, spread: 0.2, timestamp: Date.now(), digits: 2 },
    });
    let resolveOrder!: (result: { ticket: number }) => void;
    mocks.placeMarketOrder.mockImplementationOnce(() => new Promise(resolve => { resolveOrder = resolve; }));
    const view = render(<LastSymbolPanel symbol="EURUSD" />);
    fireEvent.keyDown(window, { key: 'B', shiftKey: true });
    expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(1);

    view.rerender(<LastSymbolPanel symbol="XAUUSD.raw" />);
    const summary = screen.getByRole('region', { name: 'Selected symbol' });
    expect(within(summary).getByText('XAUUSD.raw')).toBeInTheDocument();
    expect(within(summary).queryByText('BUY')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy XAUUSD.raw at market' })).toHaveTextContent('2500.20');
    expect(useLastSymbolStore.getState().lastSymbol).toBe('EURUSD');

    await act(async () => { resolveOrder({ ticket: 990001 }); });
    expect(within(summary).getByText('XAUUSD.raw')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'S', shiftKey: true });
    expect(mocks.placeMarketOrder.mock.calls[1][0]).toMatchObject({ symbol: 'XAUUSD.RAW', side: 'sell' });
    await act(async () => {});
  });

  it('does not reuse the previous quote when the selected contract has no quote', () => {
    const view = render(<LastSymbolPanel symbol="EURUSD" />);
    expect(screen.getByRole('button', { name: 'Buy EURUSD at market' })).toBeEnabled();
    view.rerender(<LastSymbolPanel symbol="EURUSD.r" />);
    expect(screen.getByRole('button', { name: 'Buy EURUSD.r at market' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sell EURUSD.r at market' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'B', shiftKey: true });
    fireEvent.keyDown(window, { key: 'S', shiftKey: true });
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(useLastSymbolStore.getState().lastSymbol).toBe('EURUSD');
  });

  it('closes only the selected symbol after switching away from the last traded symbol', async () => {
    const basePosition = {
      side: 'BUY' as const, volume: 0.01, openPrice: 100, currentPrice: 101,
      openTime: '2026-09-10T10:00:00Z', sl: 0, tp: 0, swap: 0, commission: 0, unrealizedPnL: 1,
    };
    useAppStore.setState({ positions: [
      { ...basePosition, id: 901, symbol: 'EURUSD' },
      { ...basePosition, id: 902, symbol: 'EURUSD.r' },
    ] });
    mocks.closePosition.mockResolvedValue({ success: true });
    const view = render(<LastSymbolPanel symbol="EURUSD" />);
    view.rerender(<LastSymbolPanel symbol="EURUSD.r" />);
    fireEvent.keyDown(window, { key: 'X', shiftKey: true });
    await waitFor(() => expect(mocks.closePosition).toHaveBeenCalledExactlyOnceWith('902'));
    await waitFor(() => expect(useAppStore.getState().positions.map(position => position.id)).toEqual([901]));
  });

  const seedPosition = () => useAppStore.setState({ positions: [{
    id: 901, symbol: 'EURUSD', side: 'BUY', volume: 0.01,
    openPrice: 1.08, currentPrice: 1.085, openTime: '2026-09-10T10:00:00Z',
    sl: 0, tp: 0, swap: 0, commission: 0, unrealizedPnL: 5,
  }] });

  it.each([
    { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { repeat: true }, { isComposing: true }, { keyCode: 229 },
  ])('never trades or closes positions for an inexact/held/composing shortcut: %j', (flags) => {
    seedPosition(); render(<LastSymbolPanel />);
    for (const key of ['B', 'S', 'X']) fireEvent.keyDown(window, { key, shiftKey: true, ...flags });
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(mocks.closePosition).not.toHaveBeenCalled();
    expect(useAppStore.getState().positions).toHaveLength(1);
  });

  it('ignores shortcuts already handled by a focused control', () => {
    seedPosition(); render(<LastSymbolPanel />);
    const control = document.createElement('button');
    control.addEventListener('keydown', (event) => event.preventDefault());
    document.body.append(control);
    for (const key of ['B', 'S', 'X']) fireEvent.keyDown(control, { key, shiftKey: true, cancelable: true });
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(mocks.closePosition).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select', 'editable', 'plaintext', 'dialog', 'menu', 'local'])('does not trade while keyboard focus belongs to %s', (kind) => {
    seedPosition(); render(<LastSymbolPanel />);
    const surface = document.createElement(['input', 'textarea', 'select'].includes(kind) ? kind : 'div');
    let target: HTMLElement = surface;
    if (['editable', 'plaintext'].includes(kind)) {
      surface.setAttribute('contenteditable', kind === 'plaintext' ? 'plaintext-only' : '');
      target = document.createElement('span'); surface.append(target);
    } else if (['dialog', 'menu', 'local'].includes(kind)) {
      if (kind === 'local') surface.dataset.shortcutScope = 'local';
      else surface.setAttribute('role', kind);
      target = document.createElement('button'); surface.append(target);
    }
    document.body.append(surface);
    for (const key of ['B', 'S', 'X']) fireEvent.keyDown(target, { key, shiftKey: true });
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(mocks.closePosition).not.toHaveBeenCalled();
  });

  it('keeps deliberate Shift+X closing the existing last-symbol position', async () => {
    seedPosition(); mocks.closePosition.mockResolvedValue({ success: true });
    render(<LastSymbolPanel />);
    fireEvent.keyDown(window, { key: 'X', shiftKey: true });
    await waitFor(() => expect(mocks.closePosition).toHaveBeenCalledExactlyOnceWith('901'));
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(useAppStore.getState().positions).toHaveLength(0));
  });

  it.each([
    ['TEST', 'XAUUSD'], ['achiever-financials', 'XAUUSD.raw'],
    ['myprop-trade', 'BTCUSD-pro'], ['grow-trading-academy', 'EURUSD.r'],
  ])('routes all three local trading chords for broker %s to its exact last symbol (mock transport)', async (brokerId, symbol) => {
    localStorage.setItem('broker_id', brokerId);
    useAppStore.setState({ accountId: '900001', ticks: {}, tickLookup: {}, positions: [{
      id: 901, symbol, side: 'BUY', volume: 0.01, openPrice: 100, currentPrice: 101,
      openTime: '2026-09-10T10:00:00Z', sl: 0, tp: 0, swap: 0, commission: 0, unrealizedPnL: 1,
    }] });
    useAppStore.getState().setTicks({ [symbol]: { symbol, bid: 101, ask: 102, spread: 1, timestamp: Date.now(), digits: 2 } });
    useLastSymbolStore.setState({ lastSymbol: symbol });
    mocks.closePosition.mockResolvedValue({ success: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch'); render(<LastSymbolPanel />);
    fireEvent.keyDown(window, { key: 'B', shiftKey: true });
    fireEvent.keyDown(window, { key: 'S', shiftKey: true });
    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeMarketOrder.mock.calls.map(([order]) => ({ symbol: order.symbol, side: order.side, login: order.login }))).toEqual([
      { symbol: symbol.toUpperCase(), side: 'buy', login: 900001 },
      { symbol: symbol.toUpperCase(), side: 'sell', login: 900001 },
    ]);
    fireEvent.keyDown(window, { key: 'X', shiftKey: true });
    await waitFor(() => expect(mocks.closePosition).toHaveBeenCalledExactlyOnceWith('901'));
    await waitFor(() => expect(useAppStore.getState().positions).toHaveLength(0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('LastSymbolPanel one-click gate (SUI-T9)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: '200002', isAuthenticated: true, authToken: 'gate-test-token' });
    useAppStore.getState().setTicks({
      EURUSD: { symbol: 'EURUSD', bid: 1.085, ask: 1.0852, spread: 0.0002, timestamp: Date.now(), digits: 5 },
    });
    useLastSymbolStore.setState({ lastSymbol: 'EURUSD', volume: 0.01, autoSLTP: false, useRiskSizing: false });
    act(() => {
      useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: false } }));
    });
    mocks.placeMarketOrder.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: false } }));
  });

  it('one-click OFF: Shift+B opens the order dialog, sends nothing', async () => {
    const dialogs: unknown[] = [];
    const onDialog = (e: Event) => dialogs.push((e as CustomEvent).detail ?? {});
    window.addEventListener('openNewOrder', onDialog);
    try {
      render(<LastSymbolPanel />);
      fireEvent.keyDown(window, { key: 'B', shiftKey: true });
      await waitFor(() => {
        expect(dialogs).toEqual([{ symbol: 'EURUSD', side: 'BUY' }]);
      });
      expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('openNewOrder', onDialog);
    }
  });
});

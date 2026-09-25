// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orders = vi.hoisted(() => ({ placeMarketOrder: vi.fn() }));
vi.mock('../services/api', () => ({ default: { orders } }));
import { OneClickTrading } from './OneClickTrading';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { normalizeMarketStatus } from '../utils/marketStatus';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';

const symbols = ['XAUUSD.raw', 'EURUSD.r', 'BTCUSD-pro', 'ADAUSD', 'USDJPY.r', 'GBPUSD', 'NAS100-F', 'ETHUSD'];
const frames = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'MN'];
const quote = (symbol: string, price: number) => ({ symbol, bid: price, ask: price + 0.01, spread: 0.01, digits: 2, timestamp: Date.now() });
const chart = (symbol: string, index: number) => <section key={index} data-testid={`panel-${index}`}><OneClickTrading
  symbol={symbol} timeframe={frames[index]} visible tradeAllowed marketStatus={normalizeMarketStatus({ symbol, status: 'open' })}
/></section>;
beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ isAuthenticated: true, accountId: '900001', authToken: 'test-token' });
  useAppStore.getState().setTicks(Object.fromEntries(symbols.map((symbol, index) => [symbol, quote(symbol, 1200 + index)])));
  commitBrokerAccountSessionScope({ authenticated: true, accountId: '900001', brokerId: 'test', serverUrl: 'https://test.invalid' });
  orders.placeMarketOrder.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
});

describe('independent one-click chart trading', { timeout: 30000 }, () => {
  it.each(['TEST', 'achiever-financials'])('routes all eight panels with their own exact contract, quote and lot on %s', brokerId => {
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '900001', brokerId, serverUrl: `https://${brokerId}.invalid` });
    render(<>{symbols.map(chart)}</>);
    symbols.forEach((symbol, index) => {
      const panel = within(screen.getByTestId(`panel-${index}`));
      const input = panel.getByRole('spinbutton', { name: 'Lot size' });
      fireEvent.change(input, { target: { value: (index + 1) / 10 } });
      const label = index % 2 ? 'SELL' : 'BUY';
      const button = panel.getByRole('button', { name: new RegExp(`^${label} `) });
      expect(button).toHaveTextContent(String(1200 + index));
      fireEvent.click(button);
      expect(orders.placeMarketOrder).toHaveBeenNthCalledWith(index + 1,
        { side: label.toLowerCase(), symbol, volume: (index + 1) / 10, login: 900001 }, { intentAtMs: expect.any(Number) });
      symbols.slice(index + 1).forEach((_, offset) => expect(within(screen.getByTestId(`panel-${index + offset + 1}`)).getByRole('spinbutton')).toHaveValue('0.01'));
    });
    expect(orders.placeMarketOrder).toHaveBeenCalledTimes(8);
  });

  it('updates only the changed panel and never aliases a suffixed quote to the base symbol', () => {
    const view = render(<>{symbols.map(chart)}</>);
    act(() => useAppStore.getState().setTicks({ ...useAppStore.getState().ticks,
      'xagusd.raw': quote('xagusd.raw', 42), XAGUSD: quote('XAGUSD', 999) }));
    const changed = [...symbols]; changed[3] = 'XAGUSD.RAW';
    view.rerender(<>{changed.map(chart)}</>);
    const panel = within(screen.getByTestId('panel-3'));
    const buy = panel.getByRole('button', { name: /^BUY XAGUSD.RAW/ });
    expect(buy).toHaveTextContent('42.01');
    fireEvent.click(buy);
    expect(orders.placeMarketOrder).toHaveBeenCalledWith({ side: 'buy', symbol: 'XAGUSD.RAW', volume: 0.01, login: 900001 }, { intentAtMs: expect.any(Number) });
    symbols.forEach((symbol, index) => {
      if (index !== 3) expect(within(screen.getByTestId(`panel-${index}`)).getByRole('button', { name: /^BUY / })).toHaveAttribute('aria-label', expect.stringContaining(symbol));
    });
  });

  it('ignores a late order acknowledgement after the broker/account owner changes', async () => {
    let complete: (value: unknown) => void = () => {};
    orders.placeMarketOrder.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const refresh = vi.fn(); window.addEventListener('rtx:force-refresh-positions', refresh);
    const previousLastSymbol = useLastSymbolStore.getState().lastSymbol;
    render(chart(symbols[0], 0));
    fireEvent.click(screen.getByRole('button', { name: /^BUY / }));
    act(() => {
      useAppStore.setState({ accountId: '900002', positions: [], authToken: 'test-token-2' });
      commitBrokerAccountSessionScope({ authenticated: true, accountId: '900002', brokerId: 'achiever', serverUrl: 'https://achiever.invalid' });
    });
    await act(async () => complete({ ticket: 123456, symbol: symbols[0], volume: 0.01, price_open: 1200.01 }));
    expect(useAppStore.getState().positions).toEqual([]);
    expect(useLastSymbolStore.getState().lastSymbol).toBe(previousLastSymbol);
    expect(refresh).not.toHaveBeenCalled();
    window.removeEventListener('rtx:force-refresh-positions', refresh);
  });

  it('switches to the compact two-row control layout as its chart narrows and restores on resize', () => {
    let notify: ResizeObserverCallback = () => {};
    let observed: Element | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe(target: Element) { observed = target; }
      disconnect = disconnect;
      unobserve() {}
    });
    const view = render(chart(symbols[0], 0));
    const outer = screen.getByTestId('one-click-trading-row').parentElement!;
    const resize = (width: number) => act(() => notify([{ target: observed, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    resize(260);
    expect(outer).toHaveAttribute('data-compact', 'true');
    expect(outer).toHaveStyle({ width: 'calc(100% - 20px)', maxWidth: 'calc(100% - 20px)' });
    expect(screen.getByRole('button', { name: /^BUY / })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^SELL / })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Increase lot size' })).toHaveStyle({ minWidth: '24px', height: '28px' });
    resize(600);
    expect(outer).toHaveAttribute('data-compact', 'false');
    view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
  });
});

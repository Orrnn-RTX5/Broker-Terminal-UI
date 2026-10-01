// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const freshnessMocks = vi.hoisted(() => ({ enabled: false, live: true, reason: 'live', assert: vi.fn() }));
vi.mock('../services/terminalQuoteFreshness', () => ({ canSubmitTerminalMarketOrder: (state: {live:boolean;reason:string}) => state.live || state.reason === 'time-unverified', terminalMarketQuoteAdvisory: (state: {reason:string}) => state.reason === 'time-unverified' ? 'Quote age uncertain; server will validate' : null, assertTerminalMarketOrderQuote: freshnessMocks.assert, terminalQuoteBlockMessage: (reason: string, symbol: string) => reason === 'time-unverified' ? 'Syncing time for ' + symbol : 'Waiting for a fresh quote', terminalQuoteFreshnessEnabled: () => freshnessMocks.enabled, assertTerminalQuoteFresh: freshnessMocks.assert }));
vi.mock('../hooks/useTerminalQuoteFreshness', () => ({ useTerminalQuoteFreshness: () => ({ live: freshnessMocks.live, ageMs: 0, reason: freshnessMocks.reason }) }));

const orderMocks = vi.hoisted(() => ({
  placeMarketOrder: vi.fn(),
}));

const feedMocks = vi.hoisted(() => ({
  requestMarketSymbolsRefresh: vi.fn(),
  getMarketSymbolFreshness: vi.fn(),
}));

vi.mock('../services/api', () => ({
  default: { orders: { placeMarketOrder: orderMocks.placeMarketOrder } },
}));

vi.mock('../hooks/useLiveMarketData', () => ({
  requestMarketSymbolsRefresh: feedMocks.requestMarketSymbolsRefresh,
  getMarketSymbolFreshness: feedMocks.getMarketSymbolFreshness,
}));

import { useAppStore } from '../store/useAppStore';
import { normalizeMarketStatus } from '../utils/marketStatus';
import { OneClickTrading } from './OneClickTrading';

const getTradeButton = (label: 'BUY' | 'SELL'): HTMLButtonElement => {
  const button = screen.getByText(label).closest('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${label} button`);
  }
  return button;
};

const staleOrderError = () => Object.assign(new Error('HTTP Error: 409'), {
  status: 409,
  data: { error_code: 'STALE_QUOTE', message: 'Quote is stale for BTCUSD' },
});

const neverSettlingRefresh = () => new Promise<void>(() => {});

describe('OneClickTrading stale-quote refresh', () => {
  beforeEach(() => {
    freshnessMocks.enabled = false; freshnessMocks.live = true; freshnessMocks.reason = 'live'; freshnessMocks.assert.mockReset();
    useAppStore.getState().reset();
    useAppStore.setState({
      isAuthenticated: true,
      accountId: '10001',
      authToken: 'quote-refresh-test-token',
      tokenExpiresAt: Date.now() + 60_000,
    });
    useAppStore.getState().setTicks({
      BTCUSD: {
        symbol: 'BTCUSD',
        bid: 78000,
        ask: 78010,
        spread: 10,
        timestamp: Date.now(),
        digits: 2,
      },
    });
    orderMocks.placeMarketOrder.mockReset();
    feedMocks.requestMarketSymbolsRefresh.mockReset();
    feedMocks.requestMarketSymbolsRefresh.mockImplementation(neverSettlingRefresh);
    feedMocks.getMarketSymbolFreshness.mockReset();
    feedMocks.getMarketSymbolFreshness.mockReturnValue({
      symbol: 'BTCUSD',
      ageSec: 42,
      fresh: false,
      stale: true,
      silent: false,
      observedAt: Date.now(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderPanel = (tradeAllowed: boolean) => render(
    <OneClickTrading
      symbol="BTCUSD"
      timeframe="M1"
      visible
      tradeAllowed={tradeAllowed}
      marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'open' })}
    />,
  );

  it('preserves the actual backend error and only refreshes data after a stale rejection', async () => {
    orderMocks.placeMarketOrder.mockRejectedValueOnce(Object.assign(new Error('risk quote XAUUSD: Quote is stale'), {
      code: 'QUOTE_STALE', backendMessage: 'risk quote XAUUSD: Quote is stale', preserveBackendOrderError: true,
    }));
    renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('QUOTE_STALE: risk quote XAUUSD: Quote is stale'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Waiting for a fresh quote');
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('quote for BTCUSD');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce();
  });

  it('requires a new deliberate click after stale recovery and refresh completion', async () => {
    orderMocks.placeMarketOrder.mockRejectedValueOnce(staleOrderError()).mockResolvedValueOnce({ ticket: 555 });
    feedMocks.requestMarketSymbolsRefresh.mockResolvedValue(undefined);
    renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, bid: 78001, timestamp: Date.now() + 1 } }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledTimes(1);
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(orderMocks.placeMarketOrder).toHaveBeenCalledTimes(2));
  });

  it('checks current freshness synchronously even if the rendered quote was live', async () => {
    freshnessMocks.enabled = true;
    freshnessMocks.assert.mockImplementation(() => { throw staleOrderError(); });
    renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    freshnessMocks.assert.mockReset();
    act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, timestamp: Date.now() + 1 } }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    orderMocks.placeMarketOrder.mockResolvedValueOnce({ ticket: 555 });
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce());
  });

  it('does not bypass permissions when strict freshness is live', () => {
    freshnessMocks.enabled = true;
    renderPanel(false);
    expect(getTradeButton('BUY')).toBeDisabled();
    fireEvent.click(getTradeButton('BUY'));
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('polls proactively while an authenticated session sees a disabled stale-blocked button', () => {
    const view = renderPanel(false);
    expect(getTradeButton('BUY').disabled).toBe(true);
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    view.rerender(
      <OneClickTrading
        symbol="BTCUSD"
        timeframe="M1"
        visible
        tradeAllowed
        marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'open' })}
      />,
    );
    expect(getTradeButton('BUY').disabled).toBe(false);
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(1);
  });
  it('clears a clock-only block without a new tick and never replays its click', async () => {
    freshnessMocks.enabled = true;
    freshnessMocks.assert.mockImplementation(() => {
      freshnessMocks.live = false;
      throw Object.assign(new Error('Syncing time for BTCUSD'), {code:'QUOTE_TIME_UNVERIFIED',symbol:'BTCUSD'});
    });
    const view = renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('QUOTE_TIME_UNVERIFIED'));
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    freshnessMocks.live = true; freshnessMocks.assert.mockReset();
    view.rerender(<OneClickTrading symbol="BTCUSD" timeframe="M1" visible tradeAllowed marketStatus={normalizeMarketStatus({symbol:'BTCUSD',status:'open'})} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    orderMocks.placeMarketOrder.mockResolvedValueOnce({ticket:555});
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce());
  });

  it('allows one deliberate uncertain-age market click and preserves backend rejection without replay', async () => {
    freshnessMocks.enabled = true; freshnessMocks.live = false; freshnessMocks.reason = 'time-unverified';
    orderMocks.placeMarketOrder.mockRejectedValueOnce(staleOrderError());
    const view = renderPanel(true);
    expect(getTradeButton('BUY')).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('server will validate');
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('STALE_QUOTE'));
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce();
    freshnessMocks.live = true; freshnessMocks.reason = 'live';
    view.rerender(<OneClickTrading symbol="BTCUSD" timeframe="M1" visible tradeAllowed marketStatus={normalizeMarketStatus({symbol:'BTCUSD',status:'open'})} />);
    act(() => useAppStore.getState().setTicks({ BTCUSD: {...useAppStore.getState().ticks.BTCUSD, timestamp:Date.now()+1} }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce();
    orderMocks.placeMarketOrder.mockResolvedValueOnce({ticket:556});
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(orderMocks.placeMarketOrder).toHaveBeenCalledTimes(2));
  });

});

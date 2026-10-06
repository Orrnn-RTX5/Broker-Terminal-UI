// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const freshnessMocks = vi.hoisted(() => ({ enabled: false, live: true, reason: 'live', sourcePolicyReason: undefined as string | undefined, ageMaxMs: 0 as number | null, assert: vi.fn() }));
const preflightMocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('../services/terminalMarketQuotePreflight', () => ({ prepareTerminalMarketQuote: preflightMocks.prepare, TERMINAL_MARKET_QUOTE_WAIT_MS: 1500, TERMINAL_MARKET_QUOTE_RECOVERY_MAX_AGE_MS: 1000 }));
vi.mock('../services/terminalQuoteFreshness', () => ({ getTerminalQuoteFreshness: () => ({ ageMaxMs: freshnessMocks.ageMaxMs }), getTerminalQuoteSession: () => 1, canSubmitTerminalMarketOrder: (state: {live:boolean;reason:string}) => state.live || state.reason === 'time-unverified', terminalMarketQuoteAdvisory: (state: {reason:string}) => state.reason === 'time-unverified' ? 'Quote age uncertain; server will validate' : null, assertTerminalMarketOrderQuote: freshnessMocks.assert, terminalQuoteBlockMessage: (reason: string, symbol: string) => reason === 'time-unverified' ? 'Syncing time for ' + symbol : 'Waiting for a fresh quote', terminalQuoteFreshnessEnabled: () => freshnessMocks.enabled, assertTerminalQuoteFresh: freshnessMocks.assert }));
vi.mock('../hooks/useTerminalQuoteFreshness', () => ({ useTerminalQuoteFreshness: () => ({ live: freshnessMocks.live, sourcePolicyReason: freshnessMocks.sourcePolicyReason, ageMs: 0, reason: freshnessMocks.reason, clockStatus: freshnessMocks.reason === 'time-unverified' ? 'unverified' : 'verified' }) }));

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
import { getQuoteDiagnosticDump } from '../services/quoteDiagnostics';
import { extractActiveMarketSymbols } from '../features/market-data/useActiveMarketSymbols';
import { resolveTradeEligibleSymbolNames } from '../utils/accountSymbolUniverse';

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
    freshnessMocks.sourcePolicyReason = undefined;
    freshnessMocks.enabled = false; freshnessMocks.live = true; freshnessMocks.reason = 'live'; freshnessMocks.ageMaxMs = 0; freshnessMocks.assert.mockReset();
    preflightMocks.prepare.mockReset().mockImplementation(() => { freshnessMocks.assert(); });
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
    delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__;
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

  it.each([['source-off', 'Price source is off'], ['source-switching', 'Price source is switching'], ['source-mismatch', 'Quote source mismatch']])('shows %s before the generic stale explanation and leaves orders blocked', (reason, message) => {
    freshnessMocks.enabled = true; freshnessMocks.live = false; freshnessMocks.reason = 'stale'; freshnessMocks.sourcePolicyReason = reason;
    renderPanel(false); expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(getTradeButton('BUY')).toBeDisabled(); fireEvent.click(getTradeButton('BUY'));
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('records a disabled-before-send permission decision even while the quote advisory allows orders', () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    freshnessMocks.enabled = true; freshnessMocks.live = false; freshnessMocks.reason = 'time-unverified';
    renderPanel(false);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Trading is not available for BTCUSD');
    expect(screen.getByRole('status')).not.toHaveTextContent('server will validate');
    fireEvent.click(getTradeButton('BUY'));
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(getQuoteDiagnosticDump().controls.at(-1)).toMatchObject({ kind: 'trade-control', phase: 'rendered-state',
      symbol: 'BTCUSD', disabled: true, reason: 'symbol-not-eligible', quotePermitsOrder: true, tradeAllowed: false });
    expect(JSON.stringify(getQuoteDiagnosticDump())).not.toContain('quote-refresh-test-token');
  });

  it('explains a disabled quote guard and clears it when the same displayed prices become executable', () => {
    freshnessMocks.enabled = true; freshnessMocks.live = false; freshnessMocks.reason = 'stale';
    const panel = renderPanel(true);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(getTradeButton('SELL')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for a fresh quote');
    fireEvent.click(getTradeButton('BUY'));
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    freshnessMocks.live = true; freshnessMocks.reason = 'live';
    panel.rerender(<OneClickTrading symbol="BTCUSD" timeframe="M1" visible tradeAllowed
      marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'open' })} />);
    expect(getTradeButton('BUY')).not.toBeDisabled();
    expect(getTradeButton('SELL')).not.toBeDisabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

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

  it('waits before sending once when a click encounters a short provider gap', async () => {
    freshnessMocks.enabled = true;
    let ready!: () => void;
    preflightMocks.prepare.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    orderMocks.placeMarketOrder.mockResolvedValueOnce({ ticket: 555 });
    renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for a fresh quote');
    expect(getTradeButton('BUY')).toBeDisabled();
    fireEvent.click(getTradeButton('BUY'));
    await act(async () => ready());
    expect(orderMocks.placeMarketOrder).toHaveBeenCalledOnce();
    expect(preflightMocks.prepare).toHaveBeenCalledOnce();
  });

  it.each([1001, null])('rejects recovery that lost execution headroom before submission: %s', async age => {
    freshnessMocks.enabled = true;
    let ready!: () => void;
    preflightMocks.prepare.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    renderPanel(true); fireEvent.click(getTradeButton('BUY'));
    freshnessMocks.ageMaxMs = age;
    await act(async () => ready());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('QUOTE_STALE');
  });

  it.each(['symbol', 'permission', 'hidden', 'unmount', 'volume', 'changed-back'] as const)('cancels the unsent waiting click after %s changes', async change => {
    freshnessMocks.enabled = true;
    let ready!: () => void;
    preflightMocks.prepare.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    const view = renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    if (change === 'unmount') view.unmount();
    else if (change === 'volume' || change === 'changed-back') {
      fireEvent.change(screen.getByLabelText('Lot size'), { target: { value: '0.02' } });
      if (change === 'changed-back') fireEvent.change(screen.getByLabelText('Lot size'), { target: { value: '0.01' } });
    }
    else view.rerender(<OneClickTrading symbol={change === 'symbol' ? 'XAUUSD' : 'BTCUSD'} timeframe="M1"
      visible={change !== 'hidden'} tradeAllowed={change !== 'permission'}
      marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'open' })} />);
    await act(async () => ready());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('requires a new click after preflight expiry and does not replay on later recovery', async () => {
    freshnessMocks.enabled = true;
    preflightMocks.prepare.mockRejectedValueOnce(staleOrderError());
    renderPanel(true);
    fireEvent.click(getTradeButton('BUY'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
    act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, timestamp: Date.now() + 1 } }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
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

  it.each([1000, 6000])('revalidates an excluded feed snapshot when quotes recover after %ims without replaying an order', async (recoveryDelay) => {
    vi.useFakeTimers();
    freshnessMocks.enabled = true;
    freshnessMocks.live = false;
    freshnessMocks.reason = 'stale';
    let statusResponse = { symbol_status: [{ symbol: 'BTCUSD', has_quote: true, fresh: false, stale: true, last_tick_age_sec: 3.5 }] };
    expect(extractActiveMarketSymbols(statusResponse)).toEqual([]);

    // Reproduce App's real catalogue/feed intersection while letting only a
    // completed status refresh replace its snapshot. Fresh WS ticks alone do
    // not update that snapshot in the current application.
    const SnapshotGatedPanel = () => {
      const [activeFeedSymbols, setActiveFeedSymbols] = useState(() => extractActiveMarketSymbols(statusResponse));
      feedMocks.requestMarketSymbolsRefresh.mockImplementation(async () => {
        setActiveFeedSymbols(extractActiveMarketSymbols(statusResponse));
      });
      const tradeAllowed = resolveTradeEligibleSymbolNames({
        isAuthenticated: true, feedCurrent: true,
        authorizedSymbols: ['BTCUSD'], activeFeedSymbols,
      }).includes('BTCUSD');
      return <OneClickTrading symbol="BTCUSD" timeframe="M1" visible tradeAllowed={tradeAllowed}
        marketStatus={normalizeMarketStatus({ symbol: 'BTCUSD', status: 'open' })} />;
    };

    render(<SnapshotGatedPanel />);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(getTradeButton('BUY')).toHaveAttribute('title', 'Trading is not available for BTCUSD.');
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(recoveryDelay));
    statusResponse = { symbol_status: [{ symbol: 'BTCUSD', has_quote: true, fresh: true, stale: false, last_tick_age_sec: 0.1 }] };
    freshnessMocks.live = true;
    freshnessMocks.reason = 'live';
    act(() => useAppStore.getState().setTicks({ BTCUSD: {
      ...useAppStore.getState().ticks.BTCUSD, bid: 78001, ask: 78011, timestamp: Date.now(),
    } }));
    // Verified recovery gets one immediate revalidation, even inside the
    // normal refresh rate limit. It still needs authoritative permission.
    await act(async () => Promise.resolve());
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    expect(getTradeButton('BUY')).not.toBeDisabled();
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it.each(['unmount', 'symbol', 'session', 'unblocked'] as const)('cancels a trailing recovery refresh on %s changes', async (change) => {
    vi.useFakeTimers();
    freshnessMocks.enabled = true;
    freshnessMocks.live = false;
    freshnessMocks.reason = 'stale';
    feedMocks.requestMarketSymbolsRefresh.mockResolvedValue(undefined);
    const view = renderPanel(false);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    freshnessMocks.live = false;
    freshnessMocks.reason = 'time-unverified';
    act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, bid: 78001 } }));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();
    if (change === 'unmount') view.unmount();
    else if (change === 'session') act(() => useAppStore.setState({ isAuthenticated: false, authToken: null, accountId: null }));
    else view.rerender(<OneClickTrading symbol={change === 'symbol' ? 'EURUSD' : 'BTCUSD'} timeframe="M1" visible tradeAllowed
      marketStatus={normalizeMarketStatus({ symbol: change === 'symbol' ? 'EURUSD' : 'BTCUSD', status: 'open' })} />);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('does not reset the trailing timer or start a refresh loop for unchanged executable ticks and denied catalogue permission', async () => {
    vi.useFakeTimers();
    useAppStore.setState({ tokenExpiresAt: Date.now() + 120_000 });
    freshnessMocks.enabled = true;
    freshnessMocks.live = false;
    freshnessMocks.reason = 'stale';
    feedMocks.requestMarketSymbolsRefresh.mockResolvedValue(undefined);
    const denied = resolveTradeEligibleSymbolNames({ isAuthenticated: true, feedCurrent: true,
      authorizedSymbols: ['EURUSD'], activeFeedSymbols: ['BTCUSD', 'EURUSD'] }).includes('BTCUSD');
    renderPanel(denied);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    freshnessMocks.live = false;
    freshnessMocks.reason = 'time-unverified';
    for (let i = 0; i < 4; i++) {
      act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, bid: 78001 + i } }));
      await act(async () => vi.advanceTimersByTimeAsync(1000));
    }
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('waits for an outstanding refresh and remains blocked when recovery status fails', async () => {
    vi.useFakeTimers();
    useAppStore.setState({ tokenExpiresAt: Date.now() + 120_000 });
    freshnessMocks.enabled = true;
    freshnessMocks.live = false;
    freshnessMocks.reason = 'stale';
    let finishInitialRefresh!: () => void;
    feedMocks.requestMarketSymbolsRefresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishInitialRefresh = resolve; }))
      .mockRejectedValue(new Error('status unavailable'));
    renderPanel(false);
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    freshnessMocks.live = true;
    freshnessMocks.reason = 'live';
    act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, bid: 78001 } }));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();
    await act(async () => finishInitialRefresh());
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('keeps the recovery throttle bounded when the wall clock moves backwards', async () => {
    vi.useFakeTimers();
    freshnessMocks.enabled = true;
    freshnessMocks.live = false;
    freshnessMocks.reason = 'stale';
    feedMocks.requestMarketSymbolsRefresh.mockResolvedValue(undefined);
    renderPanel(false);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    vi.setSystemTime(Date.now() - 60_000);
    freshnessMocks.live = false;
    freshnessMocks.reason = 'time-unverified';
    act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, bid: 78001 } }));
    await act(async () => vi.advanceTimersByTimeAsync(3999));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
  });

  it('allows only one immediate verified recovery per excluded episode despite boundary jitter', async () => {
    vi.useFakeTimers();
    freshnessMocks.enabled = true;
    freshnessMocks.live = false;
    freshnessMocks.reason = 'stale';
    feedMocks.requestMarketSymbolsRefresh.mockResolvedValue(undefined);
    renderPanel(false);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    let tickCount = 0;
    const publishState = (live: boolean, reason: string) => {
      freshnessMocks.live = live;
      freshnessMocks.reason = reason;
      act(() => useAppStore.getState().setTicks({ BTCUSD: { ...useAppStore.getState().ticks.BTCUSD, bid: 78000 + ++tickCount } }));
    };
    publishState(false, 'time-unverified');
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledOnce();
    publishState(true, 'live');
    await act(async () => Promise.resolve());
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 20; i++) {
      publishState(false, 'stale');
      await act(async () => vi.advanceTimersByTimeAsync(10));
      publishState(true, 'live');
      await act(async () => vi.advanceTimersByTimeAsync(10));
    }
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(4600));
    expect(feedMocks.requestMarketSymbolsRefresh).toHaveBeenCalledTimes(3);
    expect(getTradeButton('BUY')).toBeDisabled();
    expect(orderMocks.placeMarketOrder).not.toHaveBeenCalled();
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

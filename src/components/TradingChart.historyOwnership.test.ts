import React, { useCallback } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSelectedHistoryRequestOwner } from '../hooks/useSelectedHistoryRequestOwner';
import {
  useTradingChartVisibleRuntime,
  type TradingChartVisibleResource,
} from '../hooks/useTradingChartVisibleRuntime';
import { createSelectedTimeframeHistoryCoordinator } from '../services/chartHistoryLoader';
import type { OHLCData } from '../services/chartDataService';

interface HarnessProps {
  symbol: string;
  timeframe: string;
  enabled?: boolean;
  authToken: string;
  marketOpen: boolean;
  onLoad: (selection: {
    symbol: string;
    timeframe: string;
    authToken: string;
    marketOpen: boolean;
  }) => void | Promise<void>;
  onAbort: (authToken: string, marketOpen: boolean) => void;
}

const HistoryOwnerHarness = ({
  symbol,
  timeframe,
  enabled = true,
  authToken,
  marketOpen,
  onLoad,
  onAbort,
}: HarnessProps) => {
  const load = useCallback(
    (selection: { symbol: string; timeframe: string }) => onLoad({ ...selection, authToken, marketOpen }),
    [authToken, marketOpen, onLoad],
  );
  const abort = useCallback(
    () => onAbort(authToken, marketOpen),
    [authToken, marketOpen, onAbort],
  );

  useSelectedHistoryRequestOwner({ symbol, timeframe, enabled, load, abort });
  return null;
};

const candle = (time: number): OHLCData => ({
  time,
  open: time,
  high: time + 1,
  low: time - 1,
  close: time,
  volume: 1,
});

const flushHistoryOwner = () => act(async () => {
  await Promise.resolve();
});

interface RuntimeHarnessProps {
  active: boolean;
  authToken: string;
  onLoad: HarnessProps['onLoad'];
  onAbort: HarnessProps['onAbort'];
  onAcquire: (resource: TradingChartVisibleResource) => void;
  onRelease: (resource: TradingChartVisibleResource) => void;
}

const ActiveRuntimeHarness = ({
  active,
  authToken,
  onLoad,
  onAbort,
  onAcquire,
  onRelease,
}: RuntimeHarnessProps) => {
  useSelectedHistoryRequestOwner({
    symbol: 'XAUUSD',
    timeframe: 'M5',
    enabled: active,
    load: selection => onLoad({ ...selection, authToken, marketOpen: true }),
    abort: () => onAbort(authToken, true),
  });

  useTradingChartVisibleRuntime({
    active,
    hasSymbol: true,
    onAcquire,
    onRelease,
  });

  return null;
};

describe('selected history request ownership lifecycle', () => {
  it('mounts and cleans every high-frequency runtime only for the visible lifecycle', async () => {
    const onLoad = vi.fn();
    const onAbort = vi.fn();
    const onAcquire = vi.fn();
    const onRelease = vi.fn();
    const props = {
      active: false,
      authToken: 'account-a-token',
      onLoad,
      onAbort,
      onAcquire,
      onRelease,
    };
    const view = render(React.createElement(ActiveRuntimeHarness, props));

    expect(onLoad).not.toHaveBeenCalled();
    expect(onAcquire).not.toHaveBeenCalled();

    view.rerender(React.createElement(ActiveRuntimeHarness, {
      ...props,
      active: true,
      authToken: 'account-b-token',
    }));
    await flushHistoryOwner();

    const resources: TradingChartVisibleResource[] = [
      'history',
      'status',
      'quote',
      'candle',
      'interval',
      'overlay',
    ];
    resources.forEach(resource => {
      expect(onAcquire).toHaveBeenCalledWith(resource);
    });
    expect(onAcquire).toHaveBeenCalledTimes(resources.length);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenLastCalledWith({
      symbol: 'XAUUSD',
      timeframe: 'M5',
      authToken: 'account-b-token',
      marketOpen: true,
    });

    view.rerender(React.createElement(ActiveRuntimeHarness, {
      ...props,
      active: false,
      authToken: 'account-b-token',
    }));
    await flushHistoryOwner();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(resources.length);
    resources.forEach(resource => {
      expect(onRelease).toHaveBeenCalledWith(resource);
    });

    view.rerender(React.createElement(ActiveRuntimeHarness, {
      ...props,
      active: true,
      authToken: 'account-b-token',
    }));
    await flushHistoryOwner();
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(onAcquire).toHaveBeenCalledTimes(resources.length * 2);

    view.unmount();
    expect(onAbort).toHaveBeenCalledTimes(2);
    expect(onRelease).toHaveBeenCalledTimes(resources.length * 2);
  });

  it('does no hidden work and catches up once with the latest account context on activation', async () => {
    const onLoad = vi.fn();
    const onAbort = vi.fn();
    const view = render(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      enabled: false,
      authToken: 'account-a-token',
      marketOpen: true,
      onLoad,
      onAbort,
    }));

    expect(onLoad).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();

    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      enabled: false,
      authToken: 'account-b-token',
      marketOpen: false,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(onLoad).not.toHaveBeenCalled();

    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      enabled: true,
      authToken: 'account-b-token',
      marketOpen: false,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenLastCalledWith({
      symbol: 'XAUUSD',
      timeframe: 'M5',
      authToken: 'account-b-token',
      marketOpen: false,
    });

    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      enabled: false,
      authToken: 'account-b-token',
      marketOpen: false,
      onLoad,
      onAbort,
    }));
    expect(onAbort).toHaveBeenCalledTimes(1);

    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      enabled: true,
      authToken: 'account-b-token',
      marketOpen: false,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();
    expect(onLoad).toHaveBeenCalledTimes(2);
  });

  it('owns one selected request for tabbed visibility and one per visible tiled chart', async () => {
    const tabOneLoad = vi.fn();
    const tabTwoLoad = vi.fn();
    const tabOneAbort = vi.fn();
    const tabTwoAbort = vi.fn();
    const view = render(React.createElement(React.Fragment, null,
      React.createElement(HistoryOwnerHarness, {
        symbol: 'XAUUSD', timeframe: 'M5', enabled: true, authToken: 'token', marketOpen: true,
        onLoad: tabOneLoad, onAbort: tabOneAbort,
      }),
      React.createElement(HistoryOwnerHarness, {
        symbol: 'EURUSD', timeframe: 'M5', enabled: false, authToken: 'token', marketOpen: true,
        onLoad: tabTwoLoad, onAbort: tabTwoAbort,
      }),
    ));
    await flushHistoryOwner();

    expect(tabOneLoad).toHaveBeenCalledTimes(1);
    expect(tabTwoLoad).not.toHaveBeenCalled();

    view.rerender(React.createElement(React.Fragment, null,
      React.createElement(HistoryOwnerHarness, {
        symbol: 'XAUUSD', timeframe: 'M5', enabled: true, authToken: 'token', marketOpen: true,
        onLoad: tabOneLoad, onAbort: tabOneAbort,
      }),
      React.createElement(HistoryOwnerHarness, {
        symbol: 'EURUSD', timeframe: 'M5', enabled: true, authToken: 'token', marketOpen: true,
        onLoad: tabTwoLoad, onAbort: tabTwoAbort,
      }),
    ));
    await flushHistoryOwner();

    expect(tabOneLoad).toHaveBeenCalledTimes(1);
    expect(tabTwoLoad).toHaveBeenCalledTimes(1);
  });

  it('starts once per selection and ignores loader, auth, and market-status identity churn', async () => {
    const onLoad = vi.fn();
    const onAbort = vi.fn();
    const view = render(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      authToken: 'token-a',
      marketOpen: true,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenLastCalledWith({
      symbol: 'XAUUSD',
      timeframe: 'M5',
      authToken: 'token-a',
      marketOpen: true,
    });

    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      authToken: 'token-b',
      marketOpen: false,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();

    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'H1',
      authToken: 'token-b',
      marketOpen: false,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenLastCalledWith({
      symbol: 'XAUUSD',
      timeframe: 'H1',
      authToken: 'token-b',
      marketOpen: false,
    });

    view.unmount();
    expect(onAbort).toHaveBeenCalledTimes(2);
  });

  it('aborts a switched or unmounted request and never applies its stale resolution', async () => {
    const coordinator = createSelectedTimeframeHistoryCoordinator();
    const resolvers: Array<(candles: OHLCData[]) => void> = [];
    const signals: AbortSignal[] = [];
    const applied = vi.fn();

    const onLoad = async ({ symbol, timeframe }: { symbol: string; timeframe: string }) => {
      const request = coordinator.start(
        { symbol, timeframe, count: 500 },
        options => {
          signals.push(options.signal as AbortSignal);
          return new Promise<OHLCData[]>(resolve => resolvers.push(resolve));
        },
      );
      const candles = await request.result;
      if (request.isCurrent()) applied(symbol, timeframe, candles);
    };
    const onAbort = () => coordinator.abort();

    const view = render(React.createElement(HistoryOwnerHarness, {
      symbol: 'XAUUSD',
      timeframe: 'M5',
      authToken: 'token',
      marketOpen: true,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(resolvers).toHaveLength(1);
    view.rerender(React.createElement(HistoryOwnerHarness, {
      symbol: 'EURUSD',
      timeframe: 'H1',
      authToken: 'token',
      marketOpen: true,
      onLoad,
      onAbort,
    }));
    await flushHistoryOwner();

    expect(resolvers).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      resolvers[0]([candle(300)]);
      await Promise.resolve();
    });
    expect(applied).not.toHaveBeenCalled();

    await act(async () => {
      resolvers[1]([candle(3600)]);
      await Promise.resolve();
    });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledWith('EURUSD', 'H1', [candle(3600)]);

    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it('starts exactly one automatic request under React StrictMode', async () => {
    const onLoad = vi.fn();
    const onAbort = vi.fn();

    const view = render(React.createElement(
      React.StrictMode,
      null,
      React.createElement(HistoryOwnerHarness, {
        symbol: 'XAUUSD',
        timeframe: 'M5',
        authToken: 'token',
        marketOpen: true,
        onLoad,
        onAbort,
      }),
    ));

    await flushHistoryOwner();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();

    view.unmount();
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('market data Redux DevTools isolation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete (window as typeof window & { __REDUX_DEVTOOLS_EXTENSION__?: unknown })
      .__REDUX_DEVTOOLS_EXTENSION__;
  });

  it('does not connect or send raw rolling tick buffers', async () => {
    const send = vi.fn();
    const connect = vi.fn(() => ({
      init: vi.fn(),
      send,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    }));
    Object.defineProperty(window, '__REDUX_DEVTOOLS_EXTENSION__', {
      configurable: true,
      value: { connect },
    });

    vi.doMock('../services/aggregationWorkerManager', () => ({
      getWorkerManager: () => ({
        aggregateMultipleTimeframes: vi.fn(),
      }),
    }));

    const { useMarketDataStore } = await import('./useMarketDataStore');
    useMarketDataStore.getState().updateTick('XAUUSD', {
      symbol: 'XAUUSD',
      bid: 2_500,
      ask: 2_500.2,
      spread: 0.2,
      timestamp: 1,
    }, { syncAppStore: false });

    expect(connect).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueLiveTick: vi.fn(),
}));

vi.mock('./liveTickDispatcher', () => ({
  enqueueLiveTick: mocks.enqueueLiveTick,
}));

import {
  EnhancedWebSocketService,
  isEnhancedStoreHandledTickFrame,
  type WebSocketMessage,
} from './websocket-enhanced';

type TestableService = {
  handleMessage: (message: WebSocketMessage) => void;
};

describe('EnhancedWebSocketService tick normalization', () => {
  beforeEach(() => {
    mocks.enqueueLiveTick.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues a direct tick once without changing repeated BTC prices', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    const message: WebSocketMessage = {
      type: 'tick',
      symbol: 'BTCUSD',
      bid: 78_900.25,
      ask: 78_912.75,
      daily_change_pct: -0.64,
      timestamp: 1_725_000_000,
    };

    expect(isEnhancedStoreHandledTickFrame(message)).toBe(true);
    (service as unknown as TestableService).handleMessage(message);
    (service as unknown as TestableService).handleMessage(message);

    expect(mocks.enqueueLiveTick).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueLiveTick.mock.calls.map(([, tick]) => ({
      bid: tick.bid,
      ask: tick.ask,
    }))).toEqual([
      { bid: 78_900.25, ask: 78_912.75 },
      { bid: 78_900.25, ask: 78_912.75 },
    ]);
    expect(mocks.enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      dailyChange: -0.64,
      timestamp: 1_725_000_000_000,
      sourceTimestamp: 1_725_000_000_000,
    });

    service.destroy();
  });

  it('enqueues a suffixed channel tick exactly once and preserves envelope broker time', () => {
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    (service as unknown as TestableService).handleMessage({
      type: 'channel_message',
      channel: 'ticks.EURUSD.pro',
      timestamp: 1_725_000_000,
      data: {
        // Some gateways return the base alias inside the exact suffixed channel.
        symbol: 'EURUSD',
        bid: 1.10203,
        ask: 1.10215,
        daily_change_pct: 0.08,
      },
    });

    expect(mocks.enqueueLiveTick).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueLiveTick).toHaveBeenCalledWith('EURUSD.PRO', expect.objectContaining({
      symbol: 'EURUSD.PRO',
      bid: 1.10203,
      ask: 1.10215,
      dailyChange: 0.08,
      timestamp: 1_725_000_000_000,
      sourceTimestamp: 1_725_000_000_000,
    }));

    service.destroy();
  });

  it('uses local receipt time without fabricating broker source time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_777_000_000_123);
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');

    (service as unknown as TestableService).handleMessage({
      type: 'tick',
      symbol: 'ETHUSD',
      bid: 4_600.1,
      ask: 4_601.2,
    });

    expect(mocks.enqueueLiveTick).toHaveBeenCalledOnce();
    expect(mocks.enqueueLiveTick.mock.calls[0][1]).toMatchObject({
      timestamp: 1_777_000_000_123,
      sourceTimestamp: undefined,
    });
    service.destroy();
  });

  it('leaves legacy and malformed quote frames for App normalization', () => {
    expect(isEnhancedStoreHandledTickFrame({
      type: 'tick', symbol: 'BTCUSD', price: 78_900,
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'channel_message', channel: 'quotes.BTCUSD', data: { bid: 1, ask: 2 },
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'channel_message', channel: 'prices', data: { bid: 1, ask: 2 },
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'update', symbol: 'BTCUSD', bid: 1, ask: 2,
    })).toBe(false);
    expect(isEnhancedStoreHandledTickFrame({
      type: 'channel_message', channel: 'ticks.BTCUSD', data: { bid: 1 },
    })).toBe(false);
  });
});

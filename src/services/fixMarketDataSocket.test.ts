import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueLiveTick = vi.hoisted(() => vi.fn());

vi.mock('./liveTickDispatcher', () => ({
  enqueueLiveTick,
}));

import { FixMarketDataSocket, type FixTickMessage } from './fixMarketDataSocket';
import { useWebSocketStore } from '../store/useWebSocketStore';

type TestableSocket = {
  handleMessage: (message: FixTickMessage) => void;
};

describe('FixMarketDataSocket tick normalization', () => {
  beforeEach(() => {
    enqueueLiveTick.mockReset();
  });

  it('preserves actual optional aliases and leaves absent volume undefined', () => {
    const socket = new FixMarketDataSocket('wss://example.test/ws/v2');

    (socket as unknown as TestableSocket).handleMessage({
      type: 'tick',
      symbol: 'XAUUSD',
      bid: 4_411.09,
      ask: 4_411.2,
      spread: 0.11,
      timestamp: 1_725_000_000,
      high_24h: 4_430.5,
      low_24h: 4_390.25,
      last_price: 4_411.15,
      tick_volume: 321,
      provider: 'Prime LP',
      daily_open: 4_400,
      previous_close: 4_398,
    });

    expect(enqueueLiveTick).toHaveBeenCalledWith('XAUUSD', expect.objectContaining({
      timestamp: 1_725_000_000_000,
      sourceTimestamp: 1_725_000_000_000,
      high24h: 4_430.5,
      low24h: 4_390.25,
      last: 4_411.15,
      volume: 321,
      lp: 'Prime LP',
      open: 4_400,
      close: 4_398,
    }));

    enqueueLiveTick.mockClear();
    (socket as unknown as TestableSocket).handleMessage({
      type: 'tick',
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.2,
      spread: 0.1,
      timestamp: 1_725_000_001,
    });

    expect(enqueueLiveTick.mock.calls[0][1].volume).toBeUndefined();
  });
});

describe('FIX measured RTT', () => {
  it.each([0, 1, 37, 800])('records a correlated %d ms sample without clipping', (elapsed) => {
    const socket = new FixMarketDataSocket('wss://example.test/ws/v2') as any;
    useWebSocketStore.getState().updateMetrics({ lastLatency: 0, averageLatency: 0, latencyMeasuredAt: null }, 'fix_socket');
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100 + elapsed);
    socket.lastPingTime = 12345;
    socket.lastPingStartedAt = 100;
    socket.recordPongActivity({ type: 'pong', timestamp: 999 });
    expect(useWebSocketStore.getState().fixMetrics.latencyMeasuredAt).toBeNull();
    socket.recordPongActivity({ action: 'pong', data: { timestamp: 12345 } });
    expect(useWebSocketStore.getState().fixMetrics.lastLatency).toBe(elapsed);
    expect(socket.lastPingTime).toBe(0);
    clock.mockReturnValue(2000);
    socket.recordPongActivity({ type: 'pong', timestamp: 12345 });
    expect(useWebSocketStore.getState().fixMetrics.lastLatency).toBe(elapsed);
    clock.mockRestore();
  });

  it('never uses a quote as a pong', () => {
    const socket = new FixMarketDataSocket('wss://example.test/ws/v2') as any;
    socket.lastPingTime = 12345;
    const record = vi.spyOn(socket, 'recordPongActivity');
    socket.handleMessage({ type: 'tick', symbol: 'EURUSD', bid: 1.1, ask: 1.2, timestamp: 12345 });
    expect(record).not.toHaveBeenCalled();
    expect(socket.lastPingTime).toBe(12345);
  });
});

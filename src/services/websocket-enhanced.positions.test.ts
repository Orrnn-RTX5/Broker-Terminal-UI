// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = {
    accountId: '200001',
    positions: [] as any[],
    setPositions: (positions: any[]) => { store.positions = positions; },
  };
  return { store };
});
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.store } }));
vi.mock('./liveTickDispatcher', () => ({ enqueueLiveTick: vi.fn() }));

import { EnhancedWebSocketService } from './websocket-enhanced';
import { normalizePosition } from './positionStream';

afterEach(() => { vi.restoreAllMocks(); });

describe('legacy position channel batches', () => {
  it('merges partial updates without blank rows, other-symbol removal or cross-account writes', async () => {
    mocks.store.positions = [
      normalizePosition({ ticket: 1, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291 }),
      normalizePosition({ ticket: 2, symbol: 'BTCUSD', side: 'sell', volume: 0.02, price_open: 110000 }),
    ];
    const service = new EnhancedWebSocketService('wss://example.test/ws/v2');
    const handle = (service as any).handleMessage.bind(service);
    try {
      handle({ type: 'channel_message', channel: 'positions.200001', data: { type: 'pnl_update', symbol: 'XAUUSD', positions: [{ ticket: 1, price_current: 4330, profit: 39 }] } });
      await vi.waitFor(() => expect(mocks.store.positions[0].profit).toBe(39));
      expect(mocks.store.positions.map(position => position.symbol)).toEqual(['XAUUSD', 'BTCUSD']);
      expect(mocks.store.positions[0]).toMatchObject({ volume: 0.01, openPrice: 4291 });

      handle({ type: 'channel_message', channel: 'positions.200001', data: { type: 'position_update', data: [{ ticket: 2, price_current: 109900, profit: 2 }] } });
      await vi.waitFor(() => expect(mocks.store.positions[1].profit).toBe(2));
      expect(mocks.store.positions.map(position => position.symbol)).toEqual(['XAUUSD', 'BTCUSD']);
      expect(mocks.store.positions[1]).toMatchObject({ side: 'SELL', volume: 0.02, openPrice: 110000 });

      handle({ type: 'channel_message', channel: 'positions.200002', data: { type: 'positions_snapshot', positions: [{ ticket: 3, symbol: 'EURUSD', volume: 1 }] } });
      await vi.dynamicImportSettled();
      expect(mocks.store.positions.map(position => position.id)).toEqual([1, 2]);
    } finally {
      service.destroy();
    }
  });
});

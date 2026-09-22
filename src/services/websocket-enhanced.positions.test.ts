import { describe, expect, it } from 'vitest';

import {
  normalizePosition,
  readPositionStreamBatch,
  reconcilePositionStreamBatch,
} from './positionStream';

// Relocated during the merge of origin/main. These invariants were originally
// asserted by driving `EnhancedWebSocketService.handleMessage` and reading the
// store back. HEAD moved account/position ownership into `App.tsx` so the
// transport only forwards envelopes (see websocket-enhanced.test.ts), and App
// applies batches through `readPositionStreamBatch` + `reconcilePositionStreamBatch`.
// The assertions now target that path directly, with no store mock.
//
// Account scoping (`positions.200001` vs `positions.200002`) is enforced by App's
// channel routing before these helpers run; they are account-agnostic by design,
// so cross-account bleed is NOT covered here and needs an App-level test.
describe('position stream batches', () => {
  const seed = () => [
    normalizePosition({ ticket: 1, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291 }),
    normalizePosition({ ticket: 2, symbol: 'BTCUSD', side: 'sell', volume: 0.02, price_open: 110000 }),
  ];

  it('classifies a symbol-scoped pnl batch as a delta, not a snapshot', () => {
    // An array alone does not establish that omitted tickets have been closed.
    expect(readPositionStreamBatch({
      type: 'pnl_update', symbol: 'XAUUSD', positions: [{ ticket: 1, profit: 39 }],
    })?.mode).toBe('delta');
    expect(readPositionStreamBatch({
      type: 'positions_snapshot', positions: [{ ticket: 1 }],
    })?.mode).toBe('snapshot');
  });

  it('merges a symbol-scoped pnl_update without blank rows or other-symbol removal', () => {
    const batch = readPositionStreamBatch({
      type: 'pnl_update',
      symbol: 'XAUUSD',
      positions: [{ ticket: 1, price_current: 4330, profit: 39 }],
    });
    expect(batch?.mode).toBe('delta');

    const { positions } = reconcilePositionStreamBatch(seed(), batch!);

    expect(positions.map((position) => position.symbol)).toEqual(['XAUUSD', 'BTCUSD']);
    expect(positions[0]).toMatchObject({ id: 1, profit: 39, volume: 0.01, openPrice: 4291 });
    expect(positions[1]).toMatchObject({ id: 2, symbol: 'BTCUSD', volume: 0.02, openPrice: 110000 });
  });

  it('merges a position_update batch carried in a bare data array', () => {
    const batch = readPositionStreamBatch({
      type: 'position_update',
      data: [{ ticket: 2, price_current: 109900, profit: 2 }],
    });
    expect(batch?.mode).toBe('delta');

    const { positions } = reconcilePositionStreamBatch(seed(), batch!);

    expect(positions.map((position) => position.symbol)).toEqual(['XAUUSD', 'BTCUSD']);
    expect(positions[1]).toMatchObject({ id: 2, side: 'SELL', profit: 2, volume: 0.02, openPrice: 110000 });
  });
});

import { describe, expect, it } from 'vitest';
import { applyTradeLevelDragUpdate, tradeLevelModifyPatch } from './tradeLevelDrag';

describe('chart protection edits', () => {
  it.each(['BUY', 'SELL'] as const)('preserves both levels across stale %s drag snapshots', (side) => {
    let saved = { price_sl: 90, price_tp: 110 };
    for (const grabbedType of ['SL', 'TP'] as const) {
      const update = applyTradeLevelDragUpdate({
        side, grabbedType, entryPrice: 100, finalPrice: grabbedType === 'SL' ? 85 : 115,
        currentSl: 0, currentTp: 0, digits: 2,
      })!;
      const before = { ...saved };
      saved = { ...saved, ...tradeLevelModifyPatch(update.role, update.price) };
      expect(saved[grabbedType === 'SL' ? 'price_tp' : 'price_sl'])
        .toBe(before[grabbedType === 'SL' ? 'price_tp' : 'price_sl']);
    }
    expect(saved).toEqual({ price_sl: 85, price_tp: 115 });
  });

  it('removes only the selected level', () => {
    expect({ price_sl: 90, price_tp: 110, ...tradeLevelModifyPatch('SL', 0) })
      .toEqual({ price_sl: 0, price_tp: 110 });
    expect({ price_sl: 90, price_tp: 110, ...tradeLevelModifyPatch('TP', 0) })
      .toEqual({ price_sl: 90, price_tp: 0 });
  });
});

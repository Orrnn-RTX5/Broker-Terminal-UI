// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  mergePositionsPanelChannelTick,
  resolvePositionsPanelTick,
} from './PositionsPanel';

describe('PositionsPanel exact tick channel identity', () => {
  it('uses the complete channel symbol instead of a lossy payload alias', () => {
    const next = mergePositionsPanelChannelTick(
      { XAUUSD: { bid: 100, ask: 101 } },
      'ticks.XAUUSD.raw',
      { symbol: 'XAUUSD', bid: 200, ask: 201 },
    );

    expect(next.XAUUSD).toEqual({ bid: 100, ask: 101 });
    expect(next['XAUUSD.RAW']).toEqual({ bid: 200, ask: 201 });
    expect(resolvePositionsPanelTick(next, ' xauusd.raw ')).toEqual({ bid: 200, ask: 201 });
  });

  it('does not let a suffixed quote price an unsuffixed position', () => {
    const ticks = mergePositionsPanelChannelTick({}, 'ticks.XAUUSD.raw', {
      bid: 200,
      ask: 201,
    });

    expect(resolvePositionsPanelTick(ticks, 'XAUUSD')).toBeUndefined();
    expect(resolvePositionsPanelTick(ticks, 'XAUUSD.raw')).toEqual({ bid: 200, ask: 201 });
  });
});

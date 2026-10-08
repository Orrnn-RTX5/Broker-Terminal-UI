import { describe, expect, it, vi } from 'vitest';
import { TRADE_LEVEL_OVERRIDES_STORAGE_KEY, TRADE_LEVEL_OVERRIDE_TTL_MS } from '../presentation/tradeOverlayPresentation';
import { readStoredTradeLevelOverrides } from './tradeLevelOverrideStorage';

describe('ticket-owned optimistic trade level cache', () => {
  const now = 1791468000000;

  it('ignores legacy entries even when a shared alias was already copied to a real ticket', () => {
    const legacy = JSON.stringify([
      { key: 'trade:14154799', sl: 82494.59, tp: 83364.97, savedAt: now },
      { key: 'trade:14154803', sl: 82494.59, tp: 83364.97, savedAt: now },
    ]);
    const getItem = vi.fn((key: string) => key === 'rtx-trade-level-overrides-v1' ? legacy : null);
    expect(readStoredTradeLevelOverrides({ getItem }, now).size).toBe(0);
    expect(getItem).not.toHaveBeenCalledWith('rtx-trade-level-overrides-v1');
  });

  it('restores current ticket-specific entries independently and excludes expired state', () => {
    const current = JSON.stringify([
      { key: 'trade:14154799', sl: 82494.59, tp: 83364.97, savedAt: now },
      { key: 'trade:14154803', sl: 0, tp: 83523.76, savedAt: now },
      { key: 'trade:14154795', sl: 75000, tp: 90000, savedAt: now - TRADE_LEVEL_OVERRIDE_TTL_MS - 1 },
    ]);
    const getItem = (key: string) => key === TRADE_LEVEL_OVERRIDES_STORAGE_KEY ? current : null;
    expect([...readStoredTradeLevelOverrides({ getItem }, now)]).toEqual([
      ['trade:14154799', { sl: 82494.59, tp: 83364.97 }],
      ['trade:14154803', { sl: 0, tp: 83523.76 }],
    ]);
  });

  it('leaves broker state authoritative when cached data is malformed', () => {
    expect(readStoredTradeLevelOverrides({ getItem: () => '{broken' }, now).size).toBe(0);
  });
});

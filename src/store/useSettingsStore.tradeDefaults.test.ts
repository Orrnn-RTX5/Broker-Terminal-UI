// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requiresTradeConfirmation,
  resolveDefaultOrderSymbol,
  resolveDefaultTradeDeviation,
  resolveDefaultTradeVolume,
  resolveOpenOrderTargetSymbol,
  resolveQuickTradeRoute,
  selectOneClickTrading,
  selectTradeDefaults,
  useOneClickTrading,
  useSettingsStore,
  useTradeDefaults,
  type TradeSettings,
} from './useSettingsStore';

const tradeWith = (overrides: Partial<TradeSettings>): TradeSettings => ({
  ...useSettingsStore.getState().trade,
  ...overrides,
});

beforeEach(() => {
  useSettingsStore.getState().resetToDefaults();
});

afterEach(() => {
  useSettingsStore.getState().resetToDefaults();
});

describe('SUI-T8 settings-store trade wiring', () => {
  it('ships broker-neutral trade defaults with one-click off', () => {
    expect(useSettingsStore.getState().trade).toEqual({
      defaultSymbolMode: 'automatic',
      defaultVolumeMode: 'last-used',
      defaultVolume: 0.01,
      defaultDeviationMode: 'last-used',
      defaultDeviation: 0,
      oneClickTrading: false,
    });
  });

  it('persists trade updates through the store action', () => {
    useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true, defaultVolume: 0.5 });

    expect(useSettingsStore.getState().trade.oneClickTrading).toBe(true);
    expect(useSettingsStore.getState().trade.defaultVolume).toBe(0.5);
  });

  it('exposes one-click and trade defaults through selectors and hooks', () => {
    expect(selectOneClickTrading(useSettingsStore.getState())).toBe(false);
    expect(selectTradeDefaults(useSettingsStore.getState()).defaultVolume).toBe(0.01);

    const oneClick = renderHook(() => useOneClickTrading());
    const defaults = renderHook(() => useTradeDefaults());
    expect(oneClick.result.current).toBe(false);
    expect(defaults.result.current.defaultVolumeMode).toBe('last-used');

    act(() => {
      useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true });
    });

    expect(oneClick.result.current).toBe(true);
    expect(defaults.result.current.oneClickTrading).toBe(true);
    oneClick.unmount();
    defaults.unmount();
  });

  it('resolves the default volume by mode with a store-default fallback', () => {
    expect(resolveDefaultTradeVolume(tradeWith({ defaultVolumeMode: 'default', defaultVolume: 0.5 }))).toBe(0.5);
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'default', defaultVolume: 0.5 }),
      { lastUsedVolume: 2 },
    )).toBe(0.5);
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'last-used', defaultVolume: 0.5 }),
      { lastUsedVolume: '1.5' },
    )).toBe(1.5);
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'last-used', defaultVolume: 0.5 }),
    )).toBe(0.5);
    // Invalid configured or last-used values fall back to the store default.
    expect(resolveDefaultTradeVolume(tradeWith({ defaultVolumeMode: 'default', defaultVolume: 0 }))).toBe(0.01);
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'last-used', defaultVolume: -1 }),
      { lastUsedVolume: 'junk' },
    )).toBe(0.01);
    // A broker-driven empty seed keeps the previous broker-minimum initial
    // state until the trader actually trades; last-used still wins over it.
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'last-used', defaultVolume: 0.5 }),
      { emptyVolumeSeed: 0.001 },
    )).toBe(0.001);
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'last-used', defaultVolume: 0.5 }),
      { lastUsedVolume: 2, emptyVolumeSeed: 0.001 },
    )).toBe(2);
    expect(resolveDefaultTradeVolume(
      tradeWith({ defaultVolumeMode: 'default', defaultVolume: 0.5 }),
      { emptyVolumeSeed: 0.001 },
    )).toBe(0.5);
  });

  it('resolves the default deviation by mode with a store-default fallback', () => {
    expect(resolveDefaultTradeDeviation(tradeWith({ defaultDeviationMode: 'default', defaultDeviation: 10 }))).toBe(10);
    expect(resolveDefaultTradeDeviation(
      tradeWith({ defaultDeviationMode: 'last-used', defaultDeviation: 10 }),
      { lastUsedDeviation: 3 },
    )).toBe(3);
    expect(resolveDefaultTradeDeviation(
      tradeWith({ defaultDeviationMode: 'last-used', defaultDeviation: 10 }),
    )).toBe(10);
    expect(resolveDefaultTradeDeviation(tradeWith({ defaultDeviationMode: 'default', defaultDeviation: -5 }))).toBe(0);
  });

  it('resolves the default symbol by mode without symbol literals', () => {
    expect(resolveDefaultOrderSymbol(
      tradeWith({ defaultSymbolMode: 'automatic' }),
      { selectedSymbol: 'AAA', lastUsedSymbol: 'BBB' },
    )).toBe('AAA');
    expect(resolveDefaultOrderSymbol(
      tradeWith({ defaultSymbolMode: 'last-used' }),
      { selectedSymbol: 'AAA', lastUsedSymbol: 'BBB' },
    )).toBe('BBB');
    expect(resolveDefaultOrderSymbol(
      tradeWith({ defaultSymbolMode: 'last-used' }),
      { selectedSymbol: 'AAA' },
    )).toBe('AAA');
    expect(resolveDefaultOrderSymbol(tradeWith({ defaultSymbolMode: 'automatic' }), {})).toBe('');
  });

  it('lets an explicit ticket symbol win over the default-symbol mode', () => {
    expect(resolveOpenOrderTargetSymbol(
      tradeWith({ defaultSymbolMode: 'last-used' }),
      { explicitSymbol: 'AAA', activeChartSymbol: 'BBB', selectedSymbol: 'CCC', lastUsedSymbol: 'DDD' },
    )).toBe('AAA');
    expect(resolveOpenOrderTargetSymbol(
      tradeWith({ defaultSymbolMode: 'automatic' }),
      { activeChartSymbol: 'BBB', selectedSymbol: 'CCC', lastUsedSymbol: 'DDD' },
    )).toBe('BBB');
    expect(resolveOpenOrderTargetSymbol(
      tradeWith({ defaultSymbolMode: 'last-used' }),
      { selectedSymbol: 'CCC', lastUsedSymbol: 'DDD' },
    )).toBe('DDD');
  });

  it('routes quick trade by the one-click setting', () => {
    expect(resolveQuickTradeRoute(true)).toBe('instant');
    expect(resolveQuickTradeRoute(false)).toBe('confirm');
    expect(requiresTradeConfirmation(true)).toBe(false);
    expect(requiresTradeConfirmation(false)).toBe(true);
    expect(requiresTradeConfirmation({ oneClickTrading: false })).toBe(true);
    expect(requiresTradeConfirmation({ oneClickTrading: true })).toBe(false);
  });
});

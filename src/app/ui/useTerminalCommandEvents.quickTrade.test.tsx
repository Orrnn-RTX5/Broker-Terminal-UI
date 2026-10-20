// @vitest-environment jsdom

import { useState, type Dispatch, type SetStateAction } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartType, Timeframe } from '../../types/chart';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  useTerminalCommandEvents,
  type ChartObjectsTarget,
  type ChartSymbolPickerState,
} from './useTerminalCommandEvents';

const setter = <T,>(): Dispatch<SetStateAction<T>> => vi.fn();

interface QuickTradeHarness {
  placeOrder: ReturnType<typeof vi.fn>;
  openOrderPanelForSymbol: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

const renderQuickTrade = (): QuickTradeHarness => {
  const placeOrder = vi.fn();
  const openOrderPanelForSymbol = vi.fn();
  const useHarness = () => {
    const [showDataWindow, setShowDataWindow] = useState(false);
    const [showAccountPanel, setShowAccountPanel] = useState(false);
    useTerminalCommandEvents({
      selectedSymbol: 'EURUSD',
      setSelectedSymbol: setter<string>(),
      timeframe: 'M1' as Timeframe,
      setTimeframe: setter<Timeframe>(),
      chartType: 'candlestick' as ChartType,
      setChartType: setter<ChartType>(),
      chartEligibleSymbolNames: ['EURUSD'],
      displayToast: vi.fn(),
      placeOrder,
      handleOpenDOM: vi.fn(),
      handleSaveWorkspace: vi.fn(),
      handleOpenDataFolder: vi.fn(),
      handlePrintChart: vi.fn(),
      getAllowedSymbol: (symbol: unknown) => (typeof symbol === 'string' ? symbol : ''),
      getChartEligibleSymbol: () => 'EURUSD',
      openOrderPanelForSymbol,
      setShowDataWindow,
      setShowAccountPanel,
      setDockHeight: setter<number>(),
      setChartSymbolPicker: setter<ChartSymbolPickerState | null>(),
      setShowChartProperties: setter<boolean>(),
      setChartPropsSymbol: setter<string>(),
      setChartPropsTimeframe: setter<string>(),
      setChartPropsContextId: setter<string | undefined>(),
      setChartObjectsTarget: setter<ChartObjectsTarget | null>(),
    });
  };

  const { unmount } = renderHook(useHarness);
  return { placeOrder, openOrderPanelForSymbol, unmount };
};

const fireQuickTrade = (detail: { side: 'BUY' | 'SELL'; symbol?: unknown }) => {
  act(() => {
    window.dispatchEvent(new CustomEvent('quickTrade', { detail }));
  });
};

describe('useTerminalCommandEvents quickTrade one-click gate (SUI-T8)', () => {
  let cleanups: Array<() => void> = [];

  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  afterEach(() => {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    useSettingsStore.getState().resetToDefaults();
    vi.restoreAllMocks();
  });

  it('places instantly when one-click trading is on', () => {
    useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true });
    const harness = renderQuickTrade();
    cleanups.push(harness.unmount);

    fireQuickTrade({ side: 'BUY', symbol: 'EURUSD' });

    expect(harness.placeOrder).toHaveBeenCalledTimes(1);
    expect(harness.placeOrder).toHaveBeenCalledWith('BUY', 'EURUSD');
    expect(harness.openOrderPanelForSymbol).not.toHaveBeenCalled();
  });

  it('opens the confirm ticket instead of placing when one-click trading is off', () => {
    expect(useSettingsStore.getState().trade.oneClickTrading).toBe(false);
    const harness = renderQuickTrade();
    cleanups.push(harness.unmount);

    fireQuickTrade({ side: 'SELL', symbol: 'EURUSD' });

    expect(harness.openOrderPanelForSymbol).toHaveBeenCalledTimes(1);
    expect(harness.openOrderPanelForSymbol).toHaveBeenCalledWith('EURUSD');
    expect(harness.placeOrder).not.toHaveBeenCalled();
  });

  it('opens the ticket with no symbol override when the event carries none', () => {
    const harness = renderQuickTrade();
    cleanups.push(harness.unmount);

    fireQuickTrade({ side: 'SELL' });

    expect(harness.openOrderPanelForSymbol).toHaveBeenCalledTimes(1);
    expect(harness.openOrderPanelForSymbol).toHaveBeenCalledWith(undefined);
    expect(harness.placeOrder).not.toHaveBeenCalled();
  });
});

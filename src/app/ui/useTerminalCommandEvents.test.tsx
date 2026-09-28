import { useState, type Dispatch, type SetStateAction } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChartType, Timeframe } from '../../types/chart';
import {
  useTerminalCommandEvents,
  type ChartObjectsTarget,
  type ChartSymbolPickerState,
} from './useTerminalCommandEvents';

const setter = <T,>(): Dispatch<SetStateAction<T>> => vi.fn();

describe('useTerminalCommandEvents', () => {
  it('owns floating-window toggle listeners and removes them on cleanup', () => {
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
        placeOrder: vi.fn(),
        handleOpenDOM: vi.fn(),
        handleSaveWorkspace: vi.fn(),
        handleOpenDataFolder: vi.fn(),
        handlePrintChart: vi.fn(),
        getAllowedSymbol: () => 'EURUSD',
        getChartEligibleSymbol: () => 'EURUSD',
        openOrderPanelForSymbol: vi.fn(),
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
      return { showDataWindow, showAccountPanel };
    };

    const { result, unmount } = renderHook(useHarness);
    act(() => {
      window.dispatchEvent(new Event('openDataWindow'));
      window.dispatchEvent(new Event('toggleAccountPanel'));
    });
    expect(result.current).toEqual({ showDataWindow: true, showAccountPanel: true });

    unmount();
    expect(() => {
      window.dispatchEvent(new Event('openDataWindow'));
      window.dispatchEvent(new Event('toggleAccountPanel'));
    }).not.toThrow();
  });
});

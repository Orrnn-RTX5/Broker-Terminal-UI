// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndicatorManager } from '../../../services/indicatorManager';
import {
  defaultChartProperties,
  useChartSettingsStore,
} from '../../../store/useChartSettingsStore';
import { useTradingChartContextMenuController } from './useTradingChartContextMenu';

const initialState = useChartSettingsStore.getState();

const renderController = (symbol = 'EURUSD') => {
  const noop = vi.fn();
  return renderHook(({ currentSymbol }) => useTradingChartContextMenuController({
    activeChartSourceId: 'grid-test',
    activeTimeframe: 'M1',
    addLocalIndicator: () => false,
    applyChartTypeInPlace: () => true,
    chartSettingsRef: { current: useChartSettingsStore.getState().symbolProperties[currentSymbol] },
    clearLocalIndicators: noop,
    loadHistory: async () => undefined,
    localIndicatorManager: {} as IndicatorManager,
    persistCurrentIndicators: noop,
    prevTimeframeRef: { current: 'M1' },
    refreshCurrentIndicators: noop,
    setCtxAutoScroll: noop,
    setCtxChartShift: noop,
    setCtxMenu: noop,
    setCtxShowTradeHistory: noop,
    setCtxShowTradeHistoryLine: noop,
    setCtxShowTradeLevels: noop,
    setLocalChartType: noop,
    setTemplateDialogMode: noop,
    setTemplateDialogOpen: noop,
    symbol: currentSymbol,
    timeframe: 'M1',
  }), { initialProps: { currentSymbol: symbol } });
};

beforeEach(() => {
  useChartSettingsStore.setState({
    globalProperties: { ...defaultChartProperties },
    symbolProperties: {
      EURUSD: { ...defaultChartProperties, showGrid: false, gridType: 'square', gridLineStyle: 'solid' },
      XAUUSD: { ...defaultChartProperties, showGrid: false, gridType: 'square', gridLineStyle: 'dashed' },
    },
  });
});

afterEach(() => {
  useChartSettingsStore.setState(initialState);
});

describe('chart context menu grid settings', () => {
  it('selects the MT5 preset with short dashed styling, then permits an independent line style change', () => {
    const { result } = renderController();
    const before = useChartSettingsStore.getState();
    act(() => result.current.handleCtxGridTypeChange('mt5'));
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({ gridType: 'mt5', gridLineStyle: 'dashed', showGrid: true });
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD).toBe(before.symbolProperties.XAUUSD);
    act(() => result.current.handleCtxGridLineStyleChange('solid'));
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({ gridType: 'mt5', gridLineStyle: 'solid' });
    const saved = JSON.parse(localStorage.getItem('rtx-chart-settings')!);
    expect(saved.state.symbolProperties.EURUSD).toMatchObject({ gridType: 'mt5', gridLineStyle: 'solid', showGrid: true });
  });
  it('shows and persists the chosen grid type for only the target symbol, preserving line style', () => {
    const { result } = renderController();
    const before = useChartSettingsStore.getState();

    act(() => result.current.handleCtxGridTypeChange('scale'));

    const after = useChartSettingsStore.getState();
    expect(after.symbolProperties.EURUSD).toEqual({
      ...before.symbolProperties.EURUSD,
      showGrid: true,
      gridType: 'scale',
    });
    expect(after.symbolProperties.XAUUSD).toBe(before.symbolProperties.XAUUSD);
    expect(after.globalProperties).toBe(before.globalProperties);
    const saved = JSON.parse(localStorage.getItem('rtx-chart-settings')!);
    expect(saved.state.symbolProperties.EURUSD).toMatchObject({
      gridType: 'scale', gridLineStyle: 'solid', showGrid: true,
    });
  });

  it('shows and persists the chosen line style while preserving grid type and targeting the current symbol', () => {
    const { result, rerender } = renderController();
    act(() => result.current.handleCtxGridTypeChange('scale'));
    act(() => useChartSettingsStore.getState().updateSymbolProperty('EURUSD', 'showGrid', false));
    act(() => result.current.handleCtxGridLineStyleChange('dashed'));
    const eurusd = useChartSettingsStore.getState().symbolProperties.EURUSD;
    expect(eurusd).toMatchObject({ gridType: 'scale', gridLineStyle: 'dashed', showGrid: true });

    rerender({ currentSymbol: 'XAUUSD' });
    act(() => result.current.handleCtxGridLineStyleChange('solid'));
    const after = useChartSettingsStore.getState();
    expect(after.symbolProperties.XAUUSD).toMatchObject({ gridType: 'square', gridLineStyle: 'solid', showGrid: true });
    expect(after.symbolProperties.EURUSD).toBe(eurusd);
    const saved = JSON.parse(localStorage.getItem('rtx-chart-settings')!);
    expect(saved.state.symbolProperties.XAUUSD.gridLineStyle).toBe('solid');
  });

  it('toggles and persists showBackgroundLogo for the target symbol only', () => {
    const { result } = renderController();
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showBackgroundLogo).toBe(true);

    act(() => result.current.handleCtxToggleBackgroundLogo());
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showBackgroundLogo).toBe(false);
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD.showBackgroundLogo).toBe(true);

    act(() => result.current.handleCtxToggleBackgroundLogo());
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showBackgroundLogo).toBe(true);
  });
});

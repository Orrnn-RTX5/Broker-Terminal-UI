// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandBus } from '../services/commandBus';
import { useToolbarState } from './useToolbarState';

describe('useToolbarState', () => {
  beforeEach(() => {
    commandBus.clearHistory();
    window.localStorage.clear();
  });

  it('keeps dispatch stable while toolbar state changes', () => {
    const { result } = renderHook(() => useToolbarState());
    const initialDispatch = result.current.dispatch;

    act(() => {
      result.current.dispatch({ type: 'SET_CHART_TYPE', chartType: 'line' });
    });

    expect(result.current.state.chartType).toBe('line');
    expect(result.current.dispatch).toBe(initialDispatch);
  });

  it('does not loop when a prop-sync effect depends on dispatch', () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(
      ({ chartType }: { chartType: 'candlestick' | 'line' }) => {
        renderCount += 1;
        const toolbar = useToolbarState();
        const dispatch = toolbar.dispatch;

        useEffect(() => {
          dispatch({ type: 'SET_CHART_TYPE', chartType });
        }, [chartType, dispatch]);

        return toolbar;
      },
      { initialProps: { chartType: 'candlestick' as const } },
    );

    expect(result.current.state.chartType).toBe('candlestick');
    expect(renderCount).toBeLessThan(5);

    rerender({ chartType: 'line' });

    expect(result.current.state.chartType).toBe('line');
    expect(renderCount).toBeLessThan(8);
  });

  it('publishes toggle commands from the latest state', () => {
    const { result } = renderHook(() => useToolbarState());

    act(() => {
      result.current.dispatch({ type: 'TOGGLE_AUTO_SCROLL' });
    });
    act(() => {
      result.current.dispatch({ type: 'TOGGLE_AUTO_SCROLL' });
    });

    const enabledValues = commandBus
      .getHistory()
      .filter((command) => command.type === 'SET_AUTO_SCROLL')
      .map((command) => command.payload.enabled);

    expect(enabledValues).toEqual([true, false]);
  });
});

// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandBus } from '../services/commandBus';
import {
  clearActiveChartSources,
  registerActiveChartSource,
} from '../services/activeChartSource';
import { useToolbarState } from './useToolbarState';
import { useDrawingToolPreferencesStore } from '../store/useDrawingToolPreferencesStore';

describe('useToolbarState', () => {
  it('resets desktop tool state despite a saved repeat preference', () => {
    const previousBridge = window.electron;
    const previousKeepDrawing = useDrawingToolPreferencesStore.getState().keepDrawing;
    Object.defineProperty(window, 'electron', { configurable: true, value: { window: {} } });
    useDrawingToolPreferencesStore.setState({ keepDrawing: true });
    try {
      const { result } = renderHook(() => useToolbarState());
      act(() => commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'freehand', targetContextId: 'chart-a' } }));
      act(() => window.dispatchEvent(new CustomEvent('drawing:saved', { detail: { contextId: 'chart-a', type: 'freehand' } })));
      expect(result.current.state.activeTool).toBeNull();
    } finally {
      Object.defineProperty(window, 'electron', { configurable: true, value: previousBridge });
      useDrawingToolPreferencesStore.setState({ keepDrawing: previousKeepDrawing });
    }
  });
  beforeEach(() => {
    commandBus.clearHistory();
    clearActiveChartSources();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    clearActiveChartSources();
    document.body.replaceChildren();
  });

  it('clears the completed tool locally without publishing a cursor command that deselects the drawing', () => {
    const { result } = renderHook(() => useToolbarState());
    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'trendline', subtype: 'trendline', targetContextId: 'chart-a' },
      });
    });
    expect(result.current.state.activeTool).toBe('trendline');
    const historyBeforeCompletion = commandBus.getHistory();

    act(() => {
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-a', id: 'trendline-1', selected: true },
      }));
    });

    expect(result.current.state.activeTool).toBeNull();
    expect(commandBus.getHistory()).toEqual(historyBeforeCompletion);
  });

  it('keeps the armed tool when another chart completes a drawing', () => {
    const { result } = renderHook(() => useToolbarState());
    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'trendline', targetContextId: 'chart-a' },
      });
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-b' },
      }));
    });

    expect(result.current.state.activeTool).toBe('trendline');
    expect(commandBus.getHistory()).toHaveLength(1);
  });

  it('scopes locally selected tools to the active chart while keeping explicit cancellation commands', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    registerActiveChartSource({ id: 'chart-a', getContainer: () => container });
    const { result } = renderHook(() => useToolbarState());

    act(() => {
      result.current.dispatch({ type: 'SELECT_TOOL', tool: 'trendline' });
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-b' },
      }));
    });
    expect(result.current.state.activeTool).toBe('trendline');

    act(() => {
      result.current.dispatch({ type: 'SELECT_TOOL', tool: 'cursor' });
    });
    expect(result.current.state.activeTool).toBeNull();
    expect(commandBus.getHistory().at(-1)).toMatchObject({
      type: 'SELECT_TOOL', payload: { tool: 'cursor' },
    });
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

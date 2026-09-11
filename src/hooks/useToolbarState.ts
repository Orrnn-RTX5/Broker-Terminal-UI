import { useCallback, useReducer, useEffect, useRef } from 'react';
import type { ToolbarAction } from '../store/toolbarState';
import { toolbarReducer, initialToolbarState } from '../store/toolbarState';
import { useCommandBus } from './useCommandBus';
import type { Command } from '../types/commands';
import { getActiveChartSource } from '../services/activeChartSource';
import { useDrawingToolPreferencesStore } from '../store/useDrawingToolPreferencesStore';

export function useToolbarState() {
  const [state, dispatchLocal] = useReducer(toolbarReducer, initialToolbarState);
  const { dispatch: dispatchCommand, subscribe } = useCommandBus();
  // Track which command types we just dispatched ourselves, so we don't re-apply them
  const selfDispatchedRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  const drawingTargetContextRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Subscribe to command bus for incoming commands that affect toolbar state
  useEffect(() => {
    const unsubscribe = subscribe((cmd: Command) => {
      // Skip commands that originated from this hook's own dispatch wrapper
      if (selfDispatchedRef.current.has(cmd.type)) {
        selfDispatchedRef.current.delete(cmd.type);
        return;
      }
      // Map commands to toolbar actions
      switch (cmd.type) {
        case 'SELECT_TOOL':
          drawingTargetContextRef.current = cmd.payload.tool === 'cursor'
            ? null
            : cmd.payload.targetContextId ?? getActiveChartSource()?.id ?? null;
          dispatchLocal({ type: 'SELECT_TOOL', tool: cmd.payload.tool, subtype: cmd.payload.subtype });
          break;

        case 'SET_CHART_TYPE':
          dispatchLocal({ type: 'SET_CHART_TYPE', chartType: cmd.payload.chartType });
          break;

        case 'SET_TIMEFRAME':
          dispatchLocal({ type: 'SET_TIMEFRAME', timeframe: cmd.payload.timeframe });
          break;

        case 'TOGGLE_CROSSHAIR':
          dispatchLocal({ type: 'TOGGLE_CROSSHAIR' });
          break;

        case 'ZOOM_IN':
          dispatchLocal({ type: 'ZOOM', delta: 2 });
          break;

        case 'ZOOM_OUT':
          dispatchLocal({ type: 'ZOOM', delta: -2 });
          break;

        case 'DELETE_DRAWING':
          dispatchLocal({ type: 'DELETE_DRAWING', id: cmd.payload.id });
          break;

        case 'SET_AUTO_SCROLL':
          dispatchLocal({ type: 'SET_AUTO_SCROLL', enabled: cmd.payload.enabled });
          break;

        case 'SET_CHART_SHIFT':
          dispatchLocal({ type: 'SET_CHART_SHIFT', enabled: cmd.payload.enabled });
          break;

        case 'TOGGLE_MAGNET':
          dispatchLocal({ type: 'TOGGLE_MAGNET' });
          break;

        default:
          break;
      }
    });

    return unsubscribe;
  }, [subscribe]);

  useEffect(() => {
    const handleDrawingSaved = (event: Event) => {
      const contextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      const activeContextId = getActiveChartSource()?.id;
      const targetContextId = drawingTargetContextRef.current;
      if (contextId && targetContextId && contextId !== targetContextId) return;
      if (contextId && activeContextId && contextId !== activeContextId) return;
      // Keep drawing re-arms the tool from the rail; resetting the highlight
      // here would fight that replay.
      if (!window.electron?.window && useDrawingToolPreferencesStore.getState().keepDrawing) return;

      // Completion already restores chart interaction in TradingChart. Reset
      // only the tool highlight: SELECT_TOOL cursor would deselect the drawing.
      drawingTargetContextRef.current = null;
      dispatchLocal({ type: 'SELECT_TOOL', tool: 'cursor' });
    };
    window.addEventListener('drawing:saved', handleDrawingSaved);
    return () => window.removeEventListener('drawing:saved', handleDrawingSaved);
  }, []);

  // Wrapper to dispatch both locally and to command bus
  const dispatch = useCallback((action: ToolbarAction) => {
    // Update local state
    dispatchLocal(action);

    // Emit to command bus for other components (map ToolbarAction to Command)
    // Note: Not all ToolbarActions map to Commands - some are internal only
    switch (action.type) {
      case 'SELECT_TOOL':
        drawingTargetContextRef.current = action.tool && action.tool !== 'cursor'
          ? getActiveChartSource()?.id ?? null
          : null;
        selfDispatchedRef.current.add('SELECT_TOOL');
        dispatchCommand({
          type: 'SELECT_TOOL',
          payload: { tool: action.tool || 'cursor', subtype: action.subtype }
        } as Command);
        break;

      case 'SET_CHART_TYPE':
        selfDispatchedRef.current.add('SET_CHART_TYPE');
        dispatchCommand({
          type: 'SET_CHART_TYPE',
          payload: { chartType: action.chartType }
        } as Command);
        break;

      case 'SET_TIMEFRAME':
        selfDispatchedRef.current.add('SET_TIMEFRAME');
        dispatchCommand({
          type: 'SET_TIMEFRAME',
          payload: { timeframe: action.timeframe }
        } as Command);
        break;

      case 'TOGGLE_CROSSHAIR':
        selfDispatchedRef.current.add('TOGGLE_CROSSHAIR');
        dispatchCommand({
          type: 'TOGGLE_CROSSHAIR',
          payload: {}
        } as Command);
        break;

      case 'ZOOM':
        // Map ZOOM action to ZOOM_IN or ZOOM_OUT command based on delta
        if (action.delta > 0) {
          selfDispatchedRef.current.add('ZOOM_IN');
          dispatchCommand({
            type: 'ZOOM_IN',
            payload: {}
          } as Command);
        } else {
          selfDispatchedRef.current.add('ZOOM_OUT');
          dispatchCommand({
            type: 'ZOOM_OUT',
            payload: {}
          } as Command);
        }
        break;

      case 'DELETE_DRAWING':
        selfDispatchedRef.current.add('DELETE_DRAWING');
        dispatchCommand({
          type: 'DELETE_DRAWING',
          payload: { id: action.id }
        } as Command);
        break;

      case 'TOGGLE_AUTO_SCROLL':
        selfDispatchedRef.current.add('SET_AUTO_SCROLL');
        dispatchCommand({
          type: 'SET_AUTO_SCROLL',
          payload: { enabled: !stateRef.current.autoScrollEnabled }
        } as Command);
        break;

      case 'TOGGLE_CHART_SHIFT':
        selfDispatchedRef.current.add('SET_CHART_SHIFT');
        dispatchCommand({
          type: 'SET_CHART_SHIFT',
          payload: { enabled: !stateRef.current.chartShiftEnabled }
        } as Command);
        break;

      default:
        break;
    }
  }, [dispatchCommand]);

  return {
    state,
    dispatch,
    // Prop hydration must not send a new chart command back to subscribers.
    syncState: dispatchLocal,
  };
}

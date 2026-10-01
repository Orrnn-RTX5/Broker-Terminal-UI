import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { applyChartCursorMode } from '../../../drawing-tools/chartCursorInteractions';
import { setTrendDrawingInputActive, usesDirectDrawingPointerInput } from '../../../drawing-tools/drawingInteractionPriority';
import { resolveTrendToolColor } from '../../../drawing-tools/toolDefaults';
import { getActiveChartSource } from '../../../services/activeChartSource';
import { commandBus } from '../../../services/commandBus';
import { drawingManager } from '../../../services/drawingManager';
import type { Timeframe } from '../../../types/chart';
import {
  DRAWING_LOCK_HANDLE_SCALE,
  DRAWING_LOCK_HANDLE_SCROLL,
  TRADING_VIEW_HANDLE_SCALE,
  TRADING_VIEW_HANDLE_SCROLL,
} from './chartInteractionOptions';

interface TextInputOverlay {
  x: number;
  y: number;
  time: number;
  price: number;
}

interface UseTradingChartDrawingCommandsOptions {
  activeToolRef: RefObject<string | null>;
  bindDrawingManagerToChart: () => boolean;
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  crosshairEnabledRef: RefObject<boolean>;
  drawingCommandTargetRef: RefObject<string | null>;
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  setTextInputOverlay: Dispatch<SetStateAction<TextInputOverlay | null>>;
}

export const useTradingChartDrawingCommands = (options: UseTradingChartDrawingCommandsOptions): void => {
  const {
    activeToolRef,
    bindDrawingManagerToChart,
    chartRef,
    containerRef,
    crosshairEnabledRef,
    drawingCommandTargetRef,
    drawingRuntimeContextRef,
    seriesRef,
    setTextInputOverlay,
  } = options;

useEffect(() => {
    const drawingInteractionContainer = containerRef.current;
    console.log('[TradingChart] ✅ SELECT_TOOL subscriber REGISTERED, chartRef=', !!chartRef.current, 'containerRef=', !!containerRef.current);
    const restoreIdleCursor = () => {
      applyChartCursorMode(containerRef.current?.closest<HTMLElement>('.rtx-chart-wrapper') ?? null);
    };

    const handleSaved = (event: Event) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      const savedContextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      if (savedContextId && savedContextId !== contextId) return;
      if (drawingCommandTargetRef.current !== contextId) return;
      const completed = (event as CustomEvent<{ type?: string; subtype?: string; color?: string; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted'; fillColor?: string; fillOpacity?: number }>).detail;
      // Desktop drawings are single-use, including Brush and Highlighter.
      if (!window.electron?.window && event.type === 'drawing:saved' && completed?.type === 'freehand' && activeToolRef.current === 'freehand') {
        if (!bindDrawingManagerToChart()) return;
        drawingManager.startDrawing('freehand', completed.color, { subtype: completed.subtype });
        drawingManager.updateActiveDrawing({
          lineWidth: completed.lineWidth, lineStyle: completed.lineStyle,
          fillColor: completed.fillColor, fillOpacity: completed.fillOpacity
        });
        return;
      }
      console.log('[TradingChart] Drawing interaction ended, returning to cursor mode');
      activeToolRef.current = null;
      drawingCommandTargetRef.current = null;
      setTrendDrawingInputActive(containerRef.current, false);
      if (containerRef.current) containerRef.current.style.touchAction = '';
      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
          ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } }),
        });
      }
      if (containerRef.current && !crosshairEnabledRef.current) {
        containerRef.current.style.cursor = 'default';
        containerRef.current.querySelectorAll('canvas').forEach((c) => {
          (c as HTMLCanvasElement).style.cursor = 'default';
        });
        const wrapper = containerRef.current.parentElement;
        if (wrapper) wrapper.setAttribute('data-cursor', 'select');
      }
      restoreIdleCursor();
    };

    window.addEventListener('drawing:saved', handleSaved);
    window.addEventListener('drawing:cancelled', handleSaved);

    const unsubSelectTool = commandBus.subscribe('SELECT_TOOL', (payload) => {
      const tool = payload.tool;
      console.log(`[TradingChart] 🎯 SELECT_TOOL received: tool=${tool}, chartRef=${!!chartRef.current}, seriesRef=${!!seriesRef.current}`);

      const contextId = drawingRuntimeContextRef.current.contextId;
      const targetContextId = payload.targetContextId ?? getActiveChartSource()?.id;
      if (!targetContextId || targetContextId !== contextId) {
        if (drawingCommandTargetRef.current === contextId) {
          drawingCommandTargetRef.current = null;
          activeToolRef.current = null;
          if (containerRef.current) containerRef.current.style.touchAction = '';
          setTrendDrawingInputActive(containerRef.current, false);
          setTextInputOverlay(null);
          if (chartRef.current) {
            chartRef.current.applyOptions({
              handleScroll: TRADING_VIEW_HANDLE_SCROLL,
              handleScale: TRADING_VIEW_HANDLE_SCALE,
              ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } }),
            });
          }
          if (containerRef.current && !crosshairEnabledRef.current) {
            containerRef.current.style.cursor = 'default';
            containerRef.current.querySelectorAll('canvas').forEach((canvas) => {
              (canvas as HTMLCanvasElement).style.cursor = 'default';
            });
            containerRef.current.parentElement?.setAttribute('data-cursor', 'select');
          }
          restoreIdleCursor();
        }
        return;
      }
      if (!bindDrawingManagerToChart()) return;

      // Cancel any active drawing + clear inline text input
      drawingManager.cancelDrawing();
      setTextInputOverlay(null);

      // Track tool in ref (accessible in closures without re-creating handlers)
      activeToolRef.current = tool === 'cursor' ? null : tool;
      if (containerRef.current) containerRef.current.style.touchAction = tool === 'freehand' || tool === 'ruler' ? 'none' : '';
      drawingCommandTargetRef.current = tool === 'cursor' ? null : contextId;
      setTrendDrawingInputActive(containerRef.current, false);

      if (tool === 'cursor') {
        // Cursor mode: restore pan/scroll, hide crosshair lines (MT5 behaviour)
        drawingManager.unselectAll();
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: TRADING_VIEW_HANDLE_SCROLL,
            handleScale: TRADING_VIEW_HANDLE_SCALE,
            // Hide the crosshair lines — arrow mode shows no crosshair (MT5 style)
            ...(!crosshairEnabledRef.current && { crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } }),
          });
        }
        if (containerRef.current && !crosshairEnabledRef.current) {
          containerRef.current.style.cursor = 'default';
          containerRef.current.querySelectorAll('canvas').forEach((c) => {
            (c as HTMLCanvasElement).style.cursor = 'default';
          });
          const wrapper = containerRef.current.parentElement;
          if (wrapper) wrapper.setAttribute('data-cursor', 'select');
        }
        restoreIdleCursor();
        console.log('[Chart] Tool: cursor (selection mode — crosshair hidden)');
      } else {
        // Drawing mode: disable pressedMouseMove so drag doesn't pan, only click places points
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: DRAWING_LOCK_HANDLE_SCROLL,
            handleScale: DRAWING_LOCK_HANDLE_SCALE,
            // Drawing previews still follow crosshair-move events, but visible
            // crosshair guides belong exclusively to explicit Crosshair mode.
            ...(!crosshairEnabledRef.current && {
              crosshair: {
                vertLine: { visible: false, labelVisible: false },
                horzLine: { visible: false, labelVisible: false },
              },
            }),
          });
        }
        if (containerRef.current && !crosshairEnabledRef.current) {
          containerRef.current.style.cursor = 'default';
          containerRef.current.querySelectorAll('canvas').forEach((c) => {
            (c as HTMLCanvasElement).style.cursor = 'default';
          });
          const wrapper = containerRef.current.parentElement;
          if (wrapper) wrapper.setAttribute('data-cursor', 'select');
        }

        const validDrawingTypes = ['trendline', 'hline', 'vline', 'text', 'channel', 'fibonacci', 'shapes', 'rectangle', 'ellipse', 'fib_extension', 'measure', 'freehand', 'callout', 'stamp', 'pattern'];
        if (validDrawingTypes.includes(tool)) {
          const subtype = payload.subtype;
          drawingManager.startDrawing(
            tool as Parameters<typeof drawingManager.startDrawing>[0],
            resolveTrendToolColor(subtype),
            subtype ? { subtype } : undefined,
          );
          const activeAfter = drawingManager.getActiveDrawing(contextId);
          setTrendDrawingInputActive(containerRef.current, Boolean(
            usesDirectDrawingPointerInput(activeAfter),
          ));
          console.log(`[Chart] Tool: ${tool} — drawing started, activeDrawing=${!!activeAfter}, type=${activeAfter?.type}`);
        } else {
          console.log(`[Chart] Tool: ${tool} — not a drawing tool`);
        }
      }
    });

    return () => {
      unsubSelectTool();
      window.removeEventListener('drawing:saved', handleSaved);
      window.removeEventListener('drawing:cancelled', handleSaved);
      setTrendDrawingInputActive(drawingInteractionContainer, false);
      if (drawingInteractionContainer) drawingInteractionContainer.style.touchAction = '';
    };
  }, []);
};

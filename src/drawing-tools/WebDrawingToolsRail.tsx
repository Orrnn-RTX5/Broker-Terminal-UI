import { useUiTranslation } from '../hooks/useUiTranslation';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcut';
import { useDrawingSidebarStore } from '../store/useDrawingSidebarStore';
import { CHART_PATTERN_GROUPS, CHART_PATTERN_TOOLS } from './chartPatternToolCatalog';
import { ChartPatternToolIcon } from './ChartPatternToolIcon';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../components/ui/Icon';
import { ToggleSwitch } from '../components/ui/ToggleSwitch';
import { STAMP_OPTIONS } from '../components/layout/stampOptions';
import { activateActiveChartSource, getActiveChartSource, getActiveChartSourceId, subscribeActiveChartSource } from '../services/activeChartSource';
import { canZoomChartOut, useChartZoomStore } from '../store/useChartZoomStore';
import { commandBus } from '../services/commandBus';
import { drawingManager } from '../services/drawingManager';
import {
  defaultChartObjectState,
  getChartObjectState,
  useChartObjectStateStore,
} from '../store/useChartObjectStateStore';
import { useDrawingToolPreferencesStore } from '../store/useDrawingToolPreferencesStore';
import { useRemoveDrawingsSettingsStore } from '../store/useRemoveDrawingsSettingsStore';
import type { PayloadFor } from '../types/commands';
import { DRAWING_TOOL_ICONS } from './toolIcons';
import { ForecastingMeasurementToolIcon } from './ForecastingMeasurementToolIcon';
import { GannFibonacciToolIcon } from './GannFibonacciToolIcon';
import { BrushToolsIcon } from './BrushToolsIcon';
import { DrawingRailIcon } from './DrawingRailIcon';
import { EmojiPicker } from './EmojiPicker';
import { isPictographStamp } from './pictographCatalog';
import { BrushShapeToolIcon } from './BrushShapeToolIcon';
import { BRUSH_SHAPE_TOOLS } from './brushShapeToolCatalog';
import {
  FORECASTING_MEASUREMENT_TOOL_GROUPS,
  FORECASTING_MEASUREMENT_TOOLS,
} from './forecastingMeasurementToolCatalog';
import {
  GANN_FIBONACCI_TOOL_GROUPS,
  GANN_FIBONACCI_TOOLS,
} from './gannFibonacciToolCatalog';
import {
  DEFAULT_TREND_LINE_TOOL_ID,
  TREND_LINE_TOOL_GROUPS,
  TREND_LINE_TOOLS,
  getTrendLineTool,
  type TrendLineToolId,
} from './toolCatalog';
import { isWebDrawingToolsRuntime } from './runtime';
import './WebDrawingToolsRail.css';
import { AnnotationToolIcon } from './AnnotationToolIcon';
import { ANNOTATION_TOOLS as TEXT_NOTE_TOOLS } from './annotationToolCatalog';
import { CursorToolIcon } from './CursorToolIcon';
import { CURSOR_TOOLS, getCursorTool } from './cursorToolCatalog';
import { useChartCursorStore } from '../store/useChartCursorStore';
import type { ChartCursorMode } from '../store/useChartCursorStore';
import {
  buildRemovalMenuItems,
  countRemovableDrawings,
  selectRemovableDrawings,
  type RemovalCounts,
  type RemovalScope,
} from './removeDrawingsPlan';

const LAST_TOOL_STORAGE_KEY = 'rtx5:web:last-trend-line-tool';
const MENU_TRIGGER_GAP_PX = 4;
const TOOLTIP_TRIGGER_GAP_PX = 8;
const TOOLTIP_HALF_HEIGHT_PX = 15;
const VIEWPORT_EDGE_GAP_PX = 8;
const TOOLTIP_ID = 'web-drawing-tools-tooltip';

type DrawingCommandTool = PayloadFor<'SELECT_TOOL'>['tool'];
type RailMenuId =
  | 'cursors'
  | 'trend'
  | 'fibonacci'
  | 'patterns'
  | 'forecasting'
  | 'shapes'
  | 'annotations'
  | 'emojis'
  | 'stamps'
  | 'magnet'
  | 'lock'
  | 'hide'
  | 'remove';

type LockScope = 'drawings' | 'indicators' | 'all';
type HideScope = 'drawings' | 'indicators' | 'trades' | 'all';

interface MenuPosition {
  left: number;
  top: number;
}

interface ActiveTool {
  tool: DrawingCommandTool;
  subtype?: string;
}

interface TooltipState {
  ownerId: string;
  label: string;
  left: number;
  top: number;
}

interface TooltipOwner {
  ownerId: string;
  label: string;
  trigger: HTMLButtonElement;
}

interface SimpleDrawingTool {
  tool: DrawingCommandTool;
  label: string;
  icon: IconName;
  subtype?: string;
}

const GEOMETRIC_SHAPE_TOOLS: readonly SimpleDrawingTool[] = [
  { tool: 'freehand', label: 'Brush', icon: 'freehand' },
  { tool: 'freehand', subtype: 'highlighter', label: 'Highlighter', icon: 'freehand' },
];

const ANNOTATION_TOOLS: readonly SimpleDrawingTool[] = [
  ...TEXT_NOTE_TOOLS.map(item => ({ tool: 'text' as const, subtype: item.id, label: item.label, icon: 'text' as const })),
];

const readStoredTool = (): TrendLineToolId => {
  if (typeof window === 'undefined') return DEFAULT_TREND_LINE_TOOL_ID;
  try {
    const stored = window.localStorage.getItem(LAST_TOOL_STORAGE_KEY);
    return getTrendLineTool(stored)?.id ?? DEFAULT_TREND_LINE_TOOL_ID;
  } catch {
    return DEFAULT_TREND_LINE_TOOL_ID;
  }
};

const resolveCommandTool = (payload: PayloadFor<'SELECT_TOOL'>): TrendLineToolId | null => {
  const exact = getTrendLineTool(payload.subtype);
  if (exact && exact.drawingType === payload.tool) return exact.id;
  if (payload.tool === 'trendline') return 'trendline';
  if (payload.tool === 'hline') return 'horizontal_line';
  if (payload.tool === 'vline') return 'vertical_line';
  if (payload.tool === 'channel') return 'parallel_channel';
  return null;
};

export interface WebDrawingToolsRailProps {
  selectedSymbol: string;
  orientation?: 'vertical' | 'horizontal';
}

export function WebDrawingToolsRail({ selectedSymbol, orientation = 'vertical' }: WebDrawingToolsRailProps) {
    const tr = useUiTranslation();
  const [lastToolId, setLastToolId] = useState<TrendLineToolId>(readStoredTool);
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [activeTargetContextId, setActiveTargetContextId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<RailMenuId | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const requestedMenu = useDrawingSidebarStore(state => state.requestedMenu);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const stampButtonRef = useRef<HTMLButtonElement>(null);
  const cursorMode = useChartCursorStore((state) => state.mode);
  const valuesTooltipOnLongPress = useChartCursorStore((state) => state.valuesTooltipOnLongPress);
  const magnetMode = useDrawingToolPreferencesStore((state) => state.magnetMode);
  const snapToIndicators = useDrawingToolPreferencesStore((state) => state.snapToIndicators);
  const keepDrawing = useDrawingToolPreferencesStore((state) => state.keepDrawing);
  const setMagnetMode = useDrawingToolPreferencesStore((state) => state.setMagnetMode);
  const setSnapToIndicators = useDrawingToolPreferencesStore((state) => state.setSnapToIndicators);
  const setKeepDrawing = useDrawingToolPreferencesStore((state) => state.setKeepDrawing);
  const [indicatorCounts, setIndicatorCounts] = useState<Record<string, number>>({});
  const [removalCounts, setRemovalCounts] = useState<RemovalCounts>({ drawings: 0, indicators: 0 });
  const alwaysRemoveLocked = useRemoveDrawingsSettingsStore((state) => state.alwaysRemoveLocked);
  const setAlwaysRemoveLocked = useRemoveDrawingsSettingsStore((state) => state.setAlwaysRemoveLocked);
  const currentChartSourceId = useSyncExternalStore(subscribeActiveChartSource, getActiveChartSourceId, () => null);
  const canZoomOut = useChartZoomStore((state) => canZoomChartOut(state.byContext[currentChartSourceId ?? '']));
  const chartObjectState = useChartObjectStateStore((state) => (
    state.byContext[currentChartSourceId ?? ''] ?? defaultChartObjectState
  ));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredTooltipOwnerRef = useRef<TooltipOwner | null>(null);
  const focusedTooltipOwnerRef = useRef<TooltipOwner | null>(null);
  const pendingDrawingToolRef = useRef<ActiveTool | null>(null);
  const activeToolRef = useRef<ActiveTool | null>(null);
  useEffect(() => {
    if (canZoomOut) return;
    if (hoveredTooltipOwnerRef.current?.ownerId === 'zoom-out') hoveredTooltipOwnerRef.current = null;
    if (focusedTooltipOwnerRef.current?.ownerId === 'zoom-out') focusedTooltipOwnerRef.current = null;
    setTooltip((current) => current?.ownerId === 'zoom-out' ? null : current);
  }, [canZoomOut]);
  const visibleActiveTool = activeTargetContextId
    && currentChartSourceId
    && activeTargetContextId !== currentChartSourceId
    ? null
    : activeTool;
  const selectedCursor = (getCursorTool(cursorMode) ?? getCursorTool('arrow'))!;
  useEffect(() => {
    if (cursorMode === 'eraser' || cursorMode === 'demonstration') {
      useChartCursorStore.getState().setMode('arrow');
    }
  }, [cursorMode]);
  const selectedTool = getTrendLineTool(lastToolId) ?? TREND_LINE_TOOLS[0];
  const SelectedIcon = DRAWING_TOOL_ICONS[selectedTool.id];
  const activeTrendToolId = visibleActiveTool
    ? resolveCommandTool({ tool: visibleActiveTool.tool, subtype: visibleActiveTool.subtype })
    : null;
  const groupedTools = useMemo(
    () => TREND_LINE_TOOL_GROUPS.map((group) => ({
      group,
      tools: TREND_LINE_TOOLS.filter((tool) => tool.group === group),
    })),
    [],
  );
  const groupedGannFibonacciTools = useMemo(
    () => GANN_FIBONACCI_TOOL_GROUPS.map((group) => ({
      group,
      tools: GANN_FIBONACCI_TOOLS.filter((tool) => tool.group === group),
    })),
    [],
  );
  const groupedForecastingMeasurementTools = useMemo(
    () => FORECASTING_MEASUREMENT_TOOL_GROUPS.map((group) => ({
      group,
      tools: FORECASTING_MEASUREMENT_TOOLS.filter((tool) => tool.group === group),
    })),
    [],
  );

  const persistTrendTool = (toolId: TrendLineToolId) => {
    setLastToolId(toolId);
    try {
      window.localStorage.setItem(LAST_TOOL_STORAGE_KEY, toolId);
    } catch {
      // Storage can be unavailable in embedded/private contexts; drawing remains usable.
    }
  };

  const dispatchDrawingTool = useCallback((tool: DrawingCommandTool, subtype?: string) => {
    const targetContextId = getActiveChartSource()?.id;
    const pendingTool = { tool, subtype };
    // Keep one pending arm until the user clicks a chart. A
    // dock-tab activation or chart remount can otherwise make this first
    // SELECT_TOOL target stale, leaving the rail highlighted but the chart
    // unable to accept drawing points.
    pendingDrawingToolRef.current = pendingTool;
    setMenuOpen(null);
    setTooltip(null);
    setActiveTool(pendingTool);
    setActiveTargetContextId(targetContextId ?? null);
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: { tool, subtype, targetContextId },
    });
  }, []);

  const dispatchTrendTool = useCallback((toolId: TrendLineToolId) => {
    const tool = getTrendLineTool(toolId);
    if (!tool) return;
    persistTrendTool(tool.id);
    dispatchDrawingTool(tool.drawingType, tool.id);
  }, [dispatchDrawingTool]);

  const selectCursor = () => {
    const targetContextId = getActiveChartSource()?.id;
    pendingDrawingToolRef.current = null;
    setMenuOpen(null);
    setTooltip(null);
    setActiveTool(null);
    setActiveTargetContextId(null);
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId },
    });
  };

  const selectCursorMode = (mode: ChartCursorMode) => {
    useChartCursorStore.getState().setMode(mode);
    selectCursor();
  };

  const openRailMenu = (menuId: RailMenuId, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setTooltip(null);
    setMenuPosition(null);
    setMenuOpen((current) => current === menuId ? null : menuId);
  };

  useEffect(() => {
    if (!requestedMenu) return;
    const trigger = requestedMenu === 'emojis' ? emojiButtonRef.current : stampButtonRef.current;
    if (!trigger) return;
    triggerRef.current = trigger;
    setTooltip(null);
    setMenuPosition(null);
    setMenuOpen(requestedMenu);
    useDrawingSidebarStore.getState().clearMenuRequest();
  }, [requestedMenu]);

  const showTooltip = (ownerId: string, label: string, trigger: HTMLButtonElement) => {
    const rect = trigger.getBoundingClientRect();
    if (orientation === 'horizontal') {
      setTooltip({ ownerId, label, left: Math.round(rect.left), top: Math.round(rect.bottom + TOOLTIP_TRIGGER_GAP_PX) });
      return;
    }
    setTooltip({
      ownerId,
      label,
      left: Math.round(Math.min(window.innerWidth - VIEWPORT_EDGE_GAP_PX, rect.right + TOOLTIP_TRIGGER_GAP_PX)),
      top: Math.round(Math.max(
        VIEWPORT_EDGE_GAP_PX + TOOLTIP_HALF_HEIGHT_PX,
        Math.min(
          window.innerHeight - VIEWPORT_EDGE_GAP_PX - TOOLTIP_HALF_HEIGHT_PX,
          rect.top + (rect.height / 2),
        ),
      )),
    });
  };

  const hideTooltip = (ownerId: string) => {
    setTooltip((current) => current?.ownerId === ownerId ? null : current);
  };

  const tooltipProps = (ownerId: string, label: string) => ({
    'aria-describedby': tooltip?.ownerId === ownerId ? TOOLTIP_ID : undefined,
    onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => {
      hoveredTooltipOwnerRef.current = { ownerId, label, trigger: event.currentTarget };
      showTooltip(ownerId, label, event.currentTarget);
    },
    onMouseLeave: () => {
      if (hoveredTooltipOwnerRef.current?.ownerId === ownerId) hoveredTooltipOwnerRef.current = null;
      const focusedOwner = focusedTooltipOwnerRef.current;
      if (focusedOwner) {
        showTooltip(focusedOwner.ownerId, focusedOwner.label, focusedOwner.trigger);
      } else {
        hideTooltip(ownerId);
      }
    },
    onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
      focusedTooltipOwnerRef.current = { ownerId, label, trigger: event.currentTarget };
      showTooltip(ownerId, label, event.currentTarget);
    },
    onBlur: () => {
      if (focusedTooltipOwnerRef.current?.ownerId === ownerId) focusedTooltipOwnerRef.current = null;
      const hoveredOwner = hoveredTooltipOwnerRef.current;
      if (hoveredOwner) {
        showTooltip(hoveredOwner.ownerId, hoveredOwner.label, hoveredOwner.trigger);
      } else {
        hideTooltip(ownerId);
      }
    },
  });

  const dispatchZoom = (type: 'ZOOM_IN' | 'ZOOM_OUT') => {
    const targetContextId = getActiveChartSource()?.id;
    if (!targetContextId) return;
    setMenuOpen(null);
    commandBus.dispatch({
      type,
      payload: { targetContextId },
    });
  };

  const applyRemovalScope = (scope: RemovalScope) => {
    const targetContextId = getActiveChartSource()?.id;
    setMenuOpen(null);
    if (scope !== 'indicators' && targetContextId) {
      selectRemovableDrawings(drawingManager.getDrawings(targetContextId), alwaysRemoveLocked)
        .forEach((drawing) => drawingManager.deleteDrawing(drawing.id, targetContextId));
    }
    if (scope !== 'drawings') {
      commandBus.dispatch({ type: 'REMOVE_ALL_INDICATORS', payload: { targetContextId } });
    }
    setActiveTool(null);
    setActiveTargetContextId(null);
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId },
    });
  };

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const applyLockScope = (scope: LockScope) => {
    const contextId = getActiveChartSource()?.id;
    setMenuOpen(null);
    if (!contextId) return;
    const objectState = getChartObjectState(useChartObjectStateStore.getState().byContext, contextId);
    const nextLocked = scope === 'all'
      ? !(objectState.drawingsLocked && objectState.indicatorsLocked)
      : scope === 'drawings'
        ? !objectState.drawingsLocked
        : !objectState.indicatorsLocked;
    if (scope !== 'indicators' && nextLocked !== objectState.drawingsLocked) {
      drawingManager.setAllDrawingsLocked(nextLocked, contextId);
      useChartObjectStateStore.getState().setDrawingsLocked(contextId, nextLocked);
    }
    if (scope !== 'drawings' && nextLocked !== objectState.indicatorsLocked) {
      useChartObjectStateStore.getState().setIndicatorsLocked(contextId, nextLocked);
    }
  };

  const applyHideScope = (scope: HideScope) => {
    const contextId = getActiveChartSource()?.id;
    setMenuOpen(null);
    if (!contextId) return;
    const objectStateStore = useChartObjectStateStore.getState();
    const objectState = getChartObjectState(objectStateStore.byContext, contextId);
    if (scope === 'all') {
      const allHidden = objectState.drawingsHidden
        && objectState.indicatorsHidden
        && objectState.tradesHidden;
      objectStateStore.setAllHidden(contextId, !allHidden);
      return;
    }
    if (scope === 'drawings') objectStateStore.setDrawingsHidden(contextId, !objectState.drawingsHidden);
    if (scope === 'indicators') objectStateStore.setIndicatorsHidden(contextId, !objectState.indicatorsHidden);
    if (scope === 'trades') objectStateStore.setTradesHidden(contextId, !objectState.tradesHidden);
  };

  useEffect(() => {
    const handleIndicatorsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ contextId?: string; count?: number }>).detail;
      if (!detail?.contextId) return;
      setIndicatorCounts((current) => ({ ...current, [detail.contextId as string]: detail.count ?? 0 }));
    };
    window.addEventListener('indicators:changed', handleIndicatorsChanged);
    return () => window.removeEventListener('indicators:changed', handleIndicatorsChanged);
  }, []);

  useEffect(() => {
    const contextId = getActiveChartSource()?.id;
    const drawings = contextId ? drawingManager.getDrawings(contextId) : [];
    setRemovalCounts({
      drawings: countRemovableDrawings(drawings, alwaysRemoveLocked),
      indicators: contextId && !chartObjectState.indicatorsLocked ? indicatorCounts[contextId] ?? 0 : 0,
    });
  }, [alwaysRemoveLocked, chartObjectState.indicatorsLocked, indicatorCounts, menuOpen, selectedSymbol]);

  useLayoutEffect(() => {
    if (!menuOpen) return;

    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const rightCandidate = triggerRect.right + MENU_TRIGGER_GAP_PX;
      const leftCandidate = triggerRect.left - menuRect.width - MENU_TRIGGER_GAP_PX;
      const availableRight = window.innerWidth - VIEWPORT_EDGE_GAP_PX;
      const left = rightCandidate + menuRect.width <= availableRight
        ? rightCandidate
        : Math.max(VIEWPORT_EDGE_GAP_PX, leftCandidate);
      const maximumTop = Math.max(
        VIEWPORT_EDGE_GAP_PX,
        window.innerHeight - menuRect.height - VIEWPORT_EDGE_GAP_PX,
      );

      if (orientation === 'horizontal') {
        // Desktop uses the complete shared tool catalog above the workspace.
        // Keep even tall emoji/tool menus below the row with their own scroll.
        const top = Math.min(triggerRect.bottom + MENU_TRIGGER_GAP_PX, window.innerHeight - VIEWPORT_EDGE_GAP_PX);
        setMenuPosition({
          left: Math.round(Math.max(VIEWPORT_EDGE_GAP_PX, Math.min(triggerRect.left, availableRight - menuRect.width))),
          top: Math.round(Math.max(VIEWPORT_EDGE_GAP_PX, top)),
        });
        return;
      }

      setMenuPosition({
        left: Math.round(left),
        top: Math.round(Math.max(
          VIEWPORT_EDGE_GAP_PX,
          Math.min(triggerRect.top, maximumTop),
        )),
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, orientation]);

  useLayoutEffect(() => {
    if (!tooltip || orientation !== 'horizontal' || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    const left = Math.round(Math.max(VIEWPORT_EDGE_GAP_PX, Math.min(tooltip.left, window.innerWidth - rect.width - VIEWPORT_EDGE_GAP_PX)));
    const top = Math.round(Math.max(VIEWPORT_EDGE_GAP_PX, Math.min(tooltip.top, window.innerHeight - rect.height - VIEWPORT_EDGE_GAP_PX)));
    if (left !== tooltip.left || top !== tooltip.top) setTooltip({ ...tooltip, left, top });
  }, [tooltip, orientation]);

  useEffect(() => {
    const armPendingToolForChart = (event: PointerEvent) => {
      const pendingTool = pendingDrawingToolRef.current;
      if (!pendingTool) return;
      const eventTarget = event.target;
      if (!(eventTarget instanceof Element)) return;
      const chartWrapper = eventTarget.closest<HTMLElement>('.rtx-chart-wrapper');
      if (!chartWrapper || eventTarget.closest('button, input, select, textarea, [contenteditable="true"], [role="button"]')) return;
      if (event.button !== undefined && event.button !== 0) return;

      // Hover must not change the Market Watch destination or consume the
      // pending tool. Capture the click before the chart's drawing handlers
      // run so its first point belongs to the clicked pane, even if a sibling
      // owned the command when the toolbar button was pressed.
      const clickedContextId = chartWrapper.dataset.chartContextId;
      const targetContextId = clickedContextId
        ? activateActiveChartSource(clickedContextId)?.id
        : getActiveChartSource()?.id;
      if (!targetContextId) return;
      pendingDrawingToolRef.current = null;
      setActiveTargetContextId(targetContextId);
      // Do not restart an existing draft in this pane: its preview or earlier
      // anchors must survive the first click after selecting the tool.
      const armedDrawing = drawingManager.getActiveDrawing(targetContextId);
      if (pendingTool.tool === 'ruler' && chartWrapper.querySelector('[data-chart-ruler-armed="true"]')) return;
      if (armedDrawing?.type === pendingTool.tool && armedDrawing.subtype === pendingTool.subtype) return;
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { ...pendingTool, targetContextId },
      });
    };

    document.addEventListener('pointerdown', armPendingToolForChart, true);
    return () => {
      document.removeEventListener('pointerdown', armPendingToolForChart, true);
    };
  }, []);

  useEffect(() => {
    const unsubscribeSelectTool = commandBus.subscribe('SELECT_TOOL', (payload) => {
      const currentTargetContextId = getActiveChartSource()?.id;
      if (payload.targetContextId && payload.targetContextId !== currentTargetContextId) return;

      if (payload.tool === 'cursor') {
        pendingDrawingToolRef.current = null;
        setActiveTool(null);
        setActiveTargetContextId(null);
        return;
      }

      const nextToolId = resolveCommandTool(payload);
      if (nextToolId) persistTrendTool(nextToolId);
      setActiveTool({ tool: payload.tool, subtype: payload.subtype });
      setActiveTargetContextId(payload.targetContextId ?? currentTargetContextId ?? null);
    });
    const unsubscribeMagnet = commandBus.subscribe('TOGGLE_MAGNET', () => {
      const preferences = useDrawingToolPreferencesStore.getState();
      preferences.setMagnetMode(preferences.magnetMode === 'off' ? 'strong' : 'off');
    });

    return () => {
      unsubscribeSelectTool();
      unsubscribeMagnet();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const handleDrawingSaved = (event: Event) => {
      const contextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      if (activeTargetContextId && contextId && activeTargetContextId !== contextId) return;
      if (orientation !== 'horizontal' && event.type === 'drawing:saved' && (event as CustomEvent<{ type?: string }>).detail?.type === 'freehand') return;
      if (orientation !== 'horizontal' && useDrawingToolPreferencesStore.getState().keepDrawing) {
        // Keep drawing arms the same tool again once the save has fully
        // settled, so the replay cannot race the completion cleanup.
        const keptTool = activeToolRef.current;
        if (!keptTool) return;
        queueMicrotask(() => {
          commandBus.dispatch({
            type: 'SELECT_TOOL',
            payload: { ...keptTool, targetContextId: getActiveChartSource()?.id },
          });
        });
        return;
      }
      pendingDrawingToolRef.current = null;
      setActiveTool(null);
      setActiveTargetContextId(null);
    };
    const handleDrawingCancelled = (event: Event) => {
      const contextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      // SELECT_TOOL cancels the old draft before arming its replacement.
      // Observe the completed command before clearing the replacement's rail state.
      queueMicrotask(() => {
        const lastSelection = commandBus.getHistory().reverse().find(command => command.type === 'SELECT_TOOL');
        if (lastSelection?.type === 'SELECT_TOOL' && lastSelection.payload.tool === 'ruler') return;
        if (!disposed && !drawingManager.getActiveDrawing(contextId)) handleDrawingSaved(event);
      });
    };
    window.addEventListener('drawing:saved', handleDrawingSaved);
    window.addEventListener('drawing:cancelled', handleDrawingCancelled);
    return () => {
      disposed = true;
      window.removeEventListener('drawing:saved', handleDrawingSaved);
      window.removeEventListener('drawing:cancelled', handleDrawingCancelled);
    };
  }, [activeTargetContextId, orientation]);

  useKeyboardShortcuts([
    ...([
      ['t', 'trendline', 'Trend Line'],
      ['h', 'horizontal_line', 'Horizontal Line'],
      ['j', 'horizontal_ray', 'Horizontal Ray'],
      ['v', 'vertical_line', 'Vertical Line'],
      ['c', 'crossline', 'Cross Line'],
    ] as const).map(([key, tool, description]) => ({
      id: `drawing.rail.${tool}`, key, alt: true, description,
      category: 'Drawing tools', enabled: isWebDrawingToolsRuntime(),
      handler: () => dispatchTrendTool(tool),
    })),
    { id: 'drawing.rail.fibonacci', key: 'f', alt: true, description: 'Fib Retracement', category: 'Drawing tools', enabled: isWebDrawingToolsRuntime(), handler: () => dispatchDrawingTool('fibonacci', 'fib_retracement') },
    { id: 'drawing.rail.text', key: 'x', alt: true, description: 'Text', category: 'Drawing tools', enabled: isWebDrawingToolsRuntime(), handler: () => dispatchDrawingTool('text') },
  ], [dispatchDrawingTool, dispatchTrendTool]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(null);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const renderSimpleMenuItems = (tools: readonly SimpleDrawingTool[]) => tools.map((tool) => {
    const isSelected = visibleActiveTool?.tool === tool.tool && visibleActiveTool?.subtype === tool.subtype;
    return (
      <button
        className="web-drawing-tools-menu__item"
        data-selected={isSelected ? 'true' : 'false'}
        role="menuitemradio"
        aria-checked={isSelected}
        key={`${tool.tool}:${tool.subtype ?? 'default'}`}
        type="button"
        onClick={() => dispatchDrawingTool(tool.tool, tool.subtype)}
      >
        {tool.tool === 'text' ? <AnnotationToolIcon id={tool.subtype || 'text'} /> : tool.tool === 'freehand' && !tool.subtype ? <BrushToolsIcon size={23} /> : <Icon name={tool.icon} size={19} />}
        <span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
      </button>
    );
  });

  const removalMenuItems = menuOpen === 'remove' ? buildRemovalMenuItems(removalCounts) : [];

  const menuLabel = menuOpen === 'cursors'
    ? 'Cursors'
    : menuOpen === 'trend'
    ? 'Lines, channels, and pitchforks'
    : menuOpen === 'fibonacci'
      ? 'Gann and Fibonacci tools'
      : menuOpen === 'patterns'
        ? 'Chart patterns'
        : menuOpen === 'forecasting'
          ? 'Forecasting and measurement tools'
          : menuOpen === 'shapes'
            ? 'Brushes, arrows, and shapes'
            : menuOpen === 'annotations'
              ? 'Annotation tools'
              : menuOpen === 'stamps'
                ? 'Icons and stamps'
                : menuOpen === 'emojis'
                  ? 'Emoji picker'
                : menuOpen === 'magnet'
                  ? 'Magnet mode'
                  : menuOpen === 'lock'
                    ? 'Lock objects'
                    : menuOpen === 'hide'
                      ? 'Hide objects'
                      : 'Remove drawings';

  const menu = menuOpen ? createPortal(
    <div
      ref={menuRef}
      className="web-drawing-tools-menu"
      data-menu={menuOpen}
      role={menuOpen === 'emojis' ? 'dialog' : 'menu'}
      aria-label={tr(menuLabel)}
      style={menuPosition
        ? { left: menuPosition.left, top: menuPosition.top,
          ...(orientation === 'horizontal' ? { maxHeight: `calc(100vh - ${menuPosition.top + VIEWPORT_EDGE_GAP_PX}px)` } : {}) }
        : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {menuOpen === 'cursors' && (
        <section className="web-drawing-tools-menu__group" aria-label={tr('Cursors')}>
          <div className="web-drawing-tools-menu__heading">{tr('Cursors')}</div>
          {CURSOR_TOOLS.map((tool) => {
            const selected = cursorMode === tool.id;
            return (
              <button
                key={tool.id}
                className="web-drawing-tools-menu__item"
                data-selected={selected ? 'true' : 'false'}
                data-tool-id={tool.id}
                role="menuitemradio"
                aria-checked={selected}
                type="button"
                onClick={() => selectCursorMode(tool.id)}
              >
                <CursorToolIcon id={tool.id} />
                <span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
              </button>
            );
          })}
          <div className="web-drawing-tools-menu__separator" />
          <div
            className="web-drawing-tools-menu__toggle-row"
            data-cursor-setting="values-tooltip"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('[role="switch"]')) return;
              useChartCursorStore.getState().setValuesTooltipOnLongPress(!valuesTooltipOnLongPress);
            }}
          >
            <span className="web-drawing-tools-menu__label">{tr('Values tooltip on long press')}</span>
            <ToggleSwitch
              size="sm"
              checked={valuesTooltipOnLongPress}
              onChange={(checked) => useChartCursorStore.getState().setValuesTooltipOnLongPress(checked)}
              ariaLabel="Values tooltip on long press"
            />
          </div>
        </section>
      )}
      {menuOpen === 'emojis' && (
        <EmojiPicker
          ready={Boolean(menuPosition)}
          selectedSubtype={visibleActiveTool?.tool === 'stamp' ? visibleActiveTool.subtype : undefined}
          onSelect={(subtype) => dispatchDrawingTool('stamp', subtype)}
        />
      )}
      {menuOpen === 'trend' && groupedTools.map(({ group, tools }, groupIndex) => (
        <section
          className="web-drawing-tools-menu__group"
          aria-labelledby={`web-drawing-tools-group-${group.toLowerCase()}`}
          key={group}
        >
          <div
            id={`web-drawing-tools-group-${group.toLowerCase()}`}
            className="web-drawing-tools-menu__heading"
          >
            {tr(group)}
          </div>
          {tools.map((tool) => {
            const ToolIcon = DRAWING_TOOL_ICONS[tool.id];
            const isSelected = lastToolId === tool.id;
            return (
              <button
                className="web-drawing-tools-menu__item"
                data-selected={isSelected ? 'true' : 'false'}
                role="menuitemradio"
                aria-checked={isSelected}
                key={tool.id}
                type="button"
                onClick={() => dispatchTrendTool(tool.id)}
              >
                <ToolIcon aria-hidden="true" size={19} strokeWidth={1.35} />
                <span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
                {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
              </button>
            );
          })}
          {groupIndex < groupedTools.length - 1 ? (
            <div className="web-drawing-tools-menu__separator" />
          ) : null}
        </section>
      ))}

      {menuOpen === 'fibonacci' && groupedGannFibonacciTools.map(({ group, tools }, groupIndex) => (
        <section
          className="web-drawing-tools-menu__group"
          aria-labelledby={`web-drawing-tools-fibonacci-group-${group.toLowerCase()}`}
          key={group}
        >
          <div
            id={`web-drawing-tools-fibonacci-group-${group.toLowerCase()}`}
            className="web-drawing-tools-menu__heading"
          >
            {tr(group)}
          </div>
          {tools.map((tool) => {
            const isSelected = visibleActiveTool?.tool === tool.drawingType
              && visibleActiveTool?.subtype === tool.id;
            return (
              <button
                className="web-drawing-tools-menu__item"
                data-selected={isSelected ? 'true' : 'false'}
                data-tool-id={tool.id}
                role="menuitemradio"
                aria-checked={isSelected}
                key={tool.id}
                type="button"
                onClick={() => dispatchDrawingTool(tool.drawingType, tool.id)}
              >
                <GannFibonacciToolIcon id={tool.id} size={20} />
                <span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
                {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
              </button>
            );
          })}
          {groupIndex < groupedGannFibonacciTools.length - 1 ? (
            <div className="web-drawing-tools-menu__separator" />
          ) : null}
        </section>
      ))}

      {menuOpen === 'patterns' && CHART_PATTERN_GROUPS.map((group, groupIndex) => (
        <section className="web-drawing-tools-menu__group" aria-label={tr(group)} key={group}>
          <div className="web-drawing-tools-menu__heading">{tr(group)}</div>
          {CHART_PATTERN_TOOLS.filter(tool => tool.group === group).map(tool => {
            const selected = visibleActiveTool?.tool === 'pattern' && visibleActiveTool.subtype === tool.id;
            return <button className="web-drawing-tools-menu__item" data-tool-id={tool.id}
              data-selected={selected ? 'true' : 'false'} role="menuitemradio" aria-checked={selected}
              key={tool.id} type="button" onClick={() => dispatchDrawingTool('pattern', tool.id)}>
              <ChartPatternToolIcon id={tool.id} /><span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
            </button>;
          })}
          {groupIndex < CHART_PATTERN_GROUPS.length - 1 && <div className="web-drawing-tools-menu__separator" />}
        </section>
      ))}

      {menuOpen === 'forecasting' && groupedForecastingMeasurementTools.map(({ group, tools }, groupIndex) => (
        <section
          className="web-drawing-tools-menu__group"
          aria-labelledby={`web-drawing-tools-forecasting-group-${group.toLowerCase()}`}
          key={group}
        >
          <div
            id={`web-drawing-tools-forecasting-group-${group.toLowerCase()}`}
            className="web-drawing-tools-menu__heading"
          >
            {tr(group)}
          </div>
          {tools.map((tool) => {
            const isSelected = visibleActiveTool?.tool === tool.drawingType
              && visibleActiveTool?.subtype === tool.id;
            return (
              <button
                className="web-drawing-tools-menu__item"
                data-selected={isSelected ? 'true' : 'false'}
                data-tool-id={tool.id}
                role="menuitemradio"
                aria-checked={isSelected}
                key={tool.id}
                type="button"
                onClick={() => dispatchDrawingTool(tool.drawingType, tool.id)}
              >
                <ForecastingMeasurementToolIcon id={tool.id} size={20} />
                <span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
              </button>
            );
          })}
          {groupIndex < groupedForecastingMeasurementTools.length - 1 ? (
            <div className="web-drawing-tools-menu__separator" />
          ) : null}
        </section>
      ))}
      {menuOpen === 'shapes' && ['Brushes', 'Arrows', 'Shapes'].map(group => (
        <section className="web-drawing-tools-menu__group" aria-label={tr(group)} key={group}>
          <div className="web-drawing-tools-menu__heading">{tr(group)}</div>
          {group === 'Brushes' && renderSimpleMenuItems(GEOMETRIC_SHAPE_TOOLS.filter(tool => tool.tool === 'freehand'))}
          {BRUSH_SHAPE_TOOLS.filter(tool => tool.group === group).map(tool => (
            <button className="web-drawing-tools-menu__item" role="menuitemradio" type="button" key={tool.id}
              aria-checked={visibleActiveTool?.tool === 'shapes' && visibleActiveTool.subtype === tool.id}
              onClick={() => dispatchDrawingTool('shapes', tool.id)}>
              <BrushShapeToolIcon id={tool.id} /><span className="web-drawing-tools-menu__label">{tr(tool.label)}</span>
            </button>
          ))}
          {group === 'Shapes' && renderSimpleMenuItems(GEOMETRIC_SHAPE_TOOLS.filter(tool => tool.tool !== 'freehand'))}
        </section>
      ))}
      {menuOpen === 'annotations' && ['Text and notes', 'Content'].map(group => <section key={group} className="web-drawing-tools-menu__group" aria-label={tr(group)}>
        {group === 'Content' && <div className="web-drawing-tools-menu__separator" />}
        <div className="web-drawing-tools-menu__heading">{tr(group)}</div>
        {renderSimpleMenuItems(ANNOTATION_TOOLS.filter(tool => TEXT_NOTE_TOOLS.find(item => item.id === tool.subtype)?.group === group))}
      </section>)}
      {menuOpen === 'stamps' && STAMP_OPTIONS.map((stamp) => {
        const isSelected = visibleActiveTool?.tool === 'stamp' && visibleActiveTool.subtype === stamp.subtype;
        return (
          <button
            className="web-drawing-tools-menu__item"
            data-selected={isSelected ? 'true' : 'false'}
            role="menuitemradio"
            aria-checked={isSelected}
            key={stamp.subtype}
            type="button"
            onClick={() => dispatchDrawingTool('stamp', stamp.subtype)}
          >
            <Icon name={stamp.icon} size={19} />
            <span className="web-drawing-tools-menu__label">{tr(stamp.label)}</span>
          </button>
        );
      })}
      {menuOpen === 'magnet' && (
        <>
          {([['weak', 'Weak magnet'], ['strong', 'Strong magnet']] as const).map(([mode, label]) => {
            const isSelected = magnetMode === mode;
            return (
              <button
                className="web-drawing-tools-menu__item"
                data-selected={isSelected ? 'true' : 'false'}
                data-magnet-mode={mode}
                role="menuitemradio"
                aria-checked={isSelected}
                key={mode}
                type="button"
                onClick={() => setMagnetMode(isSelected ? 'off' : mode)}
              >
                <Icon name="magnet" size={19} />
                <span className="web-drawing-tools-menu__label">{tr(label)}</span>
              </button>
            );
          })}
          <div className="web-drawing-tools-menu__separator" />
          <div className="web-drawing-tools-menu__toggle-row">
            <span className="web-drawing-tools-menu__label">{tr("Snap to indicators")}</span>
            <ToggleSwitch
              size="sm"
              checked={snapToIndicators}
              onChange={setSnapToIndicators}
              ariaLabel="Snap to indicators"
            />
          </div>
        </>
      )}
      {menuOpen === 'lock' && (
        <>
          <button
            className="web-drawing-tools-menu__item"
            data-lock-scope="drawings"
            role="menuitem"
            type="button"
            onClick={() => applyLockScope('drawings')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.drawingsLocked ? tr("Unlock drawings") : tr("Lock drawings")}
            </span>
          </button>
          <button
            className="web-drawing-tools-menu__item"
            data-lock-scope="indicators"
            role="menuitem"
            type="button"
            onClick={() => applyLockScope('indicators')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.indicatorsLocked ? tr("Unlock indicators") : tr("Lock indicators")}
            </span>
          </button>
          <button
            className="web-drawing-tools-menu__item"
            data-lock-scope="all"
            role="menuitem"
            type="button"
            onClick={() => applyLockScope('all')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.drawingsLocked && chartObjectState.indicatorsLocked ? tr("Unlock all") : tr("Lock all")}
            </span>
          </button>
        </>
      )}
      {menuOpen === 'hide' && (
        <>
          <button
            className="web-drawing-tools-menu__item"
            data-hide-scope="drawings"
            role="menuitem"
            type="button"
            onClick={() => applyHideScope('drawings')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.drawingsHidden ? tr("Show drawings") : tr("Hide drawings")}
            </span>
          </button>
          <button
            className="web-drawing-tools-menu__item"
            data-hide-scope="indicators"
            role="menuitem"
            type="button"
            onClick={() => applyHideScope('indicators')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.indicatorsHidden ? tr("Show indicators") : tr("Hide indicators")}
            </span>
          </button>
          <button
            className="web-drawing-tools-menu__item"
            data-hide-scope="trades"
            role="menuitem"
            type="button"
            onClick={() => applyHideScope('trades')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.tradesHidden ? tr("Show positions and orders") : tr("Hide positions and orders")}
            </span>
          </button>
          <button
            className="web-drawing-tools-menu__item"
            data-hide-scope="all"
            role="menuitem"
            type="button"
            onClick={() => applyHideScope('all')}
          >
            <span className="web-drawing-tools-menu__label">
              {chartObjectState.drawingsHidden && chartObjectState.indicatorsHidden && chartObjectState.tradesHidden ? tr("Show all") : tr("Hide all")}
            </span>
          </button>
        </>
      )}
      {menuOpen === 'remove' && (removalMenuItems.length > 0 ? (
        <>
          {removalMenuItems.map((item) => (
            <button
              className="web-drawing-tools-menu__item"
              data-removal-scope={item.scope}
              role="menuitem"
              type="button"
              key={item.scope}
              onClick={() => applyRemovalScope(item.scope)}
            >
              <span className="web-drawing-tools-menu__label">{tr(item.label)}</span>
            </button>
          ))}
          <div className="web-drawing-tools-menu__separator" />
          <div className="web-drawing-tools-menu__toggle-row">
            <span className="web-drawing-tools-menu__label">{tr("Always remove locked drawings")}</span>
            <ToggleSwitch
              size="sm"
              checked={alwaysRemoveLocked}
              onChange={setAlwaysRemoveLocked}
              ariaLabel="Always remove locked drawings"
            />
          </div>
        </>
      ) : (
        <button
          className="web-drawing-tools-menu__item"
          role="menuitem"
          type="button"
          disabled
        >
          <span className="web-drawing-tools-menu__label">{tr("No drawings or indicators to remove")}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  const tooltipPortal = tooltip ? createPortal(
    <div
      ref={tooltipRef}
      id={TOOLTIP_ID}
      className="web-drawing-tools-tooltip"
      data-orientation={orientation}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tr(tooltip.label)}
    </div>,
    document.body,
  ) : null;

  return (
    <aside
      className="web-drawing-tools-rail"
      aria-label={tr("Drawing tools for {{value0}}", { value0: selectedSymbol })}
      data-expanded="true"
      data-orientation={orientation}
      data-symbol={selectedSymbol}
      role="toolbar"
      aria-orientation={orientation}
    >
      <div className="web-drawing-tools-rail__tools">
        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={cursorMode !== 'arrow' && visibleActiveTool === null ? 'true' : 'false'}
          type="button"
          aria-label={tr('{{value0}} — Cursors', { value0: tr(selectedCursor.label) })}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'cursors'}
          onClick={(event) => openRailMenu('cursors', event.currentTarget)}
          {...tooltipProps('cursors', `${tr(selectedCursor.label)} — ${tr('Cursors')}`)}
        >
          <CursorToolIcon id={selectedCursor.id} size={28} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={activeTrendToolId !== null ? 'true' : 'false'}
          type="button"
          aria-label={tr("{{value0}} — Trend Line Tools", { value0: tr(selectedTool.label) })}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'trend'}
          onClick={(event) => openRailMenu('trend', event.currentTarget)}
          {...tooltipProps('trend', `${tr(selectedTool.label)} — ${tr('Trend Line Tools')}`)}
        >
          <>{selectedTool.id === 'trendline' ? <DrawingRailIcon name="trendline" /> : <SelectedIcon aria-hidden="true" size={28} strokeWidth={1} />}</>
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'fibonacci' || visibleActiveTool?.tool === 'fib_extension' ? 'true' : 'false'}
          type="button"
          aria-label={tr("Fib retracement - Gann and Fibonacci Tools")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'fibonacci'}
          onClick={(event) => openRailMenu('fibonacci', event.currentTarget)}
          {...tooltipProps('fibonacci', 'Fib retracement - Gann and Fibonacci Tools')}
        >
          <DrawingRailIcon name="fibonacci" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'pattern' ? 'true' : 'false'} type="button"
          aria-label={tr("Chart patterns")} aria-haspopup="menu" aria-expanded={menuOpen === 'patterns'}
          onClick={event => openRailMenu('patterns', event.currentTarget)} {...tooltipProps('patterns', 'Chart patterns')}>
          <DrawingRailIcon name="patterns" /><ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'measure' ? 'true' : 'false'}
          type="button"
          aria-label={tr("Forecasting and measurement tools")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'forecasting'}
          onClick={(event) => openRailMenu('forecasting', event.currentTarget)}
          {...tooltipProps('forecasting', 'Forecasting and measurement tools')}
        >
          <DrawingRailIcon name="forecast" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={['freehand', 'shapes', 'rectangle', 'ellipse'].includes(visibleActiveTool?.tool ?? '') ? 'true' : 'false'}
          type="button"
          aria-label={tr("Brush tools")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'shapes'}
          onClick={(event) => openRailMenu('shapes', event.currentTarget)}
          {...tooltipProps('shapes', 'Brush tools')}
        >
          <DrawingRailIcon name="brush" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'text' || visibleActiveTool?.tool === 'callout' ? 'true' : 'false'}
          type="button"
          aria-label={tr("Annotation Tools")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'annotations'}
          onClick={(event) => openRailMenu('annotations', event.currentTarget)}
          {...tooltipProps('annotations', 'Annotation Tools')}
        >
          <DrawingRailIcon name="text" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'stamp' && isPictographStamp(visibleActiveTool.subtype) ? 'true' : 'false'}
          type="button"
          aria-label={tr("Emojis")}
          ref={emojiButtonRef}
          aria-haspopup="dialog"
          aria-expanded={menuOpen === 'emojis'}
          onClick={(event) => openRailMenu('emojis', event.currentTarget)}
          {...tooltipProps('emojis', 'Emojis')}
        >
          <DrawingRailIcon name="stamps" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'stamp' && !isPictographStamp(visibleActiveTool.subtype) ? 'true' : 'false'}
          type="button"
          aria-label={tr("Icons and Stamps")}
          ref={stampButtonRef}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'stamps'}
          onClick={(event) => openRailMenu('stamps', event.currentTarget)}
          {...tooltipProps('stamps', 'Icons and Stamps')}
        >
          <DrawingRailIcon name="trade-stamps" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <div className="web-drawing-tools-rail__separator" role="separator" />

        <button
          className="web-drawing-tools-rail__button"
          type="button"
          aria-label={tr("Measure")}
          aria-pressed={visibleActiveTool?.tool === 'ruler'}
          data-active={visibleActiveTool?.tool === 'ruler' ? 'true' : 'false'}
          onClick={() => visibleActiveTool?.tool === 'ruler' ? selectCursor() : dispatchDrawingTool('ruler')}
          {...tooltipProps('ruler', `${tr('Measure')} (Shift)`)}
        >
          <DrawingRailIcon name="measure" />
        </button>

        {orientation !== 'horizontal' && <>
        <button
          className="web-drawing-tools-rail__button"
          type="button"
          aria-label={tr("Zoom In")}
          onClick={() => dispatchZoom('ZOOM_IN')}
          {...tooltipProps('zoom-in', 'Zoom In')}
        >
          <DrawingRailIcon name="zoom" />
        </button>

        {canZoomOut && (
          <button
            className="web-drawing-tools-rail__button"
            type="button"
            aria-label={tr("Zoom Out")}
            onClick={() => dispatchZoom('ZOOM_OUT')}
            {...tooltipProps('zoom-out', 'Zoom Out')}
          >
            <DrawingRailIcon name="zoom-out" />
          </button>
        )}

        </>}

        <div className="web-drawing-tools-rail__separator" role="separator" />

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={magnetMode !== 'off' ? 'true' : 'false'}
          type="button"
          aria-label={tr("Magnet mode")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'magnet'}
          onClick={(event) => openRailMenu('magnet', event.currentTarget)}
          {...tooltipProps('magnet', 'Magnet mode')}
        >
          <DrawingRailIcon name="magnet" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        {orientation !== 'horizontal' && (
        <button
          className="web-drawing-tools-rail__button"
          data-active={keepDrawing ? 'true' : 'false'}
          type="button"
          aria-label={tr("Keep drawing")}
          aria-pressed={keepDrawing}
          onClick={() => setKeepDrawing(!keepDrawing)}
          {...tooltipProps('keep-drawing', 'Keep drawing')}
        >
          <DrawingRailIcon name="keep-drawing" />
        </button>
        )}

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={chartObjectState.drawingsLocked || chartObjectState.indicatorsLocked ? 'true' : 'false'}
          type="button"
          aria-label={tr("Lock objects")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'lock'}
          onClick={(event) => openRailMenu('lock', event.currentTarget)}
          {...tooltipProps('lock', 'Lock objects')}
        >
          <DrawingRailIcon name={chartObjectState.drawingsLocked || chartObjectState.indicatorsLocked ? 'lock' : 'unlock'} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={chartObjectState.drawingsHidden || chartObjectState.indicatorsHidden || chartObjectState.tradesHidden
            ? 'true'
            : 'false'}
          type="button"
          aria-label={tr("Hide objects")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'hide'}
          onClick={(event) => openRailMenu('hide', event.currentTarget)}
          {...tooltipProps('hide', 'Hide objects')}
        >
          <DrawingRailIcon
            name={chartObjectState.drawingsHidden && chartObjectState.indicatorsHidden && chartObjectState.tradesHidden
              ? 'eye-off'
              : 'eye'}
          />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>
      </div>

      <div className="web-drawing-tools-rail__footer">
        <div className="web-drawing-tools-rail__separator" role="separator" />
        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__remove-button web-drawing-tools-rail__flyout-button"
          type="button"
          aria-label={tr("Remove Drawings")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'remove'}
          onClick={(event) => openRailMenu('remove', event.currentTarget)}
          {...tooltipProps('remove', 'Remove Drawings')}
        >
          <DrawingRailIcon name="trash" />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>
      </div>

      {menu}
      {tooltipPortal}
    </aside>
  );
}

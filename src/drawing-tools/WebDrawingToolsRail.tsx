import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../components/ui/Icon';
import { STAMP_OPTIONS } from '../components/layout/stampOptions';
import { getActiveChartSource } from '../services/activeChartSource';
import { commandBus } from '../services/commandBus';
import { drawingManager } from '../services/drawingManager';
import type { PayloadFor } from '../types/commands';
import { DRAWING_TOOL_ICONS } from './toolIcons';
import { ForecastingMeasurementToolIcon } from './ForecastingMeasurementToolIcon';
import { GannFibonacciToolIcon } from './GannFibonacciToolIcon';
import { BrushToolsIcon } from './BrushToolsIcon';
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

const LAST_TOOL_STORAGE_KEY = 'rtx5:web:last-trend-line-tool';
const RTX5_MARK_SRC = `${import.meta.env.BASE_URL}favicon.png`;
const MENU_TRIGGER_GAP_PX = 4;
const TOOLTIP_TRIGGER_GAP_PX = 8;
const TOOLTIP_HALF_HEIGHT_PX = 15;
const VIEWPORT_EDGE_GAP_PX = 8;
const TOOLTIP_ID = 'web-drawing-tools-tooltip';

type DrawingCommandTool = PayloadFor<'SELECT_TOOL'>['tool'];
type RailMenuId =
  | 'trend'
  | 'fibonacci'
  | 'forecasting'
  | 'shapes'
  | 'annotations'
  | 'stamps'
  | 'remove';

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
  { tool: 'text', label: 'Text', icon: 'text' },
  { tool: 'callout', label: 'Callout', icon: 'callout' },
];

const readMagnetEnabled = (): boolean => commandBus.getHistory().reduce(
  (enabled, command) => command.type === 'TOGGLE_MAGNET' ? !enabled : enabled,
  false,
);

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

const shortcutTool = (event: KeyboardEvent): TrendLineToolId | null => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 't') return 'trendline';
  if (key === 'h') return 'horizontal_line';
  if (key === 'j') return 'horizontal_ray';
  if (key === 'v') return 'vertical_line';
  if (key === 'c') return 'crossline';
  return null;
};

export interface WebDrawingToolsRailProps {
  selectedSymbol: string;
}

export function WebDrawingToolsRail({ selectedSymbol }: WebDrawingToolsRailProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [lastToolId, setLastToolId] = useState<TrendLineToolId>(readStoredTool);
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [activeTargetContextId, setActiveTargetContextId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<RailMenuId | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [magnetEnabled, setMagnetEnabled] = useState(readMagnetEnabled);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hoveredTooltipOwnerRef = useRef<TooltipOwner | null>(null);
  const focusedTooltipOwnerRef = useRef<TooltipOwner | null>(null);
  const pendingDrawingToolRef = useRef<ActiveTool | null>(null);

  const currentChartSourceId = getActiveChartSource()?.id;
  const visibleActiveTool = activeTargetContextId
    && currentChartSourceId
    && activeTargetContextId !== currentChartSourceId
    ? null
    : activeTool;
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
    // Keep one pending arm until the pointer actually returns to a chart. A
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

  const openRailMenu = (menuId: RailMenuId, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setTooltip(null);
    setConfirmClearAll(false);
    setMenuPosition(null);
    setMenuOpen((current) => current === menuId ? null : menuId);
  };

  const showTooltip = (ownerId: string, label: string, trigger: HTMLButtonElement) => {
    const rect = trigger.getBoundingClientRect();
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

  const hideDrawingTools = () => {
    setMenuOpen(null);
    setTooltip(null);
    setConfirmClearAll(false);
    setIsExpanded(false);
  };

  const dispatchZoom = (type: 'ZOOM_IN' | 'ZOOM_OUT') => {
    commandBus.dispatch({
      type,
      payload: { targetContextId: getActiveChartSource()?.id },
    });
  };

  const deleteSelectedDrawing = () => {
    setMenuOpen(null);
    commandBus.dispatch({
      type: 'DELETE_SELECTED_DRAWING',
      payload: { targetContextId: getActiveChartSource()?.id },
    });
  };

  const clearAllDrawings = () => {
    const targetContextId = getActiveChartSource()?.id;
    setMenuOpen(null);
    drawingManager.clearAllDrawings(true, targetContextId);
    setActiveTool(null);
    setActiveTargetContextId(null);
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId },
    });
  };

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
  }, [menuOpen]);

  useEffect(() => {
    const armPendingToolForChart = (event: PointerEvent) => {
      const pendingTool = pendingDrawingToolRef.current;
      if (!pendingTool) return;
      const eventTarget = event.target;
      if (!(eventTarget instanceof Element) || !eventTarget.closest('.rtx-chart-wrapper')) return;

      // TradingChart activates its source on pointer-enter before the first
      // plot move. Re-resolve here so the command is guaranteed to own the
      // chart that the user is about to click, even after a dock-tab switch.
      const targetContextId = getActiveChartSource()?.id;
      if (!targetContextId) return;
      pendingDrawingToolRef.current = null;
      setActiveTargetContextId(targetContextId);
      // The chart's pointer handler runs before this document listener. If
      // selection already succeeded, replaying it would discard the preview
      // (or first anchor) that the same pointer event just placed.
      const armedDrawing = drawingManager.getActiveDrawing(targetContextId);
      if (armedDrawing?.type === pendingTool.tool && armedDrawing.subtype === pendingTool.subtype) return;
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { ...pendingTool, targetContextId },
      });
    };

    document.addEventListener('pointermove', armPendingToolForChart, { passive: true });
    document.addEventListener('pointerdown', armPendingToolForChart);
    return () => {
      document.removeEventListener('pointermove', armPendingToolForChart);
      document.removeEventListener('pointerdown', armPendingToolForChart);
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
      setMagnetEnabled((enabled) => !enabled);
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
      if (event.type === 'drawing:saved' && (event as CustomEvent<{ type?: string }>).detail?.type === 'freehand') return;
      pendingDrawingToolRef.current = null;
      setActiveTool(null);
      setActiveTargetContextId(null);
    };
    const handleDrawingCancelled = (event: Event) => {
      const contextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      // SELECT_TOOL cancels the old draft before arming its replacement.
      // Observe the completed command before clearing the replacement's rail state.
      queueMicrotask(() => {
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
  }, [activeTargetContextId]);

  useEffect(() => {
    if (!isWebDrawingToolsRuntime()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
      if (
        event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        event.stopPropagation();
        dispatchDrawingTool('fibonacci', 'fib_retracement');
        return;
      }
      const toolId = shortcutTool(event);
      if (!toolId) return;
      event.preventDefault();
      // GlobalShortcuts listens during document capture. Intercept supported
      // web drawing shortcuts one level earlier so, for example, Alt+T cannot
      // also toggle one-click trading.
      event.stopPropagation();
      dispatchTrendTool(toolId);
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [dispatchDrawingTool, dispatchTrendTool]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(null);
      setConfirmClearAll(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(null);
      setConfirmClearAll(false);
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
        {tool.tool === 'freehand' && !tool.subtype ? <BrushToolsIcon size={23} /> : <Icon name={tool.icon} size={19} />}
        <span className="web-drawing-tools-menu__label">{tool.label}</span>
      </button>
    );
  });

  const menuLabel = menuOpen === 'trend'
    ? 'Lines, channels, and pitchforks'
    : menuOpen === 'fibonacci'
      ? 'Gann and Fibonacci tools'
      : menuOpen === 'forecasting'
        ? 'Forecasting and measurement tools'
        : menuOpen === 'shapes'
          ? 'Brushes, arrows, and shapes'
          : menuOpen === 'annotations'
            ? 'Annotation tools'
            : menuOpen === 'stamps'
              ? 'Icons and stamps'
              : 'Remove drawings';

  const menu = menuOpen ? createPortal(
    <div
      ref={menuRef}
      className="web-drawing-tools-menu"
      role="menu"
      aria-label={menuLabel}
      style={menuPosition
        ? { left: menuPosition.left, top: menuPosition.top }
        : { left: 0, top: 0, visibility: 'hidden' }}
    >
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
            {group}
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
                <span className="web-drawing-tools-menu__label">{tool.label}</span>
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
            {group}
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
                <span className="web-drawing-tools-menu__label">{tool.label}</span>
                {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
              </button>
            );
          })}
          {groupIndex < groupedGannFibonacciTools.length - 1 ? (
            <div className="web-drawing-tools-menu__separator" />
          ) : null}
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
            {group}
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
                <span className="web-drawing-tools-menu__label">{tool.label}</span>
              </button>
            );
          })}
          {groupIndex < groupedForecastingMeasurementTools.length - 1 ? (
            <div className="web-drawing-tools-menu__separator" />
          ) : null}
        </section>
      ))}
      {menuOpen === 'shapes' && ['Brushes', 'Arrows', 'Shapes'].map(group => (
        <section className="web-drawing-tools-menu__group" aria-label={group} key={group}>
          <div className="web-drawing-tools-menu__heading">{group}</div>
          {group === 'Brushes' && renderSimpleMenuItems(GEOMETRIC_SHAPE_TOOLS.filter(tool => tool.tool === 'freehand'))}
          {BRUSH_SHAPE_TOOLS.filter(tool => tool.group === group).map(tool => (
            <button className="web-drawing-tools-menu__item" role="menuitemradio" type="button" key={tool.id}
              aria-checked={visibleActiveTool?.tool === 'shapes' && visibleActiveTool.subtype === tool.id}
              onClick={() => dispatchDrawingTool('shapes', tool.id)}>
              <BrushShapeToolIcon id={tool.id} /><span className="web-drawing-tools-menu__label">{tool.label}</span>
            </button>
          ))}
          {group === 'Shapes' && renderSimpleMenuItems(GEOMETRIC_SHAPE_TOOLS.filter(tool => tool.tool !== 'freehand'))}
        </section>
      ))}
      {menuOpen === 'annotations' && renderSimpleMenuItems(ANNOTATION_TOOLS)}
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
            <span className="web-drawing-tools-menu__label">{stamp.label}</span>
          </button>
        );
      })}
      {menuOpen === 'remove' && (
        <>
          <button
            className="web-drawing-tools-menu__item"
            role="menuitem"
            type="button"
            onClick={deleteSelectedDrawing}
          >
            <Icon name="trash" size={19} />
            <span className="web-drawing-tools-menu__label">Delete selected drawing</span>
          </button>
          <button
            className="web-drawing-tools-menu__item web-drawing-tools-menu__item--danger"
            role="menuitem"
            type="button"
            onClick={() => {
              if (confirmClearAll) {
                clearAllDrawings();
                return;
              }
              setConfirmClearAll(true);
            }}
          >
            <Icon name="trash" size={19} />
            <span className="web-drawing-tools-menu__label">
              {confirmClearAll ? 'Click again to remove all drawings' : 'Remove all drawings'}
            </span>
          </button>
        </>
      )}
    </div>,
    document.body,
  ) : null;

  const tooltipPortal = tooltip ? createPortal(
    <div
      id={TOOLTIP_ID}
      className="web-drawing-tools-tooltip"
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.label}
    </div>,
    document.body,
  ) : null;

  if (!isExpanded) {
    return (
      <aside
        className="web-drawing-tools-rail"
        aria-label={`Drawing tools for ${selectedSymbol}`}
        data-expanded="false"
        data-symbol={selectedSymbol}
        role="toolbar"
        aria-orientation="vertical"
      >
        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__toggle"
          type="button"
          aria-expanded="false"
          aria-label="Show drawing tools"
          onClick={() => setIsExpanded(true)}
          {...tooltipProps('show-tools', 'Show drawing tools')}
        >
          <img
            className="web-drawing-tools-rail__brand-mark"
            src={RTX5_MARK_SRC}
            alt=""
            aria-hidden="true"
          />
        </button>
        {tooltipPortal}
      </aside>
    );
  }

  return (
    <aside
      className="web-drawing-tools-rail"
      aria-label={`Drawing tools for ${selectedSymbol}`}
      data-expanded="true"
      data-symbol={selectedSymbol}
      role="toolbar"
      aria-orientation="vertical"
    >
      <div className="web-drawing-tools-rail__tools">
        <button
          className="web-drawing-tools-rail__button"
          data-active={visibleActiveTool === null ? 'true' : 'false'}
          type="button"
          aria-label="Cursor"
          aria-pressed={visibleActiveTool === null}
          onClick={selectCursor}
          {...tooltipProps('cursor', 'Cursor')}
        >
          <Icon name="cursor" size={20} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={activeTrendToolId !== null ? 'true' : 'false'}
          type="button"
          aria-label={`${selectedTool.label} — Trend Line Tools`}
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'trend'}
          onClick={(event) => openRailMenu('trend', event.currentTarget)}
          {...tooltipProps('trend', `${selectedTool.label} — Trend Line Tools`)}
        >
          <SelectedIcon aria-hidden="true" size={20} strokeWidth={1.45} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'fibonacci' || visibleActiveTool?.tool === 'fib_extension' ? 'true' : 'false'}
          type="button"
          aria-label="Fib retracement - Gann and Fibonacci Tools"
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'fibonacci'}
          onClick={(event) => openRailMenu('fibonacci', event.currentTarget)}
          {...tooltipProps('fibonacci', 'Fib retracement - Gann and Fibonacci Tools')}
        >
          <Icon name="fibonacci" size={20} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'measure' ? 'true' : 'false'}
          type="button"
          aria-label="Forecasting and measurement tools"
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'forecasting'}
          onClick={(event) => openRailMenu('forecasting', event.currentTarget)}
          {...tooltipProps('forecasting', 'Forecasting and measurement tools')}
        >
          <ForecastingMeasurementToolIcon id="long_position" size={20} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={['freehand', 'shapes', 'rectangle', 'ellipse'].includes(visibleActiveTool?.tool ?? '') ? 'true' : 'false'}
          type="button"
          aria-label="Brush tools"
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'shapes'}
          onClick={(event) => openRailMenu('shapes', event.currentTarget)}
          {...tooltipProps('shapes', 'Brush tools')}
        >
          <BrushToolsIcon />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'text' || visibleActiveTool?.tool === 'callout' ? 'true' : 'false'}
          type="button"
          aria-label="Annotation Tools"
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'annotations'}
          onClick={(event) => openRailMenu('annotations', event.currentTarget)}
          {...tooltipProps('annotations', 'Annotation Tools')}
        >
          <Icon name="text" size={20} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button"
          data-active={visibleActiveTool?.tool === 'stamp' ? 'true' : 'false'}
          type="button"
          aria-label="Icons and Stamps"
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'stamps'}
          onClick={(event) => openRailMenu('stamps', event.currentTarget)}
          {...tooltipProps('stamps', 'Icons and Stamps')}
        >
          <Icon name="thumbs-up" size={20} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>

        <div className="web-drawing-tools-rail__separator" role="separator" />

        <button
          className="web-drawing-tools-rail__button"
          type="button"
          aria-label="Zoom In"
          onClick={() => dispatchZoom('ZOOM_IN')}
          {...tooltipProps('zoom-in', 'Zoom In')}
        >
          <Icon name="zoom-in" size={20} />
        </button>

        <button
          className="web-drawing-tools-rail__button"
          data-active={magnetEnabled ? 'true' : 'false'}
          type="button"
          aria-label="Magnet Mode"
          aria-pressed={magnetEnabled}
          onClick={() => commandBus.dispatch({ type: 'TOGGLE_MAGNET', payload: {} })}
          {...tooltipProps('magnet', 'Magnet Mode')}
        >
          <Icon name="magnet" size={20} />
        </button>
      </div>

      <div className="web-drawing-tools-rail__footer">
        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__toggle"
          type="button"
          aria-expanded="true"
          aria-label="Hide drawing tools"
          onClick={hideDrawingTools}
          {...tooltipProps('hide-tools', 'Hide drawing tools')}
        >
          <PanelLeftClose aria-hidden="true" size={20} strokeWidth={1.5} />
        </button>

        <button
          className="web-drawing-tools-rail__button web-drawing-tools-rail__remove-button web-drawing-tools-rail__flyout-button"
          type="button"
          aria-label="Remove Drawings"
          aria-haspopup="menu"
          aria-expanded={menuOpen === 'remove'}
          onClick={(event) => openRailMenu('remove', event.currentTarget)}
          {...tooltipProps('remove', 'Remove Drawings')}
        >
          <Icon name="trash" size={20} />
          <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
        </button>
      </div>

      {menu}
      {tooltipPortal}
    </aside>
  );
}

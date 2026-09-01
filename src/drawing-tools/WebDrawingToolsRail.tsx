import { ChevronRight, MousePointer2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveChartSource } from '../services/activeChartSource';
import { commandBus } from '../services/commandBus';
import type { PayloadFor } from '../types/commands';
import { DRAWING_TOOL_ICONS } from './toolIcons';
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
const MENU_TRIGGER_GAP_PX = 4;
const VIEWPORT_EDGE_GAP_PX = 8;

interface MenuPosition {
  left: number;
  top: number;
}

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
  const [lastToolId, setLastToolId] = useState<TrendLineToolId>(readStoredTool);
  const [activeToolId, setActiveToolId] = useState<TrendLineToolId | null>(null);
  const [activeTargetContextId, setActiveTargetContextId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedTool = getTrendLineTool(lastToolId) ?? TREND_LINE_TOOLS[0];
  const SelectedIcon = DRAWING_TOOL_ICONS[selectedTool.id];
  const groupedTools = useMemo(
    () => TREND_LINE_TOOL_GROUPS.map((group) => ({
      group,
      tools: TREND_LINE_TOOLS.filter((tool) => tool.group === group),
    })),
    [],
  );

  const dispatchTool = useCallback((toolId: TrendLineToolId) => {
    const tool = getTrendLineTool(toolId);
    if (!tool) return;
    const targetContextId = getActiveChartSource()?.id;
    setMenuOpen(false);
    setLastToolId(tool.id);
    setActiveToolId(tool.id);
    setActiveTargetContextId(targetContextId ?? null);
    try {
      window.localStorage.setItem(LAST_TOOL_STORAGE_KEY, tool.id);
    } catch {
      // Storage can be unavailable in embedded/private contexts; drawing remains usable.
    }
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: { tool: tool.drawingType, subtype: tool.id, targetContextId },
    });
  }, []);

  const selectCursor = () => {
    const targetContextId = getActiveChartSource()?.id;
    setActiveToolId(null);
    setActiveTargetContextId(targetContextId ?? null);
    setMenuOpen(false);
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
    const unsubscribe = commandBus.subscribe('SELECT_TOOL', (payload) => {
      if (payload.tool === 'cursor') {
        if (!payload.targetContextId || payload.targetContextId === activeTargetContextId) {
          setActiveToolId(null);
        }
        return;
      }
      const nextToolId = resolveCommandTool(payload);
      if (!nextToolId) return;
      setLastToolId(nextToolId);
      setActiveToolId(nextToolId);
      setActiveTargetContextId(payload.targetContextId ?? getActiveChartSource()?.id ?? null);
    });

    return unsubscribe;
  }, [activeTargetContextId]);

  useEffect(() => {
    const handleDrawingSaved = (event: Event) => {
      const contextId = (event as CustomEvent<{ contextId?: string }>).detail?.contextId;
      if (activeTargetContextId && contextId && activeTargetContextId !== contextId) return;
      setActiveToolId(null);
    };
    window.addEventListener('drawing:saved', handleDrawingSaved);
    return () => window.removeEventListener('drawing:saved', handleDrawingSaved);
  }, [activeTargetContextId]);

  useEffect(() => {
    if (!isWebDrawingToolsRuntime()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
      const toolId = shortcutTool(event);
      if (!toolId) return;
      event.preventDefault();
      // GlobalShortcuts listens during document capture. Intercept supported
      // web drawing shortcuts one level earlier so, for example, Alt+T cannot
      // also toggle one-click trading.
      event.stopPropagation();
      dispatchTool(toolId);
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [dispatchTool]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const menu = menuOpen ? createPortal(
    <div
      ref={menuRef}
      className="web-drawing-tools-menu"
      role="menu"
      aria-label="Lines, channels, and pitchforks"
      style={menuPosition
        ? { left: menuPosition.left, top: menuPosition.top }
        : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {groupedTools.map(({ group, tools }, groupIndex) => (
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
                onClick={() => dispatchTool(tool.id)}
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
    </div>,
    document.body,
  ) : null;

  return (
    <aside
      className="web-drawing-tools-rail"
      aria-label={`Drawing tools for ${selectedSymbol}`}
      data-symbol={selectedSymbol}
    >
      <button
        className="web-drawing-tools-rail__button"
        data-active={activeToolId === null ? 'true' : 'false'}
        type="button"
        aria-label="Cursor"
        title="Cursor"
        onClick={selectCursor}
      >
        <MousePointer2 aria-hidden="true" size={20} strokeWidth={1.5} />
      </button>

      <button
        ref={triggerRef}
        className="web-drawing-tools-rail__button web-drawing-tools-rail__trend-button"
        data-active={activeToolId !== null ? 'true' : 'false'}
        type="button"
        aria-label={`${selectedTool.label} — open drawing tools`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={selectedTool.label}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <SelectedIcon aria-hidden="true" size={20} strokeWidth={1.45} />
        <ChevronRight className="web-drawing-tools-rail__flyout-mark" aria-hidden="true" size={7} />
      </button>
      {menu}
    </aside>
  );
}

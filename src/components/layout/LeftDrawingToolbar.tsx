import {
  AlignHorizontalSpaceAround,
  ArrowRight,
  BetweenHorizontalStart,
  ChartNoAxesCombined,
  ChevronRight,
  Crosshair,
  GitFork,
  Info,
  Minus,
  MousePointer2,
  MoveDiagonal2,
  MoveUpRight,
  Network,
  Rows3,
  Ruler,
  SeparatorVertical,
  Spline,
  TrendingUp,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_TREND_LINE_TOOL_ID,
  TREND_LINE_TOOL_GROUPS,
  TREND_LINE_TOOLS,
  getTrendLineTool,
  type TrendLineToolId,
} from '../../config/trendLineTools';
import { commandBus } from '../../services/commandBus';
import type { PayloadFor } from '../../types/commands';
import './LeftDrawingToolbar.css';

const LAST_TOOL_STORAGE_KEY = 'rtx5:last-trend-line-tool';

const TOOL_ICONS: Record<TrendLineToolId, LucideIcon> = {
  trendline: TrendingUp,
  ray: MoveUpRight,
  info_line: Info,
  extended_line: MoveDiagonal2,
  trend_angle: Ruler,
  horizontal_line: Minus,
  horizontal_ray: ArrowRight,
  vertical_line: SeparatorVertical,
  crossline: Crosshair,
  parallel_channel: BetweenHorizontalStart,
  regression_trend: ChartNoAxesCombined,
  flat_top_bottom: AlignHorizontalSpaceAround,
  disjoint_channel: Rows3,
  pitchfork: GitFork,
  schiff_pitchfork: Waypoints,
  modified_schiff_pitchfork: Network,
  inside_pitchfork: Spline,
};

const readStoredTool = (): TrendLineToolId => {
  if (typeof window === 'undefined') return DEFAULT_TREND_LINE_TOOL_ID;
  const stored = window.localStorage.getItem(LAST_TOOL_STORAGE_KEY);
  return getTrendLineTool(stored)?.id ?? DEFAULT_TREND_LINE_TOOL_ID;
};

const resolveCommandTool = (
  payload: PayloadFor<'SELECT_TOOL'>,
): TrendLineToolId | null => {
  const exact = getTrendLineTool(payload.subtype);
  if (exact && exact.drawingType === payload.tool) return exact.id;

  if (payload.tool === 'trendline') return 'trendline';
  if (payload.tool === 'hline') return 'horizontal_line';
  if (payload.tool === 'vline') return 'vertical_line';
  if (payload.tool === 'channel') return 'parallel_channel';
  return null;
};

export interface LeftDrawingToolbarProps {
  selectedSymbol: string;
  orientation?: 'vertical' | 'horizontal';
}

export function LeftDrawingToolbar({
  selectedSymbol,
  orientation = 'vertical',
}: LeftDrawingToolbarProps) {
  const [lastToolId, setLastToolId] = useState<TrendLineToolId>(readStoredTool);
  const [activeToolId, setActiveToolId] = useState<TrendLineToolId | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 44, top: 44 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedTool = getTrendLineTool(lastToolId) ?? TREND_LINE_TOOLS[0];
  const SelectedIcon = TOOL_ICONS[selectedTool.id];

  const groupedTools = useMemo(
    () => TREND_LINE_TOOL_GROUPS.map((group) => ({
      group,
      tools: TREND_LINE_TOOLS.filter((tool) => tool.group === group),
    })),
    [],
  );

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = Math.min(760, window.innerHeight - 16);
    setMenuPosition({
      left: orientation === 'horizontal'
        ? Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - 273))
        : Math.round(rect.right + 4),
      top: orientation === 'horizontal'
        ? Math.min(Math.round(rect.bottom + 4), window.innerHeight - menuHeight - 8)
        : Math.max(8, Math.min(Math.round(rect.top), window.innerHeight - menuHeight - 8)),
    });
  }, [menuOpen, orientation]);

  useEffect(() => {
    const unsubscribe = commandBus.subscribe('SELECT_TOOL', (payload) => {
      if (payload.tool === 'cursor') {
        setActiveToolId(null);
        return;
      }
      const nextToolId = resolveCommandTool(payload);
      if (!nextToolId) return;
      setLastToolId(nextToolId);
      setActiveToolId(nextToolId);
      window.localStorage.setItem(LAST_TOOL_STORAGE_KEY, nextToolId);
    });

    const handleDrawingSaved = () => setActiveToolId(null);
    window.addEventListener('drawing:saved', handleDrawingSaved);
    return () => {
      unsubscribe();
      window.removeEventListener('drawing:saved', handleDrawingSaved);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const selectTool = (toolId: TrendLineToolId) => {
    const tool = getTrendLineTool(toolId);
    if (!tool) return;
    setMenuOpen(false);
    setLastToolId(tool.id);
    setActiveToolId(tool.id);
    window.localStorage.setItem(LAST_TOOL_STORAGE_KEY, tool.id);
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: { tool: tool.drawingType, subtype: tool.id },
    });
  };

  const selectCursor = () => {
    setActiveToolId(null);
    setMenuOpen(false);
    commandBus.dispatch({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } });
  };

  const menu = menuOpen ? createPortal(
    <div
      ref={menuRef}
      className="trend-tools-menu"
      role="menu"
      aria-label="Trend line tools"
      style={{ left: menuPosition.left, top: menuPosition.top }}
    >
      {groupedTools.map(({ group, tools }, groupIndex) => (
        <section
          className="trend-tools-menu__group"
          aria-labelledby={`trend-tools-group-${group.toLowerCase()}`}
          key={group}
        >
          <div
            id={`trend-tools-group-${group.toLowerCase()}`}
            className="trend-tools-menu__heading"
          >
            {group}
          </div>
          {tools.map((tool) => {
            const ToolIcon = TOOL_ICONS[tool.id];
            const isSelected = lastToolId === tool.id;
            return (
              <button
                className="trend-tools-menu__item"
                data-selected={isSelected ? 'true' : 'false'}
                role="menuitemradio"
                aria-checked={isSelected}
                key={tool.id}
                type="button"
                onClick={() => selectTool(tool.id)}
              >
                <ToolIcon aria-hidden="true" size={19} strokeWidth={1.35} />
                <span>{tool.label}</span>
              </button>
            );
          })}
          {groupIndex < groupedTools.length - 1 ? <div className="trend-tools-menu__separator" /> : null}
        </section>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <aside
      className={`left-drawing-toolbar left-drawing-toolbar--${orientation}`}
      aria-label={`Drawing tools for ${selectedSymbol}`}
      data-symbol={selectedSymbol}
      data-orientation={orientation}
    >
      <button
        className="left-drawing-toolbar__button"
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
        className="left-drawing-toolbar__button left-drawing-toolbar__trend-button"
        data-active={activeToolId !== null ? 'true' : 'false'}
        type="button"
        aria-label={`${selectedTool.label} — open trend line tools`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={selectedTool.label}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <SelectedIcon aria-hidden="true" size={20} strokeWidth={1.45} />
        <ChevronRight className="left-drawing-toolbar__flyout-mark" aria-hidden="true" size={7} />
      </button>
      {menu}
    </aside>
  );
}

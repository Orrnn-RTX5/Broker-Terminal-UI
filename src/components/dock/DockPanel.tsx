import { useUiTranslation } from '../../hooks/useUiTranslation';
/**
 * DockPanel Component
 * MT5-style panel with thin title bar — supports Minimize and Close.
 *
 * Minimize: collapses content, shows only the title bar (click title to restore).
 * Close:    removes the panel from the dock layout entirely.
 */

import { Icon } from '../ui/Icon';
import React, { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DockPanelConfig } from '../../services/dockManager';
import { X, Minus } from 'lucide-react';
import { ChartSymbolTabs } from './ChartSymbolTabs';
import { ActiveChartWindowBorder } from './ActiveChartWindowBorder';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DockPanelProps {
  panel: DockPanelConfig;
  isActive?: boolean;
  isFloating?: boolean;
  isDropTarget?: boolean;
  showHeader?: boolean;
  className?: string;
  children?: React.ReactNode;
  onClose?: () => void;
  onFloat?: () => void;
  onActivate?: () => void;
  onMinimizedChange?: (minimized: boolean) => void;
  onDragStart?: (e: React.MouseEvent | React.TouchEvent) => void;
  style?: React.CSSProperties;
}

export const DockPanel: React.FC<DockPanelProps> = ({
  panel,
  isActive = true,
  isFloating = false,
  isDropTarget,
  showHeader = true,
  className,
  children,
  onClose,
  onFloat,
  onActivate,
  onMinimizedChange,
  onDragStart,
  style,
}) => {
    const tr = useUiTranslation();
  // Docked windows use layout state; standalone panels keep local control.
  const [localMinimized, setLocalMinimized] = useState(false);
  const minimized = onMinimizedChange ? Boolean(panel.minimized) : localMinimized;
  const isChart = panel.component === 'Chart';
  const chartsBarVisible = useTerminalBarsStore(state => state.chartsBarVisible);
  const chartSymbol = typeof panel.props?.symbol === 'string' ? panel.props.symbol : panel.title.split(',')[0];
  const setMinimized = (value: boolean) => {
    if (onMinimizedChange) onMinimizedChange(value);
    else setLocalMinimized(value);
  };

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden relative',
        panel.component === 'EmptyChartArea' ? 'bg-[#0d0d11]' : 'bg-[#131316]',
        minimized ? 'h-[30px]' : 'h-full',
        isFloating && 'shadow-2xl border border-zinc-600/40',
        !isFloating && panel.component !== 'EmptyChartArea' && 'border border-[#28282e]/60',
        isDropTarget && 'ring-2 ring-[#8a8a8f]/40 ring-inset',
        className
      )}
      style={style}
      onMouseDown={onActivate}
    >
      {isChart && isActive && !minimized && <ActiveChartWindowBorder panelId={panel.id} />}
      {/* ── MT5-style thin title bar ── */}
      {showHeader && (
        <div
          className={cn(
            'dock-panel__header flex items-center h-[30px] px-1.5 select-none flex-shrink-0',
            // Make cursor a pointer when minimized (click to restore)
            minimized ? 'cursor-pointer' : 'cursor-default',
            isActive
              ? 'dock-panel__header--active bg-[#202126] border-b border-[#34363d]'
              : 'dock-panel__header--inactive bg-[#17181c] border-b border-[#27282d]',
          )}
          onMouseDown={(e) => {
            // Click on empty header area while minimized → restore
            const target = e.target as HTMLElement;
            if (target.closest('button')) return;
            if (minimized) {
              setMinimized(false);
              return;
            }
            onDragStart?.(e);
          }}
          onDoubleClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button')) return;
            if (panel.floatable === false) return;
            e.preventDefault();
            e.stopPropagation();
            onFloat?.();
          }}
          title={minimized ? tr("Click to restore {{value0}}", { value0: panel.title }) : undefined}
        >
          {/* Title */}
          <span className="dock-panel__title flex-1 min-w-0 flex items-center gap-1 text-[14px] font-normal text-zinc-300 truncate leading-[30px]">
            {isChart && chartsBarVisible ? <ChartSymbolTabs panel={panel} /> : tr(panel.title)}
            {minimized && (
              <span className="ml-1 text-[12px] font-normal text-zinc-600 italic">{tr("(minimized)")}</span>
            )}
          </span>

          {/* ── Minimize button ── */}
          {panel.component !== 'EmptyChartArea' && panel.component !== 'Navigator' && (
            <button
              type="button"
              aria-label={isChart ? tr(minimized ? 'Restore chart {{symbol}}' : 'Minimize chart {{symbol}}', { symbol: chartSymbol }) : `${tr(minimized ? 'Restore' : 'Minimize')} ${tr(panel.title)}`}
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(!minimized);
              }}
              className="dock-panel__action shrink-0 flex items-center justify-center w-6 h-6 rounded-sm hover:bg-zinc-600/80 text-zinc-400 hover:text-white transition-colors mr-0.5"
              title={minimized ? tr("Restore") : tr("Minimize")}
            >
              {minimized ? <Icon name="chevron-up" size="xs" /> : <Minus className="w-2.5 h-2.5" />
              }
            </button>
          )}

          {/* ── Close button ── */}
          {panel.closable !== false && (
            <button
              type="button"
              aria-label={isChart ? tr('Close chart {{symbol}}', { symbol: chartSymbol }) : `${tr('Close')} ${tr(panel.title)}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
              className="dock-panel__action dock-panel__action--close shrink-0 flex items-center justify-center w-6 h-6 rounded-sm hover:bg-red-500/80 text-zinc-400 hover:text-white transition-colors"
              title={tr("Close")}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Keep chart state mounted while its window is minimized. */}
        <div hidden={minimized} className="dock-panel__content flex-1 overflow-hidden min-h-0 min-w-0 relative">
          {children || (
            <div className="flex items-center justify-center h-full text-zinc-500 p-4">
              <p className="text-xs">{tr(panel.title)}</p>
            </div>
          )}
        </div>
    </div>
  );
};

export default DockPanel;

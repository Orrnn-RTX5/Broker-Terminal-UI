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
  onDragStart,
  style,
}) => {
  // ── Minimize state (local — collapses content to title bar only) ──
  const [minimized, setMinimized] = useState(false);

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
      {/* ── MT5-style thin title bar ── */}
      {showHeader && (
        <div
          className={cn(
            'flex items-center h-[30px] px-1.5 select-none flex-shrink-0',
            // Make cursor a pointer when minimized (click to restore)
            minimized ? 'cursor-pointer' : 'cursor-default',
            isActive
              ? 'bg-[#202126] border-b border-[#34363d]'
              : 'bg-[#17181c] border-b border-[#27282d]',
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
          title={minimized ? `Click to restore ${panel.title}` : undefined}
        >
          {/* Title */}
          <span className="flex-1 text-[14px] font-normal text-zinc-300 truncate leading-[30px]">
            {panel.title}
            {minimized && (
              <span className="ml-1 text-[12px] font-normal text-zinc-600 italic">(minimized)</span>
            )}
          </span>

          {/* ── Minimize button ── */}
          {panel.component !== 'EmptyChartArea' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMinimized((m) => !m);
              }}
              className="w-[16px] h-[16px] flex items-center justify-center rounded-sm hover:bg-zinc-600/80 text-zinc-400 hover:text-white transition-colors mr-0.5"
              title={minimized ? 'Restore' : 'Minimize'}
            >
              {minimized
                ? <Icon name="chevron-up" size="xs" />
                : <Minus className="w-2.5 h-2.5" />
              }
            </button>
          )}

          {/* ── Close button ── */}
          {panel.closable !== false && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
              className="w-[16px] h-[16px] flex items-center justify-center rounded-sm hover:bg-red-500/80 text-zinc-400 hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* ── Content — hidden when minimized ── */}
      {!minimized && (
        <div className="flex-1 overflow-hidden min-h-0 min-w-0 relative">
          {children || (
            <div className="flex items-center justify-center h-full text-zinc-500 p-4">
              <p className="text-xs">{panel.title}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DockPanel;

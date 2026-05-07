/**
 * DropZoneOverlay Component
 * MT5-Style compass-rose dock zone indicators during panel drag operations
 */

import { Icon } from '../ui/Icon';
import React, { useCallback } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import type { DockDirection } from '../../services/dockManager';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DropZoneOverlayProps {
  containerId: string;
  containerRect: { x: number; y: number; width: number; height: number };
}

/**
 * MT5-style compass-rose dock zone buttons
 * Shows 5 small square buttons (Top, Bottom, Left, Right, Center) 
 * in the center of the target container when dragging.
 */
export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  containerId,
  containerRect,
}) => {
  const { dragState, activeDropZone, updateDropZone } = useDockLayoutStore();

  const isVisible = dragState === 'dragging';
  if (!isVisible) return null;

  const isActiveZone = (dir: DockDirection) =>
    activeDropZone?.targetContainerId === containerId && activeDropZone?.direction === dir;

  const handleZoneHover = useCallback((direction: DockDirection) => {
    updateDropZone({
      id: `${containerId}-${direction}`,
      direction,
      rect: containerRect,
      targetContainerId: containerId,
      priority: direction === 'center' ? 0 : 1,
    });
  }, [containerId, containerRect, updateDropZone]);

  const handleZoneLeave = useCallback(() => {
    updateDropZone(null);
  }, [updateDropZone]);

  // Button size and spacing
  const btnSize = 36;
  const gap = 4;

  return (
    <div className="absolute inset-0 z-50 overflow-hidden rounded-lg bg-black/20">
      {/* Background instruction */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-sm px-4 py-2 rounded-full border border-border shadow-lg">
        <span className="text-sm font-medium text-foreground">
          Hover over arrows to preview • Release to dock
        </span>
      </div>

      {/* Highlight the active zone area */}
      {activeDropZone?.targetContainerId === containerId && (
        <div
          className={cn(
            "absolute bg-emerald-500/20 border-2 border-emerald-500/50 transition-all duration-150 ease-out rounded-lg",
            activeDropZone.direction === 'top' && "top-2 left-2 right-2 h-[48%]",
            activeDropZone.direction === 'bottom' && "bottom-2 left-2 right-2 h-[48%]",
            activeDropZone.direction === 'left' && "left-2 top-2 bottom-2 w-[48%]",
            activeDropZone.direction === 'right' && "right-2 top-2 bottom-2 w-[48%]",
            activeDropZone.direction === 'center' && "inset-4"
          )}
        />
      )}

      {/* MT5-style Compass Rose - 5 dock zone buttons */}
      <div
        className="absolute pointer-events-auto bg-background/80 backdrop-blur-md p-4 rounded-2xl border border-border shadow-2xl"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div className="text-center text-xs font-medium text-muted-foreground mb-3">
          Drop Zone
        </div>
        {/* Layout: 3x3 grid with buttons at cross positions */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${btnSize}px ${btnSize}px ${btnSize}px`,
            gridTemplateRows: `${btnSize}px ${btnSize}px ${btnSize}px`,
            gap: `${gap}px`,
          }}
        >
          {/* Row 1: empty - TOP - empty */}
          <div />
          <DockZoneButton
            direction="top"
            icon="▲"
            isActive={isActiveZone('top')}
            onHover={handleZoneHover}
            onLeave={handleZoneLeave}
            size={btnSize}
            label="Top"
          />
          <div />

          {/* Row 2: LEFT - CENTER - RIGHT */}
          <DockZoneButton
            direction="left"
            icon="◄"
            isActive={isActiveZone('left')}
            onHover={handleZoneHover}
            onLeave={handleZoneLeave}
            size={btnSize}
            label="Left"
          />
          <DockZoneButton
            direction="center"
            icon="■"
            isActive={isActiveZone('center')}
            onHover={handleZoneHover}
            onLeave={handleZoneLeave}
            size={btnSize}
            label="Tab"
          />
          <DockZoneButton
            direction="right"
            icon="►"
            isActive={isActiveZone('right')}
            onHover={handleZoneHover}
            onLeave={handleZoneLeave}
            size={btnSize}
            label="Right"
          />

          {/* Row 3: empty - BOTTOM - empty */}
          <div />
          <DockZoneButton
            direction="bottom"
            icon="▼"
            isActive={isActiveZone('bottom')}
            onHover={handleZoneHover}
            onLeave={handleZoneLeave}
            size={btnSize}
            label="Bottom"
          />
          <div />
        </div>
      </div>
    </div>
  );
};

/**
 * Individual dock zone button (MT5 style small square)
 */
const DockZoneButton: React.FC<{
  direction: DockDirection;
  icon: string;
  isActive: boolean;
  onHover: (dir: DockDirection) => void;
  onLeave: () => void;
  size: number;
  label: string;
}> = ({ direction, icon, isActive, onHover, onLeave, size, label }) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border-2 transition-all duration-150 cursor-pointer select-none',
        isActive
          ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/30 scale-110'
          : 'bg-zinc-800/90 border-zinc-600 text-zinc-400 hover:bg-emerald-500/80 hover:border-emerald-400 hover:text-white'
      )}
      style={{ width: size, height: size }}
      onMouseEnter={() => onHover(direction)}
      onMouseLeave={onLeave}
      title={`Dock ${direction}`}
    >
      <span className="text-[14px] font-bold leading-none">{icon}</span>
      {isActive && (
        <span className="text-[8px] mt-0.5">{label}</span>
      )}
    </div>
  );
};

/**
 * Ghost Preview Component
 */
export const GhostPreview: React.FC = () => {
  const { ghostPreview, activeDropZone, dragState } = useDockLayoutStore();

  if (dragState !== 'dragging' || !ghostPreview.visible) return null;

  return (
    <div
      className={cn(
        'fixed pointer-events-none z-[100] transition-all duration-100',
        activeDropZone ? 'opacity-100' : 'opacity-50'
      )}
      style={{
        left: ghostPreview.x,
        top: ghostPreview.y,
        width: ghostPreview.width,
        height: ghostPreview.height,
      }}
    >
      <div
        className={cn(
          'w-full h-full rounded-lg border-2 border-dashed',
          activeDropZone
            ? 'border-zinc-600 bg-zinc-700/20 shadow-lg shadow-blue-500/20'
            : 'border-muted-foreground bg-background/50'
        )}
      >
        {activeDropZone && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-8000 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap">
            Dock {activeDropZone.direction}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Global Drop Zone Overlay - shows drag cursor and instructions
 */
export const GlobalDropZoneOverlay: React.FC = () => {
  const { dragState, dragInfo } = useDockLayoutStore();

  if (dragState !== 'dragging' || !dragInfo) return null;

  return (
    <>
      {/* Drag Cursor - follows mouse */}
      <div
        className="fixed z-[100] pointer-events-none"
        style={{
          left: dragInfo.currentX - 16,
          top: dragInfo.currentY - 16,
        }}
      >
        <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg ring-2 ring-white">
          <Icon name="grid" size="sm" className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Bottom instructions */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-background/90 backdrop-blur-sm px-4 py-2 rounded-full border border-border shadow-lg">
        <span className="text-xs text-muted-foreground">
          Hover over target panel arrows to preview • Release to dock • ESC to cancel
        </span>
      </div>
    </>
  );
};

export default DropZoneOverlay;

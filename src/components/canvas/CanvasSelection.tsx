/**
 * CanvasSelection Component
 * Professional trading-style interactive canvas with selection, drag, resize, crop, and snap
 */

import { Icon } from '../ui/Icon';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Magnet, Crop } from 'lucide-react';
import {
  useCanvasSelectionStore,
  createDefaultSnapZones,
  type Rect,
  type ResizeHandle,
} from '../../store/useCanvasSelectionStore';
// Utility for tailwind class merging
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CanvasSelectionProps {
  /** Container width in pixels */
  width: number;
  /** Container height in pixels */
  height: number;
  /** Optional custom snap zones */
  customSnapZones?: ReturnType<typeof createDefaultSnapZones>;
  /** Callback when selection changes */
  onSelectionChange?: (rect: Rect | null) => void;
  /** Callback when selection is confirmed */
  onSelectionConfirm?: (rect: Rect) => void;
  /** Callback when selection is cancelled */
  onSelectionCancel?: () => void;
  /** Enable/disable features */
  features?: {
    resize?: boolean;
    move?: boolean;
    crop?: boolean;
    snap?: boolean;
    undoRedo?: boolean;
  };
  /** Minimum selection size */
  minSelectionSize?: number;
  /** Theme color */
  accentColor?: string;
  children?: React.ReactNode;
}

const RESIZE_HANDLES: { position: ResizeHandle; cursor: string; className: string }[] = [
  { position: 'nw', cursor: 'nw-resize', className: '-top-1.5 -left-1.5' },
  { position: 'n', cursor: 'n-resize', className: '-top-1.5 left-1/2 -translate-x-1/2' },
  { position: 'ne', cursor: 'ne-resize', className: '-top-1.5 -right-1.5' },
  { position: 'e', cursor: 'e-resize', className: 'top-1/2 -right-1.5 -translate-y-1/2' },
  { position: 'se', cursor: 'se-resize', className: '-bottom-1.5 -right-1.5' },
  { position: 's', cursor: 's-resize', className: '-bottom-1.5 left-1/2 -translate-x-1/2' },
  { position: 'sw', cursor: 'sw-resize', className: '-bottom-1.5 -left-1.5' },
  { position: 'w', cursor: 'w-resize', className: 'top-1/2 -left-1.5 -translate-y-1/2' },
];

export const CanvasSelection: React.FC<CanvasSelectionProps> = ({
  width,
  height,
  customSnapZones,
  onSelectionChange,
  onSelectionConfirm,
  onSelectionCancel,
  features = {
    resize: true,
    move: true,
    crop: true,
    snap: true,
    undoRedo: true,
  },
  minSelectionSize = 20,
  accentColor = '#2196F3',
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  // Store state
  const {
    mode,
    selectionRect,
    snapZones,
    activeSnapZone,
    snapGuides,
    isSnapped,
    isCropping,
    cropRect,
    maintainAspectRatio,
    showSnapGuides,
    showZoneHighlights,
    animationEnabled,
    startSelection,
    updateSelection,
    endSelection,
    startMove,
    updateMove,
    endMove,
    startResize,
    updateResize,
    endResize,
    startCrop,
    applyCrop,
    cancelCrop,
    setSnapZones,
    clearSnapGuides,
    clearSelection,
    undo,
    redo,
    canUndo,
    canRedo,
    setMaintainAspectRatio,
    setShowSnapGuides,
    setShowZoneHighlights,
    nudgeSelection,
    expandSelection,
  } = useCanvasSelectionStore();

  // Initialize snap zones
  useEffect(() => {
    if (width > 0 && height > 0) {
      const zones = customSnapZones || createDefaultSnapZones(width, height);
      setSnapZones(zones);
      setIsReady(true);
    }
  }, [width, height, customSnapZones, setSnapZones]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(selectionRect);
  }, [selectionRect, onSelectionChange]);

  // Get container bounds relative to viewport
  const getContainerBounds = useCallback((): Rect => {
    if (!containerRef.current) {
      return { x: 0, y: 0, width, height };
    }
    const rect = containerRef.current.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, [width, height]);

  // Convert mouse coordinates to container-relative coordinates
  const getRelativeCoordinates = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const bounds = getContainerBounds();
      return {
        x: clientX - bounds.x,
        y: clientY - bounds.y,
      };
    },
    [getContainerBounds]
  );

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left click

      const { x, y } = getRelativeCoordinates(e.clientX, e.clientY);

      if (mode === 'idle') {
        startSelection(x, y);
      } else if (mode === 'selected' && selectionRect) {
        // Check if clicking inside selection to move
        if (
          x >= selectionRect.x &&
          x <= selectionRect.x + selectionRect.width &&
          y >= selectionRect.y &&
          y <= selectionRect.y + selectionRect.height
        ) {
          if (features.move) {
            startMove(x, y);
          }
        } else {
          // Clicked outside, start new selection
          clearSelection();
          startSelection(x, y);
        }
      }
    },
    [mode, selectionRect, features.move, startSelection, startMove, clearSelection, getRelativeCoordinates]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getRelativeCoordinates(e.clientX, e.clientY);
      const containerBounds = { x: 0, y: 0, width, height };

      if (mode === 'selecting') {
        updateSelection(x, y);
      } else if (mode === 'moving') {
        updateMove(x, y, containerBounds);
      } else if (mode === 'resizing') {
        updateResize(x, y, containerBounds, minSelectionSize);
      }
    },
    [mode, width, height, updateSelection, updateMove, updateResize, getRelativeCoordinates, minSelectionSize]
  );

  const handleMouseUp = useCallback(() => {
    if (mode === 'selecting') {
      endSelection();
    } else if (mode === 'moving') {
      endMove();
      clearSnapGuides();
    } else if (mode === 'resizing') {
      endResize();
    }
  }, [mode, endSelection, endMove, endResize, clearSnapGuides]);

  // Touch event handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const { x, y } = getRelativeCoordinates(touch.clientX, touch.clientY);

      if (mode === 'idle') {
        startSelection(x, y);
      } else if (mode === 'selected' && selectionRect) {
        if (
          x >= selectionRect.x &&
          x <= selectionRect.x + selectionRect.width &&
          y >= selectionRect.y &&
          y <= selectionRect.y + selectionRect.height
        ) {
          if (features.move) {
            startMove(x, y);
          }
        } else {
          clearSelection();
          startSelection(x, y);
        }
      }
    },
    [mode, selectionRect, features.move, startSelection, startMove, clearSelection, getRelativeCoordinates]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const { x, y } = getRelativeCoordinates(touch.clientX, touch.clientY);
      const containerBounds = { x: 0, y: 0, width, height };

      if (mode === 'selecting') {
        updateSelection(x, y);
      } else if (mode === 'moving') {
        updateMove(x, y, containerBounds);
      } else if (mode === 'resizing') {
        updateResize(x, y, containerBounds, minSelectionSize);
      }
    },
    [mode, width, height, updateSelection, updateMove, updateResize, getRelativeCoordinates, minSelectionSize]
  );

  const handleTouchEnd = useCallback(() => {
    if (mode === 'selecting') {
      endSelection();
    } else if (mode === 'moving') {
      endMove();
      clearSnapGuides();
    } else if (mode === 'resizing') {
      endResize();
    }
  }, [mode, endSelection, endMove, endResize, clearSnapGuides]);

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode === 'idle') return;

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      // Confirm/Cancel
      if (e.key === 'Enter') {
        if (isCropping) {
          applyCrop();
        } else if (selectionRect) {
          onSelectionConfirm?.(selectionRect);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (isCropping) {
          cancelCrop();
        } else {
          clearSelection();
          onSelectionCancel?.();
        }
        return;
      }

      // Nudge with arrow keys
      if (mode === 'selected' && selectionRect) {
        const step = e.shiftKey ? 10 : 1;
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            nudgeSelection(0, -step);
            break;
          case 'ArrowDown':
            e.preventDefault();
            nudgeSelection(0, step);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            nudgeSelection(-step, 0);
            break;
          case 'ArrowRight':
            e.preventDefault();
            nudgeSelection(step, 0);
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, isCropping, selectionRect, undo, redo, applyCrop, cancelCrop, clearSelection, nudgeSelection, onSelectionConfirm, onSelectionCancel]);

  // Global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => handleMouseUp();
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleMouseUp]);

  // Resize handle handlers
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent) => {
      e.stopPropagation();
      const { x, y } = getRelativeCoordinates(e.clientX, e.clientY);
      startResize(handle, x, y);
    },
    [startResize, getRelativeCoordinates]
  );

  // Calculate crop overlay style
  const getCropOverlayStyle = () => {
    if (!selectionRect || !cropRect) return {};

    return {
      clipPath: `polygon(
        0% 0%,
        100% 0%,
        100% 100%,
        0% 100%,
        0% 0%,
        ${cropRect.x}px ${cropRect.y}px,
        ${cropRect.x}px ${cropRect.y + cropRect.height}px,
        ${cropRect.x + cropRect.width}px ${cropRect.y + cropRect.height}px,
        ${cropRect.x + cropRect.width}px ${cropRect.y}px,
        ${cropRect.x}px ${cropRect.y}px
      )`,
    };
  };

  if (!isReady) {
    return (
      <div
        className="relative bg-background border border-border rounded-lg overflow-hidden flex items-center justify-center"
        style={{ width, height }}
      >
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative bg-background border border-border rounded-lg overflow-hidden select-none',
        mode === 'selecting' && 'cursor-crosshair',
        mode === 'moving' && 'cursor-move',
        mode === 'resizing' && 'cursor-nwse-resize'
      )}
      style={{ width, height }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background Content */}
      <div className="absolute inset-0 pointer-events-none">{children}</div>

      {/* Snap Zone Highlights */}
      {showZoneHighlights &&
        mode !== 'idle' &&
        snapZones.map((zone) => (
          <div
            key={zone.id}
            className={cn(
              'absolute border-2 border-dashed transition-all duration-150',
              activeSnapZone?.id === zone.id
                ? 'border-primary bg-primary/10'
                : 'border-muted-foreground/30 bg-transparent hover:border-muted-foreground/50'
            )}
            style={{
              left: zone.rect.x,
              top: zone.rect.y,
              width: zone.rect.width,
              height: zone.rect.height,
            }}
          >
            <span className="absolute top-1 left-1 text-[10px] text-muted-foreground uppercase tracking-wider opacity-50">
              {zone.label}
            </span>
          </div>
        ))}

      {/* Snap Guides */}
      {showSnapGuides &&
        snapGuides.map((guide, index) => (
          <div
            key={`${guide.type}-${guide.position}-${index}`}
            className="absolute pointer-events-none z-20"
            style={{
              backgroundColor: accentColor,
              ...(guide.type === 'vertical'
                ? {
                  left: guide.position,
                  top: 0,
                  width: 1,
                  height: '100%',
                }
                : {
                  top: guide.position,
                  left: 0,
                  height: 1,
                  width: '100%',
                }),
            }}
          >
            <span
              className="absolute text-[9px] px-1 rounded"
              style={{
                backgroundColor: accentColor,
                color: 'white',
                ...(guide.type === 'vertical'
                  ? { top: 2, left: 2 }
                  : { left: 2, top: 2 }),
              }}
            >
              {guide.source === 'center' ? 'Center' : 'Edge'}
            </span>
          </div>
        ))}

      {/* Selection Rectangle */}
      {selectionRect && (
        <div
          className={cn(
            'absolute z-10',
            animationEnabled && 'transition-all duration-150 ease-out'
          )}
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
            boxShadow: isSnapped ? `0 0 0 2px ${accentColor}, 0 0 20px ${accentColor}40` : `0 0 0 2px ${accentColor}`,
          }}
        >
          {/* Selection Fill */}
          <div
            className={cn(
              'absolute inset-0',
              mode === 'selected' ? 'bg-primary/5' : 'bg-primary/10'
            )}
          />

          {/* Resize Handles */}
          {features.resize &&
            mode !== 'cropping' &&
            RESIZE_HANDLES.map(({ position, cursor, className }) => (
              <div
                key={position}
                className={cn(
                  'absolute w-3 h-3 bg-background border-2 rounded-sm hover:scale-125 transition-transform',
                  className
                )}
                style={{
                  borderColor: accentColor,
                  cursor,
                }}
                onMouseDown={(e) => handleResizeStart(position, e)}
              />
            ))}

          {/* Selection Info */}
          <div className="absolute -top-6 left-0 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="font-mono">
              {Math.round(selectionRect.width)} × {Math.round(selectionRect.height)}
            </span>
            {isSnapped && <Magnet className="w-3 h-3 text-primary" />}
          </div>
        </div>
      )}

      {/* Crop Overlay */}
      {isCropping && selectionRect && cropRect && (
        <div
          className="absolute inset-0 bg-background/80 z-30 pointer-events-none"
          style={getCropOverlayStyle()}
        />
      )}

      {/* Toolbar */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 z-40">
        {/* Main Actions */}
        <div className="flex items-center gap-1 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-1 shadow-lg">
          {features.undoRedo && (
            <>
              <button
                onClick={undo}
                disabled={!canUndo()}
                className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Icon name="refresh" size="sm" className="w-4 h-4" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo()}
                className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Icon name="refresh" size="sm" className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}

          {features.snap && (
            <button
              onClick={() => setShowSnapGuides(!showSnapGuides)}
              className={cn(
                'p-1.5 rounded transition-colors',
                showSnapGuides ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              title="Toggle Snap Guides"
            >
              <Magnet className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowZoneHighlights(!showZoneHighlights)}
            className={cn(
              'p-1.5 rounded transition-colors',
              showZoneHighlights ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
            title="Toggle Zone Highlights"
          >
            <Icon name="grid-3x3" size="sm" className="w-4 h-4" />
          </button>

          <button
            onClick={() => setMaintainAspectRatio(!maintainAspectRatio)}
            className={cn(
              'p-1.5 rounded transition-colors',
              maintainAspectRatio ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
            title={maintainAspectRatio ? 'Unlock Aspect Ratio' : 'Lock Aspect Ratio'}
          >
            {maintainAspectRatio ? <Icon name="lock" size="sm" className="w-4 h-4" /> : <Icon name="unlock" size="sm" className="w-4 h-4" />}
          </button>

          {selectionRect && (
            <>
              <div className="w-px h-4 bg-border mx-1" />

              {features.crop && mode !== 'cropping' && (
                <button
                  onClick={startCrop}
                  className="p-1.5 rounded hover:bg-muted transition-colors"
                  title="Crop Selection"
                >
                  <Crop className="w-4 h-4" />
                </button>
              )}

              {mode === 'cropping' && (
                <>
                  <button
                    onClick={applyCrop}
                    className="p-1.5 rounded bg-success text-success-foreground hover:bg-success/90 transition-colors"
                    title="Apply Crop"
                  >
                    <Icon name="check" size="sm" className="w-4 h-4" />
                  </button>
                  <button
                    onClick={cancelCrop}
                    className="p-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                    title="Cancel Crop"
                  >
                    <Icon name="x-close" size="sm" className="w-4 h-4" />
                  </button>
                </>
              )}

              <button
                onClick={() => {
                  if (selectionRect) {
                    onSelectionConfirm?.(selectionRect);
                  }
                }}
                className="p-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                title="Confirm"
              >
                <Icon name="check" size="sm" className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  clearSelection();
                  onSelectionCancel?.();
                }}
                className="p-1.5 rounded hover:bg-muted transition-colors"
                title="Clear"
              >
                <Icon name="x-close" size="sm" className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Instructions */}
      {mode === 'idle' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border pointer-events-none">
          Click and drag to select an area
        </div>
      )}

      {mode === 'selected' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border pointer-events-none whitespace-nowrap">
          Drag to move • Drag handles to resize • Arrow keys to nudge • Enter to confirm
        </div>
      )}
    </div>
  );
};

export default CanvasSelection;

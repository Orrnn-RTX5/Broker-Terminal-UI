/**
 * DockResizeHandle Component
 * MT5-style invisible resize handle — cursor changes on hover, no visible divider
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DockResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  className?: string;
}

export const DockResizeHandle: React.FC<DockResizeHandleProps> = ({
  direction,
  onResize,
  className,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const lastDeltaRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startPosRef.current = direction === 'vertical' ? e.clientX : e.clientY;
    lastDeltaRef.current = 0;
    setIsDragging(true);
  }, [direction]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'vertical' ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current - lastDeltaRef.current;
      lastDeltaRef.current = currentPos - startPosRef.current;
      if (delta !== 0) onResize(delta);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, direction, onResize]);

  return (
    <div
      data-dock-resize-handle={direction}
      className={cn(
        'dock-resize-handle',
        direction === 'vertical'
          ? 'dock-resize-handle--vertical'
          : 'dock-resize-handle--horizontal',
        isDragging && 'dock-resize-handle--dragging',
        'relative flex-shrink-0 z-30',
        // Reserve no split-layout space. A centered hit target overlaps both
        // adjacent panels so the divider stays easy to drag.
        direction === 'vertical'
          ? 'h-full w-0'
          : 'h-0 w-full',
        className
      )}
    >
      <div
        data-dock-resize-hit-target={direction}
        className={cn(
          'absolute bg-transparent transition-colors duration-75',
          direction === 'vertical'
            ? 'inset-y-0 left-1/2 w-[7px] -translate-x-1/2 cursor-col-resize'
            : 'inset-x-0 top-1/2 h-[7px] -translate-y-1/2 cursor-row-resize',
          isDragging && 'bg-zinc-500/40',
        )}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

export default DockResizeHandle;

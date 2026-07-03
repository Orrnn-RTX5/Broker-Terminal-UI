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
      className={cn(
        'dock-resize-handle',
        direction === 'vertical'
          ? 'dock-resize-handle--vertical'
          : 'dock-resize-handle--horizontal',
        isDragging && 'dock-resize-handle--dragging',
        'relative flex items-center justify-center flex-shrink-0 z-30',
        // Invisible by default — only cursor changes
        direction === 'vertical'
          ? 'w-[3px] cursor-col-resize'
          : 'h-[3px] cursor-row-resize',
        // Subtle highlight on hover and during drag
        isDragging
          ? 'bg-zinc-500/60'
          : 'bg-transparent hover:bg-zinc-500/30',
        'transition-colors duration-75',
        className
      )}
      onMouseDown={handleMouseDown}
    />
  );
};

export default DockResizeHandle;

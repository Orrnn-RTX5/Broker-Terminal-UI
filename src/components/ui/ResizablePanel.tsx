import { useState, useRef, useEffect, useCallback } from 'react';

type ResizablePanelProps = {
  children: React.ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  direction?: 'horizontal' | 'vertical';
  onResize?: (size: number) => void;
  className?: string;
  showHandle?: boolean;
};

export function ResizablePanel({
  children,
  defaultSize = 250,
  minSize = 100,
  maxSize = 800,
  direction = 'horizontal',
  onResize,
  className = '',
  showHandle = true
}: ResizablePanelProps) {
  const [size, setSize] = useState(defaultSize);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = size;
  }, [direction, size]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPosRef.current;
    const newSize = Math.max(minSize, Math.min(maxSize, startSizeRef.current + delta));

    setSize(newSize);
    onResize?.(newSize);
  }, [isResizing, direction, minSize, maxSize, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp, direction]);

  const sizeStyle = direction === 'horizontal'
    ? { width: `${size}px`, flexShrink: 0 }
    : { height: `${size}px`, flexShrink: 0 };

  return (
    <div ref={panelRef} className={`relative ${className}`} style={sizeStyle}>
      {children}
      {showHandle && (
        <div
          className={`
            resizer absolute z-10
            ${direction === 'horizontal'
              ? 'top-0 right-0 h-full w-1 cursor-col-resize hover:w-1.5'
              : 'bottom-0 left-0 w-full h-1 cursor-row-resize resizer-horizontal hover:h-1.5'
            }
            ${isResizing ? 'bg-[#2196F3]' : 'bg-zinc-800 hover:bg-[#2196F3]'}
            transition-all
          `}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}

import { useState, useRef, useCallback } from 'react';

export interface HoverIntentOptions {
  delay?: number;
  sensitivity?: number;
}

/**
 * Custom hook for implementing hover intent delay pattern.
 * Prevents instant menu opening on accidental mouseover.
 *
 * @param delay - Milliseconds to wait before activating hover (default: 150ms)
 * @param sensitivity - Movement tolerance in pixels (default: 7)
 */
export function useHoverIntent(options: HoverIntentOptions = {}) {
  const { delay = 150, sensitivity = 7 } = options;
  const [isHovering, setIsHovering] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionRef = useRef({ x: 0, y: 0 });
  const initialPosRef = useRef({ x: 0, y: 0 });

  const onMouseEnter = useCallback((e: React.MouseEvent) => {
    initialPosRef.current = { x: e.clientX, y: e.clientY };
    positionRef.current = { x: e.clientX, y: e.clientY };

    timeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, delay);
  }, [delay]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const dx = Math.abs(e.clientX - initialPosRef.current.x);
    const dy = Math.abs(e.clientY - initialPosRef.current.y);

    // If user moved mouse significantly, reset timer (prevents accidental activation)
    if (dx > sensitivity || dy > sensitivity) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      initialPosRef.current = { x: e.clientX, y: e.clientY };
      timeoutRef.current = setTimeout(() => {
        setIsHovering(true);
      }, delay);
    }

    positionRef.current = { x: e.clientX, y: e.clientY };
  }, [delay, sensitivity]);

  const onMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsHovering(false);
  }, []);

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsHovering(false);
  }, []);

  return {
    isHovering,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    reset,
    currentPosition: positionRef.current,
  };
}

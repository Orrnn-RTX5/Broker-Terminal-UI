import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { getHistoryVirtualWindow, HISTORY_VIEWPORT_FALLBACK } from './historyFilters';

/** Scrolling changes the mounted rows only at a row boundary, once per frame. */
export function useHistoryVirtualWindow(count: number, resetKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [window, setWindow] = useState(() => getHistoryVirtualWindow(count, 0, HISTORY_VIEWPORT_FALLBACK));
  const syncViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const next = getHistoryVirtualWindow(count, element.scrollTop, element.clientHeight);
    setWindow(current => current.startIndex === next.startIndex && current.endIndex === next.endIndex
      && current.topSpacerHeight === next.topSpacerHeight && current.bottomSpacerHeight === next.bottomSpacerHeight
      ? current : next);
  }, [count]);
  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      syncViewport();
    });
  }, [syncViewport]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey]);

  useLayoutEffect(() => {
    syncViewport();
    const element = scrollRef.current;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncViewport) : null;
    if (element) observer?.observe(element);
    return () => {
      observer?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [resetKey, syncViewport]);

  return { scrollRef, window, onScroll };
}

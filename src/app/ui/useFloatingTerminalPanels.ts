import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react';

type Point = { x: number; y: number };
type Size = { w: number; h: number };
export type ResizeMode = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface FloatingTerminalPanelsController {
  showDOM: boolean;
  setShowDOM: Dispatch<SetStateAction<boolean>>;
  domSymbol: string;
  openDOM: (symbol: string) => void;
  domPos: Point;
  domSize: Size;
  handleDomMouseDown: (event: ReactMouseEvent) => void;
  handleDomResizeMouseDown: (event: ReactMouseEvent, mode: 'e' | 's' | 'se') => void;
  showDataWindow: boolean;
  setShowDataWindow: Dispatch<SetStateAction<boolean>>;
  dataWindowPos: Point;
  dataWindowSize: Size;
  handleDataWindowMouseDown: (event: ReactMouseEvent) => void;
  handleDataWindowResizeMouseDown: (event: ReactMouseEvent, mode: ResizeMode) => void;
}

export const useFloatingTerminalPanels = (initialSymbol: string): FloatingTerminalPanelsController => {
  const [showDOM, setShowDOM] = useState(false);
  const [domSymbol, setDomSymbol] = useState(initialSymbol);
  const [domPos, setDomPos] = useState<Point>({ x: 620, y: 56 });
  const [domSize, setDomSize] = useState<Size>({ w: 520, h: 540 });
  const [showDataWindow, setShowDataWindow] = useState(false);
  const [dataWindowPos, setDataWindowPos] = useState<Point>({ x: 620, y: 56 });
  const [dataWindowSize, setDataWindowSize] = useState<Size>({ w: 240, h: 290 });

  const domDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const domResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; mode: string } | null>(null);
  const dataWindowDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dataWindowResizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    origX: number;
    origY: number;
    mode: ResizeMode;
  } | null>(null);

  const handleDomMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    domDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: domPos.x,
      origY: domPos.y,
    };
    const onMove = (moveEvent: MouseEvent) => {
      const drag = domDragRef.current;
      if (!drag) return;
      setDomPos({
        x: drag.origX + moveEvent.clientX - drag.startX,
        y: drag.origY + moveEvent.clientY - drag.startY,
      });
    };
    const onUp = () => {
      domDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [domPos]);

  const openDOM = useCallback((symbol: string) => {
    setDomSymbol(symbol);
    setDomPos({ x: 620, y: 56 });
    setShowDOM(true);
  }, []);

  const handleDomResizeMouseDown = useCallback((event: ReactMouseEvent, mode: 'e' | 's' | 'se') => {
    event.preventDefault();
    event.stopPropagation();
    domResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origW: domSize.w,
      origH: domSize.h,
      mode,
    };
    const onMove = (moveEvent: MouseEvent) => {
      const resize = domResizeRef.current;
      if (!resize) return;
      const dx = moveEvent.clientX - resize.startX;
      const dy = moveEvent.clientY - resize.startY;
      // Capture values synchronously; the ref may be cleared before React runs the state updater.
      const { mode: resizeMode, origW, origH } = resize;
      setDomSize((previous) => ({
        w: resizeMode !== 's' ? Math.max(360, origW + dx) : previous.w,
        h: resizeMode !== 'e' ? Math.max(200, origH + dy) : previous.h,
      }));
    };
    const onUp = () => {
      domResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [domSize]);

  const handleDataWindowMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    dataWindowDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: dataWindowPos.x,
      origY: dataWindowPos.y,
    };
    const onMove = (moveEvent: MouseEvent) => {
      const drag = dataWindowDragRef.current;
      if (!drag) return;
      setDataWindowPos({
        x: drag.origX + moveEvent.clientX - drag.startX,
        y: drag.origY + moveEvent.clientY - drag.startY,
      });
    };
    const onUp = () => {
      dataWindowDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dataWindowPos]);

  const handleDataWindowResizeMouseDown = useCallback((event: ReactMouseEvent, mode: ResizeMode) => {
    event.preventDefault();
    event.stopPropagation();
    dataWindowResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origW: dataWindowSize.w,
      origH: dataWindowSize.h,
      origX: dataWindowPos.x,
      origY: dataWindowPos.y,
      mode,
    };
    const onMove = (moveEvent: MouseEvent) => {
      const resize = dataWindowResizeRef.current;
      if (!resize) return;
      const dx = moveEvent.clientX - resize.startX;
      const dy = moveEvent.clientY - resize.startY;
      const minWidth = 200;
      const minHeight = 200;
      setDataWindowSize((previous) => ({
        w: mode.includes('e') ? Math.max(minWidth, resize.origW + dx)
          : mode.includes('w') ? Math.max(minWidth, resize.origW - dx) : previous.w,
        h: mode.includes('s') ? Math.max(minHeight, resize.origH + dy)
          : mode.includes('n') ? Math.max(minHeight, resize.origH - dy) : previous.h,
      }));
      setDataWindowPos((previous) => ({
        x: mode.includes('w') ? resize.origX + Math.min(dx, resize.origW - minWidth) : previous.x,
        y: mode.includes('n') ? resize.origY + Math.min(dy, resize.origH - minHeight) : previous.y,
      }));
    };
    const onUp = () => {
      dataWindowResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dataWindowPos, dataWindowSize]);

  return {
    showDOM,
    setShowDOM,
    domSymbol,
    openDOM,
    domPos,
    domSize,
    handleDomMouseDown,
    handleDomResizeMouseDown,
    showDataWindow,
    setShowDataWindow,
    dataWindowPos,
    dataWindowSize,
    handleDataWindowMouseDown,
    handleDataWindowResizeMouseDown,
  };
};

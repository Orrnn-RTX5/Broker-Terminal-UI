import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { formatTradingChartCrosshairLabel } from '../utils/chartTimeFormat';

interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}

export interface UseCrosshairOptions {
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<any> | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  digits?: number;
  timeframe?: string;
  brokerOffsetSeconds?: number;
}

export interface CrosshairRefs {
  vertLineRef: RefObject<HTMLDivElement | null>;
  horizLineRef: RefObject<HTMLDivElement | null>;
  centerRef: RefObject<HTMLDivElement | null>;
  timeLabelRef: RefObject<HTMLDivElement | null>;
  priceLabelRef: RefObject<HTMLDivElement | null>;
}

export function useCrosshair({
  chartRef,
  seriesRef,
  containerRef,
  enabled,
  digits = 5,
  timeframe = 'M1',
  brokerOffsetSeconds = 0,
}: UseCrosshairOptions): CrosshairRefs {
  const vertLineRef   = useRef<HTMLDivElement>(null);
  const horizLineRef  = useRef<HTMLDivElement>(null);
  const centerRef     = useRef<HTMLDivElement>(null);
  const timeLabelRef  = useRef<HTMLDivElement>(null);
  const priceLabelRef = useRef<HTMLDivElement>(null);

  // No React state for position — raw ref only
  const cursorRef = useRef<CursorState>({ x: 0, y: 0, visible: false });
  const rafIdRef  = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    const allRefs = [vertLineRef, horizLineRef, centerRef, timeLabelRef, priceLabelRef];
    const hideAll = () => allRefs.forEach(r => { if (r.current) r.current.style.opacity = '0'; });

    if (!enabled) {
      hideAll();
      chartRef.current?.applyOptions({
        crosshair: {
          mode: 0, // CrosshairMode.Normal
          vertLine: { visible: true, labelVisible: true },
          horzLine: { visible: true, labelVisible: true },
        },
      });
      if (container) container.style.cursor = '';
      return;
    }

    if (!container) return;

    // Suppress built-in LWC crosshair and OS cursor
    chartRef.current?.applyOptions({
      crosshair: {
        mode: 2, 
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
    });
    container.style.cursor = 'none';
    let rect = container.getBoundingClientRect();
    const updateRect = () => { rect = container.getBoundingClientRect(); };
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    const onPointerMove = (e: PointerEvent) => {
      cursorRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        visible: true,
      };
    };
    const onPointerLeave = () => {
      cursorRef.current = { ...cursorRef.current, visible: false };
    };

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerleave', onPointerLeave);

    const tick = () => {
      rafIdRef.current = requestAnimationFrame(tick);

      const { x: rawX, y, visible } = cursorRef.current;
      const chart  = chartRef.current;
      const series = seriesRef.current;

      if (!visible || !chart || !series) { hideAll(); return; }

      const ts      = chart.timeScale();
      const logical = ts.coordinateToLogical(rawX);
      if (logical === null) { hideAll(); return; }

      const snappedX = rawX;

      const W = container.clientWidth;
      const H = container.clientHeight;

      // Vertical line — snapped X, full height
      const vl = vertLineRef.current;
      if (vl) {
        vl.style.opacity = '1';
        vl.style.transform = `translate3d(${snappedX}px,0,0)`;
      }

      // Horizontal line — exact cursor Y, full width
      const hl = horizLineRef.current;
      if (hl) {
        hl.style.opacity = '1';
        hl.style.transform = `translate3d(0,${y}px,0)`;
      }


      const cm = centerRef.current;
      if (cm) {
        cm.style.opacity = '1';
        cm.style.transform = `translate(-50%,-50%) translate3d(${snappedX}px,${y}px,0)`;
      }

     
      const tl = timeLabelRef.current;
      if (tl) {
        const timeVal = ts.coordinateToTime(snappedX);
        if (timeVal !== null) {
          tl.textContent = formatTradingChartCrosshairLabel(
            timeVal as Time,
            timeframe,
            brokerOffsetSeconds,
          );
        }
        const lw = tl.offsetWidth;
        tl.style.opacity = '1';
        tl.style.transform = `translate3d(${snappedX - lw / 2}px,${H - 22}px,0)`;
      }

      // Price label — right edge at cursor Y
      const pl = priceLabelRef.current;
      if (pl) {
        const price = series.coordinateToPrice(y);
        if (price !== null) pl.textContent = price.toFixed(digits);
        pl.style.opacity = '1';
        pl.style.transform = `translate3d(${W - 54}px,${y - 10}px,0)`;
      }
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafIdRef.current);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      container.style.cursor = '';
      hideAll();
    };

  }, [enabled, digits, timeframe, brokerOffsetSeconds]);

  return { vertLineRef, horizLineRef, centerRef, timeLabelRef, priceLabelRef };
}

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { formatTradingChartCrosshairLabel } from '../utils/chartTimeFormat';
import { formatChartAxisPrice } from '../utils/chartPriceScale';

interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}

interface LabelMeasurement {
  element: HTMLDivElement | null;
  key: string;
  width: number;
}

export interface UseCrosshairOptions {
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<any> | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  digits?: number | null;
  timeframe?: string;
  brokerOffsetSeconds?: number;
  marker?: 'cross' | 'dot';
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
  marker = 'cross',
}: UseCrosshairOptions): CrosshairRefs {
  const vertLineRef = useRef<HTMLDivElement>(null);
  const horizLineRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const timeLabelRef = useRef<HTMLDivElement>(null);
  const priceLabelRef = useRef<HTMLDivElement>(null);

  // Position and render ownership stay outside React state so pointer events can
  // be coalesced without making TradingChart render.
  const cursorRef = useRef<CursorState>({ x: 0, y: 0, visible: false });
  const rafIdRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const scheduleRenderRef = useRef<() => void>(() => undefined);
  const optionsRef = useRef({ digits, timeframe, brokerOffsetSeconds });
  optionsRef.current = { digits, timeframe, brokerOffsetSeconds };

  useEffect(() => {
    const container = containerRef.current;
    const allRefs = [vertLineRef, horizLineRef, centerRef, timeLabelRef, priceLabelRef];
    const hideAll = () => allRefs.forEach((ref) => {
      if (ref.current) ref.current.style.opacity = '0';
    });

    if (!enabled) {
      dirtyRef.current = false;
      scheduleRenderRef.current = () => undefined;
      hideAll();
      chartRef.current?.applyOptions({
        crosshair: {
          mode: 0,
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
      });
      return;
    }

    if (!container) return;

    const enabledCrosshairOptions = {
      crosshair: {
        mode: 2,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
    } as const;
    chartRef.current?.applyOptions(enabledCrosshairOptions);
    let disposed = false;
    let rect = container.getBoundingClientRect();
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;
    let subscribedChart: IChartApi | null = null;
    let subscribedTimeScale: ReturnType<IChartApi['timeScale']> | null = null;
    const timeLabelMeasurement: LabelMeasurement = { element: null, key: '', width: 0 };

    const updateRect = () => {
      rect = container.getBoundingClientRect();
      containerWidth = container.clientWidth;
      containerHeight = container.clientHeight;
    };

    const measureTimeLabel = (label: HTMLDivElement): number => {
      const key = [
        label.textContent ?? '',
        document.documentElement.className,
        document.documentElement.style.cssText,
        label.style.font,
        label.style.fontFamily,
        label.style.fontSize,
        label.style.fontWeight,
        label.style.letterSpacing,
        label.style.padding,
        label.style.borderWidth,
      ].join('|');
      if (timeLabelMeasurement.element !== label || timeLabelMeasurement.key !== key) {
        timeLabelMeasurement.element = label;
        timeLabelMeasurement.key = key;
        timeLabelMeasurement.width = label.offsetWidth;
      }
      return timeLabelMeasurement.width;
    };

    const unsubscribeFromChart = () => {
      if (subscribedChart) {
        try { subscribedChart.unsubscribeCrosshairMove(onChartInvalidated); } catch { /* disposed chart */ }
      }
      if (subscribedTimeScale) {
        try { subscribedTimeScale.unsubscribeVisibleLogicalRangeChange(onChartInvalidated); } catch { /* disposed chart */ }
        try { subscribedTimeScale.unsubscribeSizeChange(onChartSizeChanged); } catch { /* disposed chart */ }
      }
      subscribedChart = null;
      subscribedTimeScale = null;
    };

    const subscribeToLatestChart = () => {
      const nextChart = chartRef.current;
      let nextTimeScale: ReturnType<IChartApi['timeScale']> | null = null;
      if (nextChart) {
        try { nextTimeScale = nextChart.timeScale(); } catch { /* disposed chart */ }
      }
      if (nextChart === subscribedChart && nextTimeScale === subscribedTimeScale) return;
      unsubscribeFromChart();
      if (!nextChart || !nextTimeScale) return;

      subscribedChart = nextChart;
      subscribedTimeScale = nextTimeScale;
      try { nextChart.applyOptions(enabledCrosshairOptions); } catch { /* disposed chart */ }
      try { nextChart.subscribeCrosshairMove(onChartInvalidated); } catch { /* disposed chart */ }
      try { nextTimeScale.subscribeVisibleLogicalRangeChange(onChartInvalidated); } catch { /* disposed chart */ }
      try { nextTimeScale.subscribeSizeChange(onChartSizeChanged); } catch { /* disposed chart */ }
    };

    const renderCrosshair = () => {
      if (disposed || !dirtyRef.current) return;
      dirtyRef.current = false;
      subscribeToLatestChart();

      const { x: rawX, y, visible } = cursorRef.current;
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!visible || !chart || !series) {
        hideAll();
        return;
      }

      const timeScale = chart.timeScale();
      const priceScaleWidth = chart.priceScale('right').width();
      const timeScaleHeight = timeScale.height();
      const plotWidth = Math.max(0, containerWidth - priceScaleWidth);
      const plotHeight = Math.max(0, containerHeight - timeScaleHeight);
      if (rawX < 0 || rawX >= plotWidth || y < 0 || y >= plotHeight) {
        hideAll();
        return;
      }

      const vertLine = vertLineRef.current;
      if (vertLine) {
        vertLine.style.opacity = '1';
        vertLine.style.height = `${plotHeight}px`;
        vertLine.style.transform = `translate3d(${Math.round(rawX)}px,0,0)`;
      }

      const horizLine = horizLineRef.current;
      if (horizLine) {
        horizLine.style.opacity = '1';
        horizLine.style.width = `${plotWidth}px`;
        horizLine.style.transform = `translate3d(0,${Math.round(y)}px,0)`;
      }

      // The pointer glyph is a native CSS cursor. Keeping it out of this RAF
      // path lets the OS/compositor move it at input frequency while the chart
      // guides and labels remain frame-coalesced.
      if (centerRef.current) centerRef.current.style.opacity = '0';

      const {
        digits: latestDigits,
        timeframe: latestTimeframe,
        brokerOffsetSeconds: latestOffset,
      } = optionsRef.current;
      const timeLabel = timeLabelRef.current;
      if (timeLabel) {
        const time = timeScale.coordinateToTime(rawX);
        if (time === null) {
          timeLabel.style.opacity = '0';
        } else {
          const text = formatTradingChartCrosshairLabel(time as Time, latestTimeframe, latestOffset);
          if (timeLabel.textContent !== text) timeLabel.textContent = text;
          const labelWidth = measureTimeLabel(timeLabel);
          timeLabel.style.opacity = '1';
          const labelHeight = timeLabel.offsetHeight || 22;
          timeLabel.style.transform = `translate3d(${rawX - labelWidth / 2}px,${containerHeight - labelHeight}px,0)`;
        }
      }

      const priceLabel = priceLabelRef.current;
      if (priceLabel) {
        const price = series.coordinateToPrice(y);
        if (price === null) {
          priceLabel.style.opacity = '0';
        } else {
          const text = formatChartAxisPrice(price, latestDigits);
          if (priceLabel.textContent !== text) priceLabel.textContent = text;
          priceLabel.style.opacity = '1';
          const labelWidth = priceScaleWidth;
          priceLabel.style.width = `${labelWidth}px`;
          const halfHeight = (priceLabel.offsetHeight || 20) / 2;
          priceLabel.style.transform = `translate3d(${containerWidth - labelWidth}px,${y - halfHeight}px,0)`;
        }
      }
    };

    const scheduleRender = () => {
      if (disposed) return;
      dirtyRef.current = true;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        renderCrosshair();
      });
    };
    scheduleRenderRef.current = scheduleRender;

    function onChartInvalidated() {
      scheduleRender();
    }

    function onChartSizeChanged() {
      updateRect();
      scheduleRender();
    }

    const onViewportChanged = () => {
      updateRect();
      scheduleRender();
    };

    window.addEventListener('resize', onViewportChanged);
    window.addEventListener('scroll', onViewportChanged, true);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(onChartSizeChanged);
    resizeObserver?.observe(container);

    const onPointerMove = (event: PointerEvent) => {
      cursorRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        visible: true,
      };
      scheduleRender();
    };
    const onPointerLeave = () => {
      cursorRef.current = { ...cursorRef.current, visible: false };
      scheduleRender();
    };

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerleave', onPointerLeave);
    scheduleRender();

    return () => {
      disposed = true;
      dirtyRef.current = false;
      scheduleRenderRef.current = () => undefined;
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      unsubscribeFromChart();
      resizeObserver?.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onViewportChanged);
      window.removeEventListener('scroll', onViewportChanged, true);
      cursorRef.current = { ...cursorRef.current, visible: false };
      hideAll();
    };
  }, [chartRef, containerRef, enabled, seriesRef]);

  useEffect(() => {
    if (centerRef.current) centerRef.current.dataset.marker = marker;
  }, [marker]);

  // Chart and series refs are populated/replaced by later TradingChart effects.
  // One dirty frame after a React commit rebinds them without polling while idle.
  useEffect(() => {
    if (enabled) scheduleRenderRef.current();
  });

  return { vertLineRef, horizLineRef, centerRef, timeLabelRef, priceLabelRef };
}

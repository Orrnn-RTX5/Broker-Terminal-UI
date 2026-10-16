import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { LineStyle } from 'lightweight-charts';
import type { IPriceLine, ISeriesApi, SeriesType } from 'lightweight-charts';

import {
  getLivePriceOverlayColors,
  getLivePriceSeriesColor,
  resolveLivePriceScaleWidth,
  type AreaTrendDirection,
  type LivePriceOverlayColors,
} from '../../../components/TradingChart.helpers';
import { defaultChartProperties, type ChartProperties } from '../../../store/useChartSettingsStore';
import type { Candle, ChartType } from '../../../types/chart';
import { formatChartAxisPrice } from '../../../utils/chartPriceScale';
import type { ChartColorPalette } from './chartTheme';

interface UseTradingChartLivePriceOverlayOptions {
  askPriceLineRef: MutableRefObject<IPriceLine | null>;
  canPaintLivePrice: () => boolean;
  chartSettingsRef: MutableRefObject<ChartProperties>;
  chartType: ChartType;
  currentCandleRef: MutableRefObject<Candle | null>;
  isDisposedRef: MutableRefObject<boolean>;
  lastPriceLineRef: MutableRefObject<IPriceLine | null>;
  resolvedPriceDigitsRef: MutableRefObject<number>;
  seriesRef: MutableRefObject<ISeriesApi<SeriesType> | null>;
}

export function useTradingChartLivePriceOverlay({
  askPriceLineRef,
  canPaintLivePrice,
  chartSettingsRef,
  chartType,
  currentCandleRef,
  isDisposedRef,
  lastPriceLineRef,
  resolvedPriceDigitsRef,
  seriesRef,
}: UseTradingChartLivePriceOverlayOptions) {
  const livePriceLineRef = useRef<HTMLDivElement | null>(null);
  const livePriceBadgeRef = useRef<HTMLDivElement | null>(null);
  const livePriceValueRef = useRef<HTMLSpanElement | null>(null);
  const livePriceCountdownRef = useRef<HTMLSpanElement | null>(null);
  const livePriceRef = useRef<number | null>(null);
  const livePriceScaleWidthRef = useRef<number | null>(null);
  const livePriceRepaintFrameRef = useRef<number | null>(null);
  const livePriceOverlayColorsRef = useRef<LivePriceOverlayColors>(
    getLivePriceOverlayColors(defaultChartProperties.colors, defaultChartProperties.colors.bullCandle),
  );
  const livePriceColorPaletteRef = useRef<ChartColorPalette>(defaultChartProperties.colors);
  const lastLivePriceDirectionalColorRef = useRef(defaultChartProperties.colors.bullCandle);
  const areaTrendDirectionRef = useRef<AreaTrendDirection | null>(null);
  const useEnterpriseLightPricePaletteRef = useRef(false);

  const hideLivePriceOverlay = useCallback((clearPrice = true) => {
    if (clearPrice) {
      livePriceRef.current = null;
      livePriceScaleWidthRef.current = null;
      // These canvas lines outlive setData([]). Hide the old quote before the
      // broker/account selection clears its candles or paints a new scale.
      for (const lineRef of [askPriceLineRef, lastPriceLineRef]) {
        try {
          lineRef.current?.applyOptions({ lineVisible: false, axisLabelVisible: false });
        } catch { lineRef.current = null; }
      }
    }
    if (livePriceRepaintFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(livePriceRepaintFrameRef.current);
      livePriceRepaintFrameRef.current = null;
    }
    if (livePriceLineRef.current) {
      livePriceLineRef.current.style.display = 'none';
      livePriceLineRef.current.style.top = '-9999px';
    }
    if (livePriceBadgeRef.current) {
      livePriceBadgeRef.current.style.display = 'none';
      livePriceBadgeRef.current.style.top = '-9999px';
      if (clearPrice && livePriceValueRef.current) livePriceValueRef.current.textContent = '';
    }
    if (livePriceCountdownRef.current) {
      livePriceCountdownRef.current.textContent = '';
      livePriceCountdownRef.current.style.display = 'none';
    }
  }, [askPriceLineRef, lastPriceLineRef]);

  const syncSupplementalPriceLines = useCallback((askPrice: number, lastPrice: number) => {
    if (!canPaintLivePrice()) return;
    const series = seriesRef.current;
    if (!series) return;

    const settings = chartSettingsRef.current;
    const syncLine = (
      lineRef: MutableRefObject<IPriceLine | null>,
      visible: boolean,
      price: number,
      color: string,
      title: string,
    ) => {
      if (!visible || !Number.isFinite(price) || price <= 0) {
        try {
          lineRef.current?.applyOptions({ lineVisible: false, axisLabelVisible: false });
        } catch {
          lineRef.current = null;
        }
        return;
      }

      const options = {
        price,
        color,
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
        title,
      };

      try {
        if (!lineRef.current) {
          lineRef.current = series.createPriceLine(options);
        } else {
          lineRef.current.applyOptions(options);
        }
      } catch {
        lineRef.current = null;
      }
    };

    syncLine(
      askPriceLineRef,
      settings.showAskPriceLine,
      askPrice,
      settings.colors.askPriceLine,
      'ASK',
    );
    syncLine(
      lastPriceLineRef,
      settings.showLastPriceLine,
      lastPrice,
      settings.colors.lastPriceLine,
      'LAST',
    );
  }, [askPriceLineRef, canPaintLivePrice, chartSettingsRef, lastPriceLineRef, seriesRef]);

  const getLivePriceDirectionalColor = useCallback((
    activeCandleTime?: number,
    nextClose?: number,
  ): string => {
    const colors = livePriceColorPaletteRef.current;
    if (
      chartSettingsRef.current.colorScheme === 'Green and White'
      || chartSettingsRef.current.colorScheme === 'Green and Blue'
    ) {
      // Reference presets with lime outlines use the configured slate bid line.
      return colors.bidPriceLine;
    }
    if (chartType === 'area') {
      const color = getLivePriceSeriesColor(colors, chartType, areaTrendDirectionRef.current ?? 'up');
      lastLivePriceDirectionalColorRef.current = color;
      return color;
    }
    const currentCandle = currentCandleRef.current;
    const fallback = lastLivePriceDirectionalColorRef.current
      || getLivePriceSeriesColor(colors, chartType, 'up');
    if (!currentCandle || !Number.isFinite(currentCandle.open)) return fallback;
    if (activeCandleTime !== undefined && currentCandle.time !== activeCandleTime) return fallback;
    const close = nextClose ?? currentCandle.close;
    if (!Number.isFinite(close)) return fallback;

    const color = getLivePriceSeriesColor(
      colors,
      chartType,
      close >= currentCandle.open ? 'up' : 'down',
    );
    lastLivePriceDirectionalColorRef.current = color;
    return color;
  }, [chartSettingsRef, chartType, currentCandleRef]);

  const applyLivePriceHorizontalGeometry = useCallback((measuredScaleWidth: number) => {
    const resolvedWidth = resolveLivePriceScaleWidth(
      measuredScaleWidth,
      livePriceScaleWidthRef.current,
    );
    livePriceScaleWidthRef.current = resolvedWidth;

    const right = `${resolvedWidth}px`;
    const line = livePriceLineRef.current;
    const badge = livePriceBadgeRef.current;
    if (line && line.style.right !== right) line.style.right = right;
    if (badge && badge.style.width !== right) badge.style.width = right;
  }, []);

  const paintLivePriceOverlay = useCallback((
    livePrice: number,
    y: number,
    priceScaleWidth: number,
    activeCandleTime?: number,
    directionClose?: number,
  ) => {
    const line = livePriceLineRef.current;
    const badge = livePriceBadgeRef.current;
    if (!line || !badge) return;

    const digits = resolvedPriceDigitsRef.current;
    const overlayColors = getLivePriceOverlayColors(
      livePriceColorPaletteRef.current,
      getLivePriceDirectionalColor(activeCandleTime, directionClose),
      useEnterpriseLightPricePaletteRef.current,
    );
    livePriceOverlayColorsRef.current = overlayColors;

    line.style.top = `${y}px`;
    applyLivePriceHorizontalGeometry(priceScaleWidth);
    line.style.borderTopColor = overlayColors.lineColor;
    line.style.display = 'block';

    badge.style.top = `${y}px`;
    badge.style.background = overlayColors.badgeBackground;
    badge.style.color = overlayColors.badgeTextColor;
    if (livePriceValueRef.current) {
      livePriceValueRef.current.textContent = formatChartAxisPrice(livePrice, digits);
    }
    badge.style.display = 'block';
  }, [applyLivePriceHorizontalGeometry, getLivePriceDirectionalColor, resolvedPriceDigitsRef]);

  const repaintLivePriceOverlayFromCurrentPrice = useCallback((activeCandle: Candle) => {
    if (!canPaintLivePrice()) return;
    if (!chartSettingsRef.current.showBidPriceLine) {
      hideLivePriceOverlay(false);
      return;
    }
    // Candles are raw market Bid OHLC. The line and scale badge must meet the
    // same Close; account spread markup belongs to the trading quote controls.
    const livePrice = Number(activeCandle.close);
    if (
      !Number.isFinite(livePrice)
      || !livePriceLineRef.current
      || !livePriceBadgeRef.current
      || !seriesRef.current
    ) return;

    const paint = () => {
      if (
        isDisposedRef.current
        || !canPaintLivePrice()
        || !livePriceLineRef.current
        || !livePriceBadgeRef.current
        || !seriesRef.current
      ) return;

      livePriceRef.current = livePrice;
      const y = seriesRef.current.priceToCoordinate(livePrice);
      if (y === null || y === undefined) {
        hideLivePriceOverlay(false);
        return;
      }

      const scaleWidth = seriesRef.current.priceScale().width();
      paintLivePriceOverlay(livePrice, y, scaleWidth, activeCandle.time, activeCandle.close);
    };

    paint();

    if (typeof window !== 'undefined') {
      if (livePriceRepaintFrameRef.current !== null) {
        window.cancelAnimationFrame(livePriceRepaintFrameRef.current);
      }
      livePriceRepaintFrameRef.current = window.requestAnimationFrame(() => {
        livePriceRepaintFrameRef.current = null;
        paint();
      });
    }
  }, [
    canPaintLivePrice,
    chartSettingsRef,
    hideLivePriceOverlay,
    isDisposedRef,
    paintLivePriceOverlay,
    resolvedPriceDigitsRef,
    seriesRef,
  ]);

  return {
    applyLivePriceHorizontalGeometry,
    areaTrendDirectionRef,
    getLivePriceDirectionalColor,
    hideLivePriceOverlay,
    lastLivePriceDirectionalColorRef,
    livePriceBadgeRef,
    livePriceColorPaletteRef,
    livePriceCountdownRef,
    livePriceLineRef,
    livePriceOverlayColorsRef,
    livePriceRef,
    livePriceValueRef,
    repaintLivePriceOverlayFromCurrentPrice,
    syncSupplementalPriceLines,
    useEnterpriseLightPricePaletteRef,
  };
}

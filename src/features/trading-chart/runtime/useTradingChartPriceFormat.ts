import { useEffect, type RefObject } from 'react';
import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import { buildChartSeriesPriceFormat } from '../../../utils/chartPriceScale';

interface PriceFormatOptions {
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  squareGridHostSeriesRef: RefObject<ISeriesApi<'Line'> | null>;
  isDisposedRef: RefObject<boolean>;
  digits: number | null;
  point: number;
}

/** Keep the axis-owning grid host and the visible instrument equally precise. */
export function useTradingChartPriceFormat({
  seriesRef, squareGridHostSeriesRef, isDisposedRef, digits, point,
}: PriceFormatOptions): void {
  useEffect(() => {
    if (isDisposedRef.current) return;
    const priceFormat = buildChartSeriesPriceFormat(digits, point);
    try {
      squareGridHostSeriesRef.current?.applyOptions({ priceFormat });
      seriesRef.current?.applyOptions({ priceFormat });
    } catch {
      // A fast chart switch can dispose either source before this effect runs.
    }
  }, [seriesRef, squareGridHostSeriesRef, isDisposedRef, digits, point]);
}

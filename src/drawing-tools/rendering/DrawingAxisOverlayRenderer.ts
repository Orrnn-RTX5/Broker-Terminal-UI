import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type {
  Drawing,
  DrawingPoint,
  DrawingSeriesDataPoint,
} from '../model/drawing';
import { getForecastingMeasurementTool } from '../forecastingMeasurementToolCatalog';
import {
  buildVolumeProfile,
  selectBarsInTimeRange,
} from '../forecastingMeasurementRenderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const DRAWING_AXIS_OVERLAY_ATTRIBUTE = 'data-axis-overlay';

type ScreenPoint = { x: number; y: number };
type PositionDefaults = Pick<
  Drawing,
  'positionTargetPrice' | 'positionStopPrice' | 'positionEndTime' | 'positionEndLogicalIndex'
>;

interface PriceFormattingSeries {
  options?: () => {
    priceFormat?: { precision?: number; minMove?: number };
  };
  priceFormatter?: () => { format: (value: number) => string };
}

export interface DrawingAxisOverlayRendererOptions {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getOverlayContainer: () => HTMLElement | null;
  projectPoint: (point: DrawingPoint) => ScreenPoint | null;
  resolvePositionDefaults: (drawing: Drawing) => PositionDefaults;
  getSeriesData: () => DrawingSeriesDataPoint[];
}

const svgText = (
  x: number,
  y: number,
  text: string,
  fill: string,
  size: number,
): SVGTextElement => {
  const element = document.createElementNS(SVG_NS, 'text');
  element.setAttribute('x', String(x));
  element.setAttribute('y', String(y));
  element.setAttribute('fill', fill);
  element.setAttribute('font-size', String(size));
  element.setAttribute('font-family', 'monospace, sans-serif');
  element.setAttribute('pointer-events', 'none');
  element.textContent = text;
  return element;
};

export class DrawingAxisOverlayRenderer {
  constructor(private readonly options: DrawingAxisOverlayRendererOptions) {}

  getSeriesPriceFormat(): { precision: number; minMove: number } {
    const series = this.options.getSeries() as unknown as PriceFormattingSeries | null;
    const format = series?.options?.()?.priceFormat;
    const explicitPrecision = Number(format?.precision);
    const explicitMinMove = Number(format?.minMove);
    const minMove = Number.isFinite(explicitMinMove) && explicitMinMove > 0
      ? explicitMinMove
      : 1;
    const derivedPrecision = minMove >= 1
      ? 0
      : Math.min(12, Math.max(0, Math.ceil(-Math.log10(minMove) - 1e-10)));
    const precision = Number.isFinite(explicitPrecision)
      ? Math.min(12, Math.max(0, Math.trunc(explicitPrecision)))
      : derivedPrecision;
    return { precision, minMove };
  }

  formatPrice(value: number): string {
    const { precision } = this.getSeriesPriceFormat();
    try {
      const series = this.options.getSeries() as unknown as PriceFormattingSeries | null;
      const formatter = series?.priceFormatter?.();
      if (formatter?.format) return formatter.format(value);
    } catch {
      // A disposed chart can lose its formatter before the final overlay frame.
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  formatTimeScaleValue(timestampSeconds: number): string {
    const date = new Date(timestampSeconds * 1000);
    if (Number.isNaN(date.getTime())) return '';
    try {
      const formatter = this.options.getChart()?.options?.().localization?.timeFormatter;
      if (typeof formatter === 'function') {
        const formatted = formatter(timestampSeconds as Time);
        if (formatted) return formatted;
      }
    } catch {
      // Detached charts retain the same UTC fallback used by chart ticks.
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find(part => part.type === type)?.value ?? '';
    const weekday = value('weekday');
    const day = value('day');
    const month = value('month');
    const year = value('year');
    const hour = value('hour');
    const minute = value('minute');
    if (![weekday, day, month, year, hour, minute].every(Boolean)) return '';
    return `${weekday} ${day} ${month} '${year} ${hour}:${minute}`;
  }

  getThemeToken(name: string, fallback: string): string {
    const host = this.options.getOverlayContainer() || document.documentElement;
    const value = window.getComputedStyle(host).getPropertyValue(name).trim()
      || window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  /** Annotation axis feedback follows anchors independently of text box size. */
  appendAnnotationScaleHighlights(
    group: SVGGElement,
    drawing: Drawing,
    plotWidth: number,
    plotHeight: number,
    cursorIndex = -1,
  ): void {
    const anchors = drawing.points
      .map((point, index) => ({ point, index, screen: this.options.projectPoint(point) }))
      .filter((entry): entry is typeof entry & { screen: ScreenPoint } => entry.screen !== null);
    this.appendSelectionScaleBands(group, anchors.map(entry => entry.screen), plotWidth, plotHeight);
    anchors.forEach(({ point, index, screen }) => {
      const role = index === cursorIndex ? 'annotation-cursor' : `annotation-anchor-${index + 1}`;
      const accent = index === cursorIndex ? '#131722' : '#2962ff';
      if (screen.y >= 0 && screen.y <= plotHeight) {
        this.appendPriceScaleLabel(group, plotWidth, screen.y, point.price, accent, `${role}-price`);
      }
      if (screen.x >= 0 && screen.x <= plotWidth) {
        this.appendTimeScaleLabel(group, screen.x, plotHeight, point.time, accent, `${role}-time`);
      }
    });
  }

  appendSelectionScaleBands(
    group: SVGGElement,
    points: readonly ScreenPoint[],
    plotWidth: number,
    plotHeight: number,
  ): void {
    if (points.length < 2) return;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    this.appendPriceScaleRangeBand(
      group,
      plotWidth,
      Math.min(...ys),
      Math.max(...ys),
      '#2962ff',
      ys.map(y => Number(this.options.getSeries()?.coordinateToPrice(y) ?? 0)),
    );
    this.appendTimeScaleRangeBand(
      group,
      plotWidth,
      plotHeight,
      Math.min(...xs),
      Math.max(...xs),
      '#2962ff',
    );
  }

  appendForecastingScaleHighlights(
    group: SVGGElement,
    drawing: Drawing,
    plotWidth: number,
    plotHeight: number,
    selected: boolean,
  ): void {
    const tool = getForecastingMeasurementTool(drawing.subtype);
    if (!tool || !drawing.points.length || tool.id === 'anchored_vwap') return;
    const isPosition = tool.id === 'long_position' || tool.id === 'short_position';
    const isProfile = tool.id === 'fixed_range_volume_profile' || tool.id === 'anchored_volume_profile';
    const anchors = tool.id === 'ghost_feed' && drawing.points.length > 2
      ? [drawing.points[0], drawing.points[drawing.points.length - 1]]
      : drawing.points;
    let priceValues = tool.id === 'date_range' ? [] : anchors.map(point => point.price);
    let timePoints = tool.id === 'price_range' ? [] : [...anchors];

    if (isPosition) {
      const defaults = this.options.resolvePositionDefaults(drawing);
      priceValues = [defaults.positionStopPrice!, drawing.points[0].price, defaults.positionTargetPrice!];
      timePoints = [drawing.points[0], {
        time: defaults.positionEndTime!,
        price: drawing.points[0].price,
        logicalIndex: defaults.positionEndLogicalIndex,
      }];
    } else if (isProfile) {
      const series = this.options.getSeriesData();
      const start = drawing.points[0];
      const endTime = tool.id === 'anchored_volume_profile'
        ? series.at(-1)?.time
        : drawing.points[1]?.time;
      if (endTime === undefined) return;
      const profile = buildVolumeProfile(selectBarsInTimeRange(series, start.time, endTime));
      if (!profile.length) return;
      priceValues = [profile[0].low, profile[profile.length - 1].high];
      timePoints = [
        start,
        tool.id === 'fixed_range_volume_profile'
          ? drawing.points[1]
          : { time: endTime, price: start.price },
      ];
    }

    const priceScreens = priceValues
      .map(price => {
        const coordinate = this.options.getSeries()?.priceToCoordinate(price);
        return { price, y: coordinate == null ? null : Number(coordinate) };
      })
      .filter((point): point is { price: number; y: number } =>
        typeof point.y === 'number' && Number.isFinite(point.y));
    const times = timePoints
      .map(point => ({ point, screen: this.options.projectPoint(point) }))
      .filter(entry => entry.screen !== null);
    const axis = document.createElementNS(SVG_NS, 'g');
    axis.setAttribute('pointer-events', 'none');
    const color = drawing.color || '#2962ff';
    if (priceScreens.length >= 2) {
      const ys = priceScreens.map(point => point.y);
      this.appendPriceScaleRangeBand(
        axis,
        plotWidth,
        Math.min(...ys),
        Math.max(...ys),
        color,
        priceValues,
      );
    }
    if (times.length >= 2) {
      const xs = times.map(entry => entry.screen!.x);
      this.appendTimeScaleRangeBand(
        axis,
        plotWidth,
        plotHeight,
        Math.min(...xs),
        Math.max(...xs),
        color,
      );
    }
    if (!isPosition && (selected || isProfile)) {
      priceScreens.forEach(({ price, y }, index) => this.appendPriceScaleLabel(
        axis,
        plotWidth,
        y,
        price,
        color,
        `forecast-endpoint-${index + 1}-price-scale-label`,
      ));
    }
    if (selected) {
      times.forEach(({ point, screen }, index) => this.appendTimeScaleLabel(
        axis,
        screen!.x,
        plotHeight,
        point.time,
        color,
        `forecast-endpoint-${index + 1}-time-scale-label`,
      ));
    }
    group.insertBefore(
      axis,
      group.querySelector('[data-geometry-role="position-entry-price-scale-label"]'),
    );
  }

  appendPriceScaleRangeBand(
    group: SVGGElement,
    plotWidth: number,
    topY: number,
    bottomY: number,
    accent: string,
    prices: number[],
    role = 'price-scale-range',
  ): void {
    const height = bottomY - topY;
    if (!(height > 2)) return;
    const scaleWidth = Math.max(42, this.options.getChart()?.priceScale('right').width() ?? 0);
    const width = Math.min(
      scaleWidth,
      Math.max(48, ...prices.map(price => this.formatPrice(price).length * 6.4 + 12)),
    );
    const band = document.createElementNS(SVG_NS, 'rect');
    band.setAttribute('x', String(plotWidth));
    band.setAttribute('y', String(topY));
    band.setAttribute('width', String(width));
    band.setAttribute('height', String(height));
    band.setAttribute('fill', accent);
    band.setAttribute('fill-opacity', '0.35');
    band.setAttribute('data-geometry-role', role);
    band.setAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE, 'true');
    band.setAttribute('pointer-events', 'none');
    group.appendChild(band);
  }

  appendPriceScaleLabel(
    group: SVGGElement,
    plotWidth: number,
    y: number,
    price: number,
    accent: string,
    role = 'price-scale-label',
  ): void {
    const value = this.formatPrice(price);
    const scaleWidth = Math.max(42, this.options.getChart()?.priceScale('right').width() ?? 0);
    const labelWidth = Math.min(scaleWidth, Math.max(48, value.length * 6.4 + 12));
    const labelHeight = 18;
    const top = y - labelHeight / 2;
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', String(plotWidth));
    background.setAttribute('y', String(top));
    background.setAttribute('width', String(labelWidth));
    background.setAttribute('height', String(labelHeight));
    background.setAttribute('rx', '2');
    background.setAttribute('fill', accent);
    background.setAttribute('data-geometry-role', role);
    background.setAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE, 'true');
    background.setAttribute('pointer-events', 'none');
    group.appendChild(background);

    const label = svgText(plotWidth + labelWidth / 2, top + 12.5, value, '#ffffff', 10);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'var(--font-mono), monospace');
    label.setAttribute('data-geometry-role', `${role}-text`);
    label.setAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE, 'true');
    group.appendChild(label);
  }

  appendTimeScaleRangeBand(
    group: SVGGElement,
    plotWidth: number,
    plotHeight: number,
    leftX: number,
    rightX: number,
    accent: string,
    role = 'time-scale-range',
  ): void {
    const left = Math.max(0, Math.min(leftX, rightX));
    const right = Math.min(plotWidth, Math.max(leftX, rightX));
    const width = right - left;
    if (!(width > 2)) return;
    const band = document.createElementNS(SVG_NS, 'rect');
    band.setAttribute('x', String(left));
    band.setAttribute('y', String(plotHeight));
    band.setAttribute('width', String(width));
    band.setAttribute('height', String(this.options.getChart()?.timeScale().height() ?? 18));
    band.setAttribute('fill', accent);
    band.setAttribute('fill-opacity', '0.35');
    band.setAttribute('data-geometry-role', role);
    band.setAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE, 'true');
    band.setAttribute('pointer-events', 'none');
    group.appendChild(band);
  }

  appendTimeScaleLabel(
    group: SVGGElement,
    x: number,
    plotHeight: number,
    timestampSeconds: number,
    accent: string,
    role = 'time-scale-label',
  ): void {
    const value = this.formatTimeScaleValue(timestampSeconds);
    if (!value) return;
    const width = Math.max(76, value.length * 6.2 + 12);
    const containerWidth = this.options.getOverlayContainer()?.clientWidth ?? x + width;
    const left = Math.max(0, Math.min(x - width / 2, Math.max(0, containerWidth - width)));
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', String(left));
    background.setAttribute('y', String(plotHeight));
    background.setAttribute('width', String(width));
    background.setAttribute('height', '18');
    background.setAttribute('rx', '2');
    background.setAttribute('fill', accent);
    background.setAttribute('data-geometry-role', role);
    background.setAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE, 'true');
    background.setAttribute('pointer-events', 'none');
    group.appendChild(background);

    const label = svgText(left + width / 2, plotHeight + 12.5, value, '#ffffff', 10);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'var(--font-mono), monospace');
    label.setAttribute('data-geometry-role', `${role}-text`);
    label.setAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE, 'true');
    group.appendChild(label);
  }
}

export const segmentMidpoint = (segment: {
  start: ScreenPoint;
  end: ScreenPoint;
}): ScreenPoint => ({
  x: (segment.start.x + segment.end.x) / 2,
  y: (segment.start.y + segment.end.y) / 2,
});

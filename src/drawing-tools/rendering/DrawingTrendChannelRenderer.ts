import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { Drawing, DrawingPoint, DrawingSeriesDataPoint } from '../model/drawing';
import { appendInfoLinePanel as renderInfoLinePanel } from '../infoLinePanel';
import {
  clipLineToViewport,
  type ScreenSegment,
} from '../geometry/trendToolGeometry';
import {
  calculateRegressionTrend,
  createChannelGeometry,
  createPitchforkLevels,
  type InfoLineMetricDisplay,
  type PitchforkBand,
  type PitchforkRay,
} from '../geometry/tradingViewTrendGeometry';

type ScreenPoint = { x: number; y: number };

export interface RegressionScreenSegments {
  center: ScreenSegment;
  upper: ScreenSegment;
  lower: ScreenSegment;
  pearsonCorrelation: number | null;
  sampleCount: number;
  startTime: number;
  endTime: number;
}

export interface DrawingTrendChannelRendererOptions {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getPreviewPoint: () => DrawingPoint | null;
  isPreviewCursorVisible: () => boolean;
  getSeriesData: () => DrawingSeriesDataPoint[];
  projectPoint: (point: DrawingPoint) => ScreenPoint | null;
  formatPrice: (price: number) => string;
  getThemeToken: (name: string, fallback: string) => string;
  appendPriceScaleRangeBand: (
    group: SVGGElement,
    plotWidth: number,
    topY: number,
    bottomY: number,
    accent: string,
    prices: number[],
    role?: string,
  ) => void;
  appendPriceScaleLabel: (
    group: SVGGElement,
    plotWidth: number,
    y: number,
    price: number,
    accent: string,
    role?: string,
  ) => void;
  appendTimeScaleLabel: (
    group: SVGGElement,
    x: number,
    plotHeight: number,
    timestampSeconds: number,
    accent: string,
    role?: string,
  ) => void;
  createLine: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    lineWidth: number,
    dash?: string,
  ) => SVGLineElement;
  createText: (
    x: number,
    y: number,
    text: string,
    fill: string,
    size: number,
  ) => SVGTextElement;
  beginDrag: (event: PointerEvent, drawingId: string, nodeIndex: number | null) => void;
  openContextMenu: (event: MouseEvent, drawingId: string) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class DrawingTrendChannelRenderer {
  constructor(private readonly options: DrawingTrendChannelRendererOptions) {}

  /** Share the same projected corners between the fill, handles and axis values. */
  getTrendChannelGeometry(
    drawing: Drawing,
    useStoredOffset: boolean,
  ): ReturnType<typeof createChannelGeometry> {
    const subtype = drawing.subtype;
    if (subtype !== 'parallel_channel' && subtype !== 'flat_top_bottom' && subtype !== 'disjoint_channel') {
      return null;
    }
    const first = drawing.points[0] && this.options.projectPoint(drawing.points[0]);
    const second = drawing.points[1] && this.options.projectPoint(drawing.points[1]);
    let third = drawing.points[2] && this.options.projectPoint(drawing.points[2]);
    if (!first || !second || !third) return null;
    if (subtype === 'parallel_channel' && useStoredOffset && Number.isFinite(drawing.channelOffset)) {
      const offsetY = this.options.getSeries()?.priceToCoordinate(
        drawing.points[0].price + drawing.channelOffset!,
      );
      if (offsetY !== null && offsetY !== undefined) third = { x: first.x, y: offsetY };
    }
    return createChannelGeometry(subtype, first, second, third, {
      midpointRatio: drawing.channelMidpointRatio,
    });
  }

  appendChannelScaleLabels(
    group: SVGGElement,
    drawing: Drawing,
    plotWidth: number,
    plotHeight: number,
    isPreview: boolean,
  ): void {
    const cursor = isPreview && this.options.isPreviewCursorVisible()
      ? this.options.getPreviewPoint()
      : null;
    const points = cursor ? [...drawing.points, cursor] : drawing.points;
    const color = drawing.color || '#2962ff';
    const prices: { y: number; price: number; accent: string; role: string }[] = [];
    const times: { x: number; time: number; accent: string; role: string }[] = [];
    const addPrice = (point: { y: number }, role: string, accent = color, value?: number) => {
      const price = value ?? this.options.getSeries()?.coordinateToPrice(point.y);
      if (
        price === null
        || price === undefined
        || !Number.isFinite(price)
        || point.y < 0
        || point.y > plotHeight
      ) return;
      const duplicate = prices.findIndex(entry =>
        this.options.formatPrice(entry.price) === this.options.formatPrice(price));
      if (duplicate >= 0) prices.splice(duplicate, 1);
      prices.push({ y: point.y, price, accent, role });
    };
    const addTime = (x: number, time: number, role: string, accent = color) => {
      if (x < 0 || x > plotWidth || !Number.isFinite(x)) return;
      const duplicate = times.findIndex(entry => entry.time === time);
      if (duplicate >= 0) times.splice(duplicate, 1);
      times.push({ x, time, accent, role });
    };
    const regression = !isPreview && drawing.subtype === 'regression_trend'
      ? this.getRegressionSegments(drawing)
      : null;
    const channel = this.getTrendChannelGeometry({ ...drawing, points }, !isPreview);
    if (regression) {
      addPrice(regression.center.start, 'regression-start');
      addPrice(regression.center.end, 'regression-end');
      addTime(regression.center.start.x, regression.startTime, 'range-start');
      addTime(regression.center.end.x, regression.endTime, 'range-end');
    } else if (!isPreview || drawing.points.length > 0) {
      if (channel) {
        addPrice(channel.baseline.start, 'baseline-start');
        addPrice(channel.baseline.end, 'baseline-end');
        addPrice(channel.boundary.start, 'boundary-start');
        addPrice(channel.boundary.end, 'boundary-end');
      }
      points.slice(0, 2).forEach((point, index) => {
        const screen = this.options.projectPoint(point);
        if (!screen) return;
        if (!channel) addPrice(screen, `anchor-${index + 1}`, color, point.price);
        addTime(screen.x, point.time, `anchor-${index + 1}`);
      });
    }
    if (cursor) {
      const screen = this.options.projectPoint(cursor);
      if (screen) {
        addPrice(screen, 'cursor', '#131722', cursor.price);
        addTime(screen.x, cursor.time, 'cursor', '#131722');
      }
    }

    const ordered = [...prices].sort((a, b) => a.y - b.y);
    const spacing = Math.min(
      18,
      Math.max(0, (plotHeight - 18) / Math.max(1, ordered.length - 1)),
    );
    ordered.forEach((entry, index) => {
      entry.y = Math.max(9, entry.y, index > 0 ? ordered[index - 1].y + spacing : 9);
    });
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      ordered[index].y = Math.min(
        ordered[index].y,
        index === ordered.length - 1 ? plotHeight - 9 : ordered[index + 1].y - spacing,
      );
    }
    const baselineEnd = prices.find(entry => entry.role === 'baseline-end');
    const boundaryEnd = prices.find(entry => entry.role === 'boundary-end');
    const regressionStart = prices.find(entry => entry.role === 'regression-start');
    const regressionEnd = prices.find(entry => entry.role === 'regression-end');
    const pair = baselineEnd && boundaryEnd
      ? [baselineEnd, boundaryEnd]
      : regressionStart && regressionEnd
        ? [regressionStart, regressionEnd]
        : null;
    const bandEntries = pair ?? prices.filter(entry => entry.role !== 'cursor');
    if (bandEntries.length >= 2) {
      const bandYs = bandEntries.map(entry => entry.y);
      this.options.appendPriceScaleRangeBand(
        group,
        plotWidth,
        Math.min(...bandYs),
        Math.max(...bandYs),
        color,
        bandEntries.map(entry => entry.price),
      );
    }
    prices.forEach(entry => this.options.appendPriceScaleLabel(
      group,
      plotWidth,
      entry.y,
      entry.price,
      entry.accent,
      `${entry.role}-price-scale-label`,
    ));
    times.forEach(entry => this.options.appendTimeScaleLabel(
      group,
      entry.x,
      plotHeight,
      entry.time,
      entry.accent,
      `${entry.role}-time-scale-label`,
    ));
  }

  appendDrawingAddTextPrompt(
    group: SVGGElement,
    x: number,
    y: number,
    accent: string,
    rotation = 0,
  ): void {
    const label = this.options.createText(x, y, '+ Add text', accent, 10);
    label.setAttribute('font-family', 'var(--font-sans), sans-serif');
    label.setAttribute('font-weight', '600');
    label.setAttribute('data-geometry-role', 'drawing-add-text-prompt');
    if (rotation !== 0) label.setAttribute('transform', `rotate(${rotation} ${x} ${y})`);
    group.appendChild(label);
  }

  appendTrendSelectionHandle(
    group: SVGGElement,
    drawing: Drawing,
    point: ScreenPoint,
    nodeIndex: number | null,
    role: string,
    shape: 'circle' | 'square' = 'circle',
  ): void {
    const handle = shape === 'circle'
      ? document.createElementNS(SVG_NS, 'circle')
      : document.createElementNS(SVG_NS, 'rect');
    if (shape === 'circle') {
      handle.setAttribute('cx', String(point.x));
      handle.setAttribute('cy', String(point.y));
      handle.setAttribute('r', '5');
    } else {
      handle.setAttribute('x', String(point.x - 5));
      handle.setAttribute('y', String(point.y - 5));
      handle.setAttribute('width', '10');
      handle.setAttribute('height', '10');
      handle.setAttribute('rx', '1');
    }
    handle.setAttribute('fill', this.options.getThemeToken('--bg-primary', '#0d0d11'));
    handle.setAttribute(
      'stroke',
      drawing.color || this.options.getThemeToken('--drawing-tool-accent', '#2962ff'),
    );
    handle.setAttribute('stroke-width', '2');
    handle.setAttribute('data-geometry-role', role);
    handle.setAttribute('pointer-events', 'all');
    handle.style.cursor = nodeIndex === null ? 'move' : 'crosshair';
    handle.addEventListener('pointerdown', event =>
      this.options.beginDrag(event as PointerEvent, drawing.id, nodeIndex));
    handle.addEventListener('contextmenu', event =>
      this.options.openContextMenu(event as MouseEvent, drawing.id));
    group.appendChild(handle);
  }

  appendInfoLinePanel(
    group: SVGGElement,
    start: ScreenPoint,
    end: ScreenPoint,
    display: InfoLineMetricDisplay,
    plotWidth: number,
    plotHeight: number,
    drawing: Drawing,
    isPreview: boolean,
  ): void {
    const background = renderInfoLinePanel(
      group,
      start,
      end,
      display,
      plotWidth,
      plotHeight,
      {
        background: this.options.getThemeToken('--bg-elevated', '#2a2a30'),
        text: this.options.getThemeToken('--text-primary', '#f5f7fb'),
      },
    );
    if (isPreview || drawing.locked) return;
    background.setAttribute('pointer-events', 'all');
    background.style.cursor = 'move';
    background.addEventListener('pointerdown', event =>
      this.options.beginDrag(event, drawing.id, null));
    background.addEventListener('contextmenu', event =>
      this.options.openContextMenu(event, drawing.id));
  }

  private appendInteractiveSegment(
    group: SVGGElement,
    drawing: Drawing,
    segment: ScreenSegment,
    color: string,
    lineWidth: number,
    dash: string,
    opacity: string,
    isPreview: boolean,
    cursor = 'move',
    role?: string,
  ): void {
    const line = this.options.createLine(
      segment.start.x,
      segment.start.y,
      segment.end.x,
      segment.end.y,
      color,
      lineWidth,
      dash,
    );
    line.style.opacity = opacity;
    if (role) line.setAttribute('data-geometry-role', role);
    group.appendChild(line);

    if (isPreview) return;
    const hit = this.options.createLine(
      segment.start.x,
      segment.start.y,
      segment.end.x,
      segment.end.y,
      'transparent',
      14,
      'none',
    );
    hit.setAttribute('pointer-events', 'stroke');
    if (role) hit.setAttribute('data-geometry-role', `${role}-hit`);
    hit.style.cursor = cursor;
    hit.addEventListener('pointerdown', event =>
      this.options.beginDrag(event, drawing.id, null));
    hit.addEventListener('contextmenu', event =>
      this.options.openContextMenu(event, drawing.id));
    group.appendChild(hit);
  }

  private appendChannelFill(
    group: SVGGElement,
    first: ScreenSegment,
    second: ScreenSegment,
    color: string,
    opacity: string,
  ): SVGPolygonElement {
    const fill = document.createElementNS(SVG_NS, 'polygon');
    fill.setAttribute(
      'points',
      `${first.start.x},${first.start.y} ${first.end.x},${first.end.y} ${second.end.x},${second.end.y} ${second.start.x},${second.start.y}`,
    );
    fill.setAttribute('fill', color);
    fill.setAttribute('fill-opacity', '0.075');
    fill.style.opacity = opacity;
    fill.setAttribute('pointer-events', 'none');
    group.appendChild(fill);
    return fill;
  }

  private makeChannelFillInteractive(
    fill: SVGPolygonElement,
    drawing: Drawing,
    isPreview: boolean,
    role = 'channel-fill',
  ): void {
    fill.setAttribute('data-geometry-role', role);
    if (isPreview) return;
    fill.setAttribute('pointer-events', 'all');
    fill.style.cursor = 'move';
    fill.addEventListener('pointerdown', event =>
      this.options.beginDrag(event, drawing.id, null));
    fill.addEventListener('contextmenu', event =>
      this.options.openContextMenu(event, drawing.id));
  }

  private appendInteractivePolygon(
    group: SVGGElement,
    drawing: Drawing,
    points: readonly ScreenPoint[],
    color: string,
    fillOpacity: number,
    opacity: string,
    isPreview: boolean,
    role: string,
  ): SVGPolygonElement {
    const fill = document.createElementNS(SVG_NS, 'polygon');
    fill.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
    fill.setAttribute('fill', color);
    fill.setAttribute('fill-opacity', String(fillOpacity));
    fill.style.opacity = opacity;
    group.appendChild(fill);
    this.makeChannelFillInteractive(fill, drawing, isPreview, role);
    return fill;
  }

  renderTrendChannelVariant(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    color: string,
    lineWidth: number,
    dash: string,
    opacity: string,
    isPreview: boolean,
  ): boolean {
    const subtype = drawing.subtype;
    const supported = [
      'parallel_channel',
      'regression_trend',
      'flat_top_bottom',
      'disjoint_channel',
      'pitchfork',
      'schiff_pitchfork',
      'modified_schiff_pitchfork',
      'inside_pitchfork',
    ];
    if (!subtype || !supported.includes(subtype)) return false;

    const chart = this.options.getChart();
    const plotWidth = Math.max(0, width - (chart?.priceScale('right').width() ?? 0));
    const plotHeight = Math.max(0, height - (chart?.timeScale().height() ?? 0));
    const screenPoints = drawing.points.map(point => this.options.projectPoint(point));
    const first = screenPoints[0];
    const second = screenPoints[1];
    const third = screenPoints[2];
    if (!first) return true;

    if (subtype === 'regression_trend') {
      if (!second) return true;
      if (isPreview) {
        this.appendInteractiveSegment(
          group,
          drawing,
          { start: first, end: second },
          color,
          lineWidth,
          dash,
          opacity,
          true,
        );
        const handle = document.createElementNS(SVG_NS, 'circle');
        handle.setAttribute('cx', String(second.x));
        handle.setAttribute('cy', String(second.y));
        handle.setAttribute('r', '5');
        handle.setAttribute('fill', this.options.getThemeToken('--bg-primary', '#0d0d11'));
        handle.setAttribute('stroke', color);
        handle.setAttribute('stroke-width', '2');
        handle.setAttribute('data-geometry-role', 'regression-preview-anchor');
        handle.setAttribute('pointer-events', 'none');
        group.appendChild(handle);
        return true;
      }
      const regression = this.getRegressionSegments(drawing);
      if (!regression) return true;
      const lossColor = this.options.getThemeToken('--color-loss', '#ff4d4f');
      this.appendInteractivePolygon(
        group,
        drawing,
        [regression.upper.start, regression.upper.end, regression.center.end, regression.center.start],
        color,
        0.18,
        opacity,
        isPreview,
        'regression-upper-fill',
      );
      this.appendInteractivePolygon(
        group,
        drawing,
        [regression.center.start, regression.center.end, regression.lower.end, regression.lower.start],
        lossColor,
        0.2,
        opacity,
        isPreview,
        'regression-lower-fill',
      );
      this.appendInteractiveSegment(
        group, drawing, regression.upper, color, lineWidth, dash, opacity, isPreview, 'move',
        'regression-upper',
      );
      this.appendInteractiveSegment(
        group, drawing, regression.lower, color, lineWidth, dash, opacity, isPreview, 'move',
        'regression-lower',
      );
      this.appendInteractiveSegment(
        group,
        drawing,
        regression.center,
        lossColor,
        Math.max(1, lineWidth - 1),
        '5 4',
        opacity,
        isPreview,
        'move',
        'regression-center',
      );
      if (drawing.showRegressionPearson !== false && regression.pearsonCorrelation !== null) {
        const pearson = this.options.createText(
          regression.center.start.x + 4,
          Math.max(regression.upper.start.y, regression.lower.start.y) + 18,
          `Pearson's R = ${regression.pearsonCorrelation.toFixed(6)}`,
          color,
          10,
        );
        pearson.setAttribute('font-family', 'var(--font-mono), monospace');
        pearson.setAttribute('data-geometry-role', 'regression-pearson');
        group.appendChild(pearson);
      }
      return true;
    }

    if (!second) return true;
    const baseline = clipLineToViewport(first, second, plotWidth, plotHeight, 'segment')
      ?? { start: first, end: second };
    if (!third) {
      this.appendInteractiveSegment(
        group, drawing, baseline, color, lineWidth, dash, opacity, isPreview,
      );
      return true;
    }

    if (
      subtype === 'parallel_channel'
      || subtype === 'flat_top_bottom'
      || subtype === 'disjoint_channel'
    ) {
      const channel = this.getTrendChannelGeometry(drawing, !isPreview);
      if (!channel) return true;
      const channelFill = this.appendChannelFill(
        group,
        channel.baseline,
        channel.boundary,
        color,
        opacity,
      );
      this.makeChannelFillInteractive(channelFill, drawing, isPreview);
      this.appendInteractiveSegment(
        group,
        drawing,
        channel.baseline,
        color,
        lineWidth,
        dash,
        opacity,
        isPreview,
        'move',
        'channel-baseline',
      );
      this.appendInteractiveSegment(
        group,
        drawing,
        channel.boundary,
        color,
        lineWidth,
        dash,
        opacity,
        isPreview,
        'move',
        'channel-boundary',
      );
      if (subtype === 'parallel_channel') {
        this.appendInteractiveSegment(
          group,
          drawing,
          channel.midpoint,
          color,
          1,
          '4 4',
          opacity,
          isPreview,
          'move',
          'channel-middle-level',
        );
      }
      return true;
    }

    const pitchfork = createPitchforkLevels(
      first,
      second,
      third,
      plotWidth,
      plotHeight,
      subtype as 'pitchfork' | 'schiff_pitchfork' | 'modified_schiff_pitchfork' | 'inside_pitchfork',
      drawing.pitchforkLevels,
    );
    if (!pitchfork) return true;

    const lossColor = this.options.getThemeToken('--color-loss', '#ff4d4f');
    const profitColor = this.options.getThemeToken('--color-profit', '#00c896');
    pitchfork.bands.forEach((band: PitchforkBand) => {
      const bandColor = band.outerRatio <= 0.5 ? profitColor : color;
      this.appendInteractivePolygon(
        group,
        drawing,
        band.polygon,
        bandColor,
        0.105,
        opacity,
        isPreview,
        `${band.role}-${band.innerRatio}-${band.outerRatio}`,
      );
    });

    const constructionSegments: ScreenSegment[] = subtype === 'pitchfork'
      ? [{ start: second, end: third }]
      : [{ start: first, end: second }, { start: second, end: third }];
    constructionSegments.forEach((segment, index) => {
      const construction = this.options.createLine(
        segment.start.x,
        segment.start.y,
        segment.end.x,
        segment.end.y,
        lossColor,
        1,
        'none',
      );
      construction.setAttribute('data-geometry-role', `pitchfork-construction-${index + 1}`);
      construction.style.opacity = isPreview ? '0.45' : '0.75';
      group.appendChild(construction);
    });

    pitchfork.rays.forEach((ray: PitchforkRay) => {
      const isMedian = ray.role === 'median';
      const rayColor = isMedian ? lossColor : ray.ratio <= 0.5 ? profitColor : color;
      this.appendInteractiveSegment(
        group,
        drawing,
        ray.segment,
        rayColor,
        isMedian ? Math.max(1, lineWidth - 1) : lineWidth,
        isMedian ? 'none' : dash,
        opacity,
        isPreview,
        'move',
        `pitchfork-${ray.role}-${ray.ratio}`,
      );
    });
    return true;
  }

  getRegressionSegments(drawing: Drawing): RegressionScreenSegments | null {
    if (drawing.points.length < 2) return null;
    const anchorA = this.options.projectPoint(drawing.points[0]);
    const anchorB = this.options.projectPoint(drawing.points[1]);
    if (!anchorA || !anchorB) return null;

    const minTime = Math.min(drawing.points[0].time, drawing.points[1].time);
    const maxTime = Math.max(drawing.points[0].time, drawing.points[1].time);
    const source = drawing.regressionSource ?? 'close';
    const selectedSamples = this.options.getSeriesData()
      .map(item => {
        const time = typeof item?.time === 'number' ? item.time : Number.NaN;
        let value = Number.NaN;
        if (source === 'hl2') {
          value = typeof item?.high === 'number' && typeof item?.low === 'number'
            ? (item.high + item.low) / 2
            : Number.NaN;
        } else if (typeof item?.[source] === 'number') {
          value = item[source];
        } else if (typeof item?.value === 'number') {
          value = item.value;
        }
        return { time, value };
      })
      .filter(item =>
        Number.isFinite(item.time)
        && Number.isFinite(item.value)
        && item.time >= minTime
        && item.time <= maxTime)
      .sort((a, b) => a.time - b.time);
    if (selectedSamples.length < 2) return null;

    const calculated = calculateRegressionTrend(
      selectedSamples.map((sample, index) => ({ x: index, value: sample.value })),
      {
        upperDeviationMultiplier: drawing.regressionUpperDeviation ?? 2,
        lowerDeviationMultiplier: drawing.regressionLowerDeviation ?? 2,
      },
    );
    if (!calculated) return null;

    const chart = this.options.getChart();
    const series = this.options.getSeries();
    if (!chart || !series) return null;
    const startX = chart.timeScale().timeToCoordinate(selectedSamples[0].time as Time) ?? anchorA.x;
    const endX = chart.timeScale().timeToCoordinate(
      selectedSamples[selectedSamples.length - 1].time as Time,
    ) ?? anchorB.x;
    const startY = series.priceToCoordinate(calculated.center.start.value);
    const endY = series.priceToCoordinate(calculated.center.end.value);
    const upperStartY = series.priceToCoordinate(calculated.upper.start.value);
    const upperEndY = series.priceToCoordinate(calculated.upper.end.value);
    const lowerStartY = series.priceToCoordinate(calculated.lower.start.value);
    const lowerEndY = series.priceToCoordinate(calculated.lower.end.value);
    if ([startY, endY, upperStartY, upperEndY, lowerStartY, lowerEndY].some(value => value === null)) {
      return null;
    }

    return {
      center: { start: { x: startX, y: startY! }, end: { x: endX, y: endY! } },
      upper: { start: { x: startX, y: upperStartY! }, end: { x: endX, y: upperEndY! } },
      lower: { start: { x: startX, y: lowerStartY! }, end: { x: endX, y: lowerEndY! } },
      pearsonCorrelation: calculated.pearsonCorrelation,
      sampleCount: calculated.sampleCount,
      startTime: selectedSamples[0].time,
      endTime: selectedSamples[selectedSamples.length - 1].time,
    };
  }
}

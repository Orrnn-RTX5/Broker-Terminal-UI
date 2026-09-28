import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { getAnnotationTool } from '../annotationToolCatalog';
import { ellipseGeometry, rectangleHandles, rotatedRectangle } from '../brushShapeGeometry';
import { getBrushShapeTool } from '../brushShapeToolCatalog';
import { getChartPatternTool } from '../chartPatternToolCatalog';
import { projectFreehandPoint } from '../geometry/freehandGeometry';
import {
  getGannFibonacciTool,
  type GannFibonacciToolDefinition,
} from '../gannFibonacciToolCatalog';
import type { Drawing, DrawingPoint } from '../model/drawing';
import { isPictographStamp } from '../pictographCatalog';
import {
  getTrendLineToolFromDrawing,
  type TrendLineToolDefinition,
} from '../toolCatalog';
import type { DrawingAxisOverlayRenderer } from './DrawingAxisOverlayRenderer';
import type { DrawingTrendChannelRenderer } from './DrawingTrendChannelRenderer';

type ScreenPoint = { x: number; y: number };

export interface DrawingSelectionRendererOptions {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  projectPoint: (point: DrawingPoint) => ScreenPoint | null;
  shapeAnchorScreen: (drawing: Drawing, index: number) => ScreenPoint | null;
  shapeLabelTime: (point: DrawingPoint, x: number) => number;
  beginDrag: (event: PointerEvent, drawingId: string, nodeIndex: number | null) => void;
  appendAnnotationScaleHighlights: DrawingAxisOverlayRenderer['appendAnnotationScaleHighlights'];
  appendSelectionScaleBands: DrawingAxisOverlayRenderer['appendSelectionScaleBands'];
  appendPriceScaleRangeBand: DrawingAxisOverlayRenderer['appendPriceScaleRangeBand'];
  appendPriceScaleLabel: DrawingAxisOverlayRenderer['appendPriceScaleLabel'];
  appendTimeScaleRangeBand: DrawingAxisOverlayRenderer['appendTimeScaleRangeBand'];
  appendTimeScaleLabel: DrawingAxisOverlayRenderer['appendTimeScaleLabel'];
  appendChannelScaleLabels: DrawingTrendChannelRenderer['appendChannelScaleLabels'];
  appendDrawingAddTextPrompt: DrawingTrendChannelRenderer['appendDrawingAddTextPrompt'];
  appendTrendSelectionHandle: DrawingTrendChannelRenderer['appendTrendSelectionHandle'];
  getTrendChannelGeometry: DrawingTrendChannelRenderer['getTrendChannelGeometry'];
  getRegressionSegments: DrawingTrendChannelRenderer['getRegressionSegments'];
  segmentMidpoint: (segment: { start: ScreenPoint; end: ScreenPoint }) => ScreenPoint;
}

/** Renders selection-only handles and axis feedback over committed geometry. */
export class DrawingSelectionRenderer {
  constructor(private readonly options: DrawingSelectionRendererOptions) {}

  render(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    isPreview: boolean,
    color: string,
  ): void {
    if (
      !isPreview
      && drawing.selected
      && Array.isArray(drawing.points)
      && drawing.type !== 'channel'
      && !(drawing.type === 'stamp' && isPictographStamp(drawing.subtype))
    ) {
      this.renderStandardSelection(group, drawing, width, height, color);
    }

    if (!isPreview && drawing.selected && drawing.type === 'channel' && drawing.points.length >= 2) {
      this.renderChannelSelection(group, drawing, width, height, color);
    }
  }

  private renderStandardSelection(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    color: string,
  ): void {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    const trendTool = getTrendLineToolFromDrawing(drawing.type, drawing.subtype)
      ?? getGannFibonacciTool(drawing.subtype);

    if (getAnnotationTool(drawing)?.group === 'Text and notes') {
      this.options.appendAnnotationScaleHighlights(
        group,
        drawing,
        Math.max(0, width - (chart?.priceScale('right').width() ?? 0)),
        Math.max(0, height - (chart?.timeScale().height() ?? 0)),
      );
      drawing.points.forEach((point, index) => {
        const screen = this.options.projectPoint(point);
        if (screen) {
          this.options.appendTrendSelectionHandle(
            group,
            { ...drawing, color: '#2962ff' },
            screen,
            index,
            `selection-anchor-${index + 1}`,
            drawing.subtype === 'text' || drawing.subtype === 'signpost' ? 'square' : 'circle',
          );
        }
      });
      return;
    }

    if (drawing.type === 'freehand' && chart && series) {
      const indices = drawing.points.length > 1 ? [0, drawing.points.length - 1] : [0];
      indices.forEach((index, endpoint) => {
        const screen = projectFreehandPoint(chart, series, drawing.points[index]);
        if (screen) {
          this.options.appendTrendSelectionHandle(
            group,
            drawing,
            screen,
            null,
            `brush-endpoint-${endpoint + 1}`,
          );
        }
      });
      return;
    }

    const patternTool = getChartPatternTool(drawing);
    if (patternTool) {
      this.renderPatternSelection(group, drawing, patternTool, width, height, color);
      return;
    }

    if (getBrushShapeTool(drawing)) {
      this.renderBrushShapeSelection(group, drawing, width, height);
      return;
    }

    if (trendTool) {
      this.renderTrendSelection(group, drawing, trendTool, width, height, color);
      return;
    }

    const selectionPoints = drawing.type === 'measure'
      && drawing.subtype === 'ghost_feed'
      && drawing.points.length > 2
      ? [
        { point: drawing.points[0], index: 0 },
        { point: drawing.points[drawing.points.length - 1], index: drawing.points.length - 1 },
      ]
      : drawing.points.map((point, index) => ({ point, index }));
    selectionPoints.forEach(({ point, index }) => {
      this.appendFallbackHandle(group, drawing, point, index);
    });
  }

  private renderPatternSelection(
    group: SVGGElement,
    drawing: Drawing,
    patternTool: NonNullable<ReturnType<typeof getChartPatternTool>>,
    width: number,
    height: number,
    color: string,
  ): void {
    const chart = this.options.getChart();
    const plotWidth = Math.max(0, width - (chart?.priceScale('right').width() ?? 0));
    const plotHeight = Math.max(0, height - (chart?.timeScale().height() ?? 0));
    const screens = drawing.points
      .map(point => this.options.projectPoint(point))
      .filter((screen): screen is ScreenPoint => screen !== null);
    if (patternTool.group === 'Cycles' && screens.length >= 2) {
      const bandXs = screens.map(screen => screen.x);
      this.options.appendTimeScaleRangeBand(
        group,
        plotWidth,
        plotHeight,
        Math.min(...bandXs),
        Math.max(...bandXs),
        color,
      );
    }
    if (patternTool.id !== 'time_cycles') {
      const bandYs = screens.map(screen => screen.y);
      if (bandYs.length >= 2) {
        this.options.appendPriceScaleRangeBand(
          group,
          plotWidth,
          Math.min(...bandYs),
          Math.max(...bandYs),
          color,
          drawing.points.map(point => point.price),
        );
      }
    }
    drawing.points.forEach((point, index) => {
      const screen = this.options.projectPoint(point);
      if (!screen) return;
      this.options.appendTrendSelectionHandle(
        group,
        drawing,
        screen,
        index,
        `pattern-anchor-${index + 1}`,
      );
      this.options.appendPriceScaleLabel(
        group,
        plotWidth,
        screen.y,
        point.price,
        color,
        `pattern-anchor-${index + 1}-price`,
      );
      this.options.appendTimeScaleLabel(
        group,
        screen.x,
        plotHeight,
        point.time,
        color,
        `pattern-anchor-${index + 1}-time`,
      );
    });
  }

  private renderBrushShapeSelection(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
  ): void {
    const chart = this.options.getChart();
    const plotWidth = Math.max(0, width - (chart?.priceScale('right').width() ?? 0));
    const plotHeight = Math.max(0, height - (chart?.timeScale().height() ?? 0));
    this.options.appendSelectionScaleBands(
      group,
      drawing.points
        .map(point => this.options.projectPoint(point))
        .filter((point): point is ScreenPoint => point !== null),
      plotWidth,
      plotHeight,
    );
    if (drawing.subtype === 'rectangle' && drawing.points.length === 2) {
      const first = this.options.projectPoint(drawing.points[0]);
      const second = this.options.projectPoint(drawing.points[1]);
      if (first && second) {
        rectangleHandles(first, second).forEach((handle, index) => {
          this.options.appendTrendSelectionHandle(
            group,
            drawing,
            handle,
            -100 - index,
            `rectangle-handle-${index}`,
            index % 2 ? 'square' : 'circle',
          );
        });
      }
    }
    if (drawing.subtype === 'rotated_rectangle' && drawing.points.length === 3) {
      const [first, second, third] = drawing.points.map(point => this.options.projectPoint(point));
      if (first && second && third) {
        rotatedRectangle(first, second, third).corners.forEach((handle, index) => {
          this.options.appendTrendSelectionHandle(
            group,
            drawing,
            handle,
            -200 - index,
            `rotated-rectangle-width-${index}`,
          );
        });
      }
    }
    if (drawing.subtype === 'ellipse' && drawing.points.length === 3) {
      const [first, second, third] = drawing.points.map(point => this.options.projectPoint(point));
      if (first && second && third) {
        ellipseGeometry(first, second, third).handles.forEach((handle, index) => {
          this.options.appendTrendSelectionHandle(
            group,
            drawing,
            handle,
            -200 - index * 2,
            `ellipse-width-${index}`,
          );
        });
      }
    }
    drawing.points.forEach((point, index) => {
      const screen = this.options.shapeAnchorScreen(drawing, index);
      if (!screen) return;
      if (
        drawing.subtype !== 'rectangle'
        && !(['rotated_rectangle', 'ellipse'].includes(drawing.subtype!) && index === 2)
      ) {
        this.options.appendTrendSelectionHandle(
          group,
          drawing,
          screen,
          drawing.subtype === 'circle' && index === 0 ? null : index,
          `shape-anchor-${index + 1}`,
        );
      }
      if (
        ['path', 'polyline'].includes(drawing.subtype!)
        || (['curve', 'double_curve'].includes(drawing.subtype!) && index >= 2)
      ) return;
      const anchor = this.options.projectPoint(point);
      if (!anchor) return;
      this.options.appendPriceScaleLabel(
        group,
        plotWidth,
        anchor.y,
        point.price,
        '#2962ff',
        `shape-anchor-${index + 1}-price`,
      );
      this.options.appendTimeScaleLabel(
        group,
        anchor.x,
        plotHeight,
        this.options.shapeLabelTime(point, anchor.x),
        '#2962ff',
        `shape-anchor-${index + 1}-time`,
      );
    });
  }

  private renderTrendSelection(
    group: SVGGElement,
    drawing: Drawing,
    trendTool: TrendLineToolDefinition | GannFibonacciToolDefinition,
    width: number,
    height: number,
    color: string,
  ): void {
    const chart = this.options.getChart();
    const plotWidth = Math.max(0, width - (chart?.priceScale('right').width() ?? 0));
    const plotHeight = Math.max(0, height - (chart?.timeScale().height() ?? 0));
    const hasAnchorCoordinates = (trendTool.drawingType === 'trendline' && trendTool.requiredPoints === 2)
      || Boolean(getGannFibonacciTool(drawing.subtype));
    const isTimeBasedFib = drawing.subtype === 'fib_time_zone'
      || drawing.subtype === 'trend_based_fib_time';
    if (isTimeBasedFib && drawing.points.length >= 2) {
      const bandXs = drawing.points
        .map(point => this.options.projectPoint(point))
        .filter((screen): screen is ScreenPoint => screen !== null)
        .map(screen => screen.x);
      if (bandXs.length >= 2) {
        this.options.appendTimeScaleRangeBand(
          group,
          plotWidth,
          plotHeight,
          Math.min(...bandXs),
          Math.max(...bandXs),
          color,
        );
      }
    } else if (
      (
        (
          trendTool.drawingType === 'trendline'
          && trendTool.requiredPoints === 2
          && trendTool.id !== 'horizontal_line'
          && trendTool.id !== 'vertical_line'
        )
        || Boolean(getGannFibonacciTool(drawing.subtype))
      )
      && drawing.points.length >= 2
    ) {
      const bandYs: number[] = [];
      const bandPrices: number[] = [];
      drawing.points.forEach(point => {
        const screen = this.options.projectPoint(point);
        if (!screen) return;
        bandYs.push(screen.y);
        bandPrices.push(point.price);
      });
      if (bandYs.length >= 2) {
        this.options.appendPriceScaleRangeBand(
          group,
          plotWidth,
          Math.min(...bandYs),
          Math.max(...bandYs),
          color,
          bandPrices,
        );
      }
    }

    drawing.points.forEach((point, index) => {
      const screenPoint = this.options.projectPoint(point);
      if (!screenPoint) return;
      if (trendTool.id === 'horizontal_line') {
        this.options.appendTrendSelectionHandle(
          group,
          drawing,
          { x: Math.max(5, plotWidth - 7), y: screenPoint.y },
          0,
          `selection-anchor-${index + 1}`,
          'square',
        );
        this.options.appendDrawingAddTextPrompt(
          group,
          Math.max(8, plotWidth - 76),
          screenPoint.y - 8,
          color,
        );
        return;
      }
      if (trendTool.id === 'vertical_line') {
        this.options.appendTrendSelectionHandle(
          group,
          drawing,
          { x: screenPoint.x, y: Math.max(5, plotHeight - 7) },
          0,
          `selection-anchor-${index + 1}`,
          'square',
        );
        this.options.appendDrawingAddTextPrompt(
          group,
          screenPoint.x + 8,
          Math.max(14, plotHeight - 28),
          color,
          -90,
        );
        return;
      }
      this.options.appendTrendSelectionHandle(
        group,
        drawing,
        screenPoint,
        index,
        `selection-anchor-${index + 1}`,
      );
      if (hasAnchorCoordinates) {
        this.options.appendPriceScaleLabel(
          group,
          plotWidth,
          screenPoint.y,
          point.price,
          color,
          `endpoint-${index + 1}-price-scale-label`,
        );
        this.options.appendTimeScaleLabel(
          group,
          screenPoint.x,
          plotHeight,
          point.time,
          color,
          `endpoint-${index + 1}-time-scale-label`,
        );
      }
    });
  }

  private renderChannelSelection(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    color: string,
  ): void {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    const trendTool = getTrendLineToolFromDrawing(drawing.type, drawing.subtype);
    if (trendTool?.group === 'Channels') {
      this.options.appendChannelScaleLabels(
        group,
        drawing,
        Math.max(0, width - (chart?.priceScale('right').width() ?? 0)),
        Math.max(0, height - (chart?.timeScale().height() ?? 0)),
        false,
      );
    }
    if (trendTool && drawing.subtype === 'regression_trend') {
      const regression = this.options.getRegressionSegments(drawing);
      if (regression) {
        this.options.appendTrendSelectionHandle(group, drawing, regression.center.start, 0, 'selection-anchor-start');
        this.options.appendTrendSelectionHandle(group, drawing, regression.center.end, 1, 'selection-anchor-end');
        this.options.appendTrendSelectionHandle(group, drawing, regression.upper.start, 0, 'selection-anchor-upper-start');
        this.options.appendTrendSelectionHandle(group, drawing, regression.upper.end, 1, 'selection-anchor-upper-end');
      } else {
        const start = this.options.projectPoint(drawing.points[0]);
        const end = this.options.projectPoint(drawing.points[1]);
        if (start) this.options.appendTrendSelectionHandle(group, drawing, start, 0, 'selection-anchor-start');
        if (end) this.options.appendTrendSelectionHandle(group, drawing, end, 1, 'selection-anchor-end');
      }
      return;
    }
    if (
      trendTool
      && ['parallel_channel', 'flat_top_bottom', 'disjoint_channel'].includes(drawing.subtype ?? '')
      && drawing.points.length >= 3
    ) {
      const channel = this.options.getTrendChannelGeometry(drawing, true);
      if (!channel) return;
      if (drawing.subtype === 'parallel_channel') {
        this.options.appendTrendSelectionHandle(group, drawing, channel.baseline.start, 0, 'selection-anchor-baseline-start');
        this.options.appendTrendSelectionHandle(group, drawing, channel.baseline.end, 1, 'selection-anchor-baseline-end');
        this.options.appendTrendSelectionHandle(group, drawing, channel.boundary.start, -1, 'selection-anchor-boundary-start');
        this.options.appendTrendSelectionHandle(group, drawing, channel.boundary.end, -1, 'selection-anchor-boundary-end');
        this.options.appendTrendSelectionHandle(group, drawing, this.options.segmentMidpoint(channel.baseline), null, 'selection-anchor-baseline-midpoint', 'square');
        this.options.appendTrendSelectionHandle(group, drawing, this.options.segmentMidpoint(channel.boundary), -1, 'selection-anchor-boundary-midpoint', 'square');
      } else if (drawing.subtype === 'flat_top_bottom') {
        this.options.appendTrendSelectionHandle(group, drawing, channel.baseline.start, 0, 'selection-anchor-baseline-start');
        this.options.appendTrendSelectionHandle(group, drawing, channel.baseline.end, 1, 'selection-anchor-baseline-end');
        this.options.appendTrendSelectionHandle(group, drawing, channel.boundary.start, 2, 'selection-anchor-boundary-start');
        this.options.appendTrendSelectionHandle(group, drawing, channel.boundary.end, 2, 'selection-anchor-boundary-end');
      } else {
        this.options.appendTrendSelectionHandle(group, drawing, channel.baseline.start, 0, 'selection-anchor-baseline-start');
        this.options.appendTrendSelectionHandle(group, drawing, channel.baseline.end, 1, 'selection-anchor-baseline-end');
        this.options.appendTrendSelectionHandle(group, drawing, channel.boundary.start, 2, 'selection-anchor-boundary-start');
        this.options.appendTrendSelectionHandle(group, drawing, channel.boundary.end, 2, 'selection-anchor-derived-boundary-end', 'square');
      }
      return;
    }
    if (trendTool) {
      const plotWidth = Math.max(0, width - (chart?.priceScale('right').width() ?? 0));
      const plotHeight = Math.max(0, height - (chart?.timeScale().height() ?? 0));
      if (trendTool.group === 'Pitchforks' && drawing.points.length >= 2) {
        const anchorYs = drawing.points
          .map(point => this.options.projectPoint(point))
          .filter((screen): screen is ScreenPoint => screen !== null)
          .map(screen => screen.y);
        if (anchorYs.length >= 2) {
          this.options.appendPriceScaleRangeBand(
            group,
            plotWidth,
            Math.min(...anchorYs),
            Math.max(...anchorYs),
            color,
            anchorYs.map(y => Number(series?.coordinateToPrice(y) ?? 0)),
          );
        }
      }
      drawing.points.forEach((point, index) => {
        const screenPoint = this.options.projectPoint(point);
        if (!screenPoint) return;
        this.options.appendTrendSelectionHandle(
          group,
          drawing,
          screenPoint,
          index,
          `selection-anchor-${index + 1}`,
        );
        this.options.appendPriceScaleLabel(
          group,
          plotWidth,
          screenPoint.y,
          point.price,
          color,
          `anchor-${index + 1}-price-scale-label`,
        );
        this.options.appendTimeScaleLabel(
          group,
          screenPoint.x,
          plotHeight,
          point.time,
          color,
          `anchor-${index + 1}-time-scale-label`,
        );
      });
      return;
    }
    drawing.points.forEach((point, index) => {
      this.appendFallbackHandle(group, drawing, point, index);
    });
  }

  private appendFallbackHandle(
    group: SVGGElement,
    drawing: Drawing,
    point: DrawingPoint,
    index: number,
  ): void {
    const screenPoint = this.options.projectPoint(point);
    if (!screenPoint) return;
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    handle.setAttribute('x', String(screenPoint.x - 4));
    handle.setAttribute('y', String(screenPoint.y - 4));
    handle.setAttribute('width', '8');
    handle.setAttribute('height', '8');
    handle.setAttribute('fill', '#ef4444');
    handle.setAttribute('stroke', '#fff');
    handle.setAttribute('stroke-width', '1');
    handle.setAttribute('data-geometry-role', `selection-anchor-${index + 1}`);
    handle.style.cursor = 'crosshair';
    handle.setAttribute('pointer-events', 'all');
    handle.addEventListener('pointerdown', event => {
      this.options.beginDrag(event, drawing.id, index);
    });
    group.appendChild(handle);
  }
}

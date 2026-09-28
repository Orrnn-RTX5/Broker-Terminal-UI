import {
  MismatchDirection,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import { arcGeometry, ellipseGeometry, rotatedRectangle } from '../brushShapeGeometry';
import { getBrushShapeTool } from '../brushShapeToolCatalog';
import type { DrawingContextIdentity } from '../contextKey';
import { drawingLogicalToCoordinate } from '../geometry/drawingCoordinates';
import { projectDrawingTimeAtLogical } from '../geometry/drawingTimeProjection';
import { freehandPointAt, projectFreehandPoint } from '../geometry/freehandGeometry';
import { constrainPointTo45DegreeAngle } from '../geometry/trendToolGeometry';
import { projectSectorBoundaryPoint } from '../forecastingMeasurementRenderer';
import { projectFibWedgeBoundaryPoint } from '../gannFibonacciRenderer';
import type {
  Drawing,
  DrawingPoint,
  DrawingSeriesDataProvider,
} from '../model/drawing';

type ScreenPoint = { x: number; y: number };

interface OwnerGeometryContext {
  series: ISeriesApi<SeriesType>;
  seriesDataProvider?: DrawingSeriesDataProvider;
}

export interface DrawingGeometryRuntimeOptions {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getTimeframe: () => string;
  getContainerHeight: () => number;
  getMinMove: () => number;
  resolveOwnerContext: (owner: DrawingContextIdentity) => OwnerGeometryContext | null;
}

/** Chart projection and geometry constraints shared by rendering and dragging. */
export class DrawingGeometryRuntime {
  constructor(private readonly options: DrawingGeometryRuntimeOptions) {}

  anchorShapePoint(drawing: Drawing, point: DrawingPoint): DrawingPoint {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    if (!getBrushShapeTool(drawing) || !chart || !series || point.logicalIndex === undefined) {
      return point;
    }
    const x = drawingLogicalToCoordinate(chart.timeScale(), point.logicalIndex);
    const y = series.priceToCoordinate(point.price);
    if (x === null || y === null) return point;
    if (drawing.subtype === 'arc' && drawing.points.length === 2) {
      const first = this.projectPoint(drawing.points[0]);
      const second = this.projectPoint(drawing.points[1]);
      if (first && second) {
        const bend = arcGeometry(first, second, { x, y }).bend;
        return freehandPointAt(chart, series, bend.x, bend.y) ?? point;
      }
    }
    return freehandPointAt(chart, series, x, y) ?? point;
  }

  shapeLabelTime(point: DrawingPoint, x: number): number {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    if (!chart || !series || point.barOffset === undefined) return point.time;
    const scale = chart.timeScale();
    const visibleTime = scale.coordinateToTime(x);
    if (typeof visibleTime === 'number') return visibleTime;
    const anchor = scale.timeToIndex(point.time as Time, false);
    const logical = anchor === null ? point.logicalIndex : Number(anchor) + point.barOffset;
    return projectDrawingTimeAtLogical(
      series,
      scale,
      logical ?? null,
      this.timeframeSeconds(),
    ) ?? point.time;
  }

  shapeAnchorScreen(drawing: Drawing, index: number): ScreenPoint | null {
    const point = this.projectPoint(drawing.points[index]);
    if (
      !point
      || index !== 2
      || !['arc', 'ellipse', 'rotated_rectangle'].includes(drawing.subtype!)
    ) return point;
    const first = this.projectPoint(drawing.points[0]);
    const second = this.projectPoint(drawing.points[1]);
    if (!first || !second) return point;
    if (drawing.subtype === 'arc') return arcGeometry(first, second, point).bend;
    if (drawing.subtype === 'ellipse') return ellipseGeometry(first, second, point).handles[0];
    return rotatedRectangle(first, second, point).corners[1];
  }

  projectPoint(point: DrawingPoint): ScreenPoint | null {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    if (!chart || !series) return null;
    if (point.barOffset !== undefined) return projectFreehandPoint(chart, series, point);
    let x: number | null = chart.timeScale().timeToCoordinate(point.time as Time);
    if (x === null) {
      x = point.logicalIndex !== undefined
        ? drawingLogicalToCoordinate(chart.timeScale(), point.logicalIndex)
        : null;
    }
    const y = series.priceToCoordinate(point.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  pointX(point: DrawingPoint): number | null {
    const chart = this.options.getChart();
    if (!chart) return null;
    const timeScale = chart.timeScale();
    const byTime = timeScale.timeToCoordinate(point.time as Time);
    if (byTime !== null && Number.isFinite(Number(byTime))) return Number(byTime);
    if (point.logicalIndex === undefined) return null;
    const byLogical = drawingLogicalToCoordinate(timeScale, point.logicalIndex);
    return byLogical !== null && Number.isFinite(Number(byLogical))
      ? Number(byLogical)
      : null;
  }

  canConstrainTrendline(drawing: Drawing): boolean {
    return drawing.type === 'trendline'
      && (
        !drawing.subtype
        || drawing.subtype === 'trendline'
        || drawing.subtype === 'ray'
        || drawing.subtype === 'info_line'
      );
  }

  clampRegressionPoint(
    drawing: Drawing,
    candidate: DrawingPoint,
    owner: DrawingContextIdentity | null,
  ): DrawingPoint {
    if (drawing.type !== 'channel' || drawing.subtype !== 'regression_trend') return candidate;
    const context = owner ? this.options.resolveOwnerContext(owner) : null;
    const series = context?.series ?? (owner ? null : this.options.getSeries());
    if (!series) return candidate;
    try {
      const latest = typeof series.dataByIndex === 'function'
        ? series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft)
        : (context?.seriesDataProvider?.() ?? series.data?.())?.at(-1);
      if (!latest || typeof latest.time !== 'number' || !Number.isFinite(latest.time)) {
        return candidate;
      }
      if (candidate.time <= latest.time) return candidate;
      return { ...candidate, time: latest.time, logicalIndex: undefined };
    } catch {
      return candidate;
    }
  }

  projectTrendlinePoint(
    drawing: Drawing,
    candidate: DrawingPoint,
    anchorIndex = 0,
    rawScreen?: ScreenPoint,
  ): DrawingPoint {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    if (!chart || !series || !this.canConstrainTrendline(drawing)) return candidate;
    const anchor = drawing.points[anchorIndex]
      ? this.projectPoint(drawing.points[anchorIndex])
      : null;
    const candidateScreen = rawScreen ?? this.projectPoint(candidate);
    if (!anchor || !candidateScreen) return candidate;
    const projected = constrainPointTo45DegreeAngle(anchor, candidateScreen);
    const projectedTime = this.resolveDraggedPointTime(candidate, candidateScreen.x, projected.x);
    const projectedPrice = series.coordinateToPrice(projected.y);
    if (!projectedTime || projectedPrice === null) return candidate;
    const result: DrawingPoint = { ...projectedTime, price: Number(projectedPrice) };
    const horizontalSpan = projected.x - anchor.x;
    const verticalSpan = projected.y - anchor.y;
    if (Math.abs(horizontalSpan) > 0.000001 && Math.abs(verticalSpan) > 0.000001) {
      const actualX = this.pointX(result);
      if (actualX !== null) {
        const actualPrice = series.coordinateToPrice(
          anchor.y + (actualX - anchor.x) * verticalSpan / horizontalSpan,
        );
        if (actualPrice !== null) result.price = Number(actualPrice);
      }
    }
    return result;
  }

  projectFibWedgePoint(drawing: Drawing, candidate: DrawingPoint): DrawingPoint {
    if (drawing.subtype !== 'fib_wedge') return candidate;
    return this.projectRadialPoint(drawing, candidate, projectFibWedgeBoundaryPoint);
  }

  constrainFibWedge(drawing: Drawing): void {
    if (drawing.subtype !== 'fib_wedge' || drawing.points.length < 3) return;
    drawing.points[2] = this.projectFibWedgePoint(drawing, drawing.points[2]);
  }

  projectSectorPoint(drawing: Drawing, candidate: DrawingPoint): DrawingPoint {
    if (drawing.subtype !== 'sector') return candidate;
    return this.projectRadialPoint(drawing, candidate, projectSectorBoundaryPoint);
  }

  constrainSector(drawing: Drawing): void {
    if (
      drawing.type !== 'measure'
      || drawing.subtype !== 'sector'
      || drawing.points.length < 3
    ) return;
    drawing.points[2] = this.projectSectorPoint(drawing, drawing.points[2]);
  }

  positionEndX(drawing: Drawing, anchor = drawing.points[0]): number | null {
    const chart = this.options.getChart();
    if (!chart || !anchor) return null;
    const timeScale = chart.timeScale();
    if (drawing.positionEndTime !== undefined) {
      const byTime = timeScale.timeToCoordinate(drawing.positionEndTime as Time);
      if (byTime !== null && Number.isFinite(Number(byTime))) return Number(byTime);
    }
    if (drawing.positionEndLogicalIndex === undefined) return null;
    const rawEnd = drawingLogicalToCoordinate(timeScale, drawing.positionEndLogicalIndex);
    if (rawEnd === null || !Number.isFinite(Number(rawEnd))) return null;
    const anchorX = this.pointX(anchor);
    if (anchorX === null || anchor.logicalIndex === undefined) return Number(rawEnd);
    const rawAnchor = drawingLogicalToCoordinate(timeScale, anchor.logicalIndex);
    return rawAnchor !== null && Number.isFinite(Number(rawAnchor))
      ? anchorX + Number(rawEnd) - Number(rawAnchor)
      : Number(rawEnd);
  }

  offsetCoordinateByLogicalBars(x: number, bars: number): number {
    const chart = this.options.getChart();
    if (!chart) return x + Math.sign(bars || 1);
    const timeScale = chart.timeScale();
    const logical = timeScale.coordinateToLogical(x);
    if (logical !== null) {
      const shifted = drawingLogicalToCoordinate(timeScale, Number(logical) + bars);
      if (shifted !== null && Number.isFinite(Number(shifted))) return Number(shifted);
    }
    return x + Math.sign(bars || 1);
  }

  syncPositionEndFromCoordinate(drawing: Drawing, endX: number): void {
    const chart = this.options.getChart();
    if (!chart || !drawing.points[0]) return;
    const timeScale = chart.timeScale();
    const anchor = drawing.points[0];
    const anchorX = this.pointX(anchor);
    const anchorLogical = anchorX !== null ? timeScale.coordinateToLogical(anchorX) : null;
    const endLogical = timeScale.coordinateToLogical(endX);
    const exactTime = timeScale.coordinateToTime(endX);
    if (typeof exactTime === 'number' && Number.isFinite(exactTime)) {
      drawing.positionEndTime = exactTime;
    } else if (anchorLogical !== null && endLogical !== null) {
      drawing.positionEndTime = anchor.time
        + (Number(endLogical) - Number(anchorLogical)) * this.timeframeSeconds();
    }
    if (anchorLogical !== null && endLogical !== null) {
      anchor.logicalIndex = Number(anchorLogical);
      drawing.positionEndLogicalIndex = Number(endLogical);
    } else {
      drawing.positionEndLogicalIndex = undefined;
    }
  }

  timeframeSeconds(): number {
    const normalized = String(this.options.getTimeframe() || 'M1').trim().toUpperCase();
    if (normalized === 'MN' || normalized === '1MN') return 30 * 24 * 60 * 60;
    const match = normalized.match(/^([MHDW])(\d+)$/);
    if (!match) return 60;
    const amount = Math.max(1, Number(match[2]) || 1);
    const unitSeconds = match[1] === 'W'
      ? 7 * 24 * 60 * 60
      : match[1] === 'D'
        ? 24 * 60 * 60
        : match[1] === 'H'
          ? 60 * 60
          : 60;
    return amount * unitSeconds;
  }

  resolvePositionDefaults(drawing: Drawing): Pick<
    Drawing,
    'positionTargetPrice' | 'positionStopPrice' | 'positionEndTime' | 'positionEndLogicalIndex'
  > {
    const anchor = drawing.points[0];
    if (
      drawing.type !== 'measure'
      || !anchor
      || (drawing.subtype !== 'long_position' && drawing.subtype !== 'short_position')
    ) return {};
    const risk = this.defaultPositionRisk(anchor.price);
    const direction = drawing.subtype === 'long_position' ? 1 : -1;
    return {
      positionTargetPrice: drawing.positionTargetPrice ?? anchor.price + direction * risk,
      positionStopPrice: drawing.positionStopPrice ?? anchor.price - direction * risk,
      positionEndTime: drawing.positionEndTime ?? anchor.time + 40 * this.timeframeSeconds(),
      positionEndLogicalIndex: drawing.positionEndLogicalIndex
        ?? (anchor.logicalIndex === undefined ? undefined : anchor.logicalIndex + 40),
    };
  }

  defaultPositionRisk(entry: number): number {
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    const minMove = Math.max(this.options.getMinMove(), 0.000001);
    if (!series) return Math.max(minMove, Math.abs(entry) * 0.01);
    const entryY = series.priceToCoordinate(entry);
    if (entryY === null || !Number.isFinite(Number(entryY))) {
      return Math.max(minMove, Math.abs(entry) * 0.01);
    }
    const plotHeight = Math.max(
      1,
      this.options.getContainerHeight() - (chart?.timeScale().height() ?? 0),
    );
    const screenDistance = Math.max(24, plotHeight * 0.19);
    const upper = series.coordinateToPrice(Number(entryY) - screenDistance);
    const lower = series.coordinateToPrice(Number(entryY) + screenDistance);
    const candidates = [upper, lower]
      .map(price => price === null ? null : Number(price))
      .filter((price): price is number => price !== null && Number.isFinite(price))
      .map(price => Math.abs(price - entry));
    const average = candidates.length
      ? candidates.reduce((sum, value) => sum + value, 0) / candidates.length
      : Math.abs(entry) * 0.01;
    return Math.max(minMove, average);
  }

  resolveDraggedPointTime(
    initialPoint: DrawingPoint,
    initialX: number,
    targetX: number,
  ): Pick<DrawingPoint, 'time' | 'logicalIndex'> | null {
    const chart = this.options.getChart();
    if (!chart) return null;
    const timeScale = chart.timeScale();
    const exactTime = timeScale.coordinateToTime(targetX);
    if (typeof exactTime === 'number' && Number.isFinite(exactTime)) {
      return { time: exactTime };
    }
    const targetLogical = timeScale.coordinateToLogical(targetX);
    if (targetLogical === null) return null;
    const initialLogical = timeScale.coordinateToLogical(initialX) ?? initialPoint.logicalIndex;
    if (initialLogical === null || initialLogical === undefined) return null;
    return {
      time: initialPoint.time
        + (Number(targetLogical) - Number(initialLogical)) * this.timeframeSeconds(),
      logicalIndex: Number(targetLogical),
    };
  }

  toDashArray(style?: string, lineWidth?: number): string {
    if (lineWidth !== undefined) {
      if (style === 'dashed') return `${5 * lineWidth} ${6 * lineWidth}`;
      if (style === 'dotted') return `${lineWidth} ${3 * lineWidth}`;
    }
    if (style === 'dashed') return '8 4';
    if (style === 'dotted') return '3 3';
    return 'none';
  }

  private projectRadialPoint(
    drawing: Drawing,
    candidate: DrawingPoint,
    project: (origin: ScreenPoint, radius: ScreenPoint, candidate: ScreenPoint) => ScreenPoint,
  ): DrawingPoint {
    const series = this.options.getSeries();
    if (!series) return candidate;
    const origin = drawing.points[0] ? this.projectPoint(drawing.points[0]) : null;
    const radiusPoint = drawing.points[1] ? this.projectPoint(drawing.points[1]) : null;
    const candidateScreen = this.projectPoint(candidate);
    if (!origin || !radiusPoint || !candidateScreen) return candidate;
    const projected = project(origin, radiusPoint, candidateScreen);
    const projectedPrice = series.coordinateToPrice(projected.y);
    const projectedTime = this.resolveDraggedPointTime(candidate, candidateScreen.x, projected.x);
    if (projectedPrice === null || !projectedTime) return candidate;
    return { ...projectedTime, price: projectedPrice };
  }
}

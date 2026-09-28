import { MismatchDirection, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import type { DrawingPoint } from '../model/drawing';
import { drawingLogicalToCoordinate } from './drawingCoordinates';

/** Store a candle time plus a bar fraction, never a viewport pixel offset. */
export function freehandPointAt(chart: IChartApi, series: ISeriesApi<any>, x: number, y: number): DrawingPoint | null {
  const scale = chart.timeScale();
  const nearest = scale.coordinateToLogical(x);
  if (nearest === null) return null;
  const left = drawingLogicalToCoordinate(scale, Number(nearest));
  const right = drawingLogicalToCoordinate(scale, Number(nearest) + 1);
  const price = series.coordinateToPrice(y);
  if (left === null || right === null || right === left || price === null) return null;
  const logicalIndex = Number(nearest) + (x - left) / (right - left);
  const time = scale.coordinateToTime(x)
    ?? series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft)?.time;
  if (typeof time !== 'number') return null;
  const anchorIndex = scale.timeToIndex(time as Time, false);
  if (anchorIndex === null || !Number.isFinite(price) || !Number.isFinite(logicalIndex)) return null;
  return { time, price: Number(price), logicalIndex, barOffset: logicalIndex - Number(anchorIndex) };
}

export function projectFreehandPoint(chart: IChartApi, series: ISeriesApi<any>, point: DrawingPoint) {
  const scale = chart.timeScale();
  const anchorIndex = scale.timeToIndex(point.time as Time, false);
  const logical = anchorIndex !== null
    ? Number(anchorIndex) + (point.barOffset ?? 0)
    : point.logicalIndex;
  const x = logical === undefined ? null : drawingLogicalToCoordinate(scale, logical);
  const y = series.priceToCoordinate(point.price);
  return x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) ? { x, y: Number(y) } : null;
}

/** Quadratic midpoint interpolation rounds freehand samples without sharp joins. */
export function freehandPath(points: readonly { x: number; y: number }[]): string {
  if (!points.length) return '';
  const xy = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  let path = `M${xy(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const next = points[i + 1];
    path += ` Q${xy(points[i])} ${xy({ x: (points[i].x + next.x) / 2, y: (points[i].y + next.y) / 2 })}`;
  }
  return `${path} L${xy(points[points.length - 1])}`;
}

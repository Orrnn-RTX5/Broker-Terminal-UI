import type { ISeriesApi, ITimeScaleApi, LogicalRange, Time, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import type { Timeframe } from '../types/chart';
import { getTimeframeCloseSeconds } from './timeframeBoundary';

const PROJECTION_CHUNK_SIZE = 512;
const PROJECTION_BUFFER_BARS = 128;
export const MAX_CHART_GRID_PROJECTION_POINTS = 16_384;

export interface ChartGridLatestPoint {
  time: number;
  /** The point's current public timeScale.timeToIndex(time, false) result. */
  index: number;
}

type ProjectionTimeScale = Pick<ITimeScaleApi<Time>,
  | 'getVisibleLogicalRange'
  | 'setVisibleLogicalRange'
  | 'subscribeVisibleLogicalRangeChange'
  | 'unsubscribeVisibleLogicalRangeChange'
  | 'timeToIndex'
  | 'options'
  | 'applyOptions'
  | 'scrollPosition'
>;

export interface ChartGridTimeProjectionSource {
  timeScale: ProjectionTimeScale;
  /** A dedicated transparent series, never the real price series. */
  hostSeries: Pick<ISeriesApi<'Line'>, 'setData'>;
  getLatestPoint: () => ChartGridLatestPoint | null;
  getTimeframe: () => Timeframe;
  getBoundaryOffsetSeconds?: () => number;
  isEnabled: () => boolean;
}

export interface ChartGridTimeProjection {
  refresh: () => void;
  dispose: () => void;
}

const validRange = (range: LogicalRange | null): range is LogicalRange => Boolean(
  range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.from <= range.to,
);

const sameRange = (left: LogicalRange | null, right: LogicalRange): boolean => Boolean(
  left && Math.abs(left.from - right.from) < 1e-7 && Math.abs(left.to - right.to) < 1e-7,
);

/**
 * Supplies only future time coordinates for native grid marks and labels.
 * Whitespace rows contain no prices, so the real series retains its last bar
 * and base index. Projection grows in chunks instead of rebuilding on every pan.
 */
export const createChartGridTimeProjection = ({
  timeScale, hostSeries, getLatestPoint, getTimeframe, getBoundaryOffsetSeconds = () => 0, isEnabled,
}: ChartGridTimeProjectionSource): ChartGridTimeProjection => {
  let disposed = false;
  let subscribed = false;
  let applying = false;
  let frame: number | null = null;
  let originTime: number | null = null;
  let originTimeframe: Timeframe | null = null;
  let originBoundaryOffsetSeconds: number | null = null;
  let projection: WhitespaceData<Time>[] = [];

  const writeProjection = (data: WhitespaceData<Time>[], latest: ChartGridLatestPoint | null) => {
    const currentRange = timeScale.getVisibleLogicalRange();
    const range = validRange(currentRange) ? { ...currentRange } : null;
    const barSpacing = timeScale.options().barSpacing;
    const rightOffset = timeScale.scrollPosition();
    const latestIndex = latest?.index ?? null;
    applying = true;
    try {
      hostSeries.setData(data);
      if (timeScale.options().barSpacing !== barSpacing || timeScale.scrollPosition() !== rightOffset) {
        timeScale.applyOptions({ barSpacing, rightOffset });
      }
      // Removing obsolete projection points inside a new real-data gap can
      // renumber indexes. Preserve the true candle's pixel position through
      // spacing/rightOffset; only restore an absolute range when indexes agree.
      const sameIndex = latest && timeScale.timeToIndex(latest.time as UTCTimestamp, false) === latestIndex;
      if (range && sameIndex && !sameRange(timeScale.getVisibleLogicalRange(), range)) {
        timeScale.setVisibleLogicalRange(range);
      }
    } finally {
      applying = false;
    }
  };

  const clearProjection = () => {
    originTime = null;
    originTimeframe = null;
    originBoundaryOffsetSeconds = null;
    if (projection.length === 0) return;
    projection = [];
    writeProjection(projection, getLatestPoint());
  };

  const cancelFrame = () => {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };

  const deactivate = () => {
    cancelFrame();
    if (subscribed) {
      timeScale.unsubscribeVisibleLogicalRangeChange(onRangeChange);
      subscribed = false;
    }
    clearProjection();
  };

  const update = () => {
    frame = null;
    if (disposed) return;
    if (!isEnabled()) { deactivate(); return; }
    const latest = getLatestPoint();
    if (!latest || !Number.isFinite(latest.time) || !Number.isFinite(latest.index) || latest.index < 0) {
      clearProjection();
      return;
    }
    const timeframe = getTimeframe();
    const providedOffset = getBoundaryOffsetSeconds();
    const boundaryOffsetSeconds = Number.isFinite(providedOffset) ? providedOffset : 0;
    const range = timeScale.getVisibleLogicalRange();
    const sameOrigin = originTime === latest.time && originTimeframe === timeframe && originBoundaryOffsetSeconds === boundaryOffsetSeconds;
    if (!validRange(range)) {
      if (!sameOrigin) clearProjection();
      return;
    }
    const required = Math.max(0, Math.ceil(range.to - latest.index)) + PROJECTION_BUFFER_BARS;
    const capacity = Math.min(MAX_CHART_GRID_PROJECTION_POINTS, Math.ceil(required / PROJECTION_CHUNK_SIZE) * PROJECTION_CHUNK_SIZE);
    if (sameOrigin && projection.length >= capacity) return;
    const nextProjection = sameOrigin ? projection.slice() : [];
    let previousTime = nextProjection.length > 0 ? Number(nextProjection[nextProjection.length - 1].time) : latest.time;
    for (let index = nextProjection.length; index < capacity; index++) {
      const time = getTimeframeCloseSeconds(previousTime, timeframe, boundaryOffsetSeconds);
      if (!Number.isFinite(time) || time <= previousTime) { clearProjection(); return; }
      nextProjection.push({ time: time as UTCTimestamp });
      previousTime = time;
    }
    // Cache before setData, because it can synchronously emit range changes.
    originTime = latest.time;
    originTimeframe = timeframe;
    originBoundaryOffsetSeconds = boundaryOffsetSeconds;
    projection = nextProjection;
    writeProjection(projection, latest);
  };

  const schedule = () => {
    if (disposed || applying || frame !== null) return;
    frame = requestAnimationFrame(update);
  };

  function onRangeChange() {
    if (subscribed && isEnabled()) schedule();
  }

  const refresh = () => {
    if (disposed) return;
    if (!isEnabled()) { deactivate(); return; }
    if (!subscribed) {
      timeScale.subscribeVisibleLogicalRangeChange(onRangeChange);
      subscribed = true;
    }
    schedule();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    deactivate();
  };

  refresh();
  return { refresh, dispose };
};

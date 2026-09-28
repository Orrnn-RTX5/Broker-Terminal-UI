import type { ForecastingMeasurementToolId } from './forecastingMeasurementToolCatalog';
import { calculatePositionPnl, calculatePositionSizing, positionQuantityText } from './positionDrawingValues';
import type { ForecastingBar, PositionSizing } from './model/drawing';

export type { ForecastingBar } from './model/drawing';

export type ForecastingMeasurementSubtype = ForecastingMeasurementToolId;

export interface ForecastingPoint { time: number; price: number; logicalIndex?: number }
export interface ForecastingScreenPoint { x: number; y: number }
export interface PlotDimensions { width: number; height: number; left?: number; top?: number }

export interface ForecastingMeasurementRendererInput {
  group: SVGElement;
  subtype: ForecastingMeasurementSubtype;
  points: ForecastingPoint[];
  screenPoints?: Array<ForecastingScreenPoint | null | undefined>;
  plot: PlotDimensions;
  series?: ForecastingBar[];
  /** A captured data set used by Bars Pattern so its source does not move with live bars. */
  seriesSnapshot?: readonly ForecastingBar[] | null;
  latestPrice?: number;
  currentPrice?: number;
  positionTargetPrice?: number;
  positionStopPrice?: number;
  positionEndTime?: number;
  positionEndLogicalIndex?: number;
  positionSizing?: PositionSizing;
  selected?: boolean;
  timeToCoordinate: (time: number) => number | null | undefined;
  logicalToCoordinate?: (logicalIndex: number) => number | null | undefined;
  priceToCoordinate: (price: number) => number | null | undefined;
  formatPrice?: (price: number) => string;
  formatTime?: (time: number) => string;
  color?: string;
  lineWidth?: number;
  dash?: string;
  opacity?: number;
  tickSize?: number;
}

export interface VolumeProfileBin { low: number; high: number; volume: number; ratio: number }
export interface VwapPoint { time: number; value: number; deviation: number; upper: number; lower: number }

const SVG_NS = 'http://www.w3.org/2000/svg';
const number = (value: unknown, fallback = 0) => Number.isFinite(value) ? Number(value) : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const selectBarsInTimeRange = (series: readonly ForecastingBar[] = [], start: number, end: number) => {
  const low = Math.min(start, end); const high = Math.max(start, end);
  return series.filter((bar) => finite(bar.time) && bar.time >= low && bar.time <= high);
};

/** Bars Pattern deliberately uses its frozen snapshot, while all other tools use current context data. */
export const resolveForecastSeries = (input: Pick<ForecastingMeasurementRendererInput, 'subtype' | 'series' | 'seriesSnapshot'>): readonly ForecastingBar[] =>
  input.subtype === 'bars_pattern' && input.seriesSnapshot !== undefined && input.seriesSnapshot !== null
    ? input.seriesSnapshot
    : (input.series ?? []);

export const barVolume = (bar: ForecastingBar) => {
  for (const candidate of [bar.volume, bar.tickVolume, bar.realVolume]) if (finite(candidate) && candidate > 0) return candidate;
  return 0;
};

export const calculateAnchoredVwap = (series: readonly ForecastingBar[] = [], anchorTime = -Infinity): VwapPoint[] => {
  let volumeTotal = 0; let mean = 0; let m2 = 0;
  const output: VwapPoint[] = [];
  for (const bar of series) {
    if (!finite(bar.time) || bar.time < anchorTime) continue;
    if (!finite(bar.close) || !finite(bar.high) || !finite(bar.low) || bar.low > bar.high) continue;
    const typical = (bar.high + bar.low + bar.close) / 3;
    const volume = barVolume(bar);
    if (volume <= 0) continue;
    const nextTotal = volumeTotal + volume;
    const delta = typical - mean; mean += (volume / nextTotal) * delta;
    m2 += volume * delta * (typical - mean); volumeTotal = nextTotal;
    const deviation = Math.sqrt(m2 / volumeTotal);
    output.push({ time: bar.time, value: mean, deviation, upper: mean + deviation, lower: mean - deviation });
  }
  return output;
};

export const buildVolumeProfile = (series: readonly ForecastingBar[] = [], bins = 12): VolumeProfileBin[] => {
  series = series.filter(bar => finite(bar.low) && finite(bar.high) && bar.low <= bar.high && barVolume(bar) > 0);
  if (!series.length) return [];
  bins = Math.max(1, Math.min(200, Math.trunc(number(bins, 12))));
  const lows = series.map((bar) => number(bar.low, number(bar.close))).filter(finite);
  const highs = series.map((bar) => number(bar.high, number(bar.close))).filter(finite);
  if (!lows.length || !highs.length) return [];
  const min = Math.min(...lows); const max = Math.max(...highs); const step = Math.max((max - min) / Math.max(1, bins), Number.EPSILON);
  const result = Array.from({ length: bins }, (_, index) => ({ low: min + index * step, high: min + (index + 1) * step, volume: 0, ratio: 0 }));
  for (const bar of series) {
    const low = bar.low!; const high = bar.high!; const volume = barVolume(bar);
    if (high === low) {
      result[clamp(Math.floor((low - min) / step), 0, bins - 1)].volume += volume;
    } else {
      // With OHLCV only, spread the candle's volume across its traded range.
      // This is an estimate; never pretend to have lower-timeframe/tick volume.
      for (const bin of result) {
        const overlap = Math.max(0, Math.min(high, bin.high) - Math.max(low, bin.low));
        bin.volume += volume * overlap / (high - low);
      }
    }
  }
  const maximum = Math.max(1, ...result.map((bin) => bin.volume));
  return result.map((bin) => ({ ...bin, ratio: bin.volume / maximum }));
};

const clear = (group: SVGElement) => { while (group.firstChild) group.removeChild(group.firstChild); };
const node = (group: SVGElement, tag: string, role: string, attrs: Record<string, string | number | undefined> = {}, text?: string) => {
  const element = group.ownerDocument.createElementNS(SVG_NS, tag);
  element.setAttribute('data-geometry-role', role);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  group.appendChild(element); return element;
};
const style = (input: ForecastingMeasurementRendererInput) => ({
  stroke: input.color ?? '#2962ff', 'stroke-width': input.lineWidth ?? 1.5, 'stroke-dasharray': input.dash,
  opacity: input.opacity ?? 1, fill: 'none', 'vector-effect': 'non-scaling-stroke',
});
const pointAt = (input: ForecastingMeasurementRendererInput, index: number, clip = true): ForecastingScreenPoint | null => {
  const raw = input.points[index]; if (!raw) return null;
  const supplied = input.screenPoints?.[index];
  const x = supplied && finite(supplied.x) ? supplied.x : input.timeToCoordinate(raw.time);
  const y = supplied && finite(supplied.y) ? supplied.y : input.priceToCoordinate(raw.price);
  if (!finite(x) || !finite(y)) return null;
  if (!clip) return { x, y };
  const left = number(input.plot.left); const top = number(input.plot.top);
  return { x: clamp(x, left, left + input.plot.width), y: clamp(y, top, top + input.plot.height) };
};
/** Derived values must never reuse an interaction screen-point: it may be stale or be a drag anchor. */
const computedPoint = (input: ForecastingMeasurementRendererInput, time: number, price: number): ForecastingScreenPoint | null => {
  const x = input.timeToCoordinate(time); const y = input.priceToCoordinate(price);
  if (!finite(x) || !finite(y)) return null;
  const left = number(input.plot.left); const top = number(input.plot.top);
  return { x: clamp(x, left, left + input.plot.width), y: clamp(y, top, top + input.plot.height) };
};
const computedY = (input: ForecastingMeasurementRendererInput, price: number): number | null => {
  const y = input.priceToCoordinate(price);
  if (!finite(y)) return null;
  return y;
};
const path = (points: ForecastingScreenPoint[]) => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
const priceText = (input: ForecastingMeasurementRendererInput, value: number) => input.formatPrice?.(value) ?? value.toFixed(2);
const elapsedText = (elapsedSeconds: number) => {
  const seconds = Math.max(0, Math.round(Math.abs(elapsedSeconds)));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d${remainingHours ? ` ${remainingHours}h` : ''}`;
};

const formatCompactVolume = (volume: number) => {
  const absolute = Math.abs(volume);
  const suffix = absolute >= 1_000_000_000 ? 'B' : absolute >= 1_000_000 ? 'M' : absolute >= 1_000 ? 'K' : '';
  const divisor = suffix === 'B' ? 1_000_000_000 : suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1;
  const scaled = volume / divisor;
  return `${scaled.toFixed(suffix ? 2 : 0).replace(/\.00$/, '')}${suffix}`;
};

interface CalloutOptions { fill?: string; textColor?: string; anchor?: 'start' | 'middle' | 'end' }
const callout = (
  input: ForecastingMeasurementRendererInput,
  role: string,
  x: number,
  y: number,
  lines: readonly string[],
  options: CalloutOptions = {},
) => {
  const anchor = options.anchor ?? 'start';
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.max(36, longest * 6.15 + 10);
  const height = Math.max(18, lines.length * 14 + 4);
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const top = y;
  node(input.group, 'rect', `${role}-background`, {
    x: left,
    y: top,
    width,
    height,
    rx: 3,
    fill: options.fill ?? input.color ?? '#2962ff',
    opacity: .94,
  });
  const textNode = node(input.group, 'text', role, {
    x: left + 5,
    y: top + 12,
    fill: options.textColor ?? '#ffffff',
    'font-size': 11,
    'font-family': 'Arial, sans-serif',
  });
  lines.forEach((line, index) => {
    const span = input.group.ownerDocument.createElementNS(SVG_NS, 'tspan');
    span.setAttribute('x', String(left + 5));
    span.setAttribute('dy', index === 0 ? '0' : '14');
    span.textContent = line;
    textNode.appendChild(span);
  });
  return { left, top, width, height };
};

const arrowHeadPath = (start: ForecastingScreenPoint, end: ForecastingScreenPoint, size = 8) => {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const wing = Math.PI / 6;
  const first = { x: end.x - size * Math.cos(angle - wing), y: end.y - size * Math.sin(angle - wing) };
  const second = { x: end.x - size * Math.cos(angle + wing), y: end.y - size * Math.sin(angle + wing) };
  return `M ${first.x} ${first.y} L ${end.x} ${end.y} L ${second.x} ${second.y}`;
};

/** Project an angular Sector control onto the radius established by click two. */
export const projectSectorBoundaryPoint = (
  origin: ForecastingScreenPoint,
  radiusPoint: ForecastingScreenPoint,
  candidate: ForecastingScreenPoint,
): ForecastingScreenPoint => {
  const radius = Math.hypot(radiusPoint.x - origin.x, radiusPoint.y - origin.y);
  const candidateRadius = Math.hypot(candidate.x - origin.x, candidate.y - origin.y);
  if (radius <= Number.EPSILON || candidateRadius <= Number.EPSILON) return { ...radiusPoint };
  const scale = radius / candidateRadius;
  return {
    x: origin.x + ((candidate.x - origin.x) * scale),
    y: origin.y + ((candidate.y - origin.y) * scale),
  };
};

function renderPosition(input: ForecastingMeasurementRendererInput, long: boolean) {
  const anchor = pointAt(input, 0, false); if (!anchor) return false;
  const prefix = long ? 'long-position' : 'short-position';
  // Clip the viewport, not the prices: an offscreen target must not become
  // a false price line at the top/bottom edge of the chart.
  const viewport = document.createElementNS(SVG_NS, 'svg');
  viewport.setAttribute('width', String(number(input.plot.left) + input.plot.width));
  viewport.setAttribute('height', String(number(input.plot.top) + input.plot.height));
  viewport.setAttribute('overflow', 'hidden');
  input.group.appendChild(viewport);
  input = { ...input, group: viewport };
  const entry = input.points[0].price; const risk = Math.max(number(input.tickSize, 0), Math.abs(entry) * 0.01, 0.000001);
  const target = finite(input.positionTargetPrice)
    ? input.positionTargetPrice
    : entry + (long ? 1 : -1) * risk;
  const stop = finite(input.positionStopPrice)
    ? input.positionStopPrice
    : entry + (long ? -1 : 1) * risk;
  const targetY = computedY(input, target);
  const stopY = computedY(input, stop);
  if (!finite(targetY) || !finite(stopY)) return false;
  const endByTime = finite(input.positionEndTime)
    ? input.timeToCoordinate(input.positionEndTime)
    : null;
  const endByLogical = finite(input.positionEndLogicalIndex)
    ? (() => {
      const rawEnd = input.logicalToCoordinate?.(input.positionEndLogicalIndex);
      const anchorLogical = input.points[0].logicalIndex;
      const rawAnchor = finite(anchorLogical)
        ? input.logicalToCoordinate?.(anchorLogical)
        : null;
      // Logical indices move when older history is prepended. Their difference
      // remains the exact requested duration, so apply that delta to the
      // durable, time-resolved entry coordinate instead of treating the saved
      // end index as an absolute screen anchor.
      return finite(rawEnd) && finite(rawAnchor)
        ? anchor.x + (rawEnd - rawAnchor)
        : rawEnd;
    })()
    : null;
  const requestedRight = finite(endByTime)
    ? endByTime
    : finite(endByLogical)
      ? endByLogical
      : anchor.x + 160;
  const right = clamp(
    Math.max(anchor.x + 1, requestedRight),
    number(input.plot.left),
    number(input.plot.left) + input.plot.width,
  );
  node(input.group, 'rect', `${prefix}-profit-zone`, { x: anchor.x, y: Math.min(anchor.y, targetY), width: Math.max(1, right - anchor.x), height: Math.max(1, Math.abs(anchor.y - targetY)), fill: '#26a69a', stroke: '#26a69a', 'stroke-width': 1, opacity: .22 });
  node(input.group, 'rect', `${prefix}-loss-zone`, { x: anchor.x, y: Math.min(anchor.y, stopY), width: Math.max(1, right - anchor.x), height: Math.max(1, Math.abs(anchor.y - stopY)), fill: '#ef5350', stroke: '#ef5350', 'stroke-width': 1, opacity: .22 });
  node(input.group, 'line', `${prefix}-entry`, { x1: anchor.x, y1: anchor.y, x2: right, y2: anchor.y, stroke: input.color ?? '#2962ff', 'stroke-width': 1.5 });
  node(input.group, 'line', `${prefix}-target`, { x1: anchor.x, y1: targetY, x2: right, y2: targetY, stroke: '#26a69a', 'stroke-width': 1 });
  node(input.group, 'line', `${prefix}-stop`, { x1: anchor.x, y1: stopY, x2: right, y2: stopY, stroke: '#ef5350', 'stroke-width': 1 });
  const riskAmount = Math.max(Math.abs(entry - stop), Number.EPSILON);
  const rewardAmount = Math.abs(target - entry);
  const ratio = rewardAmount / riskAmount;
  const tickSize = Math.max(Math.abs(number(input.tickSize)), Number.EPSILON);
  const targetPercent = entry ? (rewardAmount / Math.abs(entry)) * 100 : 0;
  const stopPercent = entry ? (riskAmount / Math.abs(entry)) * 100 : 0;
  const sizing = calculatePositionSizing(entry, target, stop, input.positionSizing);
  const pnl = calculatePositionPnl({ long, entry, target, stop, startTime: input.points[0].time,
    endTime: input.positionEndTime, series: input.series, latestPrice: input.currentPrice ?? input.latestPrice });
  const amountText = (amount: number | null) => amount === null ? '—' : amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const targetTicks = rewardAmount / tickSize;
  const stopTicks = riskAmount / tickSize;
  const targetLabel = `Target: ${priceText(input, rewardAmount)} (${targetPercent.toFixed(2)}%) ${targetTicks.toLocaleString(undefined, { maximumFractionDigits: 1 })}, Amount: ${amountText(sizing.targetAmount)}`;
  const stopLabel = `Stop: ${priceText(input, riskAmount)} (${stopPercent.toFixed(2)}%) ${stopTicks.toLocaleString(undefined, { maximumFractionDigits: 1 })}, Amount: ${amountText(sizing.stopAmount)}`;
  callout(input, `${prefix}-target-label`, anchor.x, targetY - 22, [targetLabel], { fill: '#089981' });
  callout(input, `${prefix}-stop-label`, anchor.x, stopY + 2, [stopLabel], { fill: '#f23645' });
  callout(input, `${prefix}-stats`, (anchor.x + right) / 2, anchor.y + (long ? 8 : -38), [
    `${pnl.status === 'closed' ? 'Closed' : 'Open'} PnL: ${pnl.value === null ? '—' : priceText(input, pnl.value)}, Qty: ${positionQuantityText(sizing.quantity, input.positionSizing?.quantityPrecision)}`,
    `Risk/reward ratio: ${ratio.toFixed(2).replace(/\.00$/, '')}`,
    ...(pnl.status === 'ambiguous' ? ['Target and stop touched in one candle'] : []),
    ...(sizing.quantity === null ? ['Set position sizing inputs'] : []),
  ], { fill: pnl.value === null ? '#787b86' : pnl.value >= 0 ? '#089981' : '#f23645', anchor: 'middle' });
  if (input.selected) {
    for (const [role, y] of [[`${prefix}-target-handle`, targetY], [`${prefix}-stop-handle`, stopY]] as const) {
      node(input.group, 'circle', role, {
        cx: right,
        cy: y,
        r: 4,
        fill: '#ffffff',
        stroke: input.color ?? '#2962ff',
        'stroke-width': 1.5,
      });
    }
    node(input.group, 'line', `${prefix}-duration-edge`, {
      x1: right,
      x2: right,
      y1: Math.min(targetY, stopY),
      y2: Math.max(targetY, stopY),
      stroke: input.color ?? '#2962ff',
      'stroke-width': 1,
      'stroke-dasharray': '3 3',
    });
    node(input.group, 'circle', `${prefix}-width-handle`, {
      cx: right,
      cy: anchor.y,
      r: 4,
      fill: '#ffffff',
      stroke: input.color ?? '#2962ff',
      'stroke-width': 1.5,
    });
  }
  return true;
}

function renderProfile(input: ForecastingMeasurementRendererInput, anchored: boolean) {
  const anchor = pointAt(input, 0); if (!anchor) return false;
  const series = resolveForecastSeries(input);
  const endTime = anchored ? (series.at(-1)?.time ?? input.points[0].time) : input.points[1]?.time;
  if (!finite(endTime)) return false;
  const bars = selectBarsInTimeRange(series, input.points[0].time, endTime);
  const profile = buildVolumeProfile(bars);
  if (!profile.length) {
    callout(input, 'volume-profile-unavailable', anchor.x, anchor.y, ['Volume data unavailable']);
    return true;
  }
  const prefix = anchored ? 'anchored-volume-profile' : 'fixed-range-volume-profile';
  const end = anchored
    ? computedPoint(input, endTime, input.points[0].price)
    : pointAt(input, 1);
  if (!end) return false;
  const x = anchored ? end.x : Math.max(anchor.x, end.x);
  const rangeLeft = Math.min(anchor.x, end.x);
  const selectedWidth = Math.max(1, Math.abs(end.x - anchor.x));
  const width = Math.min(Math.max(30, input.plot.width * .18), selectedWidth);
  node(input.group, 'rect', `${prefix}-range`, { x: rangeLeft, y: number(input.plot.top), width: selectedWidth, height: input.plot.height, fill: input.color ?? '#2962ff', opacity: .06 });
  let poc: VolumeProfileBin | undefined;
  for (const bin of profile) {
    const y1 = computedPoint(input, endTime, bin.high)?.y;
    const y2 = computedPoint(input, endTime, bin.low)?.y;
    if (!poc || bin.volume > poc.volume) poc = bin;
    if (bin.volume <= 0) continue;
    if (finite(y1) && finite(y2)) node(input.group, 'rect', `${prefix}-bin`, { x: x - width * bin.ratio, y: Math.min(y1, y2), width: Math.max(1, width * bin.ratio), height: Math.max(1, Math.abs(y2 - y1)), fill: input.color ?? '#2962ff', opacity: .35 });
  }
  if (poc) {
    const price = (poc.low + poc.high) / 2;
    const y = computedPoint(input, endTime, price)?.y;
    if (finite(y)) {
      node(input.group, 'line', `${prefix}-poc`, { x1: rangeLeft, x2: Math.max(anchor.x, end.x), y1: y, y2: y, ...style(input) });
      callout(input, `${prefix}-poc-value`, x, y - 20, [`POC ${priceText(input, price)}`, 'OHLCV estimate'], { anchor: 'end' });
    }
  }
  return true;
}

export function renderForecastingMeasurementDrawing(input: ForecastingMeasurementRendererInput): boolean {
  clear(input.group);
  const first = pointAt(input, 0); const second = pointAt(input, 1); const third = pointAt(input, 2);
  const bars = resolveForecastSeries(input); const base = style(input);
  if (input.subtype === 'long_position') return renderPosition(input, true);
  if (input.subtype === 'short_position') return renderPosition(input, false);
  if (input.subtype === 'position_forecast' && first && second) {
    // TradingView eases the projection from a horizontal departure into a
    // vertical arrival. A quadratic curve with the control at (end.x,start.y)
    // reproduces that two-click gesture without inventing a hidden third node.
    node(input.group, 'path', 'forecast-projection', {
      d: `M ${first.x} ${first.y} Q ${second.x} ${first.y} ${second.x} ${second.y}`,
      ...base,
    });
    const delta = input.points[1].price - input.points[0].price;
    const direction = delta >= 0 ? 1 : -1;
    const observedBars = selectBarsInTimeRange(bars, input.points[0].time, input.points[1].time);
    const reachedTarget = observedBars.some((bar) => direction > 0
      ? number(bar.high, number(bar.close)) >= input.points[1].price
      : number(bar.low, number(bar.close)) <= input.points[1].price);
    const latestBarTime = bars.reduce((latest, bar) => finite(bar.time) ? Math.max(latest, bar.time) : latest, -Infinity);
    const deadlinePassed = latestBarTime >= input.points[1].time;
    const status = reachedTarget
      ? 'Success'
      : deadlinePassed
        ? 'Failure'
        : 'Pending';
    const percent = input.points[0].price ? delta / Math.abs(input.points[0].price) * 100 : 0;
    const duration = elapsedText(input.points[1].time - input.points[0].time);
    const startTime = input.formatTime?.(input.points[0].time) ?? String(input.points[0].time);
    const endTime = input.formatTime?.(input.points[1].time) ?? String(input.points[1].time);
    callout(input, 'position-forecast-start-label', first.x - 20, first.y + 10, [
      priceText(input, input.points[0].price),
      startTime,
    ]);
    callout(input, 'position-forecast-end-label', second.x - 20, second.y - 50, [
      `${priceText(input, delta)} (${percent.toFixed(2)}%) in ${duration}`,
      `${priceText(input, input.points[1].price)} @ ${endTime}`,
    ]);
    callout(input, 'position-forecast-status', second.x - 20, second.y - 72, [status.toUpperCase()], {
      fill: status === 'Success' ? '#089981' : status === 'Failure' ? '#f23645' : '#787b86',
    });
    input.group.querySelector(`[data-geometry-role="position-forecast-status"]`)
      ?.setAttribute('data-status', status.toLowerCase());
    return true;
  }
  if (input.subtype === 'bars_pattern' && first && second) {
    // Clicks 0 and 1 select the immutable source range; click 2 is its translated destination.
    const hasCapturedSnapshot = input.seriesSnapshot !== undefined && input.seriesSnapshot !== null;
    const source = hasCapturedSnapshot
      ? [...bars]
      : selectBarsInTimeRange(bars, input.points[0].time, input.points[1].time);
    if (!source.length) return false;
    if (!third) {
      node(input.group, 'rect', 'bars-pattern-source-range', { x: Math.min(first.x, second.x), y: number(input.plot.top), width: Math.max(1, Math.abs(second.x - first.x)), height: input.plot.height, fill: input.color ?? '#2962ff', opacity: .08 });
      return true;
    }
    const sourceBase = number(source[0].close, number(source[0].open));
    const sourceBaseY = input.priceToCoordinate(sourceBase);
    if (!finite(sourceBaseY)) return false;
    const sourceBaseX = input.timeToCoordinate(source[0].time);
    if (!finite(sourceBaseX)) return false;
    const closes = source.map((bar) => {
      const sourceX = input.timeToCoordinate(bar.time);
      const closeY = input.priceToCoordinate(number(bar.close, sourceBase));
      if (!finite(sourceX) || !finite(closeY)) return null;
      return {
        x: clamp(third.x + (sourceX - sourceBaseX), number(input.plot.left), number(input.plot.left) + input.plot.width),
        y: clamp(third.y + (closeY - sourceBaseY), number(input.plot.top), number(input.plot.top) + input.plot.height),
      };
    }).filter((value): value is ForecastingScreenPoint => value !== null);
    if (!closes.length) return false;
    const candleWidth = Math.max(2, Math.min(12, Math.abs((input.timeToCoordinate(source[1]?.time ?? source[0].time) ?? sourceBaseX) - sourceBaseX) * .65 || 6));
    // Preserve every close in the consolidated path, while bounding individual
    // SVG candle primitives so very large patterns remain interactive.
    const candleStride = Math.max(1, Math.ceil(source.length / 300));
    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += candleStride) {
      const bar = source[sourceIndex];
      const sx = input.timeToCoordinate(bar.time); const o = input.priceToCoordinate(number(bar.open, sourceBase)); const c = input.priceToCoordinate(number(bar.close, sourceBase)); const hi = input.priceToCoordinate(number(bar.high, number(bar.close, sourceBase))); const lo = input.priceToCoordinate(number(bar.low, number(bar.close, sourceBase)));
      if (![sx, o, c, hi, lo].every(finite)) continue;
      const x = clamp(third.x + (sx - sourceBaseX), number(input.plot.left), number(input.plot.left) + input.plot.width);
      const oy = clamp(third.y + (o - sourceBaseY), number(input.plot.top), number(input.plot.top) + input.plot.height); const cy = clamp(third.y + (c - sourceBaseY), number(input.plot.top), number(input.plot.top) + input.plot.height); const hy = clamp(third.y + (hi - sourceBaseY), number(input.plot.top), number(input.plot.top) + input.plot.height); const ly = clamp(third.y + (lo - sourceBaseY), number(input.plot.top), number(input.plot.top) + input.plot.height);
      node(input.group, 'line', 'bars-pattern-candle-wick', { x1: x, x2: x, y1: hy, y2: ly, stroke: input.color ?? '#2962ff', 'stroke-width': 1, opacity: .72 });
      node(input.group, 'rect', 'bars-pattern-candle-body', { x: x - candleWidth / 2, y: Math.min(oy, cy), width: candleWidth, height: Math.max(1, Math.abs(cy - oy)), fill: input.color ?? '#2962ff', opacity: .34 });
    }
    node(input.group, 'path', 'bars-pattern-ghost-path', { d: path(closes), ...base, opacity: .38 });
    return true;
  }
  if (input.subtype === 'ghost_feed') {
    const pts = input.points.map((_, i) => pointAt(input, i)).filter((p): p is ForecastingScreenPoint => p !== null);
    if (pts.length < 2) return false;
    node(input.group, 'path', 'ghost-feed-path', { d: path(pts), ...base, opacity: .55 });
    // Fill every clicked segment with evenly-spaced translucent candles. The
    // interpolation includes each control point, so the forecast follows the
    // complete polyline instead of drawing only one candle per click.
    const candles: ForecastingScreenPoint[] = [pts[0]];
    for (let segment = 1; segment < pts.length; segment += 1) {
      const start = pts[segment - 1];
      const end = pts[segment];
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 8));
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        candles.push({
          x: start.x + ((end.x - start.x) * progress),
          y: start.y + ((end.y - start.y) * progress),
        });
      }
    }
    const stride = Math.max(1, Math.ceil((candles.length - 1) / 240));
    const candleIndices: number[] = [];
    for (let index = stride; index < candles.length; index += stride) candleIndices.push(index);
    if (candleIndices[candleIndices.length - 1] !== candles.length - 1) candleIndices.push(candles.length - 1);
    let previousIndex = 0;
    for (const index of candleIndices) {
      const previous = candles[previousIndex];
      const current = candles[index];
      const bodyTop = Math.min(previous.y, current.y);
      const bodyHeight = Math.max(2, Math.abs(current.y - previous.y));
      const candleColor = current.y <= previous.y ? '#26a69a' : '#ef5350';
      node(input.group, 'line', 'ghost-feed-candle-wick', {
        x1: current.x,
        x2: current.x,
        y1: Math.max(number(input.plot.top), bodyTop - 4),
        y2: Math.min(number(input.plot.top) + input.plot.height, bodyTop + bodyHeight + 4),
        stroke: candleColor,
        'stroke-width': 1,
        opacity: .35,
      });
      node(input.group, 'rect', 'ghost-feed-candle-body', {
        x: current.x - 2,
        y: bodyTop,
        width: 4,
        height: bodyHeight,
        fill: candleColor,
        opacity: .22,
      });
      previousIndex = index;
    }
    return true;
  }
  if (input.subtype === 'sector' && first && second) {
    const constrainedSecond = second;
    node(input.group, 'line', 'sector-first-ray', { x1: first.x, y1: first.y, x2: constrainedSecond.x, y2: constrainedSecond.y, ...base });
    if (!third) return true;
    const constrainedThird = projectSectorBoundaryPoint(first, constrainedSecond, third);
    const radius = Math.hypot(constrainedSecond.x - first.x, constrainedSecond.y - first.y);
    if (!radius) return false;
    const startAngle = Math.atan2(second.y - first.y, second.x - first.x);
    const endAngle = Math.atan2(constrainedThird.y - first.y, constrainedThird.x - first.x);
    const angle = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
    const large = 0;
    const sweep = angle < 0 ? 1 : 0;
    const d = `M ${first.x} ${first.y} L ${constrainedThird.x} ${constrainedThird.y} A ${radius} ${radius} 0 ${large} ${sweep} ${constrainedSecond.x} ${constrainedSecond.y} Z`;
    node(input.group, 'path', 'sector-fill', { d, stroke: input.color ?? '#2962ff', 'stroke-width': input.lineWidth ?? 1.5, fill: input.color ?? '#2962ff', opacity: .18 });
    node(input.group, 'line', 'sector-second-ray', { x1: first.x, y1: first.y, x2: constrainedThird.x, y2: constrainedThird.y, ...base });
    node(input.group, 'path', 'sector-arc', { d: `M ${constrainedThird.x} ${constrainedThird.y} A ${radius} ${radius} 0 ${large} ${sweep} ${constrainedSecond.x} ${constrainedSecond.y}`, ...base });
    return true;
  }
  if (input.subtype === 'anchored_vwap' && first) {
    const vwap = calculateAnchoredVwap(bars, input.points[0].time);
    if (!vwap.length) {
      callout(input, 'anchored-vwap-unavailable', first.x, first.y, ['Volume data unavailable']);
      return true;
    }
    const make = (key: keyof Pick<VwapPoint, 'value' | 'upper' | 'lower'>) => vwap.map((v) => computedPoint(input, v.time, v[key])).filter((p): p is ForecastingScreenPoint => p !== null);
    const points = make('value');
    if (points.length) node(input.group, 'path', 'anchored-vwap-line', { d: path(points), ...base });
    for (const key of ['upper', 'lower'] as const) node(input.group, 'path', `anchored-vwap-${key}`, { d: path(make(key)), ...base, stroke: '#089981', 'stroke-width': 1 });
    const last = vwap.at(-1)!;
    const lastPoint = computedPoint(input, last.time, last.value);
    if (lastPoint) callout(input, 'anchored-vwap-value', lastPoint.x, lastPoint.y - 20, [priceText(input, last.value)], { anchor: 'end' });
    return true;
  }
  if (input.subtype === 'fixed_range_volume_profile') return renderProfile(input, false);
  if (input.subtype === 'anchored_volume_profile') return renderProfile(input, true);
  if ((input.subtype === 'price_range' || input.subtype === 'date_range' || input.subtype === 'date_and_price_range') && first && second) {
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    const role = `${input.subtype.replaceAll('_', '-')}-box`;
    const delta = input.points[1].price - input.points[0].price; const percent = input.points[0].price ? (delta / input.points[0].price) * 100 : 0; const ticks = input.tickSize ? delta / input.tickSize : 0;
    const duration = elapsedText(input.points[1].time - input.points[0].time);
    const logicalSpan = finite(input.points[0].logicalIndex) && finite(input.points[1].logicalIndex)
      ? Math.abs(input.points[1].logicalIndex - input.points[0].logicalIndex)
      : null;
    const selectedBars = logicalSpan !== null
      ? Math.round(logicalSpan)
      : Math.max(0, selectBarsInTimeRange(bars, input.points[0].time, input.points[1].time).length - 1);
    const selectedSeries = selectBarsInTimeRange(bars, input.points[0].time, input.points[1].time);
    const selectedVolume = selectedSeries.reduce((sum, bar) => sum + Math.max(0, barVolume(bar)), 0);
    const priceDetails = `${delta >= 0 ? '' : '-'}${priceText(input, Math.abs(delta))} (${percent >= 0 ? '' : '-'}${Math.abs(percent).toFixed(2)}%)${input.tickSize ? ` ${ticks >= 0 ? '' : '-'}${Math.abs(ticks).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : ''}`;
    const dateDetails = `${selectedBars} bars, ${duration}`;
    const hasVolume = selectedSeries.every(bar => [bar.volume, bar.tickVolume, bar.realVolume].some(value => finite(value) && value >= 0));
    const volumeDetails = selectedSeries.length ? (hasVolume ? `Vol ${formatCompactVolume(selectedVolume)}` : 'Vol —') : '';

    if (input.subtype === 'price_range') {
      const start = { x: first.x, y: first.y };
      const end = { x: first.x, y: second.y };
      node(input.group, 'line', role, { x1: start.x, y1: start.y, x2: end.x, y2: end.y, ...base });
      node(input.group, 'path', `${role}-arrow`, { d: arrowHeadPath(start, end), ...base });
      callout(input, `${role}-label`, end.x, Math.min(start.y, end.y) - 28, [priceDetails], {
        fill: '#ffffff', textColor: '#131722', anchor: 'middle',
      });
      return true;
    }

    if (input.subtype === 'date_range') {
      const start = { x: first.x, y: first.y };
      const end = { x: second.x, y: first.y };
      node(input.group, 'line', role, { x1: start.x, y1: start.y, x2: end.x, y2: end.y, ...base });
      node(input.group, 'path', `${role}-arrow`, { d: arrowHeadPath(start, end), ...base });
      callout(input, `${role}-label`, (start.x + end.x) / 2, start.y + 10, [dateDetails, volumeDetails].filter(Boolean), {
        fill: '#ffffff', textColor: '#131722', anchor: 'middle',
      });
      return true;
    }

    node(input.group, 'rect', role, { x: left, y: top, width: Math.max(1, width), height: Math.max(1, height), ...base, fill: input.color ?? '#2962ff', opacity: .12 });
    const horizontalStart = { x: first.x, y: top + (height / 2) };
    const horizontalEnd = { x: second.x, y: top + (height / 2) };
    const verticalStart = { x: left + (width / 2), y: first.y };
    const verticalEnd = { x: left + (width / 2), y: second.y };
    node(input.group, 'line', `${role}-price-axis`, { x1: verticalStart.x, y1: verticalStart.y, x2: verticalEnd.x, y2: verticalEnd.y, ...base });
    node(input.group, 'path', `${role}-price-arrow`, { d: arrowHeadPath(verticalStart, verticalEnd), ...base });
    node(input.group, 'line', `${role}-date-axis`, { x1: horizontalStart.x, y1: horizontalStart.y, x2: horizontalEnd.x, y2: horizontalEnd.y, ...base });
    node(input.group, 'path', `${role}-date-arrow`, { d: arrowHeadPath(horizontalStart, horizontalEnd), ...base });
    callout(input, `${role}-price-label`, left + (width * .28), top - 34, [priceDetails], {
      fill: '#ffffff', textColor: '#131722', anchor: 'middle',
    });
    callout(input, `${role}-label`, left + (width * .72), top - 34, [dateDetails, volumeDetails].filter(Boolean), {
      fill: '#ffffff', textColor: '#131722', anchor: 'middle',
    });
    return true;
  }
  return false;
}

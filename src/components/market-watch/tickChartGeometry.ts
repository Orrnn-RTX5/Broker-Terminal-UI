export const MARKET_WATCH_TICK_CHART_LIMIT = 2_000;

/** MT5 draws one tick per pixel column at most; denser history scrolls off the left. */
const MIN_TICK_SPACING_PX = 1;
/** Free space right of the newest tick, where both quotes run flat to the frame. */
const RIGHT_GAP_RATIO = 0.05;
/** Closest price labels may sit, in font heights; MT5 labels its axis about this densely. */
const MIN_PRICE_LABEL_SPACING_RATIO = 2.2;
const TIME_LABEL_GAP_PX = 10;
const AXIS_TICK_PX = 4;
const LABEL_PADDING_PX = 6;
const PRICE_PADDING_RATIO = 0.06;
const MAX_DIGITS = 10;
const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;
/** Average advance of the tabular digits in the UI sans font, per pixel of font size. */
const CHARACTER_WIDTH_RATIO = 0.62;

export interface TickChartPoint {
  timestamp: number;
  bid: number;
  ask: number;
}

export interface TickChartLayoutOptions {
  width: number;
  height: number;
  /** Axis label font size in pixels. */
  fontSize: number;
  /** Broker price digits; null keeps the backend value's own precision. */
  digits: number | null;
  /** YYYY.MM.DD in broker server time. */
  formatDate: (epochMs: number) => string;
  /** HH:MM:SS in broker server time. */
  formatTime: (epochMs: number) => string;
}

export interface TickChartPriceTag {
  /** Vertical centre after moving overlapping tags apart. */
  y: number;
  label: string;
}

export interface TickChartCrosshair {
  /** Snapped tick index within `geometry.visiblePoints` (`0 .. visibleCount - 1`). */
  index: number;
  /** The inspected tick data point at `index`. */
  point: TickChartPoint;
  /** X coordinate of the vertical crosshair line, snapped to the inspected tick. */
  x: number;
  /** Y coordinate of the horizontal crosshair line, clamped to the plot. */
  y: number;
  /** Price corresponding to `y` on the vertical price scale. */
  price: number;
  /** Right-axis gray price badge at the crosshair Y level. */
  priceTag: {
    y: number;
    label: string;
  };
  /** Bottom-axis gray timestamp badge (`YYYY.MM.DD HH:MM:SS`) centered on `x`. */
  timeTag: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  };
  /** Floating `Bid / Ask` quote pill inside the plot near the crosshair intersection. */
  quotePill: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  };
}

export interface TickChartGeometry {
  plot: { left: number; top: number; right: number; bottom: number };
  axisWidth: number;
  axisHeight: number;
  tickLength: number;
  visibleCount: number;
  visiblePoints: readonly TickChartPoint[];
  minimumPrice: number;
  maximumPrice: number;
  labelDigits: number;
  bidPath: string;
  askPath: string;
  priceTicks: { y: number; label: string }[];
  timeTicks: { x: number; label: string }[];
  /** Broker-day boundaries, drawn as dashed separators. */
  separators: number[];
  askTag: TickChartPriceTag;
  bidTag: TickChartPriceTag;
  tagHeight: number;
  latest: TickChartPoint;
}

const coordinate = (value: number): string => (Math.round(value * 100) / 100).toString();

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const BACKEND_PRECISION_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: MAX_DIGITS,
  useGrouping: false,
});

/** Prints a price at broker digits, or exactly as the backend sent it. */
export const formatTickChartPrice = (value: number, digits: number | null): string => (
  digits === null ? BACKEND_PRECISION_FORMAT.format(value) : value.toFixed(digits)
);

const niceStep = (rawStep: number, minimumStep: number): { step: number; decimals: number } => {
  const safeRaw = Math.max(rawStep, minimumStep, Number.MIN_VALUE);
  const magnitude = 10 ** Math.floor(Math.log10(safeRaw));
  const multiplier = NICE_STEPS.find(candidate => candidate * magnitude >= safeRaw) ?? 10;
  const step = multiplier * magnitude;
  const decimals = clamp(-Math.floor(Math.log10(step)) + (multiplier === 2.5 ? 1 : 0), 0, MAX_DIGITS);
  return { step, decimals };
};

/**
 * Lays out an MT5 Market Watch tick chart in pixels. Ticks are spaced evenly
 * by arrival order, not by time, and each quote is drawn as a step line that
 * holds its price until the next tick.
 */
export function buildTickChartGeometry(
  points: readonly TickChartPoint[],
  { width, height, fontSize, digits, formatDate, formatTime }: TickChartLayoutOptions,
): TickChartGeometry | null {
  const candidates = points.slice(-MARKET_WATCH_TICK_CHART_LIMIT);
  if (candidates.length === 0 || width <= 0 || height <= 0) return null;

  const characterWidth = fontSize * CHARACTER_WIDTH_RATIO;
  const textWidth = (text: string): number => text.length * characterWidth;
  const widestPrice = candidates.reduce((widest, point) => Math.max(
    widest,
    textWidth(formatTickChartPrice(point.ask, digits)),
    textWidth(formatTickChartPrice(point.bid, digits)),
  ), 0);
  const axisWidth = Math.ceil(widestPrice + LABEL_PADDING_PX * 2 + AXIS_TICK_PX);
  const axisHeight = Math.ceil(fontSize + LABEL_PADDING_PX + AXIS_TICK_PX);
  const plot = {
    left: 0.5,
    top: 0.5,
    right: Math.max(1.5, width - axisWidth - 0.5),
    bottom: Math.max(1.5, height - axisHeight - 0.5),
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const drawWidth = plotWidth * (1 - RIGHT_GAP_RATIO);
  const visibleCount = clamp(Math.floor(drawWidth / MIN_TICK_SPACING_PX) + 1, 1, candidates.length);
  const visible = candidates.slice(-visibleCount);
  const latest = visible[visible.length - 1];

  let minimum = Math.min(...visible.map(point => Math.min(point.bid, point.ask)));
  let maximum = Math.max(...visible.map(point => Math.max(point.bid, point.ask)));
  const brokerStep = digits === null ? 0 : 10 ** -digits;
  const observedRange = maximum - minimum;
  const padding = observedRange > 0
    ? observedRange * PRICE_PADDING_RATIO
    : Math.max(brokerStep * 5, Math.abs(maximum) * 0.00001, Number.EPSILON);
  minimum -= padding;
  maximum += padding;
  const priceRange = maximum - minimum;
  // The finest round step whose labels still clear each other.
  const minimumLabelSpacing = fontSize * MIN_PRICE_LABEL_SPACING_RATIO;
  const { step, decimals } = niceStep(priceRange * minimumLabelSpacing / Math.max(plotHeight, 1), brokerStep);
  const lineCount = Math.ceil(priceRange / step) + 1;
  const labelDigits = digits ?? decimals;
  const yAt = (price: number): number => plot.top + (1 - (price - minimum) / priceRange) * plotHeight;
  const xAt = (index: number): number => (
    visibleCount === 1
      ? plot.left + drawWidth
      : plot.left + (index / (visibleCount - 1)) * drawWidth
  );

  const priceTicks: TickChartGeometry['priceTicks'] = [];
  const firstLine = Math.ceil(minimum / step);
  for (let line = firstLine; line * step <= maximum && line - firstLine <= lineCount; line += 1) {
    const price = line * step;
    priceTicks.push({ y: yAt(price), label: price.toFixed(labelDigits) });
  }

  const stepPath = (side: 'bid' | 'ask'): string => {
    const segments = [`M${coordinate(xAt(0))} ${coordinate(yAt(visible[0][side]))}`];
    for (let index = 1; index < visible.length; index += 1) {
      segments.push(`H${coordinate(xAt(index))}V${coordinate(yAt(visible[index][side]))}`);
    }
    segments.push(`H${coordinate(plot.right)}`);
    return segments.join('');
  };

  const separators: number[] = [];
  for (let index = 1; index < visible.length; index += 1) {
    if (formatDate(visible[index].timestamp) !== formatDate(visible[index - 1].timestamp)) {
      separators.push(xAt(index));
    }
  }

  // First label carries the date, the last the newest tick's full time, and
  // regularly spaced labels in between read HH:MM, all in broker server time.
  const timeTicks: TickChartGeometry['timeTicks'] = [];
  const dateLabel = formatDate(visible[0].timestamp);
  const lastLabel = formatTime(latest.timestamp);
  const lastX = xAt(visible.length - 1);
  const firstEnd = plot.left + textWidth(dateLabel) + TIME_LABEL_GAP_PX;
  timeTicks.push({ x: plot.left, label: dateLabel });
  if (visible.length > 1) {
    const spacing = textWidth('00:00') + TIME_LABEL_GAP_PX * 2;
    const indexStep = visibleCount === 1 ? 0 : drawWidth / (visibleCount - 1);
    for (let x = plot.left + spacing; x < lastX; x += spacing) {
      const index = indexStep > 0 ? Math.round((x - plot.left) / indexStep) : 0;
      const tickX = xAt(index);
      const previousX = timeTicks[timeTicks.length - 1]?.x ?? Number.NEGATIVE_INFINITY;
      const label = formatTime(visible[index].timestamp).slice(0, 5);
      if (tickX <= previousX || tickX < firstEnd || tickX + textWidth(label) + TIME_LABEL_GAP_PX > lastX) continue;
      timeTicks.push({ x: tickX, label });
    }
    if (lastX >= firstEnd) timeTicks.push({ x: lastX, label: lastLabel });
  }

  const tagHeight = Math.ceil(fontSize + 4);
  const halfTag = tagHeight / 2;
  let askY = yAt(latest.ask);
  let bidY = yAt(latest.bid);
  if (bidY - askY < tagHeight) {
    const middle = (askY + bidY) / 2;
    askY = middle - halfTag;
    bidY = middle + halfTag;
  }
  askY = clamp(askY, plot.top + halfTag, plot.bottom - halfTag * 3);
  bidY = clamp(Math.max(bidY, askY + tagHeight), plot.top + halfTag * 3, plot.bottom - halfTag);

  return {
    plot,
    axisWidth,
    axisHeight,
    tickLength: AXIS_TICK_PX,
    visibleCount,
    visiblePoints: visible,
    minimumPrice: minimum,
    maximumPrice: maximum,
    labelDigits,
    bidPath: stepPath('bid'),
    askPath: stepPath('ask'),
    priceTicks,
    timeTicks,
    separators,
    askTag: { y: askY, label: formatTickChartPrice(latest.ask, digits) },
    bidTag: { y: bidY, label: formatTickChartPrice(latest.bid, digits) },
    tagHeight,
    latest,
  };
}

const CROSSHAIR_PILL_GAP_PX = 5;
const CROSSHAIR_PILL_INSET_PX = 2;

/**
 * Computes MT5 Market Watch tick chart crosshair lines, right-axis price badge,
 * bottom-axis `YYYY.MM.DD HH:MM:SS` timestamp badge, and in-plot `Bid / Ask`
 * quote pill for a pointer position inside the plot area.
 */
export function buildTickChartCrosshair(
  geometry: TickChartGeometry,
  pointer: { x: number; y: number } | null,
  {
    fontSize,
    digits,
    formatDate,
    formatTime,
  }: Pick<TickChartLayoutOptions, 'fontSize' | 'digits' | 'formatDate' | 'formatTime'>,
): TickChartCrosshair | null {
  if (!pointer || geometry.visiblePoints.length === 0) return null;
  const { plot, visibleCount, visiblePoints, minimumPrice, maximumPrice, labelDigits, tagHeight } = geometry;
  if (
    pointer.x < plot.left
    || pointer.x > plot.right
    || pointer.y < plot.top
    || pointer.y > plot.bottom
  ) {
    return null;
  }

  const plotWidth = Math.max(1, plot.right - plot.left);
  const plotHeight = Math.max(1, plot.bottom - plot.top);
  const drawWidth = plotWidth * (1 - RIGHT_GAP_RATIO);
  const ratio = drawWidth > 0 ? clamp((pointer.x - plot.left) / drawWidth, 0, 1) : 0;
  const index = visibleCount <= 1
    ? 0
    : clamp(Math.round(ratio * (visibleCount - 1)), 0, visibleCount - 1);
  const point = visiblePoints[index];
  const x = visibleCount <= 1
    ? plot.left + drawWidth
    : plot.left + (index / (visibleCount - 1)) * drawWidth;
  const y = clamp(pointer.y, plot.top, plot.bottom);

  const priceRange = maximumPrice - minimumPrice;
  const price = minimumPrice + (1 - (y - plot.top) / plotHeight) * priceRange;
  const halfTag = tagHeight / 2;
  const priceTagY = clamp(y, plot.top + halfTag, plot.bottom - halfTag);
  const priceTagLabel = formatTickChartPrice(price, digits ?? labelDigits);

  const characterWidth = fontSize * CHARACTER_WIDTH_RATIO;
  const textWidth = (text: string): number => text.length * characterWidth;

  const timeLabel = `${formatDate(point.timestamp)} ${formatTime(point.timestamp)}`;
  const timeTagWidth = Math.min(plotWidth, Math.ceil(textWidth(timeLabel) + LABEL_PADDING_PX * 2));
  const timeTagX = clamp(
    x - timeTagWidth / 2,
    plot.left,
    Math.max(plot.left, plot.right - timeTagWidth),
  );
  const timeTagY = plot.bottom + 1;

  const pillLabel = `${formatTickChartPrice(point.bid, digits)} / ${formatTickChartPrice(point.ask, digits)}`;
  const pillWidth = Math.min(
    Math.max(1, plotWidth - CROSSHAIR_PILL_INSET_PX * 2),
    Math.ceil(textWidth(pillLabel) + LABEL_PADDING_PX * 2),
  );
  const pillHeight = tagHeight;
  const rawPillX = x + pillWidth <= plot.right - CROSSHAIR_PILL_INSET_PX
    ? x
    : x - pillWidth;
  const pillX = clamp(
    rawPillX,
    plot.left + CROSSHAIR_PILL_INSET_PX,
    Math.max(plot.left + CROSSHAIR_PILL_INSET_PX, plot.right - pillWidth - CROSSHAIR_PILL_INSET_PX),
  );
  const rawPillY = y - pillHeight - CROSSHAIR_PILL_GAP_PX >= plot.top + CROSSHAIR_PILL_INSET_PX
    ? y - pillHeight - CROSSHAIR_PILL_GAP_PX
    : y + CROSSHAIR_PILL_GAP_PX;
  const pillY = clamp(
    rawPillY,
    plot.top + CROSSHAIR_PILL_INSET_PX,
    Math.max(plot.top + CROSSHAIR_PILL_INSET_PX, plot.bottom - pillHeight - CROSSHAIR_PILL_INSET_PX),
  );

  return {
    index,
    point,
    x,
    y,
    price,
    priceTag: {
      y: priceTagY,
      label: priceTagLabel,
    },
    timeTag: {
      x: timeTagX,
      y: timeTagY,
      width: timeTagWidth,
      height: tagHeight,
      label: timeLabel,
    },
    quotePill: {
      x: pillX,
      y: pillY,
      width: pillWidth,
      height: pillHeight,
      label: pillLabel,
    },
  };
}


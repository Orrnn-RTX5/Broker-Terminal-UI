export const MARKET_WATCH_TICK_CHART_LIMIT = 2_000;

const VIEWBOX_WIDTH = 1_000;
const VIEWBOX_HEIGHT = 260;
const PLOT_LEFT = 18;
const PLOT_RIGHT = 18;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 18;

export interface TickChartPoint {
  timestamp: number;
  bid: number;
  ask: number;
}

export interface TickChartGeometry {
  bidPath: string;
  askPath: string;
  spreadPath: string;
  latestBid: { x: number; y: number };
  latestAsk: { x: number; y: number };
}

const coordinate = (value: number): string => value.toFixed(2);

export function buildTickChartGeometry(points: readonly TickChartPoint[]): TickChartGeometry | null {
  if (points.length === 0) return null;

  const plotWidth = VIEWBOX_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = VIEWBOX_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const timestamps = points.map(point => point.timestamp);
  const timeStart = Math.min(...timestamps);
  const timeEnd = Math.max(...timestamps);
  const hasTimeRange = Number.isFinite(timeStart) && Number.isFinite(timeEnd) && timeEnd > timeStart;
  const prices = points.flatMap(point => [point.bid, point.ask]);
  let minimum = Math.min(...prices);
  let maximum = Math.max(...prices);
  const observedRange = maximum - minimum;

  if (!Number.isFinite(observedRange) || observedRange <= 0) {
    const midpoint = Number.isFinite(maximum) ? maximum : 1;
    const minimumRange = Math.max(Math.abs(midpoint) * 0.00001, 0.00000001);
    minimum = midpoint - minimumRange / 2;
    maximum = midpoint + minimumRange / 2;
  } else {
    const pricePadding = observedRange * 0.08;
    minimum -= pricePadding;
    maximum += pricePadding;
  }

  const priceRange = Math.max(maximum - minimum, Number.EPSILON);
  const xAt = (point: TickChartPoint, index: number): number => {
    const progress = hasTimeRange
      ? (point.timestamp - timeStart) / (timeEnd - timeStart)
      : points.length === 1 ? 1 : index / (points.length - 1);
    return PLOT_LEFT + Math.max(0, Math.min(1, progress)) * plotWidth;
  };
  const yAt = (price: number): number => (
    PLOT_TOP + (1 - (price - minimum) / priceRange) * plotHeight
  );
  const pathFor = (key: 'bid' | 'ask'): string => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${coordinate(xAt(point, index))} ${coordinate(yAt(point[key]))}`)
    .join(' ');

  const askBoundary = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${coordinate(xAt(point, index))} ${coordinate(yAt(point.ask))}`)
    .join(' ');
  const bidBoundary = [...points]
    .reverse()
    .map((point, reverseIndex) => {
      const originalIndex = points.length - 1 - reverseIndex;
      return `L ${coordinate(xAt(point, originalIndex))} ${coordinate(yAt(point.bid))}`;
    })
    .join(' ');
  const lastIndex = points.length - 1;
  const latest = points[lastIndex];

  return {
    bidPath: pathFor('bid'),
    askPath: pathFor('ask'),
    spreadPath: `${askBoundary} ${bidBoundary} Z`,
    latestBid: { x: xAt(latest, lastIndex), y: yAt(latest.bid) },
    latestAsk: { x: xAt(latest, lastIndex), y: yAt(latest.ask) },
  };
}

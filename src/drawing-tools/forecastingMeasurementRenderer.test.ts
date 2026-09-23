import { describe, expect, it } from 'vitest';
import { buildVolumeProfile, calculateAnchoredVwap, projectSectorBoundaryPoint, renderForecastingMeasurementDrawing, resolveForecastSeries, selectBarsInTimeRange, type ForecastingMeasurementRendererInput, type ForecastingPoint } from './forecastingMeasurementRenderer';

const bars = [
  { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 2 },
  { time: 2, open: 11, high: 14, low: 10, close: 13, volume: 4 },
  { time: 3, open: 13, high: 15, low: 12, close: 14, volume: 3 },
];
const input = (subtype: ForecastingMeasurementRendererInput['subtype'], points: ForecastingPoint[] = [{ time: 1, price: 11 }, { time: 3, price: 14 }, { time: 3, price: 12 }]): ForecastingMeasurementRendererInput => {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  return { group, subtype, points, plot: { width: 400, height: 250 }, series: bars, timeToCoordinate: (time) => time * 100, priceToCoordinate: (price) => 250 - price * 10, formatPrice: (price) => price.toFixed(1), formatTime: (time) => `T${time}` };
};

describe('forecasting measurement renderer', () => {
  it.each([
    ['long_position', 1], ['short_position', 1], ['position_forecast', 2], ['bars_pattern', 3], ['ghost_feed', 3], ['sector', 3], ['anchored_vwap', 1], ['fixed_range_volume_profile', 2], ['anchored_volume_profile', 1], ['price_range', 2], ['date_range', 2], ['date_and_price_range', 2],
  ] as const)('renders %s with semantic geometry', (subtype, count) => {
    const drawing = input(subtype); drawing.points = drawing.points.slice(0, count);
    expect(renderForecastingMeasurementDrawing(drawing)).toBe(true);
    expect(drawing.group.querySelector('[data-geometry-role]')).not.toBeNull();
  });

  it('calculates data ranges, VWAP and volume bins deterministically', () => {
    expect(selectBarsInTimeRange(bars, 2, 3)).toHaveLength(2);
    expect(calculateAnchoredVwap(bars, 2)[0].value).toBeCloseTo((14 + 10 + 13) / 3);
    expect(buildVolumeProfile(bars, 4).reduce((sum, bin) => sum + bin.volume, 0)).toBe(9);
  });

  it('prefers the immutable Bars Pattern snapshot', () => {
    const snapshot = [{ time: 99, open: 50, high: 55, low: 45, close: 52, volume: 1 }];
    expect(resolveForecastSeries({ subtype: 'bars_pattern', series: bars, seriesSnapshot: snapshot })).toBe(snapshot);
    expect(resolveForecastSeries({ subtype: 'anchored_vwap', series: bars, seriesSnapshot: snapshot })).toBe(bars);
  });

  it('translates Bars Pattern from the selected source range to click three', () => {
    const drawing = input('bars_pattern');
    drawing.seriesSnapshot = bars;
    drawing.points = [{ time: 1, price: 11 }, { time: 2, price: 13 }, { time: 3, price: 14 }];
    expect(renderForecastingMeasurementDrawing(drawing)).toBe(true);
    expect(drawing.group.querySelector('[data-geometry-role="bars-pattern-ghost-path"]')?.getAttribute('d')).toContain('M 300 110');
  });

  it('uses the selected profile and anchored VWAP time range', () => {
    const profile = input('fixed_range_volume_profile'); profile.points = [{ time: 2, price: 13 }, { time: 3, price: 14 }];
    expect(renderForecastingMeasurementDrawing(profile)).toBe(true);
    expect(profile.group.querySelectorAll('[data-geometry-role="fixed-range-volume-profile-bin"]').length).toBeGreaterThan(0);
    const vwap = input('anchored_vwap'); vwap.points = [{ time: 2, price: 13 }];
    renderForecastingMeasurementDrawing(vwap);
    expect(vwap.group.querySelector('[data-geometry-role="anchored-vwap-line"]')).not.toBeNull();
  });

  it('uses callbacks for computed geometry even when an anchor screen point is supplied', () => {
    const position = input('long_position', [{ time: 1, price: 11 }]);
    position.screenPoints = [{ x: 100, y: 140 }];
    renderForecastingMeasurementDrawing(position);
    const target = position.group.querySelector('[data-geometry-role="long-position-target"]');
    expect(target?.getAttribute('y1')).not.toBe('140');
    expect(Number(target?.getAttribute('y1'))).toBeLessThan(140);
    const vwap = input('anchored_vwap', [{ time: 1, price: 11 }]);
    vwap.screenPoints = [{ x: 100, y: 140 }]; renderForecastingMeasurementDrawing(vwap);
    expect(vwap.group.querySelector('[data-geometry-role="anchored-vwap-line"]')?.getAttribute('d')).toContain('L 200');
    const profile = input('fixed_range_volume_profile'); profile.screenPoints = [{ x: 100, y: 140 }, { x: 300, y: 110 }];
    renderForecastingMeasurementDrawing(profile);
    expect(Number(profile.group.querySelector('[data-geometry-role="fixed-range-volume-profile-bin"]')?.getAttribute('height'))).toBeGreaterThan(1);
  });

  it('renders staged Bars Pattern and Sector geometry', () => {
    const pattern = input('bars_pattern'); pattern.points = pattern.points.slice(0, 2);
    expect(renderForecastingMeasurementDrawing(pattern)).toBe(true);
    expect(pattern.group.querySelector('[data-geometry-role="bars-pattern-source-range"]')).not.toBeNull();
    const sector = input('sector'); sector.points = sector.points.slice(0, 2);
    expect(renderForecastingMeasurementDrawing(sector)).toBe(true);
    expect(sector.group.querySelector('[data-geometry-role="sector-first-ray"]')).not.toBeNull();
  });

  it('matches TradingView position defaults with symmetric risk zones and detailed labels', () => {
    const position = input('long_position', [{ time: 1, price: 100 }]);
    position.tickSize = 1;
    position.currentPrice = 99;
    position.series = [];
    position.positionSizing = { accountSize: 1000, risk: 250, riskMode: 'amount', pointValue: 1, lotSize: 1 };
    position.positionTargetPrice = 110;
    position.positionStopPrice = 90;
    expect(renderForecastingMeasurementDrawing(position)).toBe(true);

    const target = position.group.querySelector('[data-geometry-role="long-position-target"]');
    const entry = position.group.querySelector('[data-geometry-role="long-position-entry"]');
    const stop = position.group.querySelector('[data-geometry-role="long-position-stop"]');
    expect(Number(entry?.getAttribute('y1')) - Number(target?.getAttribute('y1')))
      .toBeCloseTo(Number(stop?.getAttribute('y1')) - Number(entry?.getAttribute('y1')));
    expect(position.group.querySelector('[data-geometry-role="long-position-target-label"]'))
      .toHaveTextContent('Target: 10.0 (10.00%) 10, Amount: 1,250');
    expect(position.group.querySelector('[data-geometry-role="long-position-stop-label"]'))
      .toHaveTextContent('Stop: 10.0 (10.00%) 10, Amount: 750');
    expect(position.group.querySelector('[data-geometry-role="long-position-stats"]'))
      .toHaveTextContent('Open PnL: -1.0, Qty: 25Risk/reward ratio: 1');
  });

  it('renders Position Forecast as a curved two-click projection with deadline status and endpoint labels', () => {
    const forecast = input('position_forecast', [
      { time: 1, price: 11 },
      { time: 3, price: 20 },
    ]);
    forecast.tickSize = 1;
    expect(renderForecastingMeasurementDrawing(forecast)).toBe(true);
    expect(forecast.group.querySelector('[data-geometry-role="forecast-projection"]')?.getAttribute('d'))
      .toBe('M 100 140 Q 300 140 300 50');
    expect(forecast.group.querySelector('[data-geometry-role="position-forecast-status"]'))
      .toHaveAttribute('data-status', 'failure');
    expect(forecast.group.querySelector('[data-geometry-role="position-forecast-end-label"]'))
      .toHaveTextContent('9.0 (81.82%) in 2s20.0 @ T3');
    expect(forecast.group.querySelector('[data-geometry-role="position-forecast-start-label"]'))
      .toHaveTextContent('11.0T1');
  });

  it('projects Sector click three onto the radius and renders one filled circular slice', () => {
    const projected = projectSectorBoundaryPoint(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 6, y: -8 },
    );
    expect(projected).toEqual({ x: 6, y: -8 });

    const sector = input('sector', [
      { time: 1, price: 11 },
      { time: 3, price: 11 },
      { time: 2, price: 21 },
    ]);
    expect(renderForecastingMeasurementDrawing(sector)).toBe(true);
    expect(sector.group.querySelector('[data-geometry-role="sector-fill"]')).not.toBeNull();
    expect(sector.group.querySelector('[data-geometry-role="sector-annulus-fill"]')).toBeNull();
    expect(sector.group.querySelectorAll('[data-geometry-role="sector-arc"]')).toHaveLength(1);
  });

  it('fills every Ghost Feed control-point segment with forecast candles', () => {
    const ghost = input('ghost_feed', [
      { time: 1, price: 11 },
      { time: 2, price: 14 },
      { time: 3, price: 10 },
    ]);
    expect(renderForecastingMeasurementDrawing(ghost)).toBe(true);
    const pathNode = ghost.group.querySelector('[data-geometry-role="ghost-feed-path"]');
    const candleBodies = ghost.group.querySelectorAll('[data-geometry-role="ghost-feed-candle-body"]');
    expect(pathNode?.getAttribute('d')).toBe('M 100 140 L 200 110 L 300 150');
    expect(candleBodies.length).toBeGreaterThan(3);
    expect(candleBodies.length).toBeLessThanOrEqual(240);
    expect(candleBodies.item(candleBodies.length - 1).getAttribute('x')).toBe('298');
  });

  it('formats date-range elapsed values from second-based chart timestamps', () => {
    const range = input('date_range', [{ time: 1, price: 11 }, { time: 121, price: 14 }]);
    renderForecastingMeasurementDrawing(range);
    expect(range.group.querySelector('[data-geometry-role="date-range-box-label"]')).toHaveTextContent('2 bars, 2mVol 9');
    expect(range.group.querySelector('[data-geometry-role="date-range-box-arrow"]')).not.toBeNull();
  });

  it('renders TradingView-style arrows for price and combined ranges', () => {
    const priceRange = input('price_range', [{ time: 1, price: 11 }, { time: 3, price: 14 }]);
    renderForecastingMeasurementDrawing(priceRange);
    expect(priceRange.group.querySelector('[data-geometry-role="price-range-box"]')?.tagName).toBe('line');
    expect(priceRange.group.querySelector('[data-geometry-role="price-range-box-arrow"]')).not.toBeNull();

    const combined = input('date_and_price_range', [{ time: 1, price: 11 }, { time: 3, price: 14 }]);
    renderForecastingMeasurementDrawing(combined);
    expect(combined.group.querySelector('[data-geometry-role="date-and-price-range-box"]')?.tagName).toBe('rect');
    expect(combined.group.querySelector('[data-geometry-role="date-and-price-range-box-price-arrow"]')).not.toBeNull();
    expect(combined.group.querySelector('[data-geometry-role="date-and-price-range-box-date-arrow"]')).not.toBeNull();
  });

  it('renders a future-margin position from its supplied logical screen anchor', () => {
    const position = input('long_position', [{ time: 999, price: 11, logicalIndex: 9 }]);
    position.screenPoints = [{ x: 340, y: 140 }];
    position.timeToCoordinate = () => null;
    position.logicalToCoordinate = logical => logical * 40;
    position.positionEndLogicalIndex = 10;
    position.selected = true;
    expect(renderForecastingMeasurementDrawing(position)).toBe(true);
    expect(position.group.querySelector('[data-geometry-role="long-position-target"]')).not.toBeNull();
    expect(position.group.querySelector('[data-geometry-role="long-position-duration-edge"]')?.getAttribute('x1'))
      .toBe('380');
  });

  it('keeps an explicitly empty Bars Pattern snapshot authoritative', () => {
    const pattern = input('bars_pattern');
    pattern.seriesSnapshot = [];
    expect(resolveForecastSeries(pattern)).toEqual([]);
    expect(renderForecastingMeasurementDrawing(pattern)).toBe(false);
  });

  it('places a reverse-selected fixed profile at the right edge without collapsing the range', () => {
    const profile = input('fixed_range_volume_profile', [{ time: 3, price: 14 }, { time: 1, price: 11 }]);
    profile.screenPoints = [{ x: 300, y: 110 }, { x: 100, y: 140 }];
    expect(renderForecastingMeasurementDrawing(profile)).toBe(true);
    const range = profile.group.querySelector('[data-geometry-role="fixed-range-volume-profile-range"]');
    const bin = profile.group.querySelector('[data-geometry-role="fixed-range-volume-profile-bin"]');
    expect(range?.getAttribute('x')).toBe('100');
    expect(range?.getAttribute('width')).toBe('200');
    expect(Number(bin?.getAttribute('x')) + Number(bin?.getAttribute('width'))).toBe(300);
  });

  it('uses logical distance for date-range bars including future whitespace', () => {
    const range = input('date_range', [
      { time: 1, price: 11, logicalIndex: 5 },
      { time: 121, price: 14, logicalIndex: 12.5 },
    ]);
    renderForecastingMeasurementDrawing(range);
    expect(range.group.querySelector('[data-geometry-role="date-range-box-label"]')).toHaveTextContent('8 bars');
  });
});

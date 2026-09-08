import { describe, expect, it } from 'vitest';
import { renderGannFibonacciDrawing, type GannFibonacciRenderInput } from './gannFibonacciRenderer';
import { renderForecastingMeasurementDrawing } from './forecastingMeasurementRenderer';

const input = (subtype: string, scale = 1): GannFibonacciRenderInput => ({
  group: document.createElementNS('http://www.w3.org/2000/svg', 'g'), subtype,
  dataPoints: [{ price: 100 }, { price: 80 }, { price: 110 }],
  screenPoints: [{ x: 20 * scale, y: 100 * scale }, { x: 120 * scale, y: 120 * scale }, { x: 180 * scale, y: 90 * scale }],
  plotWidth: 800 * scale, plotHeight: 500 * scale,
  color: '#2962ff', lineWidth: 2, dash: '', opacity: '1',
  priceToCoordinate: price => (200 - price) * scale, formatPrice: price => price.toFixed(2),
});

describe('values compared with TradingView recordings', () => {
  it('clips an offscreen position target without moving its price to the chart edge', () => {
    const group = input('long_position').group;
    renderForecastingMeasurementDrawing({ group, subtype: 'long_position', points: [{ time: 1, price: 100 }],
      positionTargetPrice: 250, positionStopPrice: 90, plot: { width: 400, height: 200 },
      timeToCoordinate: time => time * 100, priceToCoordinate: price => 200 - price,
    });
    expect(group.querySelector('[data-geometry-role="long-position-target"]')).toHaveAttribute('y1', '-50');
    expect(group.querySelector('svg')).toHaveAttribute('overflow', 'hidden');
  });
  it('starts Fib Channel level 1 at anchor three and shows each derived price', () => {
    const drawing = input('fib_channel'); renderGannFibonacciDrawing(drawing);
    const level = drawing.group.querySelector('[data-geometry-role="fib-channel-level-1"]')!;
    expect(Number(level.getAttribute('x1'))).toBe(180);
    expect(Number(level.getAttribute('y1'))).toBe(90);
    expect(drawing.group.querySelector('[data-geometry-role="fib-channel-label-0-236"]')).toHaveTextContent('0.236 (102.36)');
    expect(drawing.group.querySelector('[data-geometry-role="fib-channel-label-1"]')).toHaveTextContent('1 (110.00)');
  });
  it('keeps Fib Channel prices unchanged through zoom and recomputes them after an anchor move', () => {
    const normal = input('fib_channel'); const zoomed = input('fib_channel', 2);
    renderGannFibonacciDrawing(normal); renderGannFibonacciDrawing(zoomed);
    expect(zoomed.group.textContent).toBe(normal.group.textContent);
    zoomed.group.replaceChildren(); zoomed.dataPoints = [{ price: 100 }, { price: 80 }, { price: 120 }];
    renderGannFibonacciDrawing(zoomed);
    expect(zoomed.group.querySelector('[data-geometry-role="fib-channel-label-0-5"]')).toHaveTextContent('0.5 (110.00)');
  });
  it('labels Gann fan time/price ratios in the same direction as TradingView', () => {
    const drawing = input('gann_fan'); renderGannFibonacciDrawing(drawing);
    expect(drawing.group.querySelector('[data-geometry-role="gann-fan-label-1x8"]')).toHaveTextContent('8/1');
    expect(drawing.group.querySelector('[data-geometry-role="gann-fan-label-8x1"]')).toHaveTextContent('1/8');
  });
  it('labels the speed resistance fan from one at the origin to zero at the second anchor', () => {
    const drawing = input('fib_speed_resistance_fan'); renderGannFibonacciDrawing(drawing);
    expect(drawing.group.querySelector('[data-geometry-role="fib-speed-fan-price-label-0"]')).toHaveTextContent('1');
    expect(drawing.group.querySelector('[data-geometry-role="fib-speed-fan-price-label-1"]')).toHaveTextContent('0');
  });
  it('preserves signed forecast offsets and waits until the deadline to declare failure', () => {
    const drawing = input('position_forecast');
    renderForecastingMeasurementDrawing({ group: drawing.group, subtype: 'position_forecast',
      points: [{ time: 1, price: 100 }, { time: 3, price: 90 }],
      plot: { width: 400, height: 250 }, timeToCoordinate: time => time * 100,
      priceToCoordinate: price => 200 - price, formatPrice: price => price.toFixed(2),
      series: [{ time: 1, open: 101, high: 102, low: 100, close: 102 }], latestPrice: 102,
    });
    expect(drawing.group.querySelector('[data-geometry-role="position-forecast-end-label"]')).toHaveTextContent('-10.00 (-10.00%)');
    expect(drawing.group.querySelector('[data-geometry-role="position-forecast-status"]')).toHaveAttribute('data-status', 'pending');
  });
});

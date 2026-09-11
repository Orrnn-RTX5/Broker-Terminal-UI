import { describe, expect, it } from 'vitest';
import { isChartLegendPainted, paintChartLegend, type ChartLegendRefs } from './chartLegend';

const values = { open: '4401.25', high: '4408.50', low: '4399.75', close: '4405.00', volume: '12,345' };
const mountedRefs = (): ChartLegendRefs => Object.fromEntries(
  Object.keys(values).map((key) => [key, { current: document.createElement('span') }]),
) as ChartLegendRefs;

describe('OHLC legend rendering', () => {
  it('does not mark hidden labels as painted and repaints unchanged values when shown', () => {
    const refs = mountedRefs();
    refs.open.current = null;
    expect(paintChartLegend(refs, values)).toBe(false);
    expect(isChartLegendPainted(refs, values)).toBe(false);
    refs.open.current = document.createElement('span');
    expect(paintChartLegend(refs, values)).toBe(true);
    expect(isChartLegendPainted(refs, values)).toBe(true);
    expect(refs.high.current?.textContent).toBe('4408.50');
  });

  it('detects replaced or cleared text nodes despite identical cached prices', () => {
    const refs = mountedRefs();
    paintChartLegend(refs, values);
    refs.open.current = document.createElement('span');
    expect(isChartLegendPainted(refs, values)).toBe(false);
    paintChartLegend(refs, values);
    expect(isChartLegendPainted(refs, values)).toBe(true);
    refs.close.current!.textContent = '';
    expect(isChartLegendPainted(refs, values)).toBe(false);
    paintChartLegend(refs, values);
    expect(refs.close.current?.textContent).toBe(values.close);
  });
});

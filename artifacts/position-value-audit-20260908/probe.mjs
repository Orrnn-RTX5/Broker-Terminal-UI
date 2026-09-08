// Read-only source audit: run the production SVG renderer with deterministic candles.
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../../src/drawing-tools/forecastingMeasurementRenderer.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { renderForecastingMeasurementDrawing } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
globalThis.document = new JSDOM('').window.document;

const render = (overrides = {}) => {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const values = {
    group, subtype: 'long_position', points: [{ time: 1, price: 100 }],
    positionTargetPrice: 110, positionStopPrice: 90, positionEndTime: 3,
    currentPrice: 105, tickSize: .01, plot: { width: 600, height: 600 },
    timeToCoordinate: time => time * 10, priceToCoordinate: price => 500 - price,
    formatPrice: price => price.toFixed(2),
    series: [
      { time: 1, open: 100, high: 101, low: 99, close: 100 },
      { time: 2, open: 100, high: 105, low: 99, close: 104 },
      { time: 3, open: 104, high: 105, low: 102, close: 103 },
      { time: 4, open: 103, high: 106, low: 102, close: 105 },
    ], ...overrides,
  };
  renderForecastingMeasurementDrawing(values);
  const prefix = values.subtype.replace('_', '-');
  const text = role => group.querySelector(`[data-geometry-role="${prefix}-${role}"]`)?.textContent;
  return { target: text('target-label'), stop: text('stop-label'), stats: text('stats') };
};
const results = [];
const check = (name, actual, expected, pass) => results.push({ name, pass, actual, expected });
const long = render();
check('Long target distance, percentage, and ticks', long.target, '10.00, 10.00%, 1,000 ticks', long.target.includes('10.00 (10.00%) 1,000'));
check('Symmetric risk/reward', long.stats, 'Ratio 1', long.stats.includes('Risk/reward ratio: 1'));
check('Historical Long PnL at right edge t=3', long.stats, 'Open PnL: 3.000 (103 - 100)', long.stats.includes('Open PnL: 3.000'));
const short = render({ subtype: 'short_position', positionTargetPrice: 90, positionStopPrice: 110, currentPrice: 95,
  series: [{ time: 1, open: 100, high: 101, low: 99, close: 100 }, { time: 3, open: 98, high: 99, low: 96, close: 97 }, { time: 4, open: 97, high: 98, low: 94, close: 95 }] });
check('Historical Short PnL at right edge t=3', short.stats, 'Open PnL: 3.000 (100 - 97)', short.stats.includes('Open PnL: 3.000'));
const future = render({ points: [{ time: 40, price: 100 }], positionEndTime: 80 });
check('Future Long PnL uses price offset, not quantity-scaled money', future.stats, 'Open PnL: 5.000 (105 - 100)', future.stats.includes('Open PnL: 5.000'));
const closed = render({ currentPrice: 107, series: [
  { time: 1, open: 100, high: 101, low: 99, close: 100 },
  { time: 2, open: 105, high: 111, low: 104, close: 108 },
  { time: 3, open: 108, high: 109, low: 106, close: 107 },
] });
check('Target hit inside drawing closes displayed result', closed.stats, 'Closed PnL: 10.000', closed.stats.includes('Closed PnL: 10.000'));
const missing = render({ currentPrice: undefined, series: [] });
check('Missing candles and price do not assert zero PnL', missing.stats, 'Unavailable PnL', !missing.stats.includes('Open PnL: 0.000'));
const wide = render({ points: [{ time: 1, price: 1000 }], positionTargetPrice: 1500, positionStopPrice: 500, currentPrice: 1000 });
check('Quantity does not force a minimum that exceeds the 250 risk assumption', wide.stats, 'Raw qty 0.5; zero whole units if integer-only', !wide.stats.includes('Qty: 1Risk'));
check('Long/Short opposite signed price movements produce equal positive PnL magnitude', { long: long.stats, short: short.stats }, 'Equal values (unit/time semantics audited separately)', long.stats === short.stats);
await writeFile(new URL('results.json', import.meta.url), JSON.stringify({ productionSource: 'src/drawing-tools/forecastingMeasurementRenderer.ts', results }, null, 2));
console.log(JSON.stringify(results, null, 2));

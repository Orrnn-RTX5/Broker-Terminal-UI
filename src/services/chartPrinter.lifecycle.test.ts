import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartPrinter, DEFAULT_PRINT_PREFERENCES } from './chartPrinter';
import { activateActiveChartSource, clearActiveChartSources, registerActiveChartSource } from './activeChartSource';
import render from 'html2canvas-pro';

vi.mock('html2canvas-pro', () => ({ default: vi.fn() }));

const makeData = () => {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,test');
  return { symbol: 'XAUUSD', timeframe: 'M5', chartCanvas: canvas, indicators: [], drawings: [] };
};

afterEach(() => { clearActiveChartSources(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('chart print document', () => {
  it('fits all supported physical paper sizes and keeps margins in millimetres', () => {
    for (const pageSize of ['A4', 'A3', 'Letter', 'Legal'] as const) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const preferences = { ...DEFAULT_PRINT_PREFERENCES, pageSize, orientation };
        const html = chartPrinter.generatePrintableHTML(makeData(), preferences);
        const size = chartPrinter.getPageDimensions(preferences);
        expect(size.width > size.height).toBe(orientation === 'landscape');
        expect(html).toContain(`size: ${pageSize} ${orientation}`);
        expect(html).toContain('padding: 20mm 20mm 20mm 20mm');
        expect(html).not.toContain('page-break-after: always');
        expect(html).not.toContain('object-fit: cover');
      }
    }
  });

  it('escapes custom text and does not invent a visible date range', () => {
    const html = chartPrinter.generatePrintableHTML(makeData(), {
      ...DEFAULT_PRINT_PREFERENCES, headerText: '<img src=x onerror=alert(1)>', footerText: '<script>bad()</script>',
    });
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Date Range:');
  });

  it('waits for the print document to load and retains it until afterprint', async () => {
    const promise = chartPrinter.printChart(makeData());
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Chart print document"]')!;
    expect(frame).not.toBeNull();
    const target = frame.contentWindow!;
    const print = vi.spyOn(target, 'print').mockImplementation(() => {});
    vi.spyOn(target, 'focus').mockImplementation(() => {});
    expect(print).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event('load'));
    await promise;
    expect(print).toHaveBeenCalledTimes(1);
    expect(frame.isConnected).toBe(true);
    await expect(chartPrinter.printChart(makeData())).rejects.toThrow('already open');
    target.dispatchEvent(new Event('afterprint'));
    expect(frame.isConnected).toBe(false);
  });

  it('rejects an empty capture instead of printing a blank page', async () => {
    await expect(chartPrinter.printChart({ symbol: 'XAUUSD', timeframe: 'M1', indicators: [], drawings: [] }))
      .rejects.toThrow('No chart image');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('active chart print capture', () => {
  it('captures the selected whole chart container with its actual date range', async () => {
    const first = document.createElement('div');
    const active = document.createElement('div');
    active.append(document.createElement('canvas'), document.createElement('canvas'), document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    document.body.append(first, active);
    vi.spyOn(active, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 500 } as DOMRect);
    registerActiveChartSource({ id: 'first', getContainer: () => first, getSymbol: () => 'EURUSD', getTimeframe: () => 'M1' });
    const range = { from: new Date('2026-01-01'), to: new Date('2026-09-01') };
    registerActiveChartSource({ id: 'active', getContainer: () => active, getSymbol: () => 'XAUUSD', getTimeframe: () => 'MN', getDateRange: () => range });
    activateActiveChartSource('active');
    const canvas = document.createElement('canvas');
    vi.mocked(render).mockResolvedValue(canvas);
    const data = await chartPrinter.captureActiveChartData();
    expect(data).toMatchObject({ symbol: 'XAUUSD', timeframe: 'MN', dateRange: range, chartCanvas: canvas });
    expect(render).toHaveBeenCalledWith(active, expect.objectContaining({ width: 1000, height: 500 }));
  });

  it('reports when no active chart is available', async () => {
    await expect(chartPrinter.captureActiveChartData()).rejects.toThrow('Open a chart');
  });
});

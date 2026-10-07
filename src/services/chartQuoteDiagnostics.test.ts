// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('chart quote timing evidence', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(performance.now()));
  };
  beforeEach(() => {
    vi.resetModules(); frames = new Map(); nextFrame = 0;
    delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  });
  afterEach(() => { document.body.replaceChildren(); delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; vi.restoreAllMocks(); });
  const tick = (sequence: string) => ({ provider_timestamp: 1_800_000_000_000, sequence, source: 'cserver' });
  const node = () => { const element = document.createElement('span'); element.textContent = '100'; document.body.append(element); return element; };

  it('does no recording or frame scheduling unless opted in', async () => {
    const c = await import('./chartQuoteDiagnostics');
    c.recordChartQuoteSelection('chart', 'BTCUSD', 'M1', tick('1'), 100);
    c.recordChartPricePaint('chart', 'BTCUSD', 'M1', 100, node());
    expect(frames.size).toBe(0);
    expect((await import('./quoteDiagnostics')).getQuoteDiagnosticDump().quotes).toEqual([]);
  });

  it('keeps exact quote identities and distinguishes a DOM write from a rendering opportunity', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const c = await import('./chartQuoteDiagnostics');
    c.recordChartQuoteSelection('private-internal-chart-id', 'BTCUSD', 'M1', tick('18446744073709551615'), 100);
    c.recordChartPricePaint('private-internal-chart-id', 'BTCUSD', 'M1', 100, node());
    const d = await import('./quoteDiagnostics');
    expect(d.getQuoteDiagnosticDump().quotes.map(r => r.phase)).toEqual(['chart-update', 'chart-dom-write']);
    flushFrame(); flushFrame();
    const records = d.getQuoteDiagnosticDump().quotes;
    expect(records.at(-1)).toMatchObject({ phase: 'chart-render-opportunity', hubSequence: '18446744073709551615', timeframe: 'M1', providerTimestamp: 1_800_000_000_000 });
    expect(JSON.stringify(records)).not.toContain('private-internal-chart-id');
    expect(records.at(-1)).toHaveProperty('domWriteMonoMs');
    expect(records.at(-1)).toHaveProperty('frameOpportunityMonoMs');
  });

  it('does not associate another chart, superseded quote or old session with a paint', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const c = await import('./chartQuoteDiagnostics'); const element = node();
    c.recordChartQuoteSelection('one', 'BTCUSD', 'M1', tick('1'), 100);
    c.recordChartPricePaint('two', 'BTCUSD', 'M1', 100, element);
    expect(frames.size).toBe(0);
    c.recordChartPricePaint('one', 'BTCUSD', 'M1', 100, element);
    c.recordChartQuoteSelection('one', 'BTCUSD', 'M1', tick('2'), 100);
    flushFrame(); flushFrame();
    c.recordChartPricePaint('one', 'BTCUSD', 'M1', 100, element);
    (await import('./terminalQuoteFreshness')).resetTerminalQuoteFreshness();
    flushFrame(); flushFrame();
    const records = (await import('./quoteDiagnostics')).getQuoteDiagnosticDump().quotes;
    expect(records.some(r => r.phase === 'chart-render-opportunity')).toBe(false);
  });

  it('never substitutes a display timestamp for missing provider evidence and cancels hidden overlays', async () => {
    window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
    const c = await import('./chartQuoteDiagnostics'); const element = node();
    c.recordChartQuoteSelection('chart', 'BTCUSD', 'M1', { timestamp: 1_800_000_000_000, sourceTimestamp: 1_800_000_000_000 }, 100);
    c.recordChartPricePaint('chart', 'BTCUSD', 'M1', 100, element);
    c.cancelChartPaintDiagnostic(element); flushFrame(); flushFrame();
    const records = (await import('./quoteDiagnostics')).getQuoteDiagnosticDump().quotes;
    expect(records.every(r => r.providerTimestamp === undefined)).toBe(true);
    expect(records.some(r => r.phase === 'chart-render-opportunity')).toBe(false);
  });
});

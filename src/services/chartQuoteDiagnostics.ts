import { quoteDiagnosticsEnabled, recordQuoteDiagnostic, type QuoteDiagnosticInput } from './quoteDiagnostics';
import { getTerminalQuoteSession } from './terminalQuoteFreshness';

// Evidence only: never enters the quote cache, candle model, or order path.
const selections = new Map<string, QuoteDiagnosticInput>();
const pendingFrames = new WeakMap<Element, number>();
const key = (chartId: string, symbol: string, timeframe: string) => `${chartId}:${symbol}:${timeframe}`;

export function recordChartQuoteSelection(chartId: string, symbol: string, timeframe: string, tick: {
  provider_timestamp?: unknown; sourceTimestamp?: unknown; timestamp?: unknown;
  sequence?: unknown; source?: unknown;
}, rawBid: number): void {
  if (!quoteDiagnosticsEnabled()) return;
  const providerTimestamp = Number(tick.provider_timestamp);
  const sequence = typeof tick.sequence === 'string' || typeof tick.sequence === 'number' ? tick.sequence : undefined;
  const evidence: QuoteDiagnosticInput = {
    kind: 'quote', phase: 'chart-update', symbol, timeframe,
    browserGeneration: getTerminalQuoteSession(),
    providerTimestamp: Number.isFinite(providerTimestamp) && providerTimestamp > 0 ? providerTimestamp : undefined,
    hubSequence: sequence, source: typeof tick.source === 'string' ? tick.source : undefined,
    rawBid, chartUpdateMonoMs: performance.now(),
  };
  const identity = key(chartId, symbol, timeframe);
  selections.delete(identity);
  selections.set(identity, evidence);
  if (selections.size > 32) selections.delete(selections.keys().next().value!);
  recordQuoteDiagnostic(evidence);
}

export function cancelChartPaintDiagnostic(element: Element | null): void {
  if (!element) return;
  const frame = pendingFrames.get(element);
  if (frame !== undefined) cancelAnimationFrame(frame);
  pendingFrames.delete(element);
}

export function recordChartPricePaint(chartId: string, symbol: string, timeframe: string, price: number, element: HTMLElement): void {
  if (!quoteDiagnosticsEnabled()) return;
  const evidence = selections.get(key(chartId, symbol, timeframe));
  if (!evidence || evidence.browserGeneration !== getTerminalQuoteSession() || evidence.rawBid !== price) return;
  const text = element.textContent;
  const domWriteMonoMs = performance.now();
  recordQuoteDiagnostic({ ...evidence, phase: 'chart-dom-write', domWriteMonoMs,
    foreground: document.visibilityState === 'visible' });
  cancelChartPaintDiagnostic(element);
  // Two rAF callbacks bracket a rendering opportunity. This is an upper-bound
  // proxy, NOT proof that the compositor displayed these pixels. Short Chrome
  // Paint traces provide separate verification; exports retain this distinction.
  const stillCurrent = () => quoteDiagnosticsEnabled() && element.isConnected
    && element.textContent === text && evidence.browserGeneration === getTerminalQuoteSession()
    && selections.get(key(chartId, symbol, timeframe)) === evidence;
  pendingFrames.set(element, requestAnimationFrame(() => {
    if (!stillCurrent()) { pendingFrames.delete(element); return; }
    pendingFrames.set(element, requestAnimationFrame(() => {
      pendingFrames.delete(element);
      if (!stillCurrent()) return;
      recordQuoteDiagnostic({ ...evidence, phase: 'chart-render-opportunity', domWriteMonoMs,
        frameOpportunityMonoMs: performance.now(), foreground: document.visibilityState === 'visible' });
    }));
  }));
}

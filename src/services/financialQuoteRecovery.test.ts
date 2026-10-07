import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredFinancialQuotes, FINANCIAL_QUOTE_DEFER_MS, MAX_DEFERRED_FINANCIAL_QUOTES, readFinancialQuoteGap } from './financialQuoteRecovery';
import type { NormalizedQuoteTick } from './quotePayloadNormalizer';
const tick = (n: number, symbol = 'BTCUSD') => ({ symbol, bid: 100, ask: 101, timestamp: 1791194400000 + n,
  provider_timestamp: 1791194400000 + n, sourceTimestamp: 1791194400000 + n, sequence: String(n), source: 'cserver', spread: 1 } satisfies NormalizedQuoteTick);
describe('bounded ownership-scoped financial deferral', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('drains all queued events in symbol order without changing any provider evidence', () => {
    const owner = { session: 1, socket: {} }, gap = vi.fn(), out = vi.fn();
    const queue = new DeferredFinancialQuotes(() => owner, gap);
    queue.append(tick(1)); queue.append(tick(2)); queue.drain(out);
    expect(out.mock.calls.map(call => call[0])).toEqual([tick(1), tick(2)]); expect(gap).not.toHaveBeenCalled();
    expect(queue.has('BTCUSD')).toBe(false);
  });
  it('bounds total memory across symbols and reports the exact affected provider interval', () => {
    const owner = { session: 1, socket: {} }, gap = vi.fn(), out = vi.fn();
    const queue = new DeferredFinancialQuotes(() => owner, gap);
    for (let n = 1; n <= MAX_DEFERRED_FINANCIAL_QUOTES; n++) queue.append(tick(n));
    queue.append(tick(MAX_DEFERRED_FINANCIAL_QUOTES + 1)); queue.drain(out);
    expect(gap).toHaveBeenCalledWith({ symbol: 'BTCUSD', quoteSession: 1, reason: 'capacity',
      fromProviderTimeMs: tick(1).provider_timestamp, toProviderTimeMs: tick(MAX_DEFERRED_FINANCIAL_QUOTES).provider_timestamp });
    expect(out).toHaveBeenCalledTimes(1);
  });
  it('expires from monotonic receipt duration and emits a coverage gap even with no later packet', () => {
    const owner = { session: 1, socket: {} }, gap = vi.fn(); let mono = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    const queue = new DeferredFinancialQuotes(() => owner, gap); queue.append(tick(1)); queue.append(tick(2));
    mono = FINANCIAL_QUOTE_DEFER_MS; vi.advanceTimersByTime(FINANCIAL_QUOTE_DEFER_MS);
    expect(gap).toHaveBeenCalledOnce(); expect(gap.mock.calls[0][0].reason).toBe('expired');
    expect(queue.has('BTCUSD')).toBe(false);
  });
  it('never delivers or reports old ownership after session/socket change or dispose', () => {
    let owner = { session: 1, socket: {} }; const gap = vi.fn(), out = vi.fn();
    const queue = new DeferredFinancialQuotes(() => owner, gap); queue.append(tick(1));
    owner = { session: 2, socket: {} }; queue.drain(out); expect(out).not.toHaveBeenCalled();
    queue.append(tick(2)); queue.clear(); vi.advanceTimersByTime(FINANCIAL_QUOTE_DEFER_MS);
    expect(gap).not.toHaveBeenCalled();
  });
  it('stops a draining batch after a reentrant ownership replacement', () => {
    let owner = { session: 1, socket: {} }; const gap = vi.fn();
    const queue = new DeferredFinancialQuotes(() => owner, gap); queue.append(tick(1)); queue.append(tick(2));
    const out = vi.fn(() => { owner = { session: 2, socket: {} }; }); queue.drain(out);
    expect(out).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed scoped gap signals', () => {
    expect(readFinancialQuoteGap(new Event('gap'))).toBeUndefined();
    expect(readFinancialQuoteGap(new CustomEvent('gap', { detail: { symbol: 'BTCUSD', quoteSession: 1,
      fromProviderTimeMs: 5, toProviderTimeMs: 4, reason: 'capacity' } }))).toBeUndefined();
  });
});

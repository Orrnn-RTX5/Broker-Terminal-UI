import type { NormalizedQuoteTick } from './quotePayloadNormalizer';

export const FINANCIAL_QUOTE_GAP_EVENT = 'rtx:financial-quote-gap';
export const MAX_DEFERRED_FINANCIAL_QUOTES = 4096;
export const FINANCIAL_QUOTE_DEFER_MS = 120_000;
export interface FinancialQuoteGap {
  symbol: string;
  quoteSession: number;
  fromProviderTimeMs: number;
  toProviderTimeMs: number;
  reason: 'capacity' | 'expired';
}
export function readFinancialQuoteGap(event: Event): FinancialQuoteGap | undefined {
  const value = (event as CustomEvent<FinancialQuoteGap>).detail;
  if (!value || typeof value.symbol !== 'string' || !value.symbol
    || !Number.isInteger(value.quoteSession)
    || !Number.isFinite(value.fromProviderTimeMs) || !Number.isFinite(value.toProviderTimeMs)
    || value.fromProviderTimeMs <= 0 || value.toProviderTimeMs < value.fromProviderTimeMs
    || (value.reason !== 'capacity' && value.reason !== 'expired')) return undefined;
  return value;
}
export interface FinancialQuoteOwner { session: number; socket: object | null }
interface PendingSymbol {
  owner: FinancialQuoteOwner;
  started: number;
  ticks: NormalizedQuoteTick[];
}
const sameOwner = (a: FinancialQuoteOwner, b: FinancialQuoteOwner) => a.session === b.session && a.socket === b.socket;

/** Bounded waiting for clock evidence, never a substitute provider timestamp. */
export class DeferredFinancialQuotes {
  private pending = new Map<string, PendingSymbol>();
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private owner: () => FinancialQuoteOwner, private gap: (detail: FinancialQuoteGap) => void) {}
  has(symbol: string): boolean { this.reconcileOwner(); return this.pending.has(symbol); }
  clear(): void {
    this.pending.clear(); this.count = 0;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  forget(symbol: string): void {
    const entry = this.pending.get(symbol);
    if (entry) this.count -= entry.ticks.length;
    this.pending.delete(symbol);
    this.schedule();
  }
  reconcileOwner(): void {
    if (!this.pending.size) return;
    const owner = this.owner();
    for (const [symbol, entry] of this.pending) if (!sameOwner(entry.owner, owner)) this.forget(symbol);
  }
  append(tick: NormalizedQuoteTick): void {
    this.reconcileOwner();
    const capturedOwner = this.owner();
    // The capacity is total across symbols, including a full-watch subscription.
    if (this.count >= MAX_DEFERRED_FINANCIAL_QUOTES) {
      const lost = [...this.pending.entries()]; this.clear();
      for (const [symbol, entry] of lost) this.reportGap(symbol, entry, 'capacity');
      if (!sameOwner(capturedOwner, this.owner())) return;
    }
    const entry = this.pending.get(tick.symbol) ?? { owner: this.owner(), started: performance.now(), ticks: [] };
    entry.ticks.push(tick); this.pending.set(tick.symbol, entry); this.count++;
    this.schedule();
  }
  drain(deliver: (tick: NormalizedQuoteTick, owner: FinancialQuoteOwner) => void): void {
    if (!this.pending.size) return;
    this.reconcileOwner();
    const entries = [...this.pending.values()]; this.clear();
    for (const entry of entries) for (const tick of entry.ticks) {
      if (!sameOwner(entry.owner, this.owner())) return;
      deliver(tick, entry.owner);
    }
  }
  private reportGap(symbol: string, entry: PendingSymbol, reason: FinancialQuoteGap['reason']): void {
    if (!sameOwner(entry.owner, this.owner())) return;
    const times = entry.ticks.map(tick => tick.provider_timestamp!).filter(Number.isFinite);
    if (!times.length) return;
    this.gap({ symbol, quoteSession: entry.owner.session, fromProviderTimeMs: Math.min(...times),
      toProviderTimeMs: Math.max(...times), reason });
  }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending.size) return;
    const delay = Math.max(0, Math.min(...[...this.pending.values()].map(entry => entry.started + FINANCIAL_QUOTE_DEFER_MS)) - performance.now());
    this.timer = setTimeout(() => {
      this.timer = undefined; this.reconcileOwner();
      for (const [symbol, entry] of [...this.pending]) {
        if (performance.now() - entry.started < FINANCIAL_QUOTE_DEFER_MS) continue;
        this.count -= entry.ticks.length; this.pending.delete(symbol); this.reportGap(symbol, entry, 'expired');
      }
      this.schedule();
    }, delay);
  }
}

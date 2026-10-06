import { quoteDiagnosticsEnabled, recordQuoteDiagnostic, type QuoteDiagnosticContext } from './quoteDiagnostics';

/** Provider evidence is independent of local price rendering and symbol permissions. */
export interface TerminalQuoteMetadata {
  /** Internal delivery provenance; never a provider source or timestamp. */
  quoteDeliveryKind?: 'snapshot' | 'event';
  provider_timestamp?: number;
  sequence?: string | number;
  source?: string;
  source_mismatch?: boolean;
  stale?: boolean;
  tradable?: boolean;
}
export interface TerminalQuoteEvidence extends TerminalQuoteMetadata { bid?: number; ask?: number }
export type TerminalQuoteFreshnessReason = 'live' | 'unavailable' | 'time-unverified' | 'stale' | 'source-mismatch' | 'not-tradable';
export interface TerminalQuoteFreshness {
  live: boolean; ageMs: number | null; ageMinMs: number | null; ageMaxMs: number | null;
  clockStatus: 'verified' | 'unverified'; reason: TerminalQuoteFreshnessReason;
}

const quotes = new Map<string, TerminalQuoteEvidence>();
const sequenceWatermarks = new Map<string, string | number>();
const verifiedProviderTimes = new Map<string, number>();
const listeners = new Set<(changedSymbol?: string) => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let revision = 0;
let session = 0;
let anchor: { lower: number; upper: number; mono: number; wall: number; requestMono: number } | undefined;
const monoNow = () => performance.now();
const key = (symbol: string) => symbol.trim().toUpperCase();
const publish = (changedSymbol?: string) => { revision++; listeners.forEach(listener => listener(changedSymbol)); };

export function terminalQuoteFreshnessEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const config = { ...(window as Window & { RUNTIME_CONFIG?: Record<string, unknown> }).RUNTIME_CONFIG, ...(window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ };
  return config.TERMINAL_QUOTE_FRESHNESS === true || config.TERMINAL_QUOTE_FRESHNESS === 'true';
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  return Number.isFinite(parsed) && parsed >= 1e12 && parsed <= 8.64e15 ? parsed : undefined;
}

/** Display fallbacks must not turn a one-sided packet into executable evidence. */
export function hasExplicitQuoteSides(payload: Record<string, unknown>): boolean {
  return ['bid', 'ask'].every(side => {
    const value = payload[side];
    return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
      && Number.isFinite(Number(value)) && Number(value) > 0;
  });
}

export function readQuoteFreshnessMetadata(payload: unknown, envelope?: unknown, outerEnvelopes: readonly unknown[] = []): TerminalQuoteMetadata {
  const records = [payload, envelope, ...outerEnvelopes].map(value =>
    value && typeof value === 'object' ? value as Record<string, unknown> : {});
  const pick = (...names: string[]) => {
    for (const obj of records) for (const name of names) if (obj[name] !== undefined) return obj[name];
    return undefined;
  };
  const sequence = pick('sequence', 'seq');
  const source = pick('source');
  // Normalizers deliberately emit this own property even when upstream had no
  // provider timestamp. Never reinterpret their display sourceTimestamp alias
  // (which can come from event/server/receipt time) as provider evidence.
  const providerRecord = records.find(record => Object.prototype.hasOwnProperty.call(record, 'provider_timestamp'));
  const providerTime = providerRecord ? providerRecord.provider_timestamp
    : pick('time_ms', 'timestamp_ms', 'sourceTimestamp', 'last_tick_ms', 'quote_time_ms');
  const result: TerminalQuoteMetadata = {
    provider_timestamp: timestamp(providerTime),
    sequence: typeof sequence === 'string' || typeof sequence === 'number' ? sequence : undefined,
    source: typeof source === 'string' ? source : undefined,
  };
  for (const flag of ['source_mismatch', 'stale', 'tradable'] as const) {
    const value = pick(flag);
    if (typeof value === 'boolean') result[flag] = value;
    // Any explicit upstream veto wins over a permissive nested payload.
    const veto = flag === 'tradable' ? false : true;
    if (records.some(record => record[flag] === veto)) result[flag] = veto;
  }
  return result;
}

export const getTerminalQuoteSession = () => session;
export const getTerminalQuoteFreshnessRevision = () => revision;
export const getVerifiedQuoteProviderTime = (symbol: string) => verifiedProviderTimes.get(key(symbol));

/** A stale feed snapshot is superseded only by newer accepted evidence from its own source/session. */
export function getNewerLiveTerminalQuoteEvidence(symbol: string, previous: TerminalQuoteMetadata, expectedSession: number): TerminalQuoteMetadata | null {
  if (!terminalQuoteFreshnessEnabled() || expectedSession !== session) return null;
  const quote = quotes.get(key(symbol));
  if (!quote || quote.source !== previous.source || quote.stale !== false || quote.tradable !== true
    || quote.source_mismatch !== false || quote.provider_timestamp === undefined || previous.provider_timestamp === undefined
    || quote.provider_timestamp <= previous.provider_timestamp || quote.sequence === undefined || previous.sequence === undefined) return null;
  const freshness = getTerminalQuoteFreshness(symbol);
  if (!freshness.live || freshness.clockStatus !== 'verified' || compareSequence(quote.sequence, previous.sequence) !== 1) return null;
  return { provider_timestamp: quote.provider_timestamp, sequence: quote.sequence, source: quote.source };
}

export function resetTerminalQuoteFreshness(): void {
  session++;
  quotes.clear();
  sequenceWatermarks.clear();
  verifiedProviderTimes.clear();
  anchor = undefined;
  publish();
}

/** Bound server time at receipt; network asymmetry never implies freshness. */
export function calibrateTerminalQuoteClock(serverTime: unknown, startMono: number, startWall: number,
  endMono = monoNow(), endWall = Date.now(), expectedSession = session): boolean {
  const server = timestamp(serverTime);
  const rtt = endMono - startMono;
  if (expectedSession !== session || server === undefined || !Number.isFinite(rtt) || rtt < 0 || rtt > 2000
    || !Number.isFinite(startMono) || !Number.isFinite(endMono) || !Number.isFinite(startWall) || !Number.isFinite(endWall)
    || Math.abs((endWall - startWall) - rtt) > 250
    || (anchor && startMono < anchor.requestMono)) {
    if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'clock', accepted: false,
      reason: expectedSession !== session ? 'session-mismatch' : server === undefined ? 'invalid-server-time'
        : !Number.isFinite(rtt) || rtt < 0 || rtt > 2000 ? 'invalid-rtt'
          : Math.abs((endWall - startWall) - rtt) > 250 ? 'wall-clock-discontinuity' : 'invalid-or-older-sample',
      serverTimeMs: server, requestMonoMs: startMono, responseMonoMs: endMono, rttMs: rtt,
      requestEpochMs: startWall, responseEpochMs: endWall,
      wallElapsedMs: endWall - startWall, browserGeneration: session, expectedBrowserGeneration: expectedSession });
    return false;
  }
  anchor = { lower: server - 1, upper: server + rtt + 1, mono: endMono, wall: endWall, requestMono: startMono };
  if (Array.from(quotes.values()).some(quote => quote.provider_timestamp !== undefined && quote.provider_timestamp > anchor!.upper + 250)) {
    // Render caches may already contain this impossible packet. A new
    // generation lets subsequent real ticks supersede their future timestamp.
    session++;
    quotes.clear();
    sequenceWatermarks.clear();
    verifiedProviderTimes.clear();
  }
  publish();
  if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'clock', accepted: true, reason: 'calibrated',
    serverTimeMs: server, requestMonoMs: startMono, responseMonoMs: endMono, rttMs: rtt,
    requestEpochMs: startWall, responseEpochMs: endWall,
    wallElapsedMs: endWall - startWall, browserGeneration: session, expectedBrowserGeneration: expectedSession });
  return true;
}

export function compareSequence(next: string | number, previous: string | number): number | undefined {
  // Integer strings may exceed Number's exact range.
  if (/^\d+$/.test(String(next)) && /^\d+$/.test(String(previous))) {
    const a = BigInt(next); const b = BigInt(previous);
    return a === b ? 0 : a > b ? 1 : -1;
  }
  return next === previous ? 0 : undefined;
}

function recordIngestion(symbol: string, data: TerminalQuoteEvidence, expectedSession: number,
  context: QuoteDiagnosticContext | undefined, ingestMonoMs: number | undefined, accepted: boolean, reason: string): boolean {
  if (ingestMonoMs !== undefined) {
    const state = getTerminalQuoteFreshness(symbol);
    const incomingTime = readQuoteFreshnessMetadata(data).provider_timestamp;
    const elapsed = anchor ? monoNow() - anchor.mono : 0;
    const timed = state.clockStatus === 'verified' && incomingTime !== undefined;
    recordQuoteDiagnostic({ ...context, kind: 'quote', symbol, source: data.source, providerTimestamp: incomingTime,
      hubSequence: data.sequence, browserGeneration: session, expectedBrowserGeneration: expectedSession,
      foreground: typeof document !== 'undefined' && document.visibilityState === 'visible',
      receiptMonoMs: context?.receiptMonoMs, transport: context?.transport, ingestMonoMs, accepted, reason,
      freshnessReason: state.reason, clockStatus: state.clockStatus, ageMinMs: state.ageMinMs, ageMaxMs: state.ageMaxMs,
      upstreamStale: data.stale, upstreamTradable: data.tradable, sourceMismatch: data.source_mismatch,
      retainedProviderTimestamp: quotes.get(key(symbol))?.provider_timestamp,
      incomingAgeMinMs: timed ? anchor!.lower + elapsed - elapsed / 1000 - incomingTime : null,
      incomingAgeMaxMs: timed ? anchor!.upper + elapsed + elapsed / 1000 - incomingTime : null });
  }
  return accepted;
}

/** Shared immutable evidence validation; acceptance/ordering stays with each owner. */
export function quoteEvidenceFailure(data: TerminalQuoteEvidence, metadata = readQuoteFreshnessMetadata(data)): string | null {
  if (metadata.provider_timestamp === undefined || !metadata.source?.trim() || !Number.isFinite(data.bid) || !Number.isFinite(data.ask)
    || data.bid! <= 0 || data.ask! <= 0 || data.ask! < data.bid!) return metadata.provider_timestamp === undefined
      ? 'missing-provider-time' : !metadata.source?.trim() ? 'missing-source' : 'invalid-price';
  const sequenceText = metadata.sequence === undefined ? undefined : String(metadata.sequence);
  // Corrupt/future packets must not advance the sequence watermark and suppress recovery.
  if (sequenceText !== undefined && (!/^\d{1,20}$/.test(sequenceText)
    || BigInt(sequenceText) > 18446744073709551615n
    || (typeof metadata.sequence === 'number' && !Number.isSafeInteger(metadata.sequence)))) return 'invalid-sequence';
  const elapsed = anchor ? monoNow() - anchor.mono : NaN;
  const validClock = anchor && elapsed >= 0 && elapsed < 60000 && Math.abs((Date.now() - anchor.wall) - elapsed) <= 250;
  if (validClock && metadata.provider_timestamp !== undefined && metadata.provider_timestamp > anchor!.upper + elapsed + elapsed / 1000 + 250) return 'future-provider-time';
  return null;
}

export function ingestTerminalQuote(symbol: string, data: TerminalQuoteEvidence, expectedSession = session,
  context?: QuoteDiagnosticContext): boolean {
  const ingestMonoMs = quoteDiagnosticsEnabled() ? monoNow() : undefined;
  if (expectedSession !== session || !key(symbol)) return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, false,
    expectedSession !== session ? 'session-mismatch' : 'invalid-symbol');
  const metadata = readQuoteFreshnessMetadata(data);
  const previous = quotes.get(key(symbol));
  const failure = quoteEvidenceFailure(data, metadata);
  if (failure) return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, false, failure);
  if (previous) {
    const nextTime = metadata.provider_timestamp;
    const oldTime = previous.provider_timestamp;
    if (oldTime !== undefined && (nextTime === undefined || nextTime < oldTime)) return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, false, 'older-provider-time');
    const watermark = sequenceWatermarks.get(key(symbol));
    if (metadata.sequence !== undefined && watermark !== undefined) {
      const order = compareSequence(metadata.sequence, watermark);
      if (order !== undefined && order < 0) return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, false, 'older-sequence');
      if (order === 0) return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, applyVeto(previous, metadata, symbol), 'duplicate-sequence');
    } else if (oldTime !== undefined && nextTime === oldTime) return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, applyVeto(previous, metadata, symbol), 'duplicate-provider-time');
  }
  quotes.set(key(symbol), { ...metadata, bid: data.bid, ask: data.ask });
  if (isTerminalQuoteClockVerified() && metadata.provider_timestamp !== undefined) {
    verifiedProviderTimes.set(key(symbol), metadata.provider_timestamp);
  }
  if (metadata.sequence !== undefined) sequenceWatermarks.set(key(symbol), metadata.sequence);
  publish(key(symbol));
  return recordIngestion(symbol, data, expectedSession, context, ingestMonoMs, true, 'accepted');
}

/** Reprice an accepted event after an account markup change without renewing its evidence. */
export function refreshTerminalQuotePrices(symbol: string, data: TerminalQuoteEvidence, expectedSession: number | undefined): boolean {
  if (expectedSession !== session) return false;
  const previous = quotes.get(key(symbol));
  const metadata = readQuoteFreshnessMetadata(data);
  if (!previous || metadata.provider_timestamp !== previous.provider_timestamp
    || metadata.source !== previous.source || String(metadata.sequence) !== String(previous.sequence)
    || !Number.isFinite(data.bid) || !Number.isFinite(data.ask)
    || data.bid! <= 0 || data.ask! <= 0 || data.ask! < data.bid!) return false;
  if (data.bid !== previous.bid || data.ask !== previous.ask) {
    // Preserve provider time, sequence, and all vetoes, including vetoes received
    // after the cached render event. Catalogue refreshes are not market ticks.
    quotes.set(key(symbol), { ...previous, bid: data.bid, ask: data.ask });
    publish(key(symbol));
  }
  return true;
}

/** A status veto may restrict existing evidence, but duplicate prices cannot renew it. */
function applyVeto(previous: TerminalQuoteEvidence, next: TerminalQuoteMetadata, symbol: string): boolean {
  const veto = { ...previous };
  if (next.stale === true) veto.stale = true;
  if (next.tradable === false) veto.tradable = false;
  if (next.source_mismatch === true) veto.source_mismatch = true;
  if (veto.stale !== previous.stale || veto.tradable !== previous.tradable || veto.source_mismatch !== previous.source_mismatch) {
    quotes.set(key(symbol), veto);
    publish(key(symbol));
  }
  return false;
}

export function isTerminalQuoteClockVerified(): boolean {
  const elapsed = anchor ? monoNow() - anchor.mono : NaN;
  return !!anchor && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 60000
    && Math.abs((Date.now() - anchor.wall) - elapsed) <= 250;
}

/** Display-only midpoint of the current session's verified broker-time bounds. */
export function getTerminalQuoteClockNowMs(): number | null {
  if (!isTerminalQuoteClockVerified() || !anchor) return null;
  return (anchor.lower + anchor.upper) / 2 + (monoNow() - anchor.mono);
}

export function getTerminalQuoteFreshness(symbol: string): TerminalQuoteFreshness {
  const quote = quotes.get(key(symbol));
  const verified = isTerminalQuoteClockVerified();
  const elapsed = anchor ? monoNow() - anchor.mono : 0;
  const ageMinMs = verified && quote?.provider_timestamp ? anchor!.lower + elapsed - elapsed / 1000 - quote.provider_timestamp : null;
  const ageMaxMs = verified && quote?.provider_timestamp ? anchor!.upper + elapsed + elapsed / 1000 - quote.provider_timestamp : null;
  const result = (reason: TerminalQuoteFreshnessReason): TerminalQuoteFreshness => ({
    live: reason === 'live', ageMs: ageMaxMs === null ? null : Math.max(0, ageMaxMs), ageMinMs, ageMaxMs,
    clockStatus: verified ? 'verified' : 'unverified', reason,
  });
  if (!quote?.provider_timestamp || !quote.source?.trim() || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask)
    || quote.bid! <= 0 || quote.ask! <= 0 || quote.ask! < quote.bid!) return result('unavailable');
  if (ageMaxMs !== null && ageMaxMs < -250) return result('unavailable');
  if (quote.source_mismatch) return result('source-mismatch');
  if (quote.tradable === false) return result('not-tradable');
  if (quote.stale === true || (ageMinMs !== null && ageMinMs > 3000)) return result('stale');
  if (ageMaxMs === null || ageMaxMs > 3000) return result('time-unverified');
  return result('live');
}

export function terminalQuoteBlockMessage(reason: TerminalQuoteFreshnessReason, symbol: string): string {
  switch (reason) {
    case 'time-unverified': return 'Syncing time for ' + symbol + '. Please wait before trading.';
    case 'unavailable': return 'Quote unavailable for ' + symbol + '. Waiting for a valid quote.';
    case 'source-mismatch': return 'Quote source mismatch for ' + symbol + '. Trading is unavailable.';
    case 'not-tradable': return 'Trading is not available for ' + symbol + '.';
    default: return 'Waiting for a fresh quote for ' + symbol;
  }
}

export function subscribeTerminalQuoteFreshness(listener: (changedSymbol?: string) => void): () => void {
  listeners.add(listener);
  if (!timer) timer = setInterval(publish, 100);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
  };
}

export function assertTerminalQuoteFresh(symbol: string): void {
  const state = getTerminalQuoteFreshness(symbol);
  if (!terminalQuoteFreshnessEnabled() || state.live) return;
  const codes: Record<TerminalQuoteFreshnessReason, string> = {
    live: '', stale: 'QUOTE_STALE', 'time-unverified': 'QUOTE_TIME_UNVERIFIED',
    unavailable: 'QUOTE_UNAVAILABLE', 'source-mismatch': 'QUOTE_SOURCE_MISMATCH', 'not-tradable': 'QUOTE_NOT_TRADABLE',
  };
  throw Object.assign(new Error(terminalQuoteBlockMessage(state.reason, symbol)), { code: codes[state.reason], symbol, reason: state.reason });
}

/** Market creation may defer uncertain age to the authoritative execution check. */
export function canSubmitTerminalMarketOrder(state: TerminalQuoteFreshness): boolean {
  return state.live || state.reason === 'time-unverified';
}

export function assertTerminalMarketOrderQuote(symbol: string): void {
  if (!terminalQuoteFreshnessEnabled()) return;
  const state = getTerminalQuoteFreshness(symbol);
  const permits = canSubmitTerminalMarketOrder(state);
  if (quoteDiagnosticsEnabled()) recordQuoteDiagnostic({ kind: 'trade-control', phase: 'market-assert', symbol,
    reason: state.reason, freshnessReason: state.reason, clockStatus: state.clockStatus, quotePermitsOrder: permits,
    browserGeneration: session, ageMinMs: state.ageMinMs, ageMaxMs: state.ageMaxMs });
  if (permits) return;
  assertTerminalQuoteFresh(symbol);
}

/** Closing may defer uncertain age to the authoritative execution check. */
export function assertTerminalCloseQuote(symbol: string): void {
  if (!terminalQuoteFreshnessEnabled() || canSubmitTerminalMarketOrder(getTerminalQuoteFreshness(symbol))) return;
  assertTerminalQuoteFresh(symbol);
}

export function terminalMarketQuoteAdvisory(state: TerminalQuoteFreshness): string | null {
  if (state.reason !== 'time-unverified') return null;
  return state.clockStatus === 'unverified'
    ? 'Time verification unavailable; server will validate quote age'
    : 'Quote age uncertain; server will validate';
}

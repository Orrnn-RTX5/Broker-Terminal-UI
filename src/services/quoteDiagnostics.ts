/** Opt-in, memory-only evidence. Never retain payloads, credentials, URLs or account identity. */
export const QUOTE_DIAGNOSTIC_CAPACITY = 2048;
export const QUOTE_CONTROL_DIAGNOSTIC_CAPACITY = 256;

export interface QuoteDiagnosticContext {
  receiptMonoMs?: number;
  transport?: 'feed' | 'v2' | 'rest';
  upstreamSourceSequence?: string | number;
  upstreamReceiveTimestamp?: number;
  upstreamPublishTimestamp?: number;
  hubIngestTimestamp?: number;
  hubPublishTimestamp?: number;
  brokerId?: string;
  sourceVersion?: string;
  tickId?: string;
  sourceTickId?: string;
  rawBid?: number;
  rawAsk?: number;
}

export interface QuoteDiagnosticInput extends QuoteDiagnosticContext {
  kind: 'quote' | 'clock' | 'trade-control' | 'order' | 'connection' | 'feed-status' | 'position';
  symbol?: string;
  source?: string;
  hubSequence?: string | number;
  providerTimestamp?: number;
  browserGeneration?: number;
  expectedBrowserGeneration?: number;
  ingestMonoMs?: number;
  reason?: string;
  freshnessReason?: string;
  clockStatus?: string;
  accepted?: boolean;
  ageMinMs?: number | null;
  ageMaxMs?: number | null;
  retainedProviderTimestamp?: number;
  incomingAgeMinMs?: number | null;
  incomingAgeMaxMs?: number | null;
  serverTimeMs?: number;
  requestMonoMs?: number;
  responseMonoMs?: number;
  requestEpochMs?: number;
  responseEpochMs?: number;
  rttMs?: number;
  wallElapsedMs?: number;
  disabled?: boolean;
  authenticated?: boolean;
  tradeAllowed?: boolean;
  marketOpen?: boolean;
  validVolume?: boolean;
  executablePrice?: boolean;
  quotePermitsOrder?: boolean;
  upstreamStale?: boolean;
  upstreamTradable?: boolean;
  sourceMismatch?: boolean;
  feedCurrent?: boolean;
  activeSymbolCount?: number;
  httpStatus?: number;
  phase?: string;
  traceId?: string;
  errorCode?: string;
  terminalStatus?: string;
  totalMs?: number;
  closeCode?: number;
  timeframe?: string;
  chartUpdateMonoMs?: number;
  domWriteMonoMs?: number;
  frameOpportunityMonoMs?: number;
  foreground?: boolean;
  sourcePriceTimeMs?: string;
  positionVersion?: string;
  backendPrice?: number;
  backendProfit?: number;
  positionCount?: number;
}

type DiagnosticValue = string | number | boolean | null;
export type QuoteDiagnosticRecord = Readonly<Record<string, DiagnosticValue>>;
const quoteRing: QuoteDiagnosticRecord[] = [];
const controlRing: QuoteDiagnosticRecord[] = [];
let quoteWrites = 0;
let controlWrites = 0;
let sequence = 0;
let filteredQuotes = 0;
let symbolFilterInput: string[] | undefined;
let symbolFilter: Set<string> | undefined;

// Replace the optional array to change a running capture's filter. Cache by
// reference so high-rate quote capture does not rebuild a Set for every tick.
function selectedSymbols(): Set<string> | undefined {
  const input = typeof window === 'undefined' ? undefined : window.__RTX_QUOTE_DIAGNOSTICS_SYMBOLS__;
  if (input !== symbolFilterInput) {
    symbolFilterInput = input;
    symbolFilter = Array.isArray(input)
      ? new Set(input.filter(value => typeof value === 'string').map(value => value.trim().toUpperCase()).filter(safeIdentifier))
      : undefined;
  }
  return symbolFilter;
}

export function quoteDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ !== undefined) return window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ === true;
  const runtime = window as Window & { RUNTIME_CONFIG?: Record<string, unknown>; __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
  const setting = runtime.__RTX_RUNTIME_CONFIG__?.QUOTE_DIAGNOSTICS ?? runtime.RUNTIME_CONFIG?.QUOTE_DIAGNOSTICS;
  return setting === true || setting === 'true';
}

// Field allowlists are intentional: passing a larger telemetry/error object
// cannot accidentally export its URL, session scope, token or backend message.
const numericFields = ['providerTimestamp', 'browserGeneration', 'expectedBrowserGeneration', 'receiptMonoMs', 'ingestMonoMs', 'ageMinMs', 'ageMaxMs', 'retainedProviderTimestamp', 'incomingAgeMinMs', 'incomingAgeMaxMs', 'serverTimeMs', 'requestMonoMs', 'responseMonoMs', 'requestEpochMs', 'responseEpochMs', 'rttMs', 'wallElapsedMs', 'totalMs', 'closeCode', 'upstreamReceiveTimestamp', 'upstreamPublishTimestamp', 'hubIngestTimestamp', 'hubPublishTimestamp', 'rawBid', 'rawAsk', 'activeSymbolCount', 'httpStatus', 'chartUpdateMonoMs', 'domWriteMonoMs', 'frameOpportunityMonoMs', 'backendPrice', 'backendProfit', 'positionCount'] as const;
const booleanFields = ['accepted', 'disabled', 'authenticated', 'tradeAllowed', 'marketOpen', 'validVolume', 'executablePrice', 'quotePermitsOrder', 'upstreamStale', 'upstreamTradable', 'sourceMismatch', 'feedCurrent', 'foreground'] as const;
const identifierFields = ['symbol', 'source', 'reason', 'freshnessReason', 'clockStatus', 'phase', 'errorCode', 'terminalStatus', 'transport', 'brokerId', 'tickId', 'sourceTickId', 'timeframe'] as const;
const safeIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
const safeSourceVersion = (value: unknown): value is string => safeIdentifier(value)
  || (typeof value === 'string' && /^legacy-feed-v1:[a-f0-9]{64}$/.test(value));
const safeSequence = (value: unknown): string | undefined => (
  (typeof value === 'string' || Number.isSafeInteger(value)) && /^\d{1,20}$/.test(String(value)) ? String(value) : undefined
);

// Side-channel ownership prevents diagnostic-only wire fields from changing
// quote equality, provider sequence ordering, caches or candle replay behavior.
const wireEvidence = new WeakMap<object, QuoteDiagnosticContext>();
export function rememberQuoteWireEvidence(tick: object, payload: Record<string, unknown>, envelopes: readonly Record<string, unknown>[], rawBid: number, rawAsk: number): void {
  if (!quoteDiagnosticsEnabled()) return;
  const pick = (key: string) => [payload, ...envelopes].find(record => record[key] !== undefined)?.[key];
  const evidence: QuoteDiagnosticContext = { rawBid, rawAsk };
  const sequence = safeSequence(pick('upstream_source_sequence'));
  if (sequence !== undefined) evidence.upstreamSourceSequence = sequence;
  for (const [wire, field] of [['upstream_receive_timestamp', 'upstreamReceiveTimestamp'], ['upstream_publish_timestamp', 'upstreamPublishTimestamp'], ['hub_ingest_timestamp', 'hubIngestTimestamp'], ['hub_publish_timestamp', 'hubPublishTimestamp']] as const) {
    const value = pick(wire);
    if (typeof value === 'number' && Number.isFinite(value)) evidence[field] = value;
  }
  for (const [wire, field] of [['broker_id', 'brokerId'], ['source_version', 'sourceVersion'], ['tick_id', 'tickId'], ['source_tick_id', 'sourceTickId']] as const) {
    const value = pick(wire);
    if (field === 'sourceVersion' ? safeSourceVersion(value) : safeIdentifier(value)) evidence[field] = value as string;
  }
  wireEvidence.set(tick, evidence);
}

export const readQuoteWireEvidence = (tick: object): QuoteDiagnosticContext | undefined => wireEvidence.get(tick);

export function recordQuoteDiagnostic(input: QuoteDiagnosticInput): void {
  if (!quoteDiagnosticsEnabled()) return;
  const filter = input.kind === 'quote' ? selectedSymbols() : undefined;
  if (filter && !filter.has(String(input.symbol ?? '').trim().toUpperCase())) { filteredQuotes++; return; }
  const record: Record<string, DiagnosticValue> = { kind: input.kind, sequence: ++sequence, atMonoMs: performance.now() };
  for (const key of numericFields) {
    const value = input[key];
    if (value === null || (typeof value === 'number' && Number.isFinite(value))) record[key] = value;
  }
  for (const key of booleanFields) if (typeof input[key] === 'boolean') record[key] = input[key]!;
  for (const key of identifierFields) if (safeIdentifier(input[key])) record[key] = input[key]!;
  if (safeSourceVersion(input.sourceVersion)) record.sourceVersion = input.sourceVersion;
  // Never round either sequence through Number. The hub's sequence is NOT
  // the original upstream sequence. Unsafe numeric input is
  // identified by the ingestion reason and is omitted from the evidence.
  for (const field of ['hubSequence', 'upstreamSourceSequence', 'positionVersion', 'sourcePriceTimeMs'] as const) {
    const value = safeSequence(input[field]);
    if (value !== undefined) record[field] = value;
  }
  if (typeof input.traceId === 'string' && /^[A-Za-z0-9-]{1,48}$/.test(input.traceId)) record.traceId = input.traceId;
  if (input.kind === 'quote') quoteRing[quoteWrites++ % QUOTE_DIAGNOSTIC_CAPACITY] = Object.freeze(record);
  else controlRing[controlWrites++ % QUOTE_CONTROL_DIAGNOSTIC_CAPACITY] = Object.freeze(record);
}

const ordered = (ring: QuoteDiagnosticRecord[], writes: number, capacity: number): QuoteDiagnosticRecord[] => {
  const start = writes > capacity ? writes % capacity : 0;
  return [...ring.slice(start), ...ring.slice(0, start)].map(record => ({ ...record }));
};

export function getQuoteDiagnosticDump() {
  return {
    version: 1,
    enabled: quoteDiagnosticsEnabled(),
    capturedAtEpochMs: Date.now(),
    capturedAtMonoMs: performance.now(),
    monotonicTimeOriginEpochMs: performance.timeOrigin,
    receiptMeaning: 'browser-websocket-handler-entry',
    ageMeaning: 'ageMinMs-ageMaxMs-describe-retained-evidence-incomingAge-describes-packet',
    quoteCapacity: QUOTE_DIAGNOSTIC_CAPACITY,
    controlCapacity: QUOTE_CONTROL_DIAGNOSTIC_CAPACITY,
    selectedSymbols: selectedSymbols() ? [...selectedSymbols()!] : null,
    filteredQuotes,
    overwrittenQuotes: Math.max(0, quoteWrites - QUOTE_DIAGNOSTIC_CAPACITY),
    overwrittenControls: Math.max(0, controlWrites - QUOTE_CONTROL_DIAGNOSTIC_CAPACITY),
    quotes: ordered(quoteRing, quoteWrites, QUOTE_DIAGNOSTIC_CAPACITY),
    controls: ordered(controlRing, controlWrites, QUOTE_CONTROL_DIAGNOSTIC_CAPACITY),
  };
}

declare global {
  interface Window {
    __RTX_QUOTE_DIAGNOSTICS_ENABLED__?: boolean;
    __RTX_QUOTE_DIAGNOSTICS_SYMBOLS__?: string[];
    __RTX_QUOTE_DIAGNOSTICS__?: Readonly<{ dump: typeof getQuoteDiagnosticDump }>;
  }
}

if (typeof window !== 'undefined') window.__RTX_QUOTE_DIAGNOSTICS__ = Object.freeze({ dump: getQuoteDiagnosticDump });

import {
  retainSameQuoteDayDisplayFields,
  useAppStore,
  type Tick as AppTick,
} from '../store/useAppStore';
import { useMarketDataStore, type Tick as MarketTick } from '../store/useMarketDataStore';
import {
  areCanonicalUpstreamTicksEqual,
  compareCanonicalTickFreshness,
  getCanonicalTickTimestamp,
  upsertFreshestTick,
} from '../utils/liveTickSemantics';
import { onSessionChange } from './brokerSession';
import { applyAccountSpreadMarkup, onAccountSpreadMarkupChange } from './accountSpreadMarkup';
import type { SpreadMarkupQuoteTag } from '../utils/spreadMarkup';
import type { QuoteDiagnosticContext } from './quoteDiagnostics';
import { readDailyChangeInput } from '../utils/dailyChange';
import { resolveDailyChangePriceMode } from './dailyChangePriceModeRegistry';
import {
  flushMarketWatchDailyChangeCache,
  rememberCurrentMarketWatchDailyChange,
} from './marketWatchDailyChangeCache';
import {
  flushMarketWatchQuoteCache,
  rememberCurrentMarketWatchQuote,
} from './marketWatchQuoteCache';
import {
  clearMarketWatchDisplayMetadata,
  flushMarketWatchDisplayMetadata,
  getMarketWatchDisplayMetadata,
  publishMarketWatchDisplayMetadata,
  resolveMarketWatchDisplayMetadata,
} from '../store/useMarketWatchDisplayMetadataStore';
import {
  getTerminalQuoteSession,
  ingestTerminalQuote,
  refreshTerminalQuotePrices,
  resetTerminalQuoteFreshness,
  terminalQuoteFreshnessEnabled,
} from './terminalQuoteFreshness';

// A logged-in account's quote is widened by its group spread markup here, once;
// `rawBid`/`rawAsk` keep the feed sides for raw-bid consumers (chart candles).
export type LiveTick = MarketTick & Partial<AppTick> & SpreadMarkupQuoteTag & { terminalQuoteSession?: number };

declare global {
  interface Window {
    rtxTickCache: Map<string, LiveTick>;
  }
}

if (typeof window !== 'undefined') {
  if (!window.rtxTickCache) {
    window.rtxTickCache = new Map<string, LiveTick>();
  }
}

const pendingTicks = new Map<string, LiveTick>();
const frozenMarketDataSources = new Map<string, Map<string, string>>();
let rafId: number | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 2_000;
const UTC_QUOTE_DAY_MS = 24 * 60 * 60 * 1_000;

const sharesUtcQuoteDay = (left: unknown, right: unknown): boolean => {
  const leftTime = getCanonicalTickTimestamp(left);
  const rightTime = getCanonicalTickTimestamp(right);
  return leftTime !== null && rightTime !== null
    && Math.floor(leftTime / UTC_QUOTE_DAY_MS) === Math.floor(rightTime / UTC_QUOTE_DAY_MS);
};

type TargetRetryState = {
  ticks: Map<string, LiveTick>;
  delayMs: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  due: boolean;
};

const createTargetRetryState = (): TargetRetryState => ({
  ticks: new Map<string, LiveTick>(),
  delayMs: INITIAL_RETRY_DELAY_MS,
  timeoutId: null,
  due: false,
});

const marketRetry = createTargetRetryState();
const appRetry = createTargetRetryState();

const clearDispatcherRuntime = (): void => {
  pendingTicks.clear();
  frozenMarketDataSources.clear();
  if (typeof window !== 'undefined' && rafId !== null && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(rafId);
  }
  if (timeoutId !== null) clearTimeout(timeoutId);
  rafId = null;
  timeoutId = null;
  resetRetry(marketRetry);
  resetRetry(appRetry);
};

const normalizeFreezeKey = (symbol: unknown): string => (
  String(symbol ?? '')
    .trim()
    .toUpperCase()
);

const hasPositiveSide = (value: unknown): boolean => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
);

const hasAnyQuoteSide = (tick: Pick<LiveTick, 'bid' | 'ask'>): boolean => (
  hasPositiveSide(tick.bid) || hasPositiveSide(tick.ask)
);

const hasTwoSidedQuote = (tick: Pick<LiveTick, 'bid' | 'ask'>): boolean => (
  hasPositiveSide(tick.bid) && hasPositiveSide(tick.ask)
);

const getExactAppTick = (symbol: string): AppTick | undefined => {
  const ticks = useAppStore.getState().ticks;
  return ticks[symbol] ?? ticks[normalizeFreezeKey(symbol)];
};

export const isLiveMarketDataFrozen = (symbol: unknown): boolean => {
  const key = normalizeFreezeKey(symbol);
  const sources = key ? frozenMarketDataSources.get(key) : undefined;
  return Boolean(sources && sources.size > 0);
};

export const setLiveMarketDataFrozen = (
  sourceId: string,
  symbol: string,
  frozen: boolean,
): void => {
  const key = normalizeFreezeKey(symbol);
  if (!sourceId || !key) return;

  if (!frozen) {
    const sources = frozenMarketDataSources.get(key);
    if (!sources) return;
    sources.delete(sourceId);
    if (sources.size === 0) {
      frozenMarketDataSources.delete(key);
    }
    return;
  }

  const sources = frozenMarketDataSources.get(key) ?? new Map<string, string>();
  sources.set(sourceId, symbol);
  frozenMarketDataSources.set(key, sources);
};

const scheduleFlush = () => {
  if (rafId !== null || timeoutId !== null) return;

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      flushLiveTicks();
    });
    return;
  }

  timeoutId = setTimeout(() => {
    timeoutId = null;
    flushLiveTicks();
  }, 16);
};

const hasRetryTicks = (): boolean => (
  marketRetry.ticks.size > 0 || appRetry.ticks.size > 0
);

const scheduleRetry = (retry: TargetRetryState) => {
  if (retry.ticks.size === 0 || retry.timeoutId !== null || retry.due) return;
  const delay = retry.delayMs;
  retry.delayMs = Math.min(MAX_RETRY_DELAY_MS, retry.delayMs * 2);
  retry.timeoutId = setTimeout(() => {
    retry.timeoutId = null;
    retry.due = true;
    scheduleFlush();
  }, delay);
};

const resetRetry = (retry: TargetRetryState) => {
  if (retry.timeoutId !== null) clearTimeout(retry.timeoutId);
  retry.ticks.clear();
  retry.delayMs = INITIAL_RETRY_DELAY_MS;
  retry.timeoutId = null;
  retry.due = false;
};

const didDisplayFieldCandidateWin = (
  candidate: LiveTick,
  selected: LiveTick,
  merged: LiveTick,
): boolean => {
  const dailyChangeWon = candidate.dailyChangeSourceTimestamp !== undefined
    && merged.dailyChangeSourceTimestamp === candidate.dailyChangeSourceTimestamp
    && merged.dailyChange === candidate.dailyChange
    && (
      merged.dailyChangeSourceTimestamp !== selected.dailyChangeSourceTimestamp
      || merged.dailyChange !== selected.dailyChange
    );
  const lastWon = candidate.lastSourceTimestamp !== undefined
    && merged.lastSourceTimestamp === candidate.lastSourceTimestamp
    && merged.last === candidate.last
    && (
      merged.lastSourceTimestamp !== selected.lastSourceTimestamp
      || merged.last !== selected.last
    );
  return dailyChangeWon || lastWon;
};

const upsertFreshestLiveTick = (
  target: Map<string, LiveTick>,
  symbol: string,
  tick: LiveTick,
): boolean => {
  const existing = target.get(symbol);
  if (existing) {
    const normalizedExisting = retainSameQuoteDayDisplayFields(undefined, existing);
    const normalizedIncoming = retainSameQuoteDayDisplayFields(undefined, tick);
    const freshness = compareCanonicalTickFreshness(existing, tick);
    if (freshness < 0) {
      const metadataCorrection = retainSameQuoteDayDisplayFields(normalizedIncoming, normalizedExisting);
      if (!didDisplayFieldCandidateWin(normalizedIncoming, normalizedExisting, metadataCorrection)) {
        return false;
      }
      target.set(symbol, metadataCorrection as LiveTick);
      return true;
    }
  }
  return upsertFreshestTick(
    target,
    symbol,
    retainSameQuoteDayDisplayFields(existing, tick),
  );
};

const mergeTickEntries = (
  target: Map<string, LiveTick>,
  entries: readonly (readonly [string, LiveTick])[],
) => {
  entries.forEach(([symbol, tick]) => {
    try {
      upsertFreshestLiveTick(target, symbol, tick);
    } catch (error) {
      console.error(`[LiveTickDispatcher] Invalid tick for ${symbol}:`, error);
    }
  });
};

const takeDeliveryBatch = (
  retry: TargetRetryState,
  liveEntries: readonly (readonly [string, LiveTick])[],
): { ticks: Array<readonly [string, LiveTick]>; isRetry: boolean } => {
  if (retry.ticks.size === 0) {
    return {
      ticks: liveEntries.filter(([symbol]) => !isLiveMarketDataFrozen(symbol)),
      isRetry: false,
    };
  }

  // A target in backoff owns new live ticks until its own retry becomes due.
  mergeTickEntries(retry.ticks, liveEntries);
  if (!retry.due) return { ticks: [], isRetry: false };

  const ticks = Array.from(retry.ticks.entries())
    .filter(([symbol]) => !isLiveMarketDataFrozen(symbol));
  retry.ticks.clear();
  retry.due = false;
  return { ticks, isRetry: true };
};

const retainFailedBatch = (
  retry: TargetRetryState,
  entries: readonly (readonly [string, LiveTick])[],
) => {
  mergeTickEntries(retry.ticks, entries);
  retry.due = false;
  scheduleRetry(retry);
};

const enqueueTick = (symbol: string, tick: LiveTick, refreshMarkup = false, diagnosticContext?: QuoteDiagnosticContext): boolean => {
  if (!symbol) return false;
  if (isLiveMarketDataFrozen(symbol)) return false;
  // Every quote transport (quote socket, REST seed, catalogue seed, legacy WS,
  // FIX, guest refresh) enters here, so the account markup is applied exactly
  // once and every store consumer sees the same effective bid/ask. The widening
  // is recomputed from the raw sides, so a re-enqueued tick never compounds.
  const freshnessEnabled = terminalQuoteFreshnessEnabled();
  const fullTick = applyAccountSpreadMarkup(symbol, {
    ...tick,
    symbol,
    ...(freshnessEnabled && !refreshMarkup ? { terminalQuoteSession: getTerminalQuoteSession() } : {}),
  }) as LiveTick;
  const hasQuoteSide = hasAnyQuoteSide(fullTick);
  const executableTick = hasQuoteSide ? undefined : getExactAppTick(symbol);
  if (executableTick && compareCanonicalTickFreshness(executableTick, fullTick) < 0
    && !sharesUtcQuoteDay(executableTick, fullTick) && !tick.dailyChangeInput?.sessionId) return false;
  // Use raw broker prices: account spread markup must never change instrument
  // movement. Every transport publishes to this one display state.
  const publishedMetadata = publishMarketWatchDisplayMetadata(symbol, {
    last: tick.last,
    dailyChange: tick.dailyChange,
    dailyChangeInput: tick.dailyChangeInput ?? readDailyChangeInput(tick, resolveDailyChangePriceMode(tick, symbol)),
    timestamp: tick.timestamp,
    sourceTimestamp: tick.sourceTimestamp,
  }, true);
  if (publishedMetadata) scheduleFlush();
  const dailyState = getMarketWatchDisplayMetadata(symbol)?.daily;
  if (publishedMetadata && dailyState?.reference && dailyState.valuesAsOf === tick.sourceTimestamp
    && dailyState.percent !== undefined && dailyState.change !== undefined) {
    try {
      rememberCurrentMarketWatchDailyChange(normalizeFreezeKey(symbol), dailyState.percent,
        dailyState.valuesAsOf, 'quote', undefined, dailyState.change);
    } catch (error) {
      console.error('[LiveTickDispatcher] Daily Change cache write failed:', error);
    }
  }
  // TradingChart and trade consumers use the ordinary tick stores. A Last-only
  // event is ordered against the exact executable AppStore quote, then exits
  // through the dedicated Market Watch display channel without touching them.
  if (!hasQuoteSide) {
    const accepted = publishedMetadata;
    if (!accepted) return false;

    const resolvedDisplay = resolveMarketWatchDisplayMetadata(
      executableTick,
      getMarketWatchDisplayMetadata(symbol),
    );
    const sourceTimestamp = typeof fullTick.sourceTimestamp === 'number'
      && Number.isFinite(fullTick.sourceTimestamp)
      ? fullTick.sourceTimestamp
      : null;
    const dailyChangeAuthority = resolvedDisplay.dailyChangeSourceTimestamp;
    if (typeof fullTick.dailyChange === 'number'
      && Number.isFinite(fullTick.dailyChange)
      && fullTick.dailyChangeSourceTimestamp === undefined
      && sourceTimestamp !== null
      && resolvedDisplay.dailyChange === fullTick.dailyChange
      && dailyChangeAuthority === sourceTimestamp) {
      try {
        rememberCurrentMarketWatchDailyChange(
          normalizeFreezeKey(symbol),
          resolvedDisplay.dailyChange,
          dailyChangeAuthority,
          'quote',
        );
      } catch (error) {
        console.error('[LiveTickDispatcher] Daily Change cache write failed:', error);
      }
    }
    return true;
  }

  if (freshnessEnabled) {
    const accepted = refreshMarkup
      ? refreshTerminalQuotePrices(symbol, fullTick, fullTick.terminalQuoteSession)
      : diagnosticContext ? ingestTerminalQuote(symbol, fullTick, undefined, diagnosticContext) : ingestTerminalQuote(symbol, fullTick);
    if (!accepted) return false;
    if (fullTick.provider_timestamp !== undefined) {
      fullTick.sourceTimestamp = fullTick.provider_timestamp;
      fullTick.timestamp = fullTick.provider_timestamp;
    }
  }

  const cachedTick = typeof window !== 'undefined' && window.rtxTickCache
    ? window.rtxTickCache.get(symbol)
    : undefined;
  const normalizedFullTick = retainSameQuoteDayDisplayFields(undefined, fullTick);
  let deliveryTick = normalizedFullTick;
  let shouldPersistQuote = true;
  if (cachedTick) {
    const normalizedCachedTick = retainSameQuoteDayDisplayFields(undefined, cachedTick);
    const freshness = compareCanonicalTickFreshness(cachedTick, fullTick);
    if (freshness < 0) {
      deliveryTick = retainSameQuoteDayDisplayFields(normalizedFullTick, normalizedCachedTick);
      if (!didDisplayFieldCandidateWin(normalizedFullTick, normalizedCachedTick, deliveryTick)) return false;
      shouldPersistQuote = false;
    } else {
      deliveryTick = retainSameQuoteDayDisplayFields(normalizedCachedTick, normalizedFullTick);
      if (freshness === 0 && areCanonicalUpstreamTicksEqual(normalizedCachedTick, deliveryTick)) return false;
    }
  }

  try {
    if (!upsertFreshestLiveTick(pendingTicks, symbol, deliveryTick)) return false;
  } catch (error) {
    console.error(`[LiveTickDispatcher] Invalid tick for ${symbol}:`, error);
    return false;
  }

  const sourceTimestamp = typeof fullTick.sourceTimestamp === 'number'
    && Number.isFinite(fullTick.sourceTimestamp)
    ? fullTick.sourceTimestamp
    : null;
  if (shouldPersistQuote && sourceTimestamp !== null && hasTwoSidedQuote(fullTick)) {
    try {
      // Keep recovery separate from live stores and preserve broker event time;
      // a receipt-time fallback cannot establish when a last quote was priced.
      rememberCurrentMarketWatchQuote(normalizeFreezeKey(symbol), {
        bid: fullTick.bid,
        ask: fullTick.ask,
        asOf: sourceTimestamp,
      });
    } catch (error) {
      console.error('[LiveTickDispatcher] Last quote cache write failed:', error);
    }
  }
  const acceptedTick = pendingTicks.get(symbol) ?? deliveryTick;
  const dailyChange = acceptedTick.dailyChange;
  const dailyChangeAuthority = acceptedTick.dailyChangeSourceTimestamp;
  if (typeof fullTick.dailyChange === 'number'
    && Number.isFinite(fullTick.dailyChange)
    && fullTick.dailyChangeSourceTimestamp === undefined
    && sourceTimestamp !== null
    && dailyChange === fullTick.dailyChange
    && dailyChangeAuthority === sourceTimestamp) {
    try {
      // Preserve the broker's exact symbol identity (including punctuation),
      // while making lookup casing deterministic across quote transports.
      rememberCurrentMarketWatchDailyChange(
        normalizeFreezeKey(symbol),
        dailyChange,
        dailyChangeAuthority,
        'quote',
      );
    } catch (error) {
      // Persistence is display recovery only; it must never interrupt live delivery.
      console.error('[LiveTickDispatcher] Daily Change cache write failed:', error);
    }
  }
  
  if (typeof window !== 'undefined' && window.rtxTickCache) {
    window.rtxTickCache.set(symbol, acceptedTick);
    // FIX: Keep only exact broker identities. A punctuation-stripped alias can
    // collide (`0001.HK`/`0001HK`) and let a late tick overwrite another chart.
    window.rtxTickCache.set(symbol.toUpperCase(), acceptedTick);
  }
  
  scheduleFlush();
  return true;
};

export const enqueueLiveTick = (symbol: string, tick: LiveTick, diagnosticContext?: QuoteDiagnosticContext): boolean => enqueueTick(symbol, tick, false, diagnosticContext);

export const flushLiveTicks = (): void => {
  flushMarketWatchDisplayMetadata();
  if (pendingTicks.size === 0 && !hasRetryTicks()) return;

  const ticks = Array.from(pendingTicks.entries()) as Array<readonly [string, LiveTick]>;
  pendingTicks.clear();

  const marketStore = useMarketDataStore.getState();
  const appStore = useAppStore.getState();

  const ownsCurrentSession = ([, tick]: readonly [string, LiveTick]) => !terminalQuoteFreshnessEnabled()
    || tick.terminalQuoteSession === getTerminalQuoteSession();
  for (const retry of [marketRetry, appRetry]) {
    for (const entry of retry.ticks) {
      if (!ownsCurrentSession(entry)) retry.ticks.delete(entry[0]);
    }
  }
  const activeTicks = ticks.filter((entry) => ownsCurrentSession(entry) && !isLiveMarketDataFrozen(entry[0]));
  // Defensive filter: metadata-only events exit in enqueueLiveTick and can
  // never enter Market/App delivery or either retry owner.
  const marketBatch = takeDeliveryBatch(
    marketRetry,
    activeTicks.filter(([, tick]) => hasAnyQuoteSide(tick)),
  );
  const appBatch = takeDeliveryBatch(appRetry, activeTicks);

  if (marketBatch.ticks.length > 0) {
    try {
      marketStore.updateTicksBatch(marketBatch.ticks, { syncAppStore: false });
      if (marketBatch.isRetry) resetRetry(marketRetry);
    } catch (error) {
      console.error('[LiveTickDispatcher] Market store batch failed; retaining it for retry:', error);
      retainFailedBatch(marketRetry, marketBatch.ticks);
    }
  } else if (marketBatch.isRetry) {
    resetRetry(marketRetry);
  }

  if (appBatch.ticks.length > 0) {
    try {
      appStore.setTicksBatch(
        appBatch.ticks.map(([symbol, tick]) => [symbol, tick as AppTick] as const),
      );
      if (appBatch.isRetry) resetRetry(appRetry);
    } catch (error) {
      console.error('[LiveTickDispatcher] App store batch failed; retaining it for retry:', error);
      retainFailedBatch(appRetry, appBatch.ticks);
    }
  } else if (appBatch.isRetry) {
    resetRetry(appRetry);
  }

  scheduleRetry(marketRetry);
  scheduleRetry(appRetry);
};

/** Clear every quote owner at a broker/account ownership boundary. */
export const resetLiveMarketDataSession = (): void => {
  resetTerminalQuoteFreshness();
  // FIX: Source timestamps are comparable only within one broker session. Old
  // queues/caches would otherwise reject or briefly repaint the new session.
  try {
    flushMarketWatchDailyChangeCache();
  } catch (error) {
    // A storage failure must not prevent the broker/account boundary reset.
    console.error('[LiveTickDispatcher] Daily Change cache flush failed:', error);
  }
  try {
    flushMarketWatchQuoteCache();
  } catch (error) {
    console.error('[LiveTickDispatcher] Last quote cache flush failed:', error);
  }
  clearDispatcherRuntime();
  clearMarketWatchDisplayMetadata();
  if (typeof window !== 'undefined') window.rtxTickCache?.clear();
  useMarketDataStore.getState().clearAllData();
  useAppStore.getState().setTicks({});
};

/**
 * Re-publish every cached quote under the current account markup (a new
 * catalogue revision, or markup cleared at logout/account switch). Each tick is
 * rebuilt from its raw sides and delivered as a same-time correction.
 */
export const reapplyAccountSpreadMarkupToCachedTicks = (): void => {
  if (typeof window === 'undefined' || !window.rtxTickCache) return;
  const seen = new Set<LiveTick>();
  const cached: LiveTick[] = [];
  window.rtxTickCache.forEach((tick) => {
    if (!tick || seen.has(tick)) return;
    seen.add(tick);
    cached.push(tick);
  });
  cached.forEach((tick) => {
    if (tick.symbol) enqueueTick(tick.symbol, tick, true);
  });
};

onAccountSpreadMarkupChange(reapplyAccountSpreadMarkupToCachedTicks);

/** Test-only reset for module-level frame and retry ownership. */
export const resetLiveTickDispatcherForTests = (): void => {
  clearDispatcherRuntime();
  clearMarketWatchDisplayMetadata();
};

// Renewing credentials does not change the owner or event-time ordering of
// accepted quotes. Keep the display continuous while sockets reauthenticate.
onSessionChange((reason) => {
  if (reason !== 'token_rotation') resetLiveMarketDataSession();
});

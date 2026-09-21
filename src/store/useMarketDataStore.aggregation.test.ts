// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkerManager, terminateWorker } from '../services/aggregationWorkerManager';
import { processWorkerMessage, type WorkerMessage } from '../workers/aggregation.worker';
import { useMarketDataStore, type Tick } from './useMarketDataStore';

const timeframes = [
  { name: '1m', ms: 60_000 },
  { name: '5m', ms: 300_000 },
  { name: '15m', ms: 900_000 },
  { name: '1h', ms: 3_600_000 },
];
const timestamp = 1_800_000_000_000;
const tick = (symbol: string, bid = 100, sourceTimestamp = timestamp): Tick => ({
  symbol, bid, ask: bid + 2, spread: 2, timestamp: sourceTimestamp + 100,
  sourceTimestamp, volume: 1,
});

class QueuedWorker {
  static instances: QueuedWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: WorkerMessage[] = [];
  terminate = vi.fn();
  constructor() { QueuedWorker.instances.push(this); }
  postMessage(message: WorkerMessage) { this.requests.push(structuredClone(message)); }
  deliver(message: WorkerMessage) {
    const response = structuredClone(processWorkerMessage(message));
    this.onmessage?.({ data: response } as MessageEvent);
  }
  drain() { this.requests.splice(0).forEach((request) => this.deliver(request)); }
}
const worker = () => QueuedWorker.instances[QueuedWorker.instances.length - 1];
const store = () => useMarketDataStore.getState();

describe('batched worker aggregation', () => {
  beforeEach(() => {
    terminateWorker();
    store().clearAllData();
    QueuedWorker.instances = [];
    vi.stubGlobal('Worker', QueuedWorker);
  });
  afterEach(() => {
    terminateWorker();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('matches individual worker candles for all timeframes, source ordering and bid/ask fallback', () => {
    const ticks = [
      tick('BTCUSD', 120, timestamp + 120_000),
      tick('BTCUSD', 100, timestamp),
      tick('BTCUSD', 90, timestamp + 1),
      { ...tick('BTCUSD', 0, timestamp + 2), ask: 110 },
      { ...tick('BTCUSD', 0, timestamp + 3), ask: 0 },
      tick('BTCUSD', 105, timestamp + 120_000),
    ];
    const batch = processWorkerMessage({ type: 'aggregate-batch', requestId: 'batch',
      data: { requests: [{ symbol: 'BTCUSD', tickBuffer: ticks }], timeframes } });
    expect(batch.type).toBe('success');
    const result = (batch.result as any[])[0].results;
    timeframes.forEach(({ name, ms }) => {
      const individual = processWorkerMessage({ type: 'aggregate', requestId: name,
        data: { ticks, timeframeMs: ms } });
      expect(result[name]).toEqual(individual.result);
      expect(result[name][0].open).toBe(100);
    });
    expect(result['1m'][0]).toMatchObject({ open: 100, high: 110, low: 90, close: 110, volume: 3 });
    expect(result['1m'][1].close).toBe(105);
  });

  it('publishes all701 quotes immediately then all candle results in11 immutable updates', () => {
    const entries = Array.from({ length: 701 }, (_, index) => {
      const symbol = `SYMBOL${index}.RAW`;
      return [symbol, tick(symbol, 100 + index)] as const;
    });
    const notified = vi.fn();
    const unsubscribe = useMarketDataStore.subscribe(notified);
    store().updateTicksBatch(entries, { syncAppStore: false });
    const quoteSnapshot = store();
    Object.freeze(quoteSnapshot.symbolData);
    expect(notified).toHaveBeenCalledOnce();
    expect(worker().requests).toHaveLength(11);
    entries.forEach(([symbol, quote]) => {
      expect(quoteSnapshot.symbolData[symbol].currentTick).toBe(quote);
      expect(quoteSnapshot.symbolData[symbol].ohlcv1m).toEqual([]);
    });
    notified.mockClear();
    worker().drain();
    expect(notified).toHaveBeenCalledTimes(11);
    entries.forEach(([symbol, quote]) => {
      timeframes.forEach(({ name }) => {
        expect(store().getOHLCV(symbol, name as '1m')).toHaveLength(1);
        expect(store().getOHLCV(symbol, name as '1m')[0].close).toBe(quote.bid);
      });
      expect(quoteSnapshot.symbolData[symbol].ohlcv1m).toEqual([]);
      expect(store().symbolData[symbol].currentTick).toBe(quote);
    });
    unsubscribe();
  });

  it('bounds transport by tick count when symbols contain longer buffers', () => {
    const requests = Array.from({ length: 3 }, (_, index) => ({
      symbol: `LONG${index}`,
      tickBuffer: Array.from({ length: 6_000 }, (_, n) => tick(`LONG${index}`, 100, timestamp + n)),
    }));
    getWorkerManager().aggregateSymbols(requests, timeframes, vi.fn());
    expect(worker().requests).toHaveLength(3);
    expect(worker().requests.map(message => (message.data as any).requests.length)).toEqual([1, 1, 1]);
  });

  it('keeps valid siblings when one symbol fails inside the worker batch', () => {
    const response = processWorkerMessage({ type: 'aggregate-batch', requestId: 'partial', data: {
      requests: [
        { symbol: 'VALID', tickBuffer: [tick('VALID')] },
        { symbol: 'BROKEN', tickBuffer: null },
        { symbol: 'ALSO_VALID', tickBuffer: [tick('ALSO_VALID', 200)] },
      ], timeframes,
    } });
    expect(response.type).toBe('success');
    expect((response.result as any[]).map(row => [row.symbol, Boolean(row.results)]))
      .toEqual([['VALID', true], ['BROKEN', false], ['ALSO_VALID', true]]);
  });

  it('retains server buckets and newer live quotes while worker results are pending', () => {
    store().updateTick('BTCUSD', tick('BTCUSD'), { syncAppStore: false });
    store().updateTick('BTCUSD', tick('BTCUSD', 110, timestamp + 1), { syncAppStore: false });
    store().updateCandle({ symbol: 'BTCUSD', timeframe: 'M1', time: timestamp,
      open: 98, high: 102, low: 95, close: 99, volume: 10, source: 'server', closed: true });
    worker().drain();
    expect(store().getOHLCV('BTCUSD', '1m')[0])
      .toMatchObject({ open: 98, high: 102, low: 95, close: 99, source: 'server', closed: true });
    expect(store().getCurrentTick('BTCUSD')?.bid).toBe(110);
  });

  it('rejects prior-session replies even when the same symbol exists again', () => {
    store().updateTick('BTCUSD', tick('BTCUSD', 900), { syncAppStore: false });
    const stale = worker().requests[0];
    store().clearAllData();
    store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    worker().deliver(stale);
    expect(store().getOHLCV('BTCUSD', '1m')).toEqual([]);
    worker().deliver(worker().requests[1]);
    expect(store().getOHLCV('BTCUSD', '1m')[0].close).toBe(100);
  });

  it('rejects a cleared-symbol reply without discarding healthy siblings', () => {
    store().updateTicksBatch([['BTCUSD', tick('BTCUSD', 900)], ['EURUSD', tick('EURUSD', 200)]], { syncAppStore: false });
    const stale = worker().requests[0];
    store().clearSymbolData('BTCUSD');
    store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    worker().deliver(stale);
    expect(store().getOHLCV('BTCUSD', '1m')).toEqual([]);
    expect(store().getOHLCV('EURUSD', '1m')[0].close).toBe(200);
    worker().deliver(worker().requests[1]);
    expect(store().getOHLCV('BTCUSD', '1m')[0].close).toBe(100);
  });

  it('does not let an older result widen or regress a newer equal-time correction', () => {
    store().updateTick('BTCUSD', tick('BTCUSD', 900), { syncAppStore: false });
    store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    worker().deliver(worker().requests[1]);
    const corrected = store();
    worker().deliver(worker().requests[0]);
    expect(store()).toBe(corrected);
    expect(store().getOHLCV('BTCUSD', '1m')[0]).toMatchObject({ open: 100, high: 100, low: 100, close: 100 });
  });

  it('skips a known-obsolete pending tick correction even when worker replies arrive in FIFO order', () => {
    store().updateTick('BTCUSD', tick('BTCUSD', 900), { syncAppStore: false });
    store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    worker().drain();
    expect(store().getOHLCV('BTCUSD', '1m')[0]).toMatchObject({ open: 100, high: 100, low: 100, close: 100 });
  });

  it('isolates non-cloneable payloads so transport failure does not discard healthy siblings', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const callback = vi.fn();
    getWorkerManager().aggregateSymbols([
      { symbol: 'VALID', tickBuffer: [tick('VALID')] },
      { symbol: 'BROKEN', tickBuffer: [{ ...tick('BROKEN'), lp: (() => {}) as unknown as string }] },
      { symbol: 'ALSO_VALID', tickBuffer: [tick('ALSO_VALID', 200)] },
    ], timeframes, callback);
    worker().drain();
    expect(callback.mock.calls.flatMap(([rows]) => rows.map((row: any) => row.symbol)))
      .toEqual(['VALID', 'ALSO_VALID']);
  });

  it('keeps manual aggregation when an older worker snapshot arrives later', () => {
    store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    store().updateTick('BTCUSD', tick('BTCUSD', 110, timestamp + 1), { syncAppStore: false });
    store().aggregateOHLCV('BTCUSD');
    const manual = store();
    worker().drain();
    expect(store()).toBe(manual);
    expect(store().getOHLCV('BTCUSD', '1m')[0].close).toBe(110);
  });

  it('retains earlier FIFO history when a later pending request has trimmed its tick buffer', () => {
    store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    const laterTicks = Array.from({ length: 10_000 }, (_, index) => tick('BTCUSD', 200, timestamp + 86_400_000 + index));
    const current = store().symbolData.BTCUSD;
    useMarketDataStore.setState({ symbolData: { BTCUSD: { ...current,
      tickBuffer: laterTicks, currentTick: laterTicks.at(-1)!, lastAggregation: 0,
    } } });
    store().updateTick('BTCUSD', tick('BTCUSD', 210, timestamp + 86_410_000), { syncAppStore: false });
    expect(worker().requests).toHaveLength(2);
    worker().drain();
    timeframes.forEach(({ name }) => {
      const candles = store().getOHLCV('BTCUSD', name as '1m');
      expect(candles[0].close).toBe(100);
      expect(candles.at(-1)?.close).toBe(210);
    });
  });

  it('orders a correction made synchronously by a quote subscriber ahead of its older outer request', () => {
    let corrected = false;
    const unsubscribe = useMarketDataStore.subscribe(() => {
      if (corrected) return;
      corrected = true;
      store().updateTick('BTCUSD', tick('BTCUSD', 100), { syncAppStore: false });
    });
    store().updateTick('BTCUSD', tick('BTCUSD', 900), { syncAppStore: false });
    unsubscribe();
    worker().drain();
    expect(store().getCurrentTick('BTCUSD')?.bid).toBe(100);
    expect(store().getOHLCV('BTCUSD', '1m')[0]).toMatchObject({ high: 100, low: 100, close: 100 });
  });

  it('does not schedule an obsolete snapshot after a synchronous symbol clear', () => {
    let cleared = false;
    const unsubscribe = useMarketDataStore.subscribe(() => {
      if (cleared) return;
      cleared = true;
      store().clearSymbolData('BTCUSD');
      store().subscribeSymbol('BTCUSD');
    });
    store().updateTick('BTCUSD', tick('BTCUSD', 900), { syncAppStore: false });
    unsubscribe();
    expect(QueuedWorker.instances).toHaveLength(0);
    expect(store().getCurrentTick('BTCUSD')).toBeNull();
  });

  it('publishes healthy sibling results even if one result cannot be merged', () => {
    store().updateTicksBatch([['BTCUSD', tick('BTCUSD')], ['EURUSD', tick('EURUSD', 200)]], { syncAppStore: false });
    const response = processWorkerMessage(worker().requests[0]);
    (response.result as any[])[0].results['1m'] = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    worker().onmessage?.({ data: response } as MessageEvent);
    expect(store().getOHLCV('BTCUSD', '1m')).toEqual([]);
    expect(store().getOHLCV('EURUSD', '1m')[0].close).toBe(200);
  });

  it('cleans callbacks on worker failure and reinitializes on the next request', () => {
    const manager = getWorkerManager();
    const failed = vi.fn();
    manager.aggregateMultipleTimeframes([tick('BTCUSD')], timeframes, failed);
    const oldWorker = worker();
    const lateError = oldWorker.onerror;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    oldWorker.onerror?.({ message: 'worker failed' } as ErrorEvent);
    oldWorker.drain();
    expect(failed).not.toHaveBeenCalled();
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    const current = vi.fn();
    manager.aggregateMultipleTimeframes([tick('BTCUSD')], timeframes, current);
    expect(worker()).not.toBe(oldWorker);
    expect(worker().requests).toHaveLength(1);
    lateError?.({ message: 'queued old error' } as ErrorEvent);
    expect(worker().terminate).not.toHaveBeenCalled();
    worker().drain();
    expect(current).toHaveBeenCalledOnce();
  });

  it('removes a callback before invoking it so a thrown consumer cannot leak or replay it', () => {
    const callback = vi.fn(() => { throw new Error('consumer failed'); });
    getWorkerManager().aggregateMultipleTimeframes([tick('BTCUSD')], timeframes, callback);
    const request = worker().requests[0];
    expect(() => worker().deliver(request)).toThrow('consumer failed');
    expect(() => worker().deliver(request)).not.toThrow();
    expect(callback).toHaveBeenCalledOnce();
  });
});

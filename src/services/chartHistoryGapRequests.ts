import type { FetchCandlesOptions, OHLCData } from '../types/chartData';
import {
  getCommittedBrokerAccountSessionScope,
  onCommittedBrokerAccountSessionScopeChange,
  onSessionChange,
} from './brokerSession';

export const EMPTY_HISTORY_GAP_TTL_MS = 30_000;
const MAX_EMPTY_GAP_ENTRIES = 256;
type GapFetcher = (options: FetchCandlesOptions) => Promise<OHLCData[]>;
export interface HistoryGapRequestScope { key: string; generation: number }
interface SharedGapRequest {
  controller: AbortController;
  consumers: number;
  settled: boolean;
  result: Promise<OHLCData[]>;
}
const aborted = () => new DOMException('History gap request was cancelled', 'AbortError');

/** Share only exact background gap queries, retaining independent chart owners. */
export const createHistoryGapRequestCoordinator = () => {
  let generation = 0;
  let nextFetcherId = 0;
  const fetcherIds = new WeakMap<GapFetcher, number>();
  const pending = new Map<string, SharedGapRequest>();
  const emptyUntil = new Map<string, number>();

  return {
    captureScope: (key: string): HistoryGapRequestScope => ({ key, generation }),
    invalidate() {
      generation += 1;
      emptyUntil.clear();
      const requests = [...pending.values()];
      pending.clear();
      requests.forEach(request => request.controller.abort());
    },
    fetch({ scope, boundaryOffsetSeconds, timeframeSeconds, request, fetchCandles }: {
      scope: HistoryGapRequestScope;
      boundaryOffsetSeconds: number;
      timeframeSeconds: number;
      request: FetchCandlesOptions;
      fetchCandles: GapFetcher;
    }): Promise<OHLCData[]> {
      const signal = request.signal;
      if (signal?.aborted || scope.generation !== generation) return Promise.reject(aborted());
      let fetcherId = fetcherIds.get(fetchCandles);
      if (fetcherId === undefined) {
        fetcherId = ++nextFetcherId;
        fetcherIds.set(fetchCandles, fetcherId);
      }
      const key = JSON.stringify([
        scope.key, scope.generation, fetcherId, request.symbol, request.timeframe,
        boundaryOffsetSeconds, timeframeSeconds, request.from, request.to, request.count,
      ]);
      const now = Date.now();
      for (const [cachedKey, until] of emptyUntil) {
        if (until <= now) emptyUntil.delete(cachedKey);
      }
      if (emptyUntil.has(key)) return Promise.resolve([]);

      let entry = pending.get(key);
      if (!entry) {
        const controller = new AbortController();
        const created: SharedGapRequest = { controller, consumers: 0, settled: false, result: Promise.resolve([]) };
        entry = created;
        pending.set(key, created);
        created.result = Promise.resolve().then(() => {
          if (controller.signal.aborted) throw aborted();
          return fetchCandles({ ...request, signal: controller.signal });
        }).then(rows => {
          if (controller.signal.aborted || scope.generation !== generation) throw aborted();
          // Errors, partial pages and successful data are never negative-cached.
          if (rows.length === 0) {
            emptyUntil.set(key, Date.now() + EMPTY_HISTORY_GAP_TTL_MS);
            while (emptyUntil.size > MAX_EMPTY_GAP_ENTRIES) {
              emptyUntil.delete(emptyUntil.keys().next().value!);
            }
          }
          return rows;
        }).finally(() => {
          created.settled = true;
          if (pending.get(key) === created) pending.delete(key);
        });
      }
      const owned = entry;
      owned.consumers += 1;
      return new Promise<OHLCData[]>((resolve, reject) => {
        let finished = false;
        const release = () => {
          signal?.removeEventListener('abort', cancel);
          owned.controller.signal.removeEventListener('abort', cancel);
          owned.consumers -= 1;
          if (owned.consumers === 0 && !owned.settled) {
            // Remove synchronously so an immediate reacquire starts fresh.
            if (pending.get(key) === owned) pending.delete(key);
            owned.controller.abort();
          }
        };
        const cancel = () => {
          if (finished) return;
          finished = true;
          release();
          reject(aborted());
        };
        signal?.addEventListener('abort', cancel, { once: true });
        owned.controller.signal.addEventListener('abort', cancel, { once: true });
        owned.result.then(rows => {
          if (finished) return;
          finished = true;
          release();
          resolve(rows.map(row => ({ ...row })));
        }, error => {
          if (finished) return;
          finished = true;
          release();
          reject(error);
        });
      });
    },
  };
};

export const historyGapRequests = createHistoryGapRequestCoordinator();

export const captureHistoryGapRequestScope = (endpoint: string): HistoryGapRequestScope => (
  historyGapRequests.captureScope(JSON.stringify([endpoint, getCommittedBrokerAccountSessionScope()]))
);

onSessionChange(reason => {
  if (reason !== 'token_rotation') historyGapRequests.invalidate();
});
onCommittedBrokerAccountSessionScopeChange(() => historyGapRequests.invalidate());

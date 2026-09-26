import {
    clearTradeHistoryRequestCache,
    tradeGatewayApi,
    type TradeHistoryDataSet,
} from '../api/tradeGateway';

type HistoryListener = (data: TradeHistoryDataSet, ordersPending: boolean) => void;

type HistoryCacheEntry = {
    login: number;
    scopeKey: string;
    data: TradeHistoryDataSet;
    ordersPending: boolean;
};

type HistoryFlight = {
    generation: number;
    serial: number;
    promise: Promise<TradeHistoryDataSet>;
    listeners: Set<HistoryListener>;
};

let generation = 0;
let publishSerial = 0;
let primed = false;
let cache: HistoryCacheEntry | null = null;
const flights = new Map<string, HistoryFlight>();

const historyRequestKey = (login: number, scopeKey: string): string => `${scopeKey}\u0000${login}`;

const matchesCache = (login: number, scopeKey: string): HistoryCacheEntry | null => (
    cache && cache.login === login && cache.scopeKey === scopeKey ? cache : null
);

export const peekTerminalHistory = (login: number, scopeKey: string): HistoryCacheEntry | null => (
    matchesCache(login, scopeKey)
);

const publishHistory = (
    flight: HistoryFlight,
    login: number,
    scopeKey: string,
    data: TradeHistoryDataSet,
    ordersPending: boolean,
) => {
    if (flight.generation !== generation || flight.serial !== publishSerial) return;
    cache = { login, scopeKey, data, ordersPending };
    flight.listeners.forEach(listener => listener(data, ordersPending));
};

// Drops the account-history snapshot when the signed-in account changes.
// The next read must not reuse another account's deals or orders.
export const resetTerminalHistorySession = (): void => {
    generation += 1;
    publishSerial += 1;
    primed = false;
    cache = null;
    flights.clear();
    clearTradeHistoryRequestCache();
};

// The first refresh shares the prefetch already in flight. Later refreshes,
// such as a fill or close, drop that snapshot so the next read is current.
export const beginTradeHistoryRefresh = (): void => {
    if (primed) {
        generation += 1;
        publishSerial += 1;
        cache = null;
        flights.clear();
        clearTradeHistoryRequestCache();
    }
    primed = true;
};

export const loadTerminalHistory = (
    login: number,
    scopeKey: string,
    options?: { force?: boolean; refresh?: boolean; onUpdate?: HistoryListener },
): Promise<TradeHistoryDataSet> => {
    const key = historyRequestKey(login, scopeKey);
    const force = options?.force === true;
    const refresh = options?.refresh === true;
    const onUpdate = options?.onUpdate;

    if (!force) {
        const existing = flights.get(key);
        if (existing && existing.generation === generation) {
            if (onUpdate) {
                existing.listeners.add(onUpdate);
                const cached = matchesCache(login, scopeKey);
                if (cached) onUpdate(cached.data, cached.ordersPending);
            }
            return existing.promise.finally(() => {
                if (onUpdate) existing.listeners.delete(onUpdate);
            });
        }
        const cached = matchesCache(login, scopeKey);
        if (!refresh && cached && !cached.ordersPending) {
            onUpdate?.(cached.data, false);
            return Promise.resolve(cached.data);
        }
    }

    const flight: HistoryFlight = {
        generation,
        serial: ++publishSerial,
        promise: Promise.resolve({
            positions: [],
            deals: [],
            orders: [],
            errors: { positions: null, deals: null, orders: null },
        }),
        listeners: new Set(onUpdate ? [onUpdate] : []),
    };
    const promise = tradeGatewayApi.getHistoryDataSet(login, {
        force,
        onPartial: (data) => publishHistory(flight, login, scopeKey, data, true),
    }).then((data) => {
        publishHistory(flight, login, scopeKey, data, false);
        return data;
    }).finally(() => {
        if (flights.get(key)?.promise === promise) flights.delete(key);
    });
    flight.promise = promise;
    flights.set(key, flight);
    return promise;
};

import { brokerDisplayName, NEUTRAL_TERMINAL_TITLE, resolveTerminalTitle } from '../services/brokerDisplayName';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '../store/useAppStore';
import { brokerV2Api } from '../api/trade';
import { configApi } from '../services/api';
import type { Broker, BrokerServer } from '../types/api';
import type { NormalizedMarketStatus } from '../utils/marketStatus';
import { API_V2_BASE_URL, RTX5_API_URL, normalizeServerUrl } from '../config/api';
import { apiClient } from '../api/client';
import { runAfterTerminalReady } from '../startup/runAfterTerminalReady';
import { setBrokerServerTimeZoneFromConfig } from '../services/brokerServerClock';
import { onSessionChange } from '../services/brokerSession';
import {
    buildBrokerDirectoryLogoUrl,
    getConfiguredBrokerLogoUrl,
    isPlaceholderBrokerLogoUrl,
} from '../components/BrokerLogoImage';
import { getRuntimeBrokerConfiguration } from '../config/backendTarget.js';
import {
    recordBrokerServerIdentity,
    resolveServerDisplayLabel,
    useKnownBrokerServerName,
} from '../services/brokerServerIdentity';

/** Neutral fallback title. No vendor string; prefer getWebTerminalTitle(). */
export const WEB_TERMINAL_TITLE = NEUTRAL_TERMINAL_TITLE;
export const DEFAULT_BROKER_SERVER = WEB_TERMINAL_TITLE;

/**
 * White-label terminal title: broker display name from broker config when
 * configured, neutral fallback otherwise. Never a vendor default.
 */
export const getWebTerminalTitle = (): string => {
    try {
        const config = getRuntimeBrokerConfiguration() as {
            brokerName?: unknown; defaultMt5Server?: unknown; brokerId?: unknown;
        } | null;
        // The build fallback DEFAULT_MT5_SERVER yields to the broker-published
        // server name once the broker config is available.
        return resolveServerDisplayLabel(resolveTerminalTitle({
            displayName: config?.brokerName,
            defaultMt5Server: config?.defaultMt5Server,
            brokerId: config?.brokerId,
        }));
    } catch {
        return NEUTRAL_TERMINAL_TITLE;
    }
};

export const normalizeHeaderText = (value: unknown): string => String(value || '').trim();

/** Case-insensitive label equality for title dedupe (empty never equals). */
export const isSameTerminalLabel = (a: unknown, b: unknown): boolean => {
  const x = normalizeHeaderText(a).toLowerCase();
  const y = normalizeHeaderText(b).toLowerCase();
  return Boolean(x) && x === y;
};

const getStoredHeaderValue = (key: string): string => {
    if (typeof window === 'undefined') return '';
    return normalizeHeaderText(localStorage.getItem(key));
};

const getStoredBrokerId = (): string => getStoredHeaderValue('broker_id') || getStoredHeaderValue('rtx_broker_id');
const getStoredLogoUrl = (): string => {
    const storedLogo = getStoredHeaderValue('logo_url');
    const validStoredLogo = isPlaceholderBrokerLogoUrl(storedLogo) ? '' : storedLogo;
    return getConfiguredBrokerLogoUrl(getStoredBrokerId())
        || validStoredLogo
        || buildBrokerDirectoryLogoUrl(getStoredBrokerId());
};

const normalizeLogoBaseUrl = (value: unknown): string => {
    const normalized = normalizeServerUrl(normalizeHeaderText(value));
    return normalized.replace(/\/api\/v\d+\/?$/i, '').replace(/\/$/, '');
};

export const getLogoUrl = (url?: string, baseCandidates: string[] = []) => {
    const rawUrl = normalizeHeaderText(url);
    if (!rawUrl || isPlaceholderBrokerLogoUrl(rawUrl)) return '';
    if (/^(?:https?:|data:|blob:)/i.test(rawUrl)) {
        return rawUrl;
    }
    if (rawUrl.startsWith('./')) {
        return rawUrl;
    }

    const base = [
        ...baseCandidates,
        getStoredHeaderValue('server_url'),
        getStoredHeaderValue('backend_url'),
        RTX5_API_URL,
    ].map(normalizeLogoBaseUrl).find(Boolean);
    if (!base) return rawUrl;

    const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    return `${base}${path}`;
};

type BrokerTitleConfig = {
    name?: string;
    brokerName?: string;
    broker_name?: string;
    server_name?: string;
    logo_url?: string;
    marginMode?: string;
    margin_mode?: string;
};

const matchesBrokerServer = (server: BrokerServer, serverName: string): boolean => {
    const target = normalizeHeaderText(serverName).toLowerCase();
    if (!target) return false;

    return [
        server.server,
        server.server_url,
        server.backend_url,
        server.market_api_url,
        server.broker_id,
        server.broker_name,
    ].some((value) => normalizeHeaderText(value).toLowerCase() === target);
};

const resolveBrokerDisplayName = (
    serverName: string,
    config: BrokerTitleConfig | null,
    matchedServer?: BrokerServer,
    brokers: Broker[] = [],
    brokerId = '',
): string => {
    const targetBrokerId = matchedServer?.broker_id || brokerId;
    const matchedBroker = targetBrokerId
        ? brokers.find((broker) => String(broker.broker_id) === String(targetBrokerId))
        : undefined;

    const directoryName = matchedServer?.broker_name || matchedBroker?.name;
    return brokerDisplayName(
        serverName,
        directoryName,
        config?.broker_name,
        config?.brokerName,
        config?.name,
        config?.server_name,
    );
};

type BrokerDetails = [BrokerTitleConfig | null, BrokerServer[], { brokers: Broker[]; count: number } | null];

// HeaderBar and StatusBar both mount this hook; share one in-flight fetch per server.
let detailsCache: { key: string; promise: Promise<BrokerDetails> } | null = null;

const fetchBrokerDetails = (key: string): Promise<BrokerDetails> => {
    if (detailsCache?.key === key) return detailsCache.promise;
    const promise = Promise.all([
        configApi.getConfig().catch(() => null),
        brokerV2Api.getServers().catch(() => [] as BrokerServer[]),
        brokerV2Api.getBrokers().catch(() => ({ brokers: [] as Broker[], count: 0 })),
    ]).finally(() => {
        if (detailsCache?.promise === promise) detailsCache = null;
    }) as Promise<BrokerDetails>;
    detailsCache = { key, promise };
    return promise;
};

/** Shown while the signed account's own mode is unknown; never a guessed Hedge. */
export const UNKNOWN_MARGIN_MODE = '—';

/** accounts.account_mode ('netting' | 'hedging') → title label; anything else stays unknown. */
export const accountModeLabel = (value: unknown): string => {
    const mode = normalizeHeaderText(value).toLowerCase();
    if (mode === 'netting') return 'Netting';
    if (mode === 'hedging') return 'Hedge';
    return UNKNOWN_MARGIN_MODE;
};

type AccountModeRead = { account_login?: unknown; account_mode?: unknown };

// Netting/hedging is per account (group), not per broker: read it from the
// signed current-account capability snapshot once per account/session key.
// Every hook user shares one record per account/session key (resolved mode +
// read count), one in-flight read per key and symbol, and one session epoch,
// and is notified when a mode resolves (a small external store).
let accountModeCache: { key: string; promise: Promise<string> } | null = null;
const accountModeRecords = new Map<string, { mode: string; reads: number }>();
const accountModeListeners = new Set<() => void>();
/** Reads per account/session key while the mode stays unknown (one per symbol change). */
const MAX_ACCOUNT_MODE_READS = 3;
/** Bounded: only the current and a few recent account/session keys are kept. */
const MAX_ACCOUNT_MODE_RECORDS = 8;
/** Shared by every hook user, so a user that mounts after a login uses the same key. */
let accountModeSessionEpoch = 0;

const notifyAccountMode = () => { accountModeListeners.forEach((listener) => listener()); };
const subscribeAccountMode = (listener: () => void) => {
    accountModeListeners.add(listener);
    return () => { accountModeListeners.delete(listener); };
};

// Registered at import, before any hook user subscribes, so the epoch has moved
// when their own session listeners re-render. A login, logout or account change
// never reuses a previous session's mode.
onSessionChange((reason) => {
    if (reason === 'token_rotation') return;
    accountModeSessionEpoch += 1;
    accountModeRecords.clear();
    accountModeCache = null;
    notifyAccountMode();
});

const accountModeRecordFor = (key: string) => {
    let record = accountModeRecords.get(key);
    if (!record) {
        record = { mode: UNKNOWN_MARGIN_MODE, reads: 0 };
        accountModeRecords.set(key, record);
        while (accountModeRecords.size > MAX_ACCOUNT_MODE_RECORDS) {
            accountModeRecords.delete(accountModeRecords.keys().next().value as string);
        }
    }
    return record;
};

/** The shared resolved mode for this account/session key. */
const knownAccountMode = (key: string): string => accountModeRecords.get(key)?.mode ?? UNKNOWN_MARGIN_MODE;

const fetchAccountMode = (key: string, accountId: string, symbol: string): Promise<string> => {
    const record = accountModeRecordFor(key);
    if (record.mode !== UNKNOWN_MARGIN_MODE) return Promise.resolve(record.mode);
    const readKey = `${key}|${symbol}`;
    if (accountModeCache?.key === readKey) return accountModeCache.promise;
    if (record.reads >= MAX_ACCOUNT_MODE_READS) return Promise.resolve(UNKNOWN_MARGIN_MODE);
    record.reads += 1;
    const promise = apiClient.get<AccountModeRead>(
        `/account/symbol-capabilities/${encodeURIComponent(symbol)}`,
        { baseUrl: API_V2_BASE_URL },
    ).then((read) => (
        // A snapshot for another login (stale token after a switch) is not this account's mode.
        normalizeHeaderText(read?.account_login) === accountId ? accountModeLabel(read?.account_mode) : UNKNOWN_MARGIN_MODE
    )).catch(() => UNKNOWN_MARGIN_MODE).then((mode) => {
        // Keep the answer for its own key, even after a symbol change; an
        // unknown never replaces a known mode.
        const current = accountModeRecords.get(key);
        if (current && current.mode === UNKNOWN_MARGIN_MODE && mode !== UNKNOWN_MARGIN_MODE) {
            current.mode = mode;
            notifyAccountMode();
        }
        return knownAccountMode(key);
    }).finally(() => {
        if (accountModeCache?.promise === promise) accountModeCache = null;
    });
    accountModeCache = { key: readKey, promise };
    return promise;
};

export interface TerminalBrokerInfo {
    accountId: string;
    accountName?: string;
    serverName: string;
    brokerName: string;
    marginMode: string;
    logoUrl: string;
    logoBaseCandidates: string[];
}

/**
 * @param symbol the chart symbol the caller shows (required: App / StatusBar own
 *   it; the store's selectedSymbol is not kept in sync). Used only for the account-mode read.
 */
export function useTerminalBrokerInfo(symbol: string): TerminalBrokerInfo {
    const [sessionRevision, setSessionRevision] = useState(0);
    useEffect(() => onSessionChange(reason => {
        if (reason !== 'token_rotation') setSessionRevision(value => value + 1);
    }), []);
    const accountId = useAppStore((s) => s.accountId) || '---';
    const savedAccounts = useAppStore((s) => s.savedAccounts) || [];
    const activeAccount = savedAccounts.find(a => String(a.login) === String(accountId));
    const accountName = normalizeHeaderText(activeAccount?.name);
    const storedServer = typeof window !== 'undefined' ? localStorage.getItem('rtx_broker_server') : '';
    const serverName = storedServer || activeAccount?.server || DEFAULT_BROKER_SERVER;
    const brokerId = getStoredBrokerId();
    const infoKey = `${brokerId}|${serverName}|${accountId}|${sessionRevision}`;

    const [resolvedKey, setResolvedKey] = useState(infoKey);
    const [brokerName, setBrokerName] = useState<string>(() => brokerDisplayName(serverName));
    const isAuthenticated = useAppStore((s) => s.isAuthenticated);
    const modeSymbol = normalizeHeaderText(symbol);
    const modeKey = `${brokerId}|${serverName}|${accountId}|${isAuthenticated ? 'auth' : 'guest'}|${accountModeSessionEpoch}`;
    const [logoUrl, setLogoUrl] = useState<string>(() => getStoredLogoUrl());
    const [logoBaseCandidates, setLogoBaseCandidates] = useState<string[]>([]);

    useEffect(() => {
        let active = true;
        setResolvedKey(infoKey);
        setBrokerName(brokerDisplayName(serverName));
        setLogoUrl(getStoredLogoUrl());
        setLogoBaseCandidates([]);

        const fetchDetails = async () => {
            try {
                const [config, servers, brokersData] = await fetchBrokerDetails(infoKey);

                if (!active) return;

                // The broker may declare its server timezone for the server clock.
                if (config) setBrokerServerTimeZoneFromConfig(config);
                // The broker-published server name (config server_name, else the
                // current broker's /broker/servers entry) replaces the build fallback.
                recordBrokerServerIdentity(config, servers);

                // Find broker ID, broker name, and logo from server matching
                const matchedServer = servers.find(server => brokerId && String(server.broker_id) === brokerId)
                    || servers.find((server) => matchesBrokerServer(server, serverName));
                const brokersList = brokersData?.brokers || [];
                const matchedBroker = brokersList.find(broker => String(broker.broker_id) === (brokerId || String(matchedServer?.broker_id || '')));

                const pickValidLogoUrl = (...values: Array<string | undefined>): string =>
                    values
                        .map((v) => normalizeHeaderText(v))
                        .find((v) => Boolean(v) && !isPlaceholderBrokerLogoUrl(v)) || '';

                const finalLogoUrl = pickValidLogoUrl(
                    getConfiguredBrokerLogoUrl(brokerId),
                    matchedServer?.logo_url,
                    matchedBroker?.logo_url,
                    config?.logo_url,
                    getStoredHeaderValue('logo_url'),
                    getStoredLogoUrl(),
                );
                let nextLogoBaseCandidates: string[] = [];
                if (matchedServer) {
                    nextLogoBaseCandidates = [
                        matchedServer.server_url || '',
                        matchedServer.backend_url || '',
                        matchedServer.market_api_url || '',
                    ];
                }

                setBrokerName(resolveBrokerDisplayName(serverName, config, matchedServer, brokersList, brokerId));
                setLogoUrl(finalLogoUrl);
                setLogoBaseCandidates(nextLogoBaseCandidates);
            } catch (err) {
                console.error('[TerminalTitle] Error loading dynamic titlebar info:', err);
                if (!active) return;
                setBrokerName(brokerDisplayName(serverName));
                setLogoUrl(getStoredLogoUrl());
                setLogoBaseCandidates([]);
            }
        };

        const cancelScheduledDetails = runAfterTerminalReady(() => { void fetchDetails(); });
        return () => {
            active = false;
            cancelScheduledDetails();
        };
    }, [infoKey, serverName, brokerId]);

    // Account mode: read once per account/session; unknown until the signed
    // snapshot for this login answers. The read is per symbol and can fail for
    // a symbol outside this account's scope, so while the mode is still
    // unknown a symbol change may retry (capped); a known mode never re-reads.
    const sharedMode = useSyncExternalStore(subscribeAccountMode, () => knownAccountMode(modeKey));
    const marginMode = isAuthenticated ? sharedMode : UNKNOWN_MARGIN_MODE;
    const modeReadSymbol = marginMode !== UNKNOWN_MARGIN_MODE ? '' : modeSymbol;
    useEffect(() => {
        const login = accountId === '---' ? '' : String(accountId);
        if (!isAuthenticated || !login || !modeReadSymbol) return undefined;
        // The answer lands in the shared record for its own key and notifies
        // every hook user, so a read that finishes after a symbol change still counts.
        return runAfterTerminalReady(() => {
            void fetchAccountMode(modeKey, login, modeReadSymbol);
        });
    }, [modeKey, accountId, isAuthenticated, modeReadSymbol]);

    // Re-render when the broker-published server name becomes known so the
    // build fallback is replaced without waiting for another session change.
    useKnownBrokerServerName();
    const currentDetails = resolvedKey === infoKey;
    return {
        accountId, accountName, serverName: resolveServerDisplayLabel(serverName), marginMode,
        brokerName: resolveServerDisplayLabel(currentDetails ? brokerName : brokerDisplayName(serverName)),
        logoUrl: currentDetails ? logoUrl : getStoredLogoUrl(),
        logoBaseCandidates: currentDetails ? logoBaseCandidates : [],
    };
}

export function formatTerminalTitle(
    info: Pick<TerminalBrokerInfo, 'accountId' | 'brokerName' | 'marginMode'>,
    symbol: string,
    timeframe: string,
    marketStatus?: NormalizedMarketStatus & { loading?: boolean },
): string {
    const marketStatusSuffix = marketStatus?.isTradeBlocked && !marketStatus.loading && marketStatus.status !== 'unknown'
        ? ` - ${marketStatus.label}`
        : '';
    // Broker display name from discovery/runtime-config, shown once: when it
    // equals the title prefix the broker segment adds nothing, so it is dropped
    // (the server label then appears only once via the remaining segment).
    const brokerSegment = isSameTerminalLabel(info.brokerName, getWebTerminalTitle()) ? '' : info.brokerName;
    const title = `${getWebTerminalTitle()} - ${info.accountId}`
        + (brokerSegment ? ` - ${brokerSegment}` : '')
        + ` - ${info.marginMode} - ${symbol},${timeframe.toUpperCase()}${marketStatusSuffix}`;
    return title;
}

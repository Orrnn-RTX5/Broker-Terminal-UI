import { brokerDisplayName } from '../services/brokerDisplayName';
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { brokerV2Api } from '../api/trade';
import { configApi } from '../services/api';
import type { Broker, BrokerServer } from '../types/api';
import type { NormalizedMarketStatus } from '../utils/marketStatus';
import { RTX5_API_URL, normalizeServerUrl } from '../config/api';
import { runAfterTerminalReady } from '../startup/runAfterTerminalReady';
import { setBrokerServerTimeZoneFromConfig } from '../services/brokerServerClock';
import { onSessionChange } from '../services/brokerSession';
import { buildBrokerDirectoryLogoUrl } from '../components/BrokerLogoImage';

export const WEB_TERMINAL_TITLE = 'RTX 5 Web Terminal';
export const DEFAULT_BROKER_SERVER = WEB_TERMINAL_TITLE;

export const normalizeHeaderText = (value: unknown): string => String(value || '').trim();

const getStoredHeaderValue = (key: string): string => {
    if (typeof window === 'undefined') return '';
    return normalizeHeaderText(localStorage.getItem(key));
};

const getStoredBrokerId = (): string => getStoredHeaderValue('broker_id') || getStoredHeaderValue('rtx_broker_id');
const getStoredLogoUrl = (): string => getStoredHeaderValue('logo_url') || buildBrokerDirectoryLogoUrl(getStoredBrokerId());

const normalizeLogoBaseUrl = (value: unknown): string => {
    const normalized = normalizeServerUrl(normalizeHeaderText(value));
    return normalized.replace(/\/api\/v\d+\/?$/i, '').replace(/\/$/, '');
};

export const getLogoUrl = (url?: string, baseCandidates: string[] = []) => {
    const rawUrl = normalizeHeaderText(url);
    if (!rawUrl) return '';
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
    logo_url?: string;
    marginMode?: string;
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
): string => {
    const matchedBroker = matchedServer?.broker_id
        ? brokers.find((broker) => broker.broker_id === matchedServer.broker_id)
        : undefined;

    const directoryName = matchedServer?.broker_name || matchedBroker?.name;
    return brokerDisplayName(serverName, directoryName, config?.brokerName, config?.name);
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

export interface TerminalBrokerInfo {
    accountId: string;
    accountName?: string;
    serverName: string;
    brokerName: string;
    marginMode: string;
    logoUrl: string;
    logoBaseCandidates: string[];
}

export function useTerminalBrokerInfo(): TerminalBrokerInfo {
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
    const [marginMode, setMarginMode] = useState<string>('Hedge');
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

                // 1. Margin mode from config
                if (config) {
                    if (config.marginMode === 'NETTING') {
                        setMarginMode('Netting');
                    } else {
                        setMarginMode('Hedge');
                    }
                }

                // 2. Find broker ID, broker name, and logo from server matching
                const matchedServer = servers.find(server => brokerId && String(server.broker_id) === brokerId)
                    || servers.find((server) => matchesBrokerServer(server, serverName));
                const brokersList = brokersData?.brokers || [];
                const matchedBroker = brokersList.find(broker => String(broker.broker_id) === (brokerId || String(matchedServer?.broker_id || '')));

                const finalLogoUrl = matchedServer?.logo_url || matchedBroker?.logo_url
                    || config?.logo_url || getStoredHeaderValue('logo_url') || getStoredLogoUrl();
                let nextLogoBaseCandidates: string[] = [];
                if (matchedServer) {
                    nextLogoBaseCandidates = [
                        matchedServer.server_url || '',
                        matchedServer.backend_url || '',
                        matchedServer.market_api_url || '',
                    ];
                }

                setBrokerName(resolveBrokerDisplayName(serverName, config, matchedServer, brokersList));
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

    const currentDetails = resolvedKey === infoKey;
    return {
        accountId, accountName, serverName, marginMode,
        brokerName: currentDetails ? brokerName : brokerDisplayName(serverName),
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
    return `${WEB_TERMINAL_TITLE} - ${info.accountId} - ${info.brokerName} - ${info.marginMode} - ${symbol},${timeframe.toUpperCase()}${marketStatusSuffix}`;
}

import { getRuntimeBrokerConfiguration } from '../../config/backendTarget.js';
import { getCommittedBrokerAccountSessionScope } from '../../services/brokerSession';
import { DEFAULT_BROKER_SERVER, getStoredBrokerServer } from '../../services/brokerServers';

// Account ownership needs full identities. The logo resolver's hostname-only
// matching would merge servers on different ports or broker-specific paths.
export const normalizeNavigatorAccountServer = (value: string): string => {
    const text = value.trim();
    if (!text || text === DEFAULT_BROKER_SERVER || text === 'Broker') return '';
    try {
        const url = new URL(text);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
            return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}${url.hash}`;
        }
    } catch {
        // Named servers and opaque broker IDs keep their exact identity.
    }
    return text;
};

export const getNavigatorAccountServerIdentities = (): Set<string> => {
    const stored = (key: string) => typeof window === 'undefined' ? '' : localStorage.getItem(key) || '';
    const scope = getCommittedBrokerAccountSessionScope();
    const identities = new Set<string>();
    const add = (value: string) => {
        const identity = normalizeNavigatorAccountServer(value);
        if (identity) identities.add(identity);
    };
    if (scope.authenticated) {
        add(scope.brokerId);
        add(scope.serverUrl);
    }

    const storedBrokerId = stored('broker_id').trim() || stored('rtx_broker_id').trim();
    // market_api_url can survive an older session; it is not committed by the
    // login discovery flow and must not grant visibility to saved accounts.
    const storedServers = [getStoredBrokerServer(), stored('server_url'), stored('backend_url')];
    const storageMatchesSession = !scope.authenticated || (
        (!scope.brokerId || storedBrokerId === scope.brokerId)
        && (!scope.serverUrl || storedServers.some(server => (
            normalizeNavigatorAccountServer(server) === normalizeNavigatorAccountServer(scope.serverUrl)
        )))
    );
    // Broker selection can stage new storage metadata before login succeeds.
    // Never let those aliases describe the previous authenticated session.
    if (storageMatchesSession) {
        storedServers.forEach(add);
        add(storedBrokerId);
        add(stored('broker_name'));
    }

    const config = getRuntimeBrokerConfiguration();
    const activeBrokerId = scope.authenticated ? scope.brokerId : storedBrokerId;
    const configuredEndpoints = [config.apiHost, config.apiHostExt]
        .map(value => normalizeNavigatorAccountServer(value || '')).filter(Boolean);
    const committedServer = scope.authenticated ? normalizeNavigatorAccountServer(scope.serverUrl) : '';
    const matchesConfiguredServer = committedServer
        ? configuredEndpoints.includes(committedServer)
        : configuredEndpoints.some(endpoint => identities.has(endpoint)) || identities.has(config.brokerId);
    if (config.valid && (!activeBrokerId || activeBrokerId === config.brokerId)
        && matchesConfiguredServer) {
        add(config.brokerName || '');
        add(config.defaultMt5Server || '');
    }
    return identities;
};

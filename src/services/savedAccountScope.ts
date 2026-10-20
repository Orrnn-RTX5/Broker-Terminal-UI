import { getRuntimeBrokerConfiguration } from '../config/backendTarget.js';
import type { SavedAccount } from '../store/useAppStore';
import { getCommittedBrokerAccountSessionScope, type CommittedBrokerAccountSessionScope } from './brokerSession';
import { getRawStoredBrokerServer, isDefaultBrokerServerValue } from './brokerServers';

// Account ownership needs full identities. The logo resolver's hostname-only
// matching would merge servers on different ports or broker-specific paths.
export const normalizeSavedAccountServer = (value: string): string => {
    const text = value.trim();
    if (!text || isDefaultBrokerServerValue(text)) return '';
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

export const getSavedAccountServerIdentities = (): Set<string> => {
    const stored = (key: string) => typeof window === 'undefined' ? '' : localStorage.getItem(key) || '';
    const scope = getCommittedBrokerAccountSessionScope();
    const identities = new Set<string>();
    const add = (value: string) => {
        const identity = normalizeSavedAccountServer(value);
        if (identity) identities.add(identity);
    };
    if (scope.authenticated) {
        add(scope.brokerId);
        add(scope.serverUrl);
    }

    const storedBrokerId = stored('broker_id').trim() || stored('rtx_broker_id').trim();
    // market_api_url can survive an older session; it is not committed by the
    // login discovery flow and must not grant visibility to saved accounts.
    // Ownership matching uses the verbatim remembered server (base behaviour);
    // login/display paths use the validated getStoredBrokerServer() instead.
    const storedServers = [getRawStoredBrokerServer(), stored('server_url'), stored('backend_url')];
    const storageMatchesSession = !scope.authenticated || (
        (!scope.brokerId || storedBrokerId === scope.brokerId)
        && (!scope.serverUrl || storedServers.some(server => (
            normalizeSavedAccountServer(server) === normalizeSavedAccountServer(scope.serverUrl)
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
        .map(value => normalizeSavedAccountServer(value || '')).filter(Boolean);
    const committedServer = scope.authenticated ? normalizeSavedAccountServer(scope.serverUrl) : '';
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

export const isSavedAccountInBrokerSession = (
    account: SavedAccount,
    scope: CommittedBrokerAccountSessionScope,
    serverIdentities: ReadonlySet<string>,
): boolean => {
    // A display label is not an ownership key: discovery and login may spell
    // it differently. Explicit login ownership takes precedence over aliases.
    if (account.brokerId || account.serverUrl) {
        return scope.authenticated
            && (!account.brokerId || account.brokerId === scope.brokerId)
            && (!account.serverUrl || normalizeSavedAccountServer(account.serverUrl) === normalizeSavedAccountServer(scope.serverUrl))
            && (Boolean(account.brokerId && account.serverUrl)
                || serverIdentities.has(normalizeSavedAccountServer(account.server)));
    }
    // Keep legacy matching exact. Folding case could expose an unrelated
    // opaque broker ID that differs only by case.
    return serverIdentities.has(normalizeSavedAccountServer(account.server));
};

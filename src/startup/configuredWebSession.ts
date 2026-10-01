import {
  getBackendTarget,
  getRuntimeConfiguredBrokerId,
  getRuntimeBrokerConfiguration,
  getPublicWsTarget,
  isDesktopBackendTarget,
} from '../config/backendTarget.js';
import { credentialsAreBoundToDeployment, persistBrokerSessionDiscovery } from '../services/brokerSession';

export const CONFIGURED_WEB_SESSION_KEY = 'rtx_configured_web_session_v1';

type DeploymentScope = { brokerId: string; backendUrl: string };

const normalizeBrokerId = (value: unknown): string => String(value || '').trim();
const normalizeBackendUrl = (value: unknown): string => {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
};

const ACTIVE_SESSION_KEYS = [
  'auth_token', 'refresh_token', 'token_expires_at', 'api_base_url',
  'account_login', 'rtx_last_login', 'rtx_saved_username', 'rtx_saved_password',
  'rtx_user', 'mt5_credentials', 'mt5_auto_login',
  'feed_broker_id',
  'rtx_last_authenticated_broker_id',
];

const ROUTING_AND_PRESENTATION_KEYS = [
  'server_url', 'backend_url', 'market_api_url', 'rtx_broker_server',
  'ws_url', 'feed_url', 'feed_status_url', 'logo_url', 'broker_name',
  'broker_theme_color', 'rtx_broker_presentation_v1',
];

const clearPersistedActiveAccount = (storage: Storage): void => {
  const raw = storage.getItem('trading-app-storage');
  if (!raw) return;
  try {
    const persisted = JSON.parse(raw);
    if (!persisted?.state || typeof persisted.state !== 'object') return;
    // Older releases persisted authentication too. Retain preferences and any
    // saved-account records, but never rehydrate another deployment's identity.
    for (const key of ['accountId', 'isAuthenticated', 'authToken', 'refreshToken', 'tokenExpiresAt']) {
      delete persisted.state[key];
    }
    storage.setItem('trading-app-storage', JSON.stringify(persisted));
  } catch {
    // A malformed preference record contains no usable authenticated identity.
  }
};

/** Reconcile deployment ownership before the authenticated module can load. */
export const ensureConfiguredWebSession = (): boolean => {
  if (typeof window === 'undefined' || isDesktopBackendTarget()) return true;
  const brokerId = getRuntimeConfiguredBrokerId();

  try {
    const storage = window.localStorage;
    const session = window.sessionStorage;
    const configuration = getRuntimeBrokerConfiguration();
    if (!configuration.valid || !brokerId || !getBackendTarget()) {
      [...ACTIVE_SESSION_KEYS, ...ROUTING_AND_PRESENTATION_KEYS, 'broker_id', 'rtx_broker_id'].forEach((key) => {
        storage.removeItem(key);
        session.removeItem(key);
      });
      clearPersistedActiveAccount(storage);
      storage.removeItem(CONFIGURED_WEB_SESSION_KEY);
      return false;
    }
    const scope: DeploymentScope = {
      brokerId: normalizeBrokerId(brokerId),
      backendUrl: normalizeBackendUrl(getBackendTarget()),
    };
    const rawScope = storage.getItem(CONFIGURED_WEB_SESSION_KEY);
    let previous: DeploymentScope | null = null;
    if (rawScope) {
      try {
        const parsed = JSON.parse(rawScope);
        previous = {
          brokerId: normalizeBrokerId(parsed?.brokerId),
          backendUrl: normalizeBackendUrl(parsed?.backendUrl),
        };
      } catch { /* Invalid ownership records cannot authorize session restore. */ }
    }

    const storedBrokerId = normalizeBrokerId(
      storage.getItem('broker_id') || storage.getItem('rtx_broker_id')
        || storage.getItem('rtx_last_authenticated_broker_id'),
    );
    const storedBackendUrl = normalizeBackendUrl(
      storage.getItem('server_url') || storage.getItem('backend_url')
        || storage.getItem('market_api_url') || storage.getItem('rtx_broker_server'),
    );
    const hasCredentials = Boolean(
      storage.getItem('auth_token') || session.getItem('auth_token')
        || storage.getItem('refresh_token') || session.getItem('refresh_token'),
    );
    const storedRoutingMatches = (!storedBrokerId || storedBrokerId === scope.brokerId)
      && (!storedBackendUrl || storedBackendUrl === scope.backendUrl)
      && (!hasCredentials || credentialsAreBoundToDeployment());
    const matches = previous
      ? previous.brokerId === scope.brokerId && previous.backendUrl === scope.backendUrl
        && storedRoutingMatches
      : storedRoutingMatches
        && (!hasCredentials || Boolean(storedBrokerId && storedBackendUrl));

    if (!matches) {
      ACTIVE_SESSION_KEYS.forEach((key) => {
        storage.removeItem(key);
        session.removeItem(key);
      });
      ROUTING_AND_PRESENTATION_KEYS.forEach((key) => {
        storage.removeItem(key);
        session.removeItem(key);
      });
      clearPersistedActiveAccount(storage);
      // Reuse the normal broker transition so endpoint/feed state and session
      // listeners are updated together, without importing the trading store.
      // Clear credentials first so no transition listener sees the old token.
      persistBrokerSessionDiscovery({
        broker_id: brokerId,
        backend_url: scope.backendUrl,
        market_api_url: scope.backendUrl,
        server_url: scope.backendUrl,
      });
    }
    // Routing is repaired even when the HTTP session ownership is unchanged.
    // Older releases could persist a public socket from a different broker.
    const socketOrigin = new URL(getPublicWsTarget());
    socketOrigin.pathname = '/ws/v2';
    socketOrigin.search = '';
    socketOrigin.hash = '';
    storage.setItem('ws_url', socketOrigin.toString());
    socketOrigin.pathname = '/ws/feed';
    storage.setItem('feed_url', socketOrigin.toString());
    storage.setItem('broker_id', configuration.brokerId);
    storage.setItem('rtx_broker_id', configuration.brokerId);
    storage.setItem('feed_broker_id', configuration.feedBrokerId || configuration.brokerId);
    storage.setItem('server_url', configuration.apiHost);
    storage.setItem('backend_url', configuration.apiHost);
    storage.setItem('market_api_url', configuration.apiHostExt);
    storage.setItem('rtx_broker_server', configuration.apiHost);
    storage.setItem(CONFIGURED_WEB_SESSION_KEY, JSON.stringify(scope));
    return matches;
  } catch {
    // If ownership cannot be checked, open the login screen rather than start
    // an authenticated request with an unverified stored broker session.
    return false;
  }
};

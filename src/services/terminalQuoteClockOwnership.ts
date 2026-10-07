import { getAccessToken, getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey,
  getRefreshToken, getServerUrl } from './brokerSession';
import { resetTerminalQuoteFreshness, type TerminalQuoteClockOwner } from './terminalQuoteFreshness';
import { toLocalDevProxyUrl } from '../config/localDevProxy';

interface BrokerQuoteClockOwner extends TerminalQuoteClockOwner { apiBaseUrl: string }

let retained: { scope: string; server: string; access: string | null; refresh: string | null;
  owner: BrokerQuoteClockOwner } | undefined;

/** Opaque ownership; credential values stay in memory and are never diagnostic identifiers. */
export function getTerminalQuoteClockOwner(): BrokerQuoteClockOwner | undefined {
  const scope = getCommittedBrokerAccountSessionScope();
  const server = getServerUrl().replace(/\/+$/, '');
  if (!scope.brokerId || !scope.serverUrl || scope.serverUrl.replace(/\/+$/, '') !== server) {
    retained = undefined;
    return undefined;
  }
  const scopeKey = getCommittedBrokerAccountSessionScopeKey(scope);
  const access = getAccessToken();
  const refresh = getRefreshToken();
  if (retained?.scope === scopeKey && retained.server === server
    && retained.access === access && retained.refresh === refresh) return retained.owner;
  const owner: BrokerQuoteClockOwner = { apiBaseUrl: `${toLocalDevProxyUrl(server)}/api/v2`,
    isCurrent: () => getTerminalQuoteClockOwner() === owner };
  retained = { scope: scopeKey, server, access, refresh, owner };
  return owner;
}

/** Reconnects invalidate quote evidence, but cannot renew or transfer an HTTP clock sample. */
export function resetTerminalQuoteTransport(): void {
  resetTerminalQuoteFreshness({ preserveClockForOwner: getTerminalQuoteClockOwner() });
}

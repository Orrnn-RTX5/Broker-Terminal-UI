import { getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';

const text = (value: unknown): string => String(value ?? '').trim();
const identity = (value: unknown): string => text(value).replace(/\/+$/, '').toLowerCase();

// A valid display name cannot be empty, cannot be the literal placeholder 'Broker' (case-insensitive),
// cannot be a URL, and cannot be a generic terminal window title.
export const isBrokerName = (value: unknown): boolean => {
  const s = text(value);
  if (!s) return false;
  if (/^broker$/i.test(s)) return false;
  if (/^rtx\s*5?\s*(?:web\s*)?terminal$/i.test(s)) return false;
  if (/^(?:https?:|wss?:|\/\/)/i.test(s)) return false;
  if (/^[^\s/]+\.[a-z]{2,}(?:[/:]|$)/i.test(s)) return false;
  return true;
};

/** Display metadata only: never change the server used for routing or login. */
export function brokerDisplayName(server: string, ...names: unknown[]): string {
  const config = getRuntimeBrokerConfiguration();
  const configuredServers = [config.apiHost, config.apiHostExt].filter(Boolean);
  const matchesConfig = configuredServers.some(value => identity(server) === identity(value))
    || Boolean(config.brokerId && identity(server) === identity(config.brokerId));
  if (!isDesktopBackendTarget() && config.valid && matchesConfig && isBrokerName(config.brokerName)) {
    return config.brokerName;
  }

  // Explicit directory names remain presentation metadata only.
  const suppliedName = names.map(text).find(isBrokerName);
  if (suppliedName) return suppliedName;

  // 3. Check storage metadata from active session or cached broker presentation.
  if (typeof localStorage !== 'undefined') {
    const matches = ['rtx_broker_server', 'server_url', 'backend_url', 'market_api_url', 'broker_id', 'rtx_broker_id']
      .some(key => !!identity(server) && identity(localStorage.getItem(key)) === identity(server));

    const storedName = text(localStorage.getItem('broker_name'));
    if (matches && isBrokerName(storedName)) return storedName;

    // Check presentation cache written during broker discovery / login
    try {
      const presentation = JSON.parse(localStorage.getItem('rtx_broker_presentation_v1') || 'null');
      if (presentation?.brokerName && isBrokerName(presentation.brokerName)) {
        if (identity(server) === identity(presentation.brokerId)) {
          return String(presentation.brokerName).trim();
        }
      }
    } catch {
      // Ignore JSON parse errors
    }

    // If matches session and storedName is valid (even if storedName was set without matches check)
    if (isBrokerName(storedName) && (!server || matches)) {
      return storedName;
    }
  }

  const configuredName = text(config.brokerName || config.defaultMt5Server);
  if (matchesConfig && isBrokerName(configuredName)) return configuredName;

  // 5. A desktop deployment can name only the broker it was configured for.
  // Do not apply that fallback label to a different broker selected from the
  // shared directory when its session metadata is unavailable.
  if (isDesktopBackendTarget()) {
    if (matchesConfig) {
      if (isBrokerName(configuredName)) return configuredName;
    }
    return 'Broker';
  }

  // 6. Named servers (e.g. 'MetaQuotes-Demo', 'ICMarkets-Live') keep their name.
  return isBrokerName(text(server)) ? text(server) : 'Broker';
}

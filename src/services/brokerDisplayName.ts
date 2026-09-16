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

// Known broker name mappings by domain substring or broker ID
const KNOWN_BROKERS: Record<string, string> = {
  'achiever-financials': 'Achiever Financials',
  'achieverfinancials': 'Achiever Financials',
  'grow-trading-academy': 'Grow Trading Academy',
  'growtradingacademy': 'Grow Trading Academy',
  'gta_broker': 'Grow Trading Academy',
  'gta': 'Grow Trading Academy',
  'fxtrust': 'FX Trust',
  'myprop': 'MyProp',
};

const resolveKnownBroker = (value: unknown): string => {
  const norm = identity(value);
  if (!norm) return '';
  for (const [pattern, brokerName] of Object.entries(KNOWN_BROKERS)) {
    if (norm === pattern || norm.includes(pattern)) {
      return brokerName;
    }
  }
  return '';
};

const getEnv = (): Record<string, any> => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env;
    }
  } catch {
    // Ignore when import.meta is unavailable
  }
  return {};
};

const isDesktopRuntime = (): boolean => {
  if (typeof window !== 'undefined') {
    const w = window as any;
    if (Boolean(w.electron?.window || w.electronAPI || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')))) {
      return true;
    }
  }
  const env = getEnv();
  const target = String(env.VITE_BACKEND_TARGET || env.BACKEND_TARGET || '').toLowerCase();
  const mode = String(env.VITE_BACKEND_MODE || env.BACKEND_MODE || '').toLowerCase();
  return target === 'electron' || target === 'desktop' || mode === 'electron' || mode === 'desktop';
};

/** Display metadata only: never change the server used for routing or login. */
export function brokerDisplayName(server: string, ...names: unknown[]): string {
  // 1. If any supplied candidate is a valid broker name, use it.
  const suppliedName = names.map(text).find(isBrokerName);
  if (suppliedName) return suppliedName;

  // 2. Check if the server string or any supplied candidate maps to a known broker.
  const knownDirect = resolveKnownBroker(server) || names.map(resolveKnownBroker).find(Boolean);
  if (knownDirect) return knownDirect;

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
        if (!server || matches || identity(server) === identity(presentation.brokerId) || identity(server).includes(identity(presentation.brokerId))) {
          return String(presentation.brokerName).trim();
        }
      }
    } catch {
      // Ignore JSON parse errors
    }

    // Check stored broker ID against known brokers
    const storedBrokerId = localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id');
    const knownFromStoredId = resolveKnownBroker(storedBrokerId);
    if ((matches || isDesktopRuntime()) && knownFromStoredId) {
      return knownFromStoredId;
    }

    // If matches session and storedName is valid (even if storedName was set without matches check)
    if (isBrokerName(storedName) && (!server || matches)) {
      return storedName;
    }
  }

  // 4. Check configured environment broker name (e.g. from .env.electron).
  const env = getEnv();
  const configuredServer = text(env.VITE_BACKEND_URL || env.VITE_API_URL);
  const configuredName = text(env.VITE_DEFAULT_MT5_SERVER || env.VITE_BROKER_NAME);
  const configuredBrokerId = text(env.VITE_BROKER_ID || env.VITE_FEED_BROKER_ID);

  const matchesConfig = (configuredServer && (identity(server) === identity(configuredServer) || identity(server).includes(identity(configuredServer))))
    || (configuredBrokerId && identity(server) === identity(configuredBrokerId));

  if (matchesConfig && isBrokerName(configuredName)) {
    return configuredName;
  }

  // 5. A desktop deployment can name only the broker it was configured for.
  // Do not apply that fallback label to a different broker selected from the
  // shared directory when its session metadata is unavailable.
  if (isDesktopRuntime()) {
    if (matchesConfig) {
      if (isBrokerName(configuredName)) return configuredName;
      const knownFromConfigId = resolveKnownBroker(configuredBrokerId);
      if (knownFromConfigId) return knownFromConfigId;
    }
    return 'Broker';
  }

  // 6. Named servers (e.g. 'MetaQuotes-Demo', 'ICMarkets-Live') keep their name.
  return isBrokerName(text(server)) ? text(server) : 'Broker';
}

// URL-only helpers shared by the lightweight entry and the full API runtime.
export const DEV_BROKER_API_PROXY_PREFIX = '/__broker_api';
export const DEV_BROKER_DISCOVERY_PROXY_PREFIX = '/__broker_discovery';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const isElectronRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.electron?.window)
    || Boolean((window as Window & { electronAPI?: unknown }).electronAPI)
    || window.location?.protocol === 'file:'
    || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
};

export const isLocalViteDevServer = (): boolean => {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test' || typeof window === 'undefined' || isElectronRuntime()) return false;
  const protocol = window.location?.protocol || '';
  const hostname = window.location?.hostname || '';
  return protocol.startsWith('http') && LOCAL_DEV_HOSTS.has(hostname);
};

export const toLocalDevProxyUrl = (
  value: string,
  proxyPrefix = DEV_BROKER_API_PROXY_PREFIX,
): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed || !isLocalViteDevServer()) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return trimmed;
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${proxyPrefix}/${encodeURIComponent(parsed.origin)}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
};

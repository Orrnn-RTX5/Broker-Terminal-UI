import { normalizeBrokerServerUrl, toLocalDevProxyUrl } from '../config/api';
import { isBrokerName } from './brokerDisplayName';
import { normalizeBrokerThemeColor } from './brokerThemeColor';
import { isConfiguredBrokerEndpoint, isDesktopBackendTarget, getRuntimeBrokerConfiguration, getRuntimeConfiguredBrokerId } from '../config/backendTarget.js';
import { NEUTRAL_TERMINAL_TITLE, resolveTerminalTitle } from './brokerDisplayName';
import { assertBrokerRequestAllowed } from '../api/brokerRequestGuard';

export { normalizeBrokerThemeColor } from './brokerThemeColor';

export const BROKER_CHROME_EVENT = 'rtx:broker-chrome';

export interface BrokerPresentationConfig {
  logo_url?: string;
  theme_color?: string;
  broker_name?: string;
}

export interface BrokerPresentationSource {
  broker_id?: string | number;
  broker_name?: string;
  logo_url?: string;
  theme_color?: string;
  [key: string]: unknown;
}

export interface BrokerChromeState {
  brokerId: string;
  brokerName: string;
  logoUrl: string;
  themeColor: string;
}

const ABSOLUTE_ASSET_URL = /^(?:https?:|data:|blob:)/i;
/** Neutral login/desktop title. No vendor string; prefer getLoginTitle(). */
export const DEFAULT_LOGIN_TITLE = NEUTRAL_TERMINAL_TITLE;
const originalFavicons = new WeakMap<HTMLLinkElement, { href: string; type: string | null }>();

const updateBrokerFavicon = (logoUrl: string): void => {
  let favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.setAttribute('href', './favicon.png');
    favicon.type = 'image/png';
    document.head.appendChild(favicon);
  }
  if (!originalFavicons.has(favicon)) {
    originalFavicons.set(favicon, { href: favicon.getAttribute('href') || './favicon.png', type: favicon.getAttribute('type') });
  }
  const original = originalFavicons.get(favicon)!;
  const nextHref = logoUrl || original.href;
  if (favicon.getAttribute('href') !== nextHref) favicon.setAttribute('href', nextHref);
  // Brokers can provide PNG, SVG or ICO; let the browser detect their format.
  if (logoUrl || original.type === null) favicon.removeAttribute('type');
  else favicon.setAttribute('type', original.type);
};

let currentChrome: BrokerChromeState = {
  brokerId: '',
  brokerName: '',
  logoUrl: '',
  themeColor: '',
};

export const getBrokerChrome = (): BrokerChromeState => currentChrome;

/**
 * White-label login title: broker display name from broker config when
 * configured, neutral fallback otherwise. Never a vendor default.
 */
export const getLoginTitle = (): string => {
  try {
    const config = getRuntimeBrokerConfiguration() as {
      brokerName?: unknown; defaultMt5Server?: unknown; brokerId?: unknown;
    } | null;
    return resolveTerminalTitle({
      displayName: config?.brokerName,
      defaultMt5Server: config?.defaultMt5Server,
      brokerId: config?.brokerId,
    });
  } catch {
    return NEUTRAL_TERMINAL_TITLE;
  }
};

export const buildBrokerPresentationUrl = (
  serverUrl: unknown,
  brokerId: unknown,
): string => {
  const baseUrl = normalizeBrokerServerUrl(String(serverUrl || '').trim()).replace(/\/+$/, '');
  const id = String(brokerId || '').trim();
  if (!baseUrl || !id) return '';

  try {
    const url = new URL(`${baseUrl}/api/v2/broker/config`);
    url.searchParams.set('broker_id', id);
    return url.toString();
  } catch {
    return '';
  }
};

export const isPlaceholderBrokerLogoUrl = (value: unknown): boolean =>
  /(?:^|\/)assets\/logo\.png(?:[?#].*)?$/i.test(String(value || '').trim());

/** Resolve a broker-provided asset against that broker's own origin. */
export const resolveBrokerPresentationAssetUrl = (
  value: unknown,
  serverUrl: unknown,
): string => {
  const raw = String(value || '').trim();
  if (!raw || isPlaceholderBrokerLogoUrl(raw)) return '';
  if (ABSOLUTE_ASSET_URL.test(raw)) return raw;
  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  const baseUrl = normalizeBrokerServerUrl(String(serverUrl || '').trim()).replace(/\/+$/, '');
  if (!baseUrl) return '';

  try {
    return new URL(raw, `${baseUrl}/`).toString();
  } catch {
    return '';
  }
};

export const normalizeBrokerPresentationConfig = (
  payload: unknown,
  serverUrl?: unknown,
): BrokerPresentationConfig | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const raw = payload as Record<string, unknown>;
  const rawLogo = isPlaceholderBrokerLogoUrl(raw.logo_url) ? '' : raw.logo_url;
  const logoUrl = resolveBrokerPresentationAssetUrl(rawLogo, serverUrl)
    || String(rawLogo || '').trim();
  const themeColor = normalizeBrokerThemeColor(raw.theme_color);
  const brokerName = isBrokerName(raw.broker_name) ? String(raw.broker_name).trim() : '';
  if (!logoUrl && !themeColor && !brokerName) return null;

  return {
    ...(logoUrl ? { logo_url: logoUrl } : {}),
    ...(themeColor ? { theme_color: themeColor } : {}),
    ...(brokerName ? { broker_name: brokerName } : {}),
  };
};

/**
 * Reads optional visual metadata from the broker selected in the desktop
 * directory. It never changes API routing or blocks the health/login flow.
 */
export async function loadBrokerPresentation(
  broker: Pick<BrokerPresentationSource, 'broker_id'> & { server_url?: string },
  signal?: AbortSignal,
): Promise<BrokerPresentationConfig | null> {
  const url = buildBrokerPresentationUrl(broker.server_url, broker.broker_id);
  if (!url) return null;
  if (!isDesktopBackendTarget() && String(broker.broker_id) !== getRuntimeConfiguredBrokerId()) return null;
  assertBrokerRequestAllowed(url);

  const response = await fetch(toLocalDevProxyUrl(url), {
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) return null;

  const payload = await response.json();
  if (!isDesktopBackendTarget() && (!isConfiguredBrokerEndpoint(url, 'http')
    || String(broker.broker_id) !== getRuntimeConfiguredBrokerId()
    || (payload?.broker_id !== undefined && String(payload.broker_id) !== getRuntimeConfiguredBrokerId()))) return null;
  return normalizeBrokerPresentationConfig(payload, broker.server_url);
}

export const mergeBrokerPresentation = <T extends BrokerPresentationSource>(
  broker: T,
  presentation: BrokerPresentationConfig | null,
): T => {
  if (!presentation) return broker;

  const logoUrl = presentation.logo_url || String(broker.logo_url || '').trim();
  const themeColor = presentation.theme_color || normalizeBrokerThemeColor(broker.theme_color);
  const brokerName = presentation.broker_name || String(broker.broker_name || '').trim();
  if (
    logoUrl === String(broker.logo_url || '').trim()
    && themeColor === normalizeBrokerThemeColor(broker.theme_color)
    && brokerName === String(broker.broker_name || '').trim()
  ) {
    return broker;
  }

  return {
    ...broker,
    ...(brokerName ? { broker_name: brokerName } : {}),
    ...(logoUrl ? { logo_url: logoUrl } : {}),
    ...(themeColor ? { theme_color: themeColor } : {}),
  };
};

/**
 * Paints selected-broker identity onto the desktop chrome. Routing, health,
 * and login stay on the directory server_url — this only updates visuals.
 */
export const applyBrokerChrome = (
  input: Partial<BrokerChromeState> & { updateLoginTitle?: boolean } = {},
): BrokerChromeState => {
  currentChrome = {
    brokerId: String(input.brokerId || '').trim(),
    brokerName: String(input.brokerName || '').trim(),
    logoUrl: String(input.logoUrl || '').trim(),
    themeColor: normalizeBrokerThemeColor(input.themeColor),
  };

  if (typeof document === 'undefined') return currentChrome;
  updateBrokerFavicon(currentChrome.logoUrl);

  const root = document.documentElement;
  if (currentChrome.brokerId) root.setAttribute('data-broker-id', currentChrome.brokerId);
  else root.removeAttribute('data-broker-id');

  if (currentChrome.themeColor) root.style.setProperty('--rtx-broker-accent', currentChrome.themeColor);
  else root.style.removeProperty('--rtx-broker-accent');

  if (input.updateLoginTitle) {
    const title = currentChrome.brokerName
      ? `${getLoginTitle()} - ${currentChrome.brokerName}`
      : getLoginTitle();
    document.title = title;
    if (typeof window !== 'undefined') {
      window.electron?.window?.setTitle?.(title);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<BrokerChromeState>(BROKER_CHROME_EVENT, { detail: currentChrome }));
  }

  return currentChrome;
};

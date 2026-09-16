import { normalizeBrokerServerUrl, toLocalDevProxyUrl } from '../config/api';
import { isBrokerName } from './brokerDisplayName';
import { normalizeBrokerThemeColor } from './brokerThemeColor';

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
const DEFAULT_LOGIN_TITLE = 'RTX Terminal';

let currentChrome: BrokerChromeState = {
  brokerId: '',
  brokerName: '',
  logoUrl: '',
  themeColor: '',
};

export const getBrokerChrome = (): BrokerChromeState => currentChrome;

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

/** Resolve a broker-provided asset against that broker's own origin. */
export const resolveBrokerPresentationAssetUrl = (
  value: unknown,
  serverUrl: unknown,
): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
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
  const logoUrl = resolveBrokerPresentationAssetUrl(raw.logo_url, serverUrl)
    || String(raw.logo_url || '').trim();
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

  const response = await fetch(toLocalDevProxyUrl(url), {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) return null;

  return normalizeBrokerPresentationConfig(await response.json(), broker.server_url);
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

  const root = document.documentElement;
  if (currentChrome.brokerId) root.setAttribute('data-broker-id', currentChrome.brokerId);
  else root.removeAttribute('data-broker-id');

  if (currentChrome.themeColor) root.style.setProperty('--rtx-broker-accent', currentChrome.themeColor);
  else root.style.removeProperty('--rtx-broker-accent');

  if (input.updateLoginTitle) {
    const title = currentChrome.brokerName
      ? `${DEFAULT_LOGIN_TITLE} - ${currentChrome.brokerName}`
      : DEFAULT_LOGIN_TITLE;
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

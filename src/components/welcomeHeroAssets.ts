import { getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';

export interface LoginHeroAsset {
  src: string;
  mobileSrc?: string;
  width: number;
  height: number;
  theme?: 'accent';
  fit?: 'cover' | 'contain';
  position?: string;
  mobileFit?: 'cover' | 'contain';
  mobilePosition?: string;
}

export interface LoginHeroBroker {
  broker_id?: string;
  broker_name?: string;
  login_hero_url?: string;
  login_hero_mobile_url?: string;
  [key: string]: unknown;
}

export const toPublicAssetPath = (assetPath: string, baseUrl = import.meta.env.BASE_URL): string => {
  const normalizedPath = String(assetPath || '').trim().replace(/^\/+/, '');
  if (!normalizedPath) return '';

  const normalizedBase = String(baseUrl || '/').trim();
  if (!normalizedBase || normalizedBase === '/') return `/${normalizedPath}`;

  return `${normalizedBase.replace(/\/+$/, '')}/${normalizedPath}`;
};

const DEFAULT_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: toPublicAssetPath('login/trading-desk-hero.webp'),
  mobileSrc: toPublicAssetPath('login/trading-desk-hero-mobile.webp'),
  width: 2048,
  height: 1152,
};

/** Public artwork is explicit metadata, never inferred from a broker ID, name or host. */
const publicAsset = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

export const resolveLoginHeroAsset = (broker: LoginHeroBroker | null | undefined = null): LoginHeroAsset => {
  const desktop = isDesktopBackendTarget();
  const config = getRuntimeBrokerConfiguration();
  if (!desktop && (!config.valid || (broker?.broker_id && broker.broker_id !== config.brokerId))) {
    return DEFAULT_LOGIN_HERO_ASSET;
  }
  // A pinned web deployment cannot inherit another broker's presentation from storage/discovery.
  const src = publicAsset(desktop ? broker?.login_hero_url : config.brokerLoginHeroUrl);
  if (!src) return DEFAULT_LOGIN_HERO_ASSET;
  const mobileSrc = publicAsset(desktop ? broker?.login_hero_mobile_url : config.brokerLoginHeroMobileUrl);
  return {
    src, mobileSrc: mobileSrc || src, width: 2048, height: 1152, theme: 'accent',
    fit: 'cover', position: 'center center', mobileFit: 'contain', mobilePosition: 'center center',
  };
};

import { getBackendTarget } from '../config/backendTarget.js';

export interface LoginHeroAsset {
  src: string;
  mobileSrc?: string;
  width: number;
  height: number;
  fit?: 'cover' | 'contain';
  position?: string;
  mobileFit?: 'cover' | 'contain';
  mobilePosition?: string;
}

export interface LoginHeroBroker {
  broker_id?: string;
  broker_name?: string;
  id?: string | number;
  name?: string;
  domain?: string;
  server?: string;
  server_url?: string;
  backend_url?: string;
  market_api_url?: string;
  API_HOST?: string;
  API_HOST_EXT?: string;
  api_host?: string;
  api_host_ext?: string;
  public_backend_url?: string;
  public_ext_api_url?: string;
  web_backend_url?: string;
  web_ext_api_url?: string;
  services_url?: string;
  servicesUrl?: string;
  logo_url?: string;
}

const DEFAULT_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: '/login/trading-desk-hero.webp',
  mobileSrc: '/login/trading-desk-hero-mobile.webp',
  width: 2048,
  height: 1152,
};

const GTA_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: '/login/gta-hero-wide.png',
  mobileSrc: '/login/gta-hero-mobile.jpg',
  width: 1586,
  height: 992,
  fit: 'cover',
  position: 'left center',
  mobileFit: 'contain',
  mobilePosition: 'center center',
};

const MYPROP_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: '/login/myprop-hero-wide.png',
  mobileSrc: '/login/myprop-hero-mobile.jpg',
  width: 1672,
  height: 941,
  fit: 'cover',
  position: 'left center',
  mobileFit: 'contain',
  mobilePosition: 'center center',
};

const LOGIN_HERO_BROKER_URL_FIELDS = [
  'API_HOST',
  'API_HOST_EXT',
  'api_host',
  'api_host_ext',
  'public_backend_url',
  'public_ext_api_url',
  'web_backend_url',
  'web_ext_api_url',
  'services_url',
  'servicesUrl',
  'backend_url',
  'market_api_url',
  'server_url',
] as const satisfies readonly (keyof LoginHeroBroker)[];

const compactBrokerHeroIdentity = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const identityIncludes = (identityParts: readonly string[], matcher: string): boolean => {
  const compactMatcher = compactBrokerHeroIdentity(matcher);
  return identityParts.some(part => compactBrokerHeroIdentity(part).includes(compactMatcher));
};

const identityHasWord = (identityParts: readonly string[], word: string): boolean => {
  const wordPattern = new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`, 'i');
  return identityParts.some(part => wordPattern.test(part));
};

const cleanIdentityParts = (parts: readonly unknown[]): string[] =>
  parts
    .map(value => String(value || '').trim())
    .filter((value): value is string => Boolean(value));

const getRuntimeHeroIdentityParts = (): string[] => {
  if (typeof window === 'undefined') return [];

  return cleanIdentityParts([
    window.location?.hostname,
    getBackendTarget(),
  ]);
};

const getBrokerHeroIdentityParts = (broker: LoginHeroBroker): string[] =>
  cleanIdentityParts([
    broker.broker_id,
    broker.broker_name,
    broker.id,
    broker.name,
    broker.domain,
    broker.server,
    ...LOGIN_HERO_BROKER_URL_FIELDS.map(field => broker[field]),
  ]);

export const resolveLoginHeroAsset = (broker: LoginHeroBroker | null | undefined = null): LoginHeroAsset => {
  const identityParts = broker ? getBrokerHeroIdentityParts(broker) : getRuntimeHeroIdentityParts();

  if (identityIncludes(identityParts, 'myprop')) {
    return MYPROP_LOGIN_HERO_ASSET;
  }

  if (
    identityIncludes(identityParts, 'growtradingacademy')
    || identityIncludes(identityParts, 'gtabroker')
    || identityHasWord(identityParts, 'gta')
  ) {
    return GTA_LOGIN_HERO_ASSET;
  }

  return DEFAULT_LOGIN_HERO_ASSET;
};

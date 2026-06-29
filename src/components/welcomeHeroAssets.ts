import { getBackendTarget } from '../config/backendTarget.js';

export interface LoginHeroAsset {
  src: string;
  mobileSrc?: string;
  width: number;
  height: number;
  theme?: 'achiever';
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
  domains?: string[] | string;
  webterminal_domain?: string;
  web_terminal_domain?: string;
  webterminal_url?: string;
  web_terminal_url?: string;
  frontend_domain?: string;
  frontend_url?: string;
  client_domain?: string;
  client_url?: string;
  login_domain?: string;
  login_url?: string;
  admin_domain?: string;
  admin_url?: string;
  manager_domain?: string;
  manager_url?: string;
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

const GTA_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: toPublicAssetPath('login/gta-hero-desktop-fit.webp'),
  mobileSrc: toPublicAssetPath('login/gta-hero-mobile.jpg'),
  width: 1024,
  height: 928,
  fit: 'cover',
  position: 'center center',
  mobileFit: 'contain',
  mobilePosition: 'center center',
};

const MYPROP_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: toPublicAssetPath('login/myprop-hero-wide.png'),
  mobileSrc: toPublicAssetPath('login/myprop-hero-mobile.jpg'),
  width: 1672,
  height: 941,
  fit: 'contain',
  position: 'center center',
  mobileFit: 'contain',
  mobilePosition: 'center center',
};

const ACHIEVER_LOGIN_HERO_ASSET: LoginHeroAsset = {
  src: toPublicAssetPath('login/achiever-hero-desktop-fit.png'),
  mobileSrc: toPublicAssetPath('login/achiever-hero-mobile.jpg'),
  width: 1024,
  height: 928,
  theme: 'achiever',
  fit: 'cover',
  position: 'center center',
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

const LOGIN_HERO_BROKER_DOMAIN_FIELDS = [
  'domain',
  'domains',
  'webterminal_domain',
  'web_terminal_domain',
  'webterminal_url',
  'web_terminal_url',
  'frontend_domain',
  'frontend_url',
  'client_domain',
  'client_url',
  'login_domain',
  'login_url',
  'admin_domain',
  'admin_url',
  'manager_domain',
  'manager_url',
] as const satisfies readonly (keyof LoginHeroBroker)[];

const compactBrokerHeroIdentity = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ACHIEVER_BROKER_COMPACT_IDENTITIES = new Set([
  'achieverfinancials',
  'achiever',
  'achiver',
]);

const ACHIEVER_BROKER_HOSTS = new Set([
  'admin.achieverfinancials.com',
  'manager.achieverfinancials.com',
  'webterminal.achieverfinancials.com',
  'service.achieverfinancials.com',
]);

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

const expandDelimitedIdentityParts = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value.flatMap(item => expandDelimitedIdentityParts(item));
  }

  if (typeof value === 'string') {
    return value.split(',');
  }

  return [value];
};

const getIdentityHostname = (identity: string): string => {
  const normalizedIdentity = identity.trim().toLowerCase();
  if (!normalizedIdentity) return '';

  const urlCandidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedIdentity)
    ? normalizedIdentity
    : `https://${normalizedIdentity}`;

  try {
    return new URL(urlCandidate).hostname.replace(/^www\./, '');
  } catch {
    return normalizedIdentity.split(/[/?#:]/, 1)[0].replace(/^www\./, '');
  }
};

const identityMatchesBroker = (
  identityParts: readonly string[],
  compactIdentities: ReadonlySet<string>,
  hostnames: ReadonlySet<string>,
): boolean =>
  identityParts.some(part => {
    const compactIdentity = compactBrokerHeroIdentity(part);
    if (compactIdentities.has(compactIdentity)) return true;

    const hostname = getIdentityHostname(part);
    return Boolean(hostname && hostnames.has(hostname));
  });

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
    broker.server,
    ...LOGIN_HERO_BROKER_DOMAIN_FIELDS.flatMap(field => expandDelimitedIdentityParts(broker[field])),
    ...LOGIN_HERO_BROKER_URL_FIELDS.map(field => broker[field]),
  ]);

export const resolveLoginHeroAsset = (broker: LoginHeroBroker | null | undefined = null): LoginHeroAsset => {
  const identityParts = broker ? getBrokerHeroIdentityParts(broker) : getRuntimeHeroIdentityParts();

  if (identityIncludes(identityParts, 'myprop')) {
    return MYPROP_LOGIN_HERO_ASSET;
  }

  if (identityMatchesBroker(
    identityParts,
    ACHIEVER_BROKER_COMPACT_IDENTITIES,
    ACHIEVER_BROKER_HOSTS,
  )) {
    return ACHIEVER_LOGIN_HERO_ASSET;
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

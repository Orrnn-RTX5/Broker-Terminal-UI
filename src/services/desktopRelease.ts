import { translateUi } from '../hooks/useUiTranslation';

// Desktop update channel configuration keys. The release channel is
// configuration only: a broker-provided broker-config field wins when present,
// otherwise the deployment runtime configuration (or build environment).
// There is intentionally no built-in default — a white-label build must never
// contact vendor infrastructure on its own.
const RUNTIME_RELEASE_API_URL_KEYS = ['DESKTOP_RELEASE_API_URL', 'VITE_DESKTOP_RELEASE_API_URL'];

// Broker-provided release channel fields (generic, tenant-agnostic). Unknown
// broker-config fields pass through normalization, so a platform operator can
// publish the channel per broker without code changes.
const BROKER_RELEASE_API_URL_KEYS = [
  'desktop_release_api_url',
  'desktopReleaseApiUrl',
  'release_api_url',
  'releaseApiUrl',
  'DESKTOP_RELEASE_API_URL',
  'VITE_DESKTOP_RELEASE_API_URL',
];

const RELEASE_CHANNEL_KEYS = [...BROKER_RELEASE_API_URL_KEYS, ...RUNTIME_RELEASE_API_URL_KEYS];

export const RELEASE_CHANNEL_UNAVAILABLE_MESSAGE = 'Desktop update check is not configured for this broker.';

type RuntimeConfigSource = Record<string, unknown> & { env?: unknown };

const asChannelUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const readChannelKey = (source: RuntimeConfigSource | null | undefined, key: string): string => {
  if (!source || typeof source !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const direct = asChannelUrl(source[key]);
    if (direct) return direct;
  }
  const env = source.env;
  if (env && typeof env === 'object' && Object.prototype.hasOwnProperty.call(env as Record<string, unknown>, key)) {
    const nested = asChannelUrl((env as Record<string, unknown>)[key]);
    if (nested) return nested;
  }
  return '';
};

// Pure helper: resolve the configured release channel from a plain config
// object (runtime config snapshot and/or broker info). Returns the channel
// URL, or null when no channel is configured. Never falls back to vendor
// infrastructure.
export const resolveReleaseChannel = (config: unknown): string | null => {
  if (!config || typeof config !== 'object') return null;
  const source = config as RuntimeConfigSource;
  for (const key of RELEASE_CHANNEL_KEYS) {
    const value = readChannelKey(source, key);
    if (value) return value;
  }
  return null;
};

type RuntimeWindow = Window & {
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RUNTIME_CONFIG__?: Record<string, unknown>;
};

// Pure helper: resolve the channel from a build-environment object (the
// VITE_* keys above). The production caller passes the build metadata; tests
// pass plain objects.
export const resolveReleaseChannelFromBuildEnv = (env: unknown): string | null => {
  if (!env || typeof env !== 'object') return null;
  const source = env as Record<string, unknown>;
  for (const key of RUNTIME_RELEASE_API_URL_KEYS) {
    const value = asChannelUrl(source[key]);
    if (value) return value;
  }
  return null;
};

const readBuildEnvChannel = (): string => {
  try {
    return resolveReleaseChannelFromBuildEnv(
      (import.meta as unknown as { env?: Record<string, unknown> }).env,
    ) || '';
  } catch {
    // Build metadata is unavailable in this runtime; deployment config still applies.
    return '';
  }
};

// Impure wrapper: the broker-provided channel wins when present, otherwise
// the deployment runtime configuration (then build environment).
// Returns the channel URL, or null when unconfigured (fail-closed).
export const getReleaseApiUrl = (brokerInfo: unknown = null): string | null => {
  const fromBroker = resolveReleaseChannel(brokerInfo);
  if (fromBroker) return fromBroker;

  if (typeof window !== 'undefined') {
    const runtimeWindow = window as RuntimeWindow;
    const snapshots = [
      runtimeWindow.__RTX_RUNTIME_CONFIG__,
      runtimeWindow.RUNTIME_CONFIG,
      runtimeWindow.__RUNTIME_CONFIG__,
    ];
    for (const snapshot of snapshots) {
      const channel = resolveReleaseChannel(snapshot);
      if (channel) return channel;
    }
  }

  return readBuildEnvChannel() || null;
};

export const isReleaseChannelConfigured = (brokerInfo: unknown = null): boolean =>
  Boolean(getReleaseApiUrl(brokerInfo));

export interface DesktopRelease {
  version: string | null;
  tagName: string | null;
  releaseUrl: string;
  downloadUrl: string;
  assetName: string | null;
  assetSize: number | null;
}

interface ReleaseAssetInfo {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface ReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: ReleaseAssetInfo[];
}

// Fail-closed fallback: no version, no URLs. Callers already treat a missing
// channel as "no update information" (the lookup rejects and the hook keeps
// this fallback), so an unconfigured deployment renders the generic download
// label and the download action safely does nothing.
export const FALLBACK_DESKTOP_RELEASE: DesktopRelease = {
  version: null,
  tagName: null,
  releaseUrl: '',
  downloadUrl: '',
  assetName: null,
  assetSize: null,
};

let cachedDesktopReleasePromise: Promise<DesktopRelease> | null = null;

const normalizeReleaseVersion = (payload: ReleasePayload): string | null => {
  const candidate = String(payload.tag_name || payload.name || '').trim();
  if (!candidate) return null;
  return candidate.replace(/^v/i, '');
};

const isWindowsInstallerAsset = (asset: ReleaseAssetInfo): boolean => {
  const name = String(asset.name || '').toLowerCase();
  return name.endsWith('.exe') && !name.endsWith('.blockmap.exe');
};

export const normalizeDesktopRelease = (
  payload: ReleasePayload,
  options: { releaseUrl?: string | null; brokerInfo?: unknown } = {},
): DesktopRelease => {
  const installer = payload.assets?.find(isWindowsInstallerAsset);
  const fallbackUrl = options.releaseUrl ?? getReleaseApiUrl(options.brokerInfo) ?? '';
  const releaseUrl = payload.html_url || fallbackUrl;

  return {
    version: normalizeReleaseVersion(payload),
    tagName: payload.tag_name || null,
    releaseUrl,
    downloadUrl: installer?.browser_download_url || releaseUrl,
    assetName: installer?.name || null,
    assetSize: typeof installer?.size === 'number' ? installer.size : null,
  };
};

export const clearDesktopReleaseCache = (): void => {
  cachedDesktopReleasePromise = null;
};

export const loadLatestDesktopRelease = (options: {
  forceRefresh?: boolean;
  fetcher?: typeof fetch;
  releaseApiUrl?: string;
  brokerInfo?: unknown;
} = {}): Promise<DesktopRelease> => {
  if (!options.forceRefresh && cachedDesktopReleasePromise) {
    return cachedDesktopReleasePromise;
  }

  const channelUrl = asChannelUrl(options.releaseApiUrl) || getReleaseApiUrl(options.brokerInfo);
  if (!channelUrl) {
    // Fail closed without touching the network: no configured channel means
    // no lookup. The rejection is intentionally not cached.
    return Promise.reject(new Error(RELEASE_CHANNEL_UNAVAILABLE_MESSAGE));
  }

  const fetcher = options.fetcher || fetch;
  cachedDesktopReleasePromise = fetcher(channelUrl, {
    headers: {
      Accept: 'application/json',
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Desktop release lookup failed (${response.status})`);
      }
      const payload = await response.json() as ReleasePayload;
      return normalizeDesktopRelease(payload, { releaseUrl: channelUrl, brokerInfo: options.brokerInfo });
    })
    .catch((error) => {
      cachedDesktopReleasePromise = null;
      throw error;
    });

  return cachedDesktopReleasePromise;
};

export const getDesktopReleaseVersionLabel = (release: DesktopRelease | null | undefined): string => {
  return release?.version ? `v${release.version}` : '';
};

export const getDesktopReleaseButtonTitle = (release: DesktopRelease | null | undefined): string => {
  const version = getDesktopReleaseVersionLabel(release);
  return version
    ? translateUi('Download desktop installer {{value0}}', { value0: version })
    : translateUi('Download the latest desktop installer');
};

export const openDesktopReleaseDownload = (release: DesktopRelease | null | undefined): void => {
  const targetRelease = release || FALLBACK_DESKTOP_RELEASE;
  const url = targetRelease.downloadUrl || targetRelease.releaseUrl;

  // Fail closed: with no configured channel there is nowhere neutral to send
  // the user, so do nothing instead of opening a vendor page.
  if (!url || typeof window === 'undefined') return;

  if (window.electron?.shell?.openExternal) {
    void window.electron.shell.openExternal(url);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (targetRelease.assetName) {
    anchor.download = targetRelease.assetName;
  }
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

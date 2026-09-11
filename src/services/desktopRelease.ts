import { translateUi } from '../hooks/useUiTranslation';

export const DESKTOP_RELEASE_REPOSITORY = 'rtx5-orrnn/rtx5-terminal-releases';
export const DESKTOP_RELEASE_API_URL = `https://api.github.com/repos/${DESKTOP_RELEASE_REPOSITORY}/releases/latest`;
export const DESKTOP_RELEASE_LATEST_URL = `https://github.com/${DESKTOP_RELEASE_REPOSITORY}/releases/latest`;

export interface DesktopRelease {
  version: string | null;
  tagName: string | null;
  releaseUrl: string;
  downloadUrl: string;
  assetName: string | null;
  assetSize: number | null;
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

export const FALLBACK_DESKTOP_RELEASE: DesktopRelease = {
  version: null,
  tagName: null,
  releaseUrl: DESKTOP_RELEASE_LATEST_URL,
  downloadUrl: DESKTOP_RELEASE_LATEST_URL,
  assetName: null,
  assetSize: null,
};

let cachedDesktopReleasePromise: Promise<DesktopRelease> | null = null;

const normalizeReleaseVersion = (payload: GitHubReleasePayload): string | null => {
  const candidate = String(payload.tag_name || payload.name || '').trim();
  if (!candidate) return null;
  return candidate.replace(/^v/i, '');
};

const isWindowsInstallerAsset = (asset: GitHubReleaseAsset): boolean => {
  const name = String(asset.name || '').toLowerCase();
  return name.endsWith('.exe') && !name.endsWith('.blockmap.exe');
};

export const normalizeDesktopRelease = (payload: GitHubReleasePayload): DesktopRelease => {
  const installer = payload.assets?.find(isWindowsInstallerAsset);
  const releaseUrl = payload.html_url || DESKTOP_RELEASE_LATEST_URL;

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
} = {}): Promise<DesktopRelease> => {
  if (!options.forceRefresh && cachedDesktopReleasePromise) {
    return cachedDesktopReleasePromise;
  }

  const fetcher = options.fetcher || fetch;
  cachedDesktopReleasePromise = fetcher(DESKTOP_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Desktop release lookup failed (${response.status})`);
      }
      const payload = await response.json() as GitHubReleasePayload;
      return normalizeDesktopRelease(payload);
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
    ? translateUi('Download RTX Terminal desktop installer {{value0}}', { value0: version })
    : translateUi('Download the latest RTX Terminal desktop installer');
};

export const openDesktopReleaseDownload = (release: DesktopRelease | null | undefined): void => {
  const targetRelease = release || FALLBACK_DESKTOP_RELEASE;
  const url = targetRelease.downloadUrl || targetRelease.releaseUrl || DESKTOP_RELEASE_LATEST_URL;

  if (typeof window === 'undefined') return;

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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDesktopReleaseCache,
  FALLBACK_DESKTOP_RELEASE,
  getReleaseApiUrl,
  isReleaseChannelConfigured,
  loadLatestDesktopRelease,
  normalizeDesktopRelease,
  openDesktopReleaseDownload,
  RELEASE_CHANNEL_UNAVAILABLE_MESSAGE,
  resolveReleaseChannel,
  resolveReleaseChannelFromBuildEnv,
} from './desktopRelease';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const CHANNEL_URL = 'https://releases.example.test/api/latest';

const setRuntimeChannel = (url: string | undefined): void => {
  const runtimeWindow = window as RuntimeWindow;
  if (url === undefined) {
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  } else {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { DESKTOP_RELEASE_API_URL: url };
  }
};

describe('desktopRelease', () => {
  afterEach(() => {
    clearDesktopReleaseCache();
    setRuntimeChannel(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('selects the latest Windows installer asset and normalizes the version', () => {
    const release = normalizeDesktopRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://releases.example.test/tag/v1.2.3',
      assets: [
        {
          name: 'latest.yml',
          browser_download_url: 'https://releases.example.test/latest.yml',
          size: 200,
        },
        {
          name: 'Terminal.Setup.1.2.3.exe',
          browser_download_url: 'https://releases.example.test/Terminal.Setup.1.2.3.exe',
          size: 1000,
        },
      ],
    });

    expect(release).toMatchObject({
      version: '1.2.3',
      tagName: 'v1.2.3',
      releaseUrl: 'https://releases.example.test/tag/v1.2.3',
      downloadUrl: 'https://releases.example.test/Terminal.Setup.1.2.3.exe',
      assetName: 'Terminal.Setup.1.2.3.exe',
      assetSize: 1000,
    });
  });

  it('falls back to the release page when no installer asset is available', () => {
    const release = normalizeDesktopRelease({
      tag_name: 'v2.0.0',
      html_url: 'https://releases.example.test/tag/v2.0.0',
      assets: [{ name: 'latest.yml', browser_download_url: 'https://releases.example.test/latest.yml' }],
    });

    expect(release.version).toBe('2.0.0');
    expect(release.downloadUrl).toBe('https://releases.example.test/tag/v2.0.0');
    expect(release.assetName).toBeNull();
  });

  it('loads and caches the latest release response from the configured channel', async () => {
    setRuntimeChannel(CHANNEL_URL);
    const seen: string[] = [];
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({
        tag_name: 'v3.4.5',
        assets: [{
          name: 'Terminal.Setup.3.4.5.exe',
          browser_download_url: 'https://releases.example.test/Terminal.Setup.3.4.5.exe',
        }],
      }), { status: 200 });
    });

    const first = await loadLatestDesktopRelease({ fetcher });
    const second = await loadLatestDesktopRelease({ fetcher });

    expect(first.version).toBe('3.4.5');
    expect(second.downloadUrl).toBe('https://releases.example.test/Terminal.Setup.3.4.5.exe');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([CHANNEL_URL]);
  });

  it('falls back to the configured channel when release URLs are missing', () => {
    setRuntimeChannel(CHANNEL_URL);
    const release = normalizeDesktopRelease({});

    expect(release.releaseUrl).toBe(CHANNEL_URL);
    expect(release.downloadUrl).toBe(CHANNEL_URL);
  });

  it('uses empty URLs when neither the payload nor configuration provides a channel', () => {
    const release = normalizeDesktopRelease({});

    expect(release.releaseUrl).toBe('');
    expect(release.downloadUrl).toBe('');
    expect(FALLBACK_DESKTOP_RELEASE.releaseUrl).toBe('');
    expect(FALLBACK_DESKTOP_RELEASE.downloadUrl).toBe('');
  });

  it('resolveReleaseChannel returns the configured channel', () => {
    expect(resolveReleaseChannel({ DESKTOP_RELEASE_API_URL: CHANNEL_URL })).toBe(CHANNEL_URL);
    expect(resolveReleaseChannel({ VITE_DESKTOP_RELEASE_API_URL: CHANNEL_URL })).toBe(CHANNEL_URL);
    expect(resolveReleaseChannel({ desktop_release_api_url: CHANNEL_URL })).toBe(CHANNEL_URL);
    expect(resolveReleaseChannel({ desktopReleaseApiUrl: CHANNEL_URL })).toBe(CHANNEL_URL);
    expect(resolveReleaseChannel({ release_api_url: CHANNEL_URL })).toBe(CHANNEL_URL);
    expect(resolveReleaseChannel({ releaseApiUrl: CHANNEL_URL })).toBe(CHANNEL_URL);
    expect(resolveReleaseChannel({ env: { DESKTOP_RELEASE_API_URL: CHANNEL_URL } })).toBe(CHANNEL_URL);
  });

  it('resolveReleaseChannel returns null when no channel is configured', () => {
    expect(resolveReleaseChannel({})).toBeNull();
    expect(resolveReleaseChannel(null)).toBeNull();
    expect(resolveReleaseChannel(undefined)).toBeNull();
    expect(resolveReleaseChannel(CHANNEL_URL)).toBeNull();
    expect(resolveReleaseChannel({ DESKTOP_RELEASE_API_URL: '' })).toBeNull();
    expect(resolveReleaseChannel({ DESKTOP_RELEASE_API_URL: '   ' })).toBeNull();
    expect(resolveReleaseChannel({ unrelated_key: CHANNEL_URL })).toBeNull();
  });

  it('getReleaseApiUrl prefers the broker-provided channel over runtime config', () => {
    setRuntimeChannel('https://releases.example.test/runtime/latest');
    expect(getReleaseApiUrl()).toBe('https://releases.example.test/runtime/latest');
    expect(isReleaseChannelConfigured()).toBe(true);
    expect(
      getReleaseApiUrl({ desktop_release_api_url: 'https://releases.example.test/broker/latest' }),
    ).toBe('https://releases.example.test/broker/latest');
  });

  it('getReleaseApiUrl returns null when absent and emits no vendor URL', () => {
    const channel = getReleaseApiUrl();
    expect(channel).toBeNull();
    expect(isReleaseChannelConfigured()).toBe(false);
    expect(String(channel || '')).not.toContain('://');
  });

  it('getReleaseApiUrl reads the build environment when no runtime config exists', () => {
    expect(
      resolveReleaseChannelFromBuildEnv({ VITE_DESKTOP_RELEASE_API_URL: 'https://releases.example.test/build/latest' }),
    ).toBe('https://releases.example.test/build/latest');
    expect(resolveReleaseChannelFromBuildEnv({})).toBeNull();
    expect(resolveReleaseChannelFromBuildEnv(null)).toBeNull();
    // The test runner carries no packaged channel, so the live build
    // environment must not resolve one either (no built-in default).
    expect(getReleaseApiUrl()).toBeNull();
  });

  it('loadLatestDesktopRelease rejects without fetching when no channel is configured', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(loadLatestDesktopRelease({ fetcher })).rejects.toThrow(RELEASE_CHANNEL_UNAVAILABLE_MESSAGE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loadLatestDesktopRelease honors an explicit channel override', async () => {
    const seen: string[] = [];
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({
        tag_name: 'v2.0.1',
        html_url: 'https://releases.example.test/tag/v2.0.1',
        assets: [],
      }), { status: 200 });
    });

    const release = await loadLatestDesktopRelease({
      fetcher,
      releaseApiUrl: 'https://releases.example.test/explicit/latest',
    });

    expect(seen).toEqual(['https://releases.example.test/explicit/latest']);
    expect(release.version).toBe('2.0.1');
  });

  it('openDesktopReleaseDownload does nothing when no channel URL is available', () => {
    const createElement = vi.spyOn(document, 'createElement');
    const openExternal = vi.fn();

    expect(() => openDesktopReleaseDownload(null)).not.toThrow();
    expect(() => openDesktopReleaseDownload(FALLBACK_DESKTOP_RELEASE)).not.toThrow();
    expect(() => openDesktopReleaseDownload({ ...FALLBACK_DESKTOP_RELEASE })).not.toThrow();
    expect(createElement).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('openDesktopReleaseDownload opens the configured download URL when present', () => {
    const anchorClick = vi.fn();
    const anchor = document.createElement('a');
    anchor.click = anchorClick;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    vi.spyOn(anchor, 'remove').mockImplementation(() => anchor);

    openDesktopReleaseDownload({
      ...FALLBACK_DESKTOP_RELEASE,
      version: '4.0.0',
      downloadUrl: 'https://releases.example.test/Terminal.Setup.4.0.0.exe',
      assetName: 'Terminal.Setup.4.0.0.exe',
    });

    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('release channel sources hardcode no vendor identity or external URLs', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/desktopRelease.ts'), 'utf8');
    expect(source).not.toMatch(/https?:\/\//);
    expect(source.toLowerCase()).not.toContain('orrnn');
    expect(source.toLowerCase()).not.toContain('github');
    expect(source).not.toMatch(/rtx5-terminal-releases/i);
  });
});

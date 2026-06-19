import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDesktopReleaseCache,
  DESKTOP_RELEASE_LATEST_URL,
  loadLatestDesktopRelease,
  normalizeDesktopRelease,
} from './desktopRelease';

describe('desktopRelease', () => {
  afterEach(() => {
    clearDesktopReleaseCache();
  });

  it('selects the latest Windows installer asset and normalizes the version', () => {
    const release = normalizeDesktopRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/example/releases/tag/v1.2.3',
      assets: [
        {
          name: 'latest.yml',
          browser_download_url: 'https://example.com/latest.yml',
          size: 200,
        },
        {
          name: 'RTX.Terminal.Setup.1.2.3.exe',
          browser_download_url: 'https://example.com/RTX.Terminal.Setup.1.2.3.exe',
          size: 1000,
        },
      ],
    });

    expect(release).toMatchObject({
      version: '1.2.3',
      tagName: 'v1.2.3',
      releaseUrl: 'https://github.com/example/releases/tag/v1.2.3',
      downloadUrl: 'https://example.com/RTX.Terminal.Setup.1.2.3.exe',
      assetName: 'RTX.Terminal.Setup.1.2.3.exe',
      assetSize: 1000,
    });
  });

  it('falls back to the release page when no installer asset is available', () => {
    const release = normalizeDesktopRelease({
      tag_name: 'v2.0.0',
      html_url: 'https://github.com/example/releases/tag/v2.0.0',
      assets: [{ name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' }],
    });

    expect(release.version).toBe('2.0.0');
    expect(release.downloadUrl).toBe('https://github.com/example/releases/tag/v2.0.0');
    expect(release.assetName).toBeNull();
  });

  it('loads and caches the latest release response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v3.4.5',
      assets: [{
        name: 'RTX.Terminal.Setup.3.4.5.exe',
        browser_download_url: 'https://example.com/RTX.Terminal.Setup.3.4.5.exe',
      }],
    }), { status: 200 }));

    const first = await loadLatestDesktopRelease({ fetcher });
    const second = await loadLatestDesktopRelease({ fetcher });

    expect(first.version).toBe('3.4.5');
    expect(second.downloadUrl).toBe('https://example.com/RTX.Terminal.Setup.3.4.5.exe');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the stable latest-release page when release URLs are missing', () => {
    const release = normalizeDesktopRelease({});

    expect(release.releaseUrl).toBe(DESKTOP_RELEASE_LATEST_URL);
    expect(release.downloadUrl).toBe(DESKTOP_RELEASE_LATEST_URL);
  });
});

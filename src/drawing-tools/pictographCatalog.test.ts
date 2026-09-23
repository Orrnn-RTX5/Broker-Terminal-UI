import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PICTOGRAPH_CATEGORIES,
  getPictographItems,
  getPictographStamp,
  getResolvedPictographDataUrl,
  isPictographStamp,
  resolvePictographDataUrl,
  type PictographTab,
} from './pictographCatalog';

const decodeDataUrlSvg = (url: string): string => {
  expect(url).toMatch(/^data:image\/svg\+xml[;,]/);
  const comma = url.indexOf(',');
  return url.slice(0, comma).includes(';base64')
    ? Buffer.from(url.slice(comma + 1), 'base64').toString('utf8')
    : decodeURIComponent(url.slice(comma + 1));
};

// Icons stay inline data URIs; emoji artwork is a bundled same-origin asset
// whose URL must map back to the pinned Twemoji file for its own identifier.
const readSvg = (url: string): string => {
  if (url.startsWith('data:')) return decodeDataUrlSvg(url);
  const filename = /(?:^|\/)([0-9a-f-]+\.svg)(?:[?#]|$)/.exec(url)?.[1];
  expect(filename, `bundled asset URL expected, got: ${url}`).toBeDefined();
  return readFileSync(resolve(process.cwd(), 'src/assets/pictographs/twemoji', filename!), 'utf8');
};

describe('bundled pictograph catalog', () => {
  it('provides a substantial emoji selection in all eight familiar categories', () => {
    expect(PICTOGRAPH_CATEGORIES.map(({ id }) => id)).toEqual([
      'smileys', 'nature', 'food', 'activities', 'travel', 'objects', 'symbols', 'flags',
    ]);
    const counts = PICTOGRAPH_CATEGORIES.map(({ id }) => getPictographItems('emojis', id).length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(250);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(350);
    expect(counts.every((count) => count >= 24)).toBe(true);
  });

  it('uses self-contained vector images for every choice and every tab', () => {
    const identifiers = new Set<string>();
    for (const tab of ['emojis', 'stickers', 'icons'] as const) {
      for (const { id: category } of PICTOGRAPH_CATEGORIES) {
        const stamps = getPictographItems(tab, category);
        expect(stamps.length).toBeGreaterThan(0);
        for (const stamp of stamps) {
          expect(identifiers.has(stamp.id)).toBe(false);
          identifiers.add(stamp.id);
          expect(stamp.glyph.trim()).not.toBe('');
          expect(stamp.label.trim()).not.toBe('');
          expect(getPictographStamp(stamp.id)).toBe(stamp);
          const svg = readSvg(stamp.assetUrl);
          expect(svg).toContain('<svg');
          expect(svg).toMatch(/viewBox=/);
          expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i);
        }
      }
    }
  });

  it.each([
    ['emojis', 'emoji:1f600', 32],
    ['stickers', 'sticker:1f602', 48],
    ['icons', 'icon:arrow-up', 28],
  ] as const)('retains stable %s identities and placement dimensions', (tab: PictographTab, id, size) => {
    const stamp = getPictographStamp(id);
    expect(stamp?.size).toBe(size);
    expect(isPictographStamp(id)).toBe(true);
    expect(PICTOGRAPH_CATEGORIES.flatMap(({ id: category }) => getPictographItems(tab, category))).toContain(stamp);
  });

  it('offers larger curated stickers without duplicating the whole emoji catalog', () => {
    const emoji = getPictographStamp('emoji:1f602');
    const sticker = getPictographStamp('sticker:1f602');
    expect(sticker?.assetUrl).toBe(emoji?.assetUrl);
    expect(sticker?.size).toBeGreaterThan(emoji!.size);
    expect(getPictographStamp('sticker:1f600')).toBeUndefined();
    expect(getPictographItems('stickers', 'smileys').length).toBeLessThan(getPictographItems('emojis', 'smileys').length);
  });

  it.each([
    undefined, '', 'stamp-smile', 'emoji:missing', 'sticker:missing', 'icon:missing',
    'emoji:../../assets/private', 'emoji:https://example.com/tracker.svg',
    'icon:<svg onload="alert(1)">', 'emoji:__proto__',
  ])('rejects unknown or untrusted persisted subtype %s', (subtype) => {
    expect(getPictographStamp(subtype)).toBeUndefined();
    expect(isPictographStamp(subtype)).toBe(false);
  });

  it('returns no choices for invalid categories, including prototype property names', () => {
    expect(getPictographItems('emojis', 'unknown')).toEqual([]);
    expect(getPictographItems('icons', '__proto__')).toEqual([]);
    expect(getPictographItems('stickers', 'constructor')).toEqual([]);
  });

  describe('export inlining', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('inlines bundled emoji artwork as a data URI and then serves it synchronously', async () => {
      const stamp = getPictographStamp('emoji:1f600')!;
      const svgSource = readSvg(stamp.assetUrl);
      const fetchMock = vi.fn(async () => new Response(svgSource, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const dataUrl = await resolvePictographDataUrl(stamp);
      expect(decodeDataUrlSvg(dataUrl)).toBe(svgSource);
      expect(getResolvedPictographDataUrl(stamp)).toBe(dataUrl);
      // Later resolutions reuse the cache instead of refetching.
      await expect(resolvePictographDataUrl(stamp)).resolves.toBe(dataUrl);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns inline icon artwork without any fetch', async () => {
      const stamp = getPictographStamp('icon:arrow-up')!;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(resolvePictographDataUrl(stamp)).resolves.toBe(stamp.assetUrl);
      expect(getResolvedPictographDataUrl(stamp)).toBe(stamp.assetUrl);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not cache a failed resolution', async () => {
      const stamp = getPictographStamp('emoji:1f602')!;
      const svgSource = readSvg(stamp.assetUrl);
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(new Response(svgSource, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(resolvePictographDataUrl(stamp)).rejects.toThrow('offline');
      expect(getResolvedPictographDataUrl(stamp)).toBeUndefined();
      await expect(resolvePictographDataUrl(stamp).then(decodeDataUrlSvg)).resolves.toBe(svgSource);
    });
  });

  it('includes attribution, the pinned source revision, and the graphics license', () => {
    const directory = resolve(process.cwd(), 'src/assets/pictographs/twemoji');
    const attribution = readFileSync(resolve(directory, 'ATTRIBUTION.md'), 'utf8');
    const license = readFileSync(resolve(directory, 'LICENSE-GRAPHICS'), 'utf8');
    expect(attribution).toContain('Twitter, Inc. and other');
    expect(attribution).toContain('b6b55fef1e8636b540a6d016a4729ca8cdf2e60b');
    expect(attribution).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(license).toContain('Creative Commons');
    expect(license).toContain('Attribution 4.0 International');
  });
});

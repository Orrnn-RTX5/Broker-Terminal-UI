import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildTradeShareUrl,
  copyTextToClipboard,
  decodeTradeShare,
  encodeTradeShare,
  getSharedChartTrade,
  parseTradeShareFromHref,
  resetSharedChartTradeCache,
  TRADE_SHARE_HASH_PARAM,
  type SharedChartTrade,
} from './tradeShareLink';

const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');

const sampleTrade: SharedChartTrade = {
  version: 1,
  ticket: 21261,
  symbol: 'XAUUSD',
  timeframe: 'M1',
  side: 'SELL',
  volume: 0.01,
  entryPrice: 4582.83,
  entryTime: 1787579666,
  sl: 0,
  tp: 4570.5,
};

afterEach(() => {
  resetSharedChartTradeCache();
  vi.restoreAllMocks();
  if (originalExecCommandDescriptor) {
    Object.defineProperty(document, 'execCommand', originalExecCommandDescriptor);
  } else {
    Reflect.deleteProperty(document, 'execCommand');
  }
});

describe('trade share encoding', () => {
  it('round-trips a trade through the URL-safe encoding', () => {
    const encoded = encodeTradeShare(sampleTrade);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeTradeShare(encoded)).toEqual(sampleTrade);
  });

  it('preserves exact broker punctuation when decoding a shared trade', () => {
    const punctuated = { ...sampleTrade, symbol: '  xauusd.raw  ' };
    expect(decodeTradeShare(encodeTradeShare(punctuated))).toMatchObject({
      symbol: 'XAUUSD.RAW',
    });
    expect(decodeTradeShare(encodeTradeShare({ ...sampleTrade, symbol: 'BTCUSD-PRO' }))).toMatchObject({
      symbol: 'BTCUSD-PRO',
    });
  });

  it('rejects malformed or invalid payloads', () => {
    expect(decodeTradeShare('not-base64!!!')).toBeNull();
    expect(decodeTradeShare('')).toBeNull();
    // Valid base64url of invalid JSON.
    expect(decodeTradeShare('aGVsbG8')).toBeNull();
    // Missing side / non-positive volume.
    const invalidSide = encodeTradeShare({ ...sampleTrade, side: 'HOLD' as never });
    expect(decodeTradeShare(invalidSide)).toBeNull();
    const invalidVolume = encodeTradeShare({ ...sampleTrade, volume: 0 });
    expect(decodeTradeShare(invalidVolume)).toBeNull();
  });

  it('builds a hash URL on the given base and parses it back', () => {
    const url = buildTradeShareUrl(sampleTrade, 'https://terminal.example.com/app?x=1#old-hash');
    expect(url.startsWith(`https://terminal.example.com/app?x=1#${TRADE_SHARE_HASH_PARAM}=`)).toBe(true);
    expect(parseTradeShareFromHref(url)).toEqual(sampleTrade);
  });

  it('returns null for URLs without a share fragment', () => {
    expect(parseTradeShareFromHref('https://terminal.example.com/app')).toBeNull();
    expect(parseTradeShareFromHref('https://terminal.example.com/app#other=1')).toBeNull();
  });

  it('reads the shared trade from the window location once and caches it', () => {
    const url = buildTradeShareUrl(sampleTrade, 'https://terminal.example.com/app');
    window.history.replaceState(null, '', `#${url.split('#')[1]}`);
    resetSharedChartTradeCache();
    expect(getSharedChartTrade()).toEqual(sampleTrade);

    // Cache survives later hash changes within the session.
    window.history.replaceState(null, '', '#');
    expect(getSharedChartTrade()).toEqual(sampleTrade);
    window.history.replaceState(null, '', window.location.pathname);
  });
});

describe('copyTextToClipboard', () => {
  it('prefers the async clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    (document as Document & { execCommand?: (command: string) => boolean }).execCommand = execCommand;
    await expect(copyTextToClipboard('fallback')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea[readonly]')).toBeNull();
  });

  it('cleans up the fallback textarea when execCommand throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    const execCommand = vi.fn().mockImplementation(() => {
      throw new Error('blocked');
    });
    (document as Document & { execCommand?: (command: string) => boolean }).execCommand = execCommand;

    await expect(copyTextToClipboard('fallback')).resolves.toBe(false);
    expect(document.querySelector('textarea[readonly]')).toBeNull();
  });
});

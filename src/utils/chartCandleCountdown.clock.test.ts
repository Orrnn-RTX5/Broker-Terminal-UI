import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrateTerminalQuoteClock, getTerminalQuoteSession, resetTerminalQuoteFreshness } from '../services/terminalQuoteFreshness';
import { getChartCandleCountdownNowMs, getChartCandleCountdownText } from './chartCandleCountdown';
import { getSynchronizedMarketNowMs, synchronizeMarketClock } from './synchronizedMarketClock';

describe('countdown broker clock selection', () => {
  const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
  const epoch = Date.UTC(2026, 9, 5, 10, 0, 30);
  let mono: number;
  let wall: number;
  beforeEach(() => {
    mono = 1000;
    wall = epoch;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    runtime.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    resetTerminalQuoteFreshness();
  });
  afterEach(() => {
    resetTerminalQuoteFreshness();
    vi.restoreAllMocks();
    delete runtime.__RTX_RUNTIME_CONFIG__;
  });

  it('does not display a ten-second-old cached server/quote stamp as current broker time', () => {
    const sourceAnchor = synchronizeMarketClock(null, epoch - 10_000, mono);
    const sourceNow = () => getSynchronizedMarketNowMs(sourceAnchor, wall, mono);
    expect(calibrateTerminalQuoteClock(epoch, mono, wall, mono, wall)).toBe(true);
    expect(getChartCandleCountdownText(sourceNow(), 'M1')).toBe('00:40');
    expect(getChartCandleCountdownText(getChartCandleCountdownNowMs(sourceNow), 'M1')).toBe('00:30');
    mono += 1000; wall += 1000;
    expect(getChartCandleCountdownText(getChartCandleCountdownNowMs(sourceNow), 'M1')).toBe('00:29');
  });

  it('hides unverified, expired, reset, and wall-clock-discontinuous countdowns', () => {
    const fallback = () => epoch - 10_000;
    const text = () => getChartCandleCountdownText(getChartCandleCountdownNowMs(fallback), 'M1');
    expect(text()).toBe('');
    calibrateTerminalQuoteClock(epoch, mono, wall, mono, wall);
    expect(text()).toBe('00:30');
    wall += 1000;
    expect(text()).toBe('');
    mono += 1000;
    expect(text()).toBe('00:29');
    mono += 60_000; wall += 60_000;
    expect(text()).toBe('');
    const oldSession = getTerminalQuoteSession();
    resetTerminalQuoteFreshness();
    expect(calibrateTerminalQuoteClock(wall, mono, wall, mono, wall, oldSession)).toBe(false);
    expect(text()).toBe('');
    expect(calibrateTerminalQuoteClock(wall, mono, wall, mono, wall)).toBe(true);
    expect(text()).toBe('00:29');
  });

  it('preserves legacy source-clock display when quote clock infrastructure is disabled', () => {
    runtime.__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: false };
    expect(getChartCandleCountdownNowMs(() => epoch - 10_000)).toBe(epoch - 10_000);
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { defaultChartProperties, getEffectiveChartColors, normalizeChartProperties } from '../../store/useChartSettingsStore';
import {
  getFixedChartPriceRange,
  resolveChartIndicatorType,
} from './model/indicatorRequest';
import {
  applyBrokerTimeOffset,
  computeAdaptiveVisibleBars,
  isAbortError,
  mergeCandleCollections,
  shouldBuildVolumeData,
  shouldScrollToRealtime,
} from './runtime/chartRuntime';
import { buildChartTheme, isLightChartBackground } from './presentation/chartTheme';
import {
  getTradeOverlayCardPalette,
  getTradePlotClipLayer,
  placeTradeMarkerTooltip,
  tradeMarkerTooltipLayouts,
} from './presentation/tradeOverlayPresentation';

describe('trading chart extracted modules', () => {
  it.each([
    { position: 0, rightOffset: 0, follows: true },
    { position: -1, rightOffset: 0, follows: true },
    { position: 8, rightOffset: 8, follows: true },
    { position: 7, rightOffset: 8, follows: true },
    { position: 9, rightOffset: 8, follows: true },
    { position: -20, rightOffset: 0, follows: false },
    { position: -20, rightOffset: 8, follows: false },
    { position: 30, rightOffset: 8, follows: false },
    { position: NaN, rightOffset: 0, follows: false },
  ])('follows live bars at $position with a configured offset of $rightOffset: $follows', ({ position, rightOffset, follows }) => {
    const chart = { timeScale: () => ({ scrollPosition: () => position }) };
    expect(shouldScrollToRealtime(chart as never, true, true, rightOffset)).toBe(follows);
    expect(shouldScrollToRealtime(chart as never, false, true, rightOffset)).toBe(false);
    expect(shouldScrollToRealtime(chart as never, true, false, rightOffset)).toBe(false);
  });

  it.each([false, true])('renders hollow green bulls and white bears on black with a light interface of %s', (light) => {
    const properties = normalizeChartProperties({ colorScheme: 'Green and White', gridType: 'mt5' });
    const colors = getEffectiveChartColors(properties, { isAdvancedUntitledLight: light });
    const theme = buildChartTheme(colors, true, false, 'dashed', 'mt5', properties.colorScheme);
    expect(theme).toMatchObject({
      background: '#000000',
      candleUp: '#000000', candleDown: '#ffffff',
      barUp: '#00ff00', barDown: '#00ff00', wickUp: '#00ff00', wickDown: '#00ff00',
      areaUpLine: '#00ff00', areaDownLine: '#ffffff',
      gridVertical: '#778899', gridHorizontal: '#778899',
      volumeUp: '#32cd32', volumeDown: '#32cd32',
    });
    expect(buildChartTheme(colors, false, light, 'dashed', 'mt5', properties.colorScheme).gridHorizontal).toBe('rgba(0, 0, 0, 0)');
  });
  it('resolves indicator requests and fixed ranges without component state', () => {
    expect(resolveChartIndicatorType({ name: 'Exponential Moving Average' })).toBe('ema');
    expect(resolveChartIndicatorType({ id: 'rsi-14', name: 'Custom' })).toBe('rsi');
    expect(resolveChartIndicatorType({ name: 'Unsupported' })).toBeNull();

    expect(getFixedChartPriceRange({
      scaleFix: true,
      fixedMinimum: 10,
      fixedMaximum: 20,
    })).toEqual({ from: 10, to: 20 });
    expect(getFixedChartPriceRange({
      scaleFix: true,
      fixedMinimum: 20,
      fixedMaximum: 10,
    })).toBeNull();
  });

  it('keeps sizing, volume, and realtime decisions in the runtime policy', () => {
    const chart = {
      priceScale: () => ({ width: () => 100 }),
      timeScale: () => ({ scrollPosition: () => 1.5 }),
    };
    const container = { offsetWidth: 1_000 };

    expect(computeAdaptiveVisibleBars(
      container as HTMLElement,
      chart as never,
      500,
      20,
    )).toBe(36);
    expect(computeAdaptiveVisibleBars(container as HTMLElement, chart as never, 0, 20)).toBe(0);
    expect(shouldBuildVolumeData({ showTickVolumes: false, showRealVolumes: true })).toBe(true);
    expect(shouldScrollToRealtime(chart as never, true, true)).toBe(true);
    expect(shouldScrollToRealtime(chart as never, false, true)).toBe(false);
  });

  it('keeps candle collection and offset transforms deterministic', () => {
    const first = { time: 10, open: 1, high: 2, low: 1, close: 2, volume: 3 };
    const replacement = { ...first, close: 3 };
    const later = { ...first, time: 20, close: 4 };

    expect(mergeCandleCollections([first], [replacement, later])).toEqual([replacement, later]);
    expect(applyBrokerTimeOffset([first], 60)).toEqual([{ ...first, time: -50 }]);
    expect(isAbortError(Object.assign(new Error('cancelled'), { name: 'AbortError' }))).toBe(true);
  });

  it('builds light and dark chart presentation from configured colors', () => {
    expect(isLightChartBackground('#fff')).toBe(true);
    expect(isLightChartBackground('rgb(10, 20, 30)')).toBe(false);

    const theme = buildChartTheme({
      ...defaultChartProperties.colors,
      background: '#ffffff',
      foreground: '#111827',
      grid: '#d0d5dd',
    }, true, true);

    expect(theme.background).toBe('#ffffff');
    expect(theme.axisText).toBe('#111827');
    expect(theme.scaleBorder).toBe('transparent');
    expect(theme.candleUp).toBe(defaultChartProperties.colors.bullCandle);
  });

  it.each([
    { mode: 'dark', light: false, background: '#000000', up: '#4597ff', down: '#ff5858' },
    { mode: 'light', light: true, background: '#f7f8fa', up: '#1d4ed8', down: '#b91c1c' },
  ])('keeps default candle bodies, borders, wicks and area lines aligned with quote hues in $mode mode', ({ light, background, up, down }) => {
    const colors = getEffectiveChartColors(defaultChartProperties, { isAdvancedUntitledLight: light });
    const theme = buildChartTheme(colors, true, light);

    expect(theme).toMatchObject({
      background,
      candleUp: up, candleDown: down,
      barUp: up, barDown: down,
      wickUp: up, wickDown: down,
      areaUpLine: up, areaDownLine: down,
    });
  });

  it('owns trade overlay clipping, tooltip placement, and palette selection', () => {
    const host = document.createElement('div');
    const firstLayer = getTradePlotClipLayer(host);
    expect(getTradePlotClipLayer(host)).toBe(firstLayer);
    expect(firstLayer.className).toBe('rtx-trade-plot-clip');

    const target = document.createElement('button');
    const tooltip = document.createElement('div');
    vi.spyOn(target, 'offsetWidth', 'get').mockReturnValue(14);
    vi.spyOn(target, 'offsetHeight', 'get').mockReturnValue(32);
    vi.spyOn(tooltip, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(tooltip, 'offsetHeight', 'get').mockReturnValue(58);
    tradeMarkerTooltipLayouts.set(target, {
      x: 190,
      markerY: 50,
      markerSide: 'SELL',
      plotWidth: 200,
      plotHeight: 160,
    });

    placeTradeMarkerTooltip(target, tooltip);
    expect(tooltip.style.left).toBe('-69px');
    expect(tooltip.style.top).toBe('calc(100% + 7px)');
    expect(getTradeOverlayCardPalette('BUY', true)).toMatchObject({
      background: '#eff6ff',
      border: '#2563eb',
    });
  });
});

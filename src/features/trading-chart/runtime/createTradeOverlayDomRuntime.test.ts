import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTradeOverlayDomRuntime } from './createTradeOverlayDomRuntime';
import type { ActiveTradeSnapshot, TradeLevelOverride } from './tradeRuntimeContracts';
import { tradeMarkerTooltipLayouts } from '../presentation/tradeOverlayPresentation';

const modifyPosition = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api', () => ({ default: { positions: { modifyPosition } } }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ accountId: '200003', account: { currency: 'USD' }, positions: [] }) },
}));
vi.mock('../../../utils/tradeHistoryLevelCache', () => ({ rememberTradeHistoryPositionLevels: vi.fn() }));

type RuntimeOptions = Parameters<typeof createTradeOverlayDomRuntime>[0];

const trade: ActiveTradeSnapshot = {
  key: 'trade:9302300', symbol: 'BTCUSD', side: 'SELL', volume: 0.01,
  entryPrice: 85939.87, entryTime: 1, entryExecutionTime: 1,
  currentPrice: 85832.16, currentTime: 2,
};

function createRuntime(overrides: Partial<RuntimeOptions> = {}) {
  const host = document.createElement('div');
  host.style.position = 'relative';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;z-index:10;pointer-events:none';
  host.appendChild(overlay);
  document.body.appendChild(host);

  const options: RuntimeOptions = {
    activeOverlayNodeDataRef: { current: [] }, activeOverlayNodesRef: { current: [] },
    activeTradeSnapshotsRef: { current: new Map([[trade.key, trade]]) },
    brokerAccountSessionScope: 'Orrnn:200003',
    chartThemeRef: { current: { background: '#000000' } } as RuntimeOptions['chartThemeRef'],
    digits: 2, historyOverlayNodeDataRef: { current: [] }, historyOverlayNodesRef: { current: [] },
    isChartSurfaceLight: () => false, overlayRef: { current: overlay },
    pendingTradeLevelModifyRequestsRef: { current: new Map() }, persistTradeLevelOverrides: vi.fn(),
    prevTimeframeRef: { current: 'M1' }, seriesRef: { current: null }, timeframe: 'M1',
    tr: source => source, tradeControlLiveUpdatersRef: { current: [] },
    tradeLevelLastKnownLevelsRef: { current: new Map() }, tradeLevelModifyRequestSeqRef: { current: 0 },
    tradeLevelOptimisticGraceUntilRef: { current: new Map() }, tradeLevelOverridesRef: { current: new Map() },
    deleteTradeLevelState: (state, owner) => { state.delete(owner.key); },
    formatTradeLevelBadgePrice: price => price.toFixed(2),
    getTradeLevelStateKeys: owner => [owner.key], getTradeTicketLabel: key => key.replace('trade:', ''),
    resolveSymbolTick: () => null,
    setTradeLevelState: (state, owner, levels) => { state.set(owner.key, levels); },
    ...overrides,
  };
  return { host, overlay, options, runtime: createTradeOverlayDomRuntime(options) };
}

describe('SL/TP chart remove controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    modifyPosition.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(['SL', 'TP'] as const)('keeps the %s cross above the line drag target and clears only that level', async role => {
    const { host, overlay, options, runtime } = createRuntime();
    const levels: TradeLevelOverride = { sl: 87000, tp: 85118.19 };
    const price = role === 'SL' ? levels.sl : levels.tp;
    runtime.createPriceLevel(role, price, '#999999', { tradeKey: trade.key, role, labelVariant: 'none' });
    runtime.createLevelControlsForTrade(trade, role, levels);

    const hitArea = host.querySelector<HTMLElement>('.rtx-trade-level-hit-area')!;
    const bar = host.querySelector<HTMLElement>('.rtx-trade-controls--level')!;
    const button = bar.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--remove')!;
    // Compare sibling stacking levels, since a child's z-index cannot escape
    // the lower drawing-overlay stacking context that caused the blocked click.
    expect(bar.parentElement).toBe(hitArea.parentElement);
    expect(bar.parentElement).toBe(host);
    expect(overlay.contains(bar)).toBe(false);
    expect(Number(bar.style.zIndex)).toBeGreaterThan(Number(hitArea.style.zIndex));

    button.click();
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(9302300, role === 'SL' ? { price_sl: 0 } : { price_tp: 0 });
    expect(options.tradeLevelOverridesRef.current.get(trade.key)).toEqual(
      role === 'SL' ? { sl: 0, tp: levels.tp } : { sl: levels.sl, tp: 0 },
    );
    await Promise.resolve();
  });
});

describe('lazy historical marker details', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it.each([500, 1000])('retains all %i markers and focus targets without allocating hidden detail trees', count => {
    const { host, runtime } = createRuntime();
    for (let i = 0; i < count; i++) runtime.createTradeMarker('BUY', 100, 60 + i, '100.00', 'history');
    expect(host.querySelectorAll('.rtx-trade-marker')).toHaveLength(count);
    expect(host.querySelectorAll('.rtx-trade-marker-hover-target[tabindex="0"][role="img"]')).toHaveLength(count);
    expect(host.querySelectorAll('.rtx-trade-marker__price-tooltip')).toHaveLength(0);
    const baseline = host.querySelectorAll('*').length;
    expect(baseline).toBeLessThanOrEqual(count * 4 + 4);
    const target = host.querySelector<HTMLElement>('.rtx-trade-marker-hover-target')!;
    target.dispatchEvent(new Event('pointerenter'));
    expect(host.querySelectorAll('.rtx-trade-marker__price-tooltip')).toHaveLength(1);
    expect(host.querySelectorAll('*').length - baseline).toBe(7);
    target.dispatchEvent(new Event('pointerleave'));
    expect(host.querySelectorAll('*')).toHaveLength(baseline);
  });

  it('keeps details while pointer or keyboard focus owns the target and releases them on departure', () => {
    const { host, runtime } = createRuntime();
    runtime.createTradeMarker('SELL', 123.456, 60, '123.456', 'history', 1, undefined, 'close', 'BUY', 123);
    const target = host.querySelector<HTMLElement>('.rtx-trade-marker-hover-target')!;
    target.focus();
    const tooltip = target.querySelector<HTMLElement>('.rtx-trade-marker__price-tooltip')!;
    expect(tooltip.textContent).toContain('BUY Close');
    expect(tooltip.textContent).toContain('123.456');
    expect(tooltip.textContent).toContain('00:02:03 GMT');
    target.dispatchEvent(new Event('pointerenter')); target.blur();
    expect(target.querySelector('.rtx-trade-marker__price-tooltip')).toBe(tooltip);
    target.focus(); target.dispatchEvent(new Event('pointerleave'));
    expect(target.querySelector('.rtx-trade-marker__price-tooltip')).toBe(tooltip);
    target.blur(); expect(target.querySelector('.rtx-trade-marker__price-tooltip')).toBeNull();
    expect(target.tabIndex).toBe(0); expect(target.getAttribute('aria-label')).toContain('123.46');
  });

  it('creates details with current language/theme and uses geometry published before first hover', () => {
    let light = false, language = 'first';
    const cssText = vi.spyOn(CSSStyleDeclaration.prototype, 'cssText', 'set');
    const { host, runtime } = createRuntime({ isChartSurfaceLight: () => light,
      tr: <T,>(source: T): T => `${language}:${source}` as T });
    runtime.createTradeMarker('BUY', 100, 60, '100.00', 'history');
    const target = host.querySelector<HTMLElement>('.rtx-trade-marker-hover-target')!;
    tradeMarkerTooltipLayouts.set(target, { x: 5, markerY: 8, markerSide: 'BUY', plotWidth: 300, plotHeight: 200 });
    light = true; language = 'current'; target.dispatchEvent(new Event('pointerenter'));
    const tooltip = target.querySelector<HTMLElement>('.rtx-trade-marker__price-tooltip')!;
    // jsdom does not retain this existing CSS block with variable font tokens.
    // Verify the actual declaration supplied to the browser's style setter.
    expect(cssText.mock.calls.some(([value]) => value.includes('min-width:148px;') && value.includes('background:#ffffff;'))).toBe(true);
    expect(tooltip.textContent).toContain('current:Price');
    expect(tooltip.style.transform).toBe('none'); expect(tooltip.style.left).toBe('8px');
    expect(tooltip.style.top).toBe('calc(100% + 7px)');
    // Removing a history layer removes its detail subtree with the owner.
    host.remove(); expect(tooltip.isConnected).toBe(false);
    target.dispatchEvent(new Event('pointerenter'));
    expect(target.querySelector('.rtx-trade-marker__price-tooltip')).toBeNull();
  });
});

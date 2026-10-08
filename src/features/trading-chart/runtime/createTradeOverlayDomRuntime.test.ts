import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTradeOverlayDomRuntime } from './createTradeOverlayDomRuntime';
import type { ActiveTradeSnapshot, ClosedTradeSnapshot, TradeLevelOverride } from './tradeRuntimeContracts';
import { tradeMarkerTooltipLayouts } from '../presentation/tradeOverlayPresentation';
import { createActiveTradeOverlayGroups, createActiveTradeOverlayRenderPlans } from './createActiveTradeOverlayGroups';
import { createHistoryTradeOverlayGroups, createHistoryTradeOverlayRenderPlans } from './createHistoryTradeOverlayGroups';

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

function createRuntime(optionsOrLightSurface: Partial<RuntimeOptions> | boolean = {}) {
  const lightSurface = typeof optionsOrLightSurface === 'boolean' && optionsOrLightSurface;
  const overrides = typeof optionsOrLightSurface === 'boolean' ? {} : optionsOrLightSurface;
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
    chartThemeRef: { current: { background: lightSurface ? '#d8dde2' : '#000000' } } as RuntimeOptions['chartThemeRef'],
    digits: 2, historyOverlayNodeDataRef: { current: [] }, historyOverlayNodesRef: { current: [] },
    isChartSurfaceLight: () => lightSurface, overlayRef: { current: overlay },
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

  it.each([false, true])('shares SL/TP label colors with docked shortcuts and price-axis badges, light=%s', lightSurface => {
    const { host, options, runtime } = createRuntime(lightSurface);
    options.seriesRef.current = {
      priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    } as NonNullable<RuntimeOptions['seriesRef']['current']>;
    runtime.createEntryControlsForTrade(trade, { sl: 0, tp: 0 });
    for (const role of ['SL', 'TP'] as const) {
      const color = role === 'SL'
        ? (lightSurface ? '#795000' : '#e9c18a')
        : (lightSurface ? '#04685e' : '#9dd2c8');
      runtime.createLevelControlsForTrade(trade, role, { sl: 87000, tp: 85118.19 });
      expect(host.querySelector(`.rtx-trade-dock-chip--${role.toLowerCase()}`)).toHaveStyle({ color });
      expect(host.querySelector(`.rtx-trade-controls--${role.toLowerCase()} .rtx-trade-chip--role`)).toHaveStyle({ color });
      const axisBadge = host.querySelector<HTMLElement>(`[data-trade-axis-key='${trade.key}:${role.toLowerCase()}']`)!;
      expect(axisBadge).toHaveStyle({ color });
    }
  });

  it.each(['BUY', 'SELL'] as const)('keeps the light %s entry price-axis label readable on the dim chart', side => {
    const { host, options, runtime } = createRuntime(true);
    options.seriesRef.current = {
      priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    } as NonNullable<RuntimeOptions['seriesRef']['current']>;
    runtime.createEntryControlsForTrade({ ...trade, side }, { sl: 0, tp: 0 });
    const axisBadge = host.querySelector<HTMLElement>(`[data-trade-axis-key='${trade.key}:entry']`)!;
    expect(axisBadge).toHaveStyle({
      backgroundColor: '#d8dde2',
      color: side === 'BUY' ? '#1746bc' : '#a51f26',
    });
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

describe('incremental active groups with actual trade controls', () => {
  beforeEach(() => { modifyPosition.mockReset().mockResolvedValue(undefined); });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  function groupedRuntime() {
    const f = createRuntime({ seriesRef: { current: { priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }) } } } as Partial<RuntimeOptions>);
    const groups = createActiveTradeOverlayGroups({ nodes: f.options.activeOverlayNodesRef,
      data: f.options.activeOverlayNodeDataRef, updaters: f.options.tradeControlLiveUpdatersRef });
    const levelMap = new Map<string, TradeLevelOverride>();
    const render = (trades: ActiveTradeSnapshot[]) => {
      f.options.activeTradeSnapshotsRef.current = new Map(trades.map(item => [item.key, item]));
      const descriptors = createActiveTradeOverlayRenderPlans({ sortedTrades: trades,
        liveKeys: f.options.activeTradeSnapshotsRef.current, retainedKeys: new Set(), presentationSignature: 'test-context',
        resolveLevels: item => levelMap.get(item.key) ?? { sl: 0, tp: 0 }, nextOffset: () => 0 });
      groups.reconcile(descriptors.map(({ trade: item, levels, signature }) => ({ key: item.key, signature, create: () => {
        f.runtime.createTradeMarker(item.side, item.entryPrice, item.entryTime, item.key, 'active');
        f.runtime.createPriceLevel(item.key, item.entryPrice, '#999999', { tradeKey: item.key, role: 'ENTRY', labelVariant: 'none' });
        f.runtime.createEntryControlsForTrade(item, levels);
        for (const role of ['SL', 'TP'] as const) {
          const price = role === 'SL' ? levels.sl : levels.tp;
          if (!(price > 0)) continue;
          f.runtime.createPriceLevel(role, price, '#999999', { tradeKey: item.key, role, labelVariant: 'none' });
          f.runtime.createLevelControlsForTrade(item, role, levels);
        }
      } })));
    };
    return { ...f, groups, levelMap, render };
  }

  it('retains actual markers and controls over 50 fills, removal and re-add with one updater per trade', () => {
    const f = groupedRuntime();
    const trades = Array.from({ length: 50 }, (_, index) => ({ ...trade, key: `trade:${9302300 + index}` }));
    f.render(trades.slice(0, 1));
    const firstNodes = [...f.options.activeOverlayNodesRef.current];
    const marker = f.host.querySelector('.rtx-trade-marker');
    const creator = vi.spyOn(f.runtime, 'createEntryControlsForTrade');
    for (let count = 2; count <= 50; count++) f.render(trades.slice(0, count));
    expect(creator).toHaveBeenCalledTimes(49);
    expect(f.options.activeOverlayNodesRef.current.slice(0, firstNodes.length)).toEqual(firstNodes);
    expect(f.host.querySelector('.rtx-trade-marker')).toBe(marker);
    expect(f.options.tradeControlLiveUpdatersRef.current).toHaveLength(50);
    expect(f.host.querySelectorAll('.rtx-trade-axis-price-badge')).toHaveLength(50);
    expect(f.options.activeOverlayNodeDataRef.current).toHaveLength(f.options.activeOverlayNodesRef.current.length);
    f.render(trades.slice(1));
    expect(firstNodes.every(node => !node.isConnected)).toBe(true);
    expect(f.options.tradeControlLiveUpdatersRef.current).toHaveLength(49);
    f.render(trades);
    expect(creator).toHaveBeenCalledTimes(50);
    expect(f.options.tradeControlLiveUpdatersRef.current).toHaveLength(50);
    const entryBars = [...f.host.querySelectorAll<HTMLElement>('.rtx-trade-controls')]
      .filter(node => node.dataset.role === 'ENTRY');
    expect(entryBars.map(node => node.dataset.tradeKey)).toEqual(trades.map(item => item.key));
    f.groups.dispose();
    expect(f.host.querySelectorAll('.rtx-trade-marker,.rtx-trade-controls,.rtx-trade-axis-price-badge')).toHaveLength(0);
  });

  it('replaces changed level captures while retained controls update their latest valuation', async () => {
    const f = groupedRuntime();
    const other = { ...trade, key: 'trade:9302301' };
    f.levelMap.set(trade.key, { sl: 87000, tp: 85000 });
    f.render([trade]);
    const findSlButton = () => f.host.querySelector<HTMLButtonElement>(
      `[data-trade-key="${trade.key}"][data-role="SL"].rtx-trade-controls--level .rtx-trade-control-btn--remove`)!;
    const oldButton = findSlButton();
    f.render([trade, other]);
    expect(findSlButton()).toBe(oldButton);
    const entry = f.host.querySelector<HTMLElement>(`[data-trade-key="${trade.key}"][data-role="ENTRY"].rtx-trade-controls`)!;
    const money = entry.querySelector<HTMLElement>('.rtx-trade-chip--money .rtx-trade-chip-value')!;
    const previousMoney = money.textContent;
    f.render([{ ...trade, currentPrice: 84000, currentTime: 10 }, other]);
    f.options.tradeControlLiveUpdatersRef.current[0]();
    expect(entry.isConnected).toBe(true);
    expect(findSlButton()).toBe(oldButton);
    expect(money.textContent).not.toBe(previousMoney);
    expect(Number(money.textContent)).toBeCloseTo(19.40, 2);
    const otherNodes = f.options.activeOverlayNodesRef.current.filter(node => node.dataset.tradeKey === other.key);
    f.levelMap.set(trade.key, { sl: 87500, tp: 84500 });
    f.render([{ ...trade, currentPrice: 84000, currentTime: 10 }, other]);
    const newButton = findSlButton();
    expect(newButton).not.toBe(oldButton);
    expect(oldButton.isConnected).toBe(false);
    expect(otherNodes.every(node => node.isConnected)).toBe(true);
    newButton.click();
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(9302300, { price_sl: 0 });
    expect(f.options.tradeLevelOverridesRef.current.get(trade.key)).toEqual({ sl: 0, tp: 84500 });
    await Promise.resolve();
    expect(f.options.tradeControlLiveUpdatersRef.current).toHaveLength(2);
  });
});

describe('incremental history groups with actual markers and tooltips', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  function historyRuntime() {
    const f = createRuntime();
    const groups = createHistoryTradeOverlayGroups({ nodes: f.options.historyOverlayNodesRef, data: f.options.historyOverlayNodeDataRef });
    const settings = { showLines: true, showArrows: true, lineOpacity: 0.5 };
    const render = (trades: ClosedTradeSnapshot[], force = false) => {
      const plans = createHistoryTradeOverlayRenderPlans({ trades, ...settings, presentationSignature: 'actual-history-fixture',
        resolveLineColor: item => (item.profit ?? 0) >= 0 ? '#00ff00' : '#ff0000' });
      groups.reconcile(plans.map(({ trade: item, signature, exitSide, lineColor }) => ({ key: item.key, signature, create: () => {
        if (settings.showLines) f.runtime.createTradeHistoryLine(item.entryPrice, item.entryTime, item.exitPrice, item.exitTime,
          lineColor, settings.lineOpacity, settings.showArrows ? { start: item.side, end: exitSide } : undefined);
        if (settings.showArrows) {
          f.runtime.createTradeMarker(item.side, item.entryPrice, item.entryTime, item.entryPrice.toFixed(2), 'history', 1,
            undefined, 'open', item.side, item.entryExecutionTime);
          f.runtime.createTradeMarker(exitSide, item.exitPrice, item.exitTime, item.exitPrice.toFixed(2), 'history', 1,
            undefined, 'close', item.side, item.exitExecutionTime);
        }
      } })), force);
    };
    return { ...f, groups, settings, render };
  }
  const closed: ClosedTradeSnapshot = { ...trade, exitPrice: 85800, exitTime: 60, exitExecutionTime: 61,
    profit: 1, source: 'app-history' };

  it('keeps 500 closed groups and focused tooltip identity when another close is added and corrected', () => {
    const f = historyRuntime();
    const history = Array.from({ length: 500 }, (_, index) => ({ ...closed, key: `trade:${9302300 + index}` }));
    const markers = vi.spyOn(f.runtime, 'createTradeMarker'), lines = vi.spyOn(f.runtime, 'createTradeHistoryLine');
    f.render(history);
    const originalNodes = [...f.options.historyOverlayNodesRef.current];
    const target = f.host.querySelector<HTMLElement>('.rtx-trade-marker-hover-target')!;
    target.focus();
    const tooltip = target.querySelector('.rtx-trade-marker__price-tooltip');
    expect(tooltip).not.toBeNull();
    const pending = { ...closed, key: 'trade:9400000' };
    f.render([...history, pending]);
    expect(markers).toHaveBeenCalledTimes(1002); expect(lines).toHaveBeenCalledTimes(501);
    expect(f.options.historyOverlayNodesRef.current.slice(0, 2500)).toEqual(originalNodes);
    const pendingNodes = f.options.historyOverlayNodesRef.current.slice(2500);
    f.render([...history, { ...pending, exitPrice: 85700, exitExecutionTime: 65, source: 'mt5-history' }]);
    expect(markers).toHaveBeenCalledTimes(1004); expect(lines).toHaveBeenCalledTimes(502);
    expect(f.options.historyOverlayNodesRef.current.slice(0, 2500)).toEqual(originalNodes);
    expect(pendingNodes.every(node => !node.isConnected)).toBe(true);
    const correctedTarget = f.options.historyOverlayNodesRef.current.slice(2500).find(node =>
      node.classList.contains('rtx-trade-marker-hover-target') && node.dataset.tradeLifecycle === 'close')!;
    expect(correctedTarget.dataset.hoverPrice).toBe('85700.00');
    expect(correctedTarget.dataset.hoverTime).toContain('00:01:05 GMT');
    correctedTarget.dispatchEvent(new Event('pointerenter'));
    const correctedTooltip = correctedTarget.querySelector('.rtx-trade-marker__price-tooltip')!;
    expect(correctedTooltip.textContent).toContain('85700.00');
    expect(correctedTooltip.textContent).toContain('00:01:05 GMT');
    correctedTarget.dispatchEvent(new Event('pointerleave'));
    expect(document.activeElement).toBe(target);
    expect(target.querySelector('.rtx-trade-marker__price-tooltip')).toBe(tooltip);
    target.blur(); expect(target.querySelector('.rtx-trade-marker__price-tooltip')).toBeNull();
    f.render(history);
    expect(f.options.historyOverlayNodesRef.current).toEqual(originalNodes);
    expect(f.options.tradeControlLiveUpdatersRef.current).toHaveLength(0);
  });

  it('rebuilds changed settings and explicit refresh, including line-to-arrow alignment and focus cleanup', () => {
    const cssText = vi.spyOn(CSSStyleDeclaration.prototype, 'cssText', 'set');
    const declarationsFor = (node: HTMLElement) => cssText.mock.calls.flatMap(([value], index) =>
      cssText.mock.contexts[index] === node.style ? [value] : []);
    const f = historyRuntime(); f.render([closed]);
    const target = f.host.querySelector<HTMLElement>('.rtx-trade-marker-hover-target')!; target.focus();
    f.render([closed], true);
    expect(target.isConnected).toBe(false);
    const originalLine = f.host.querySelector<HTMLElement>('.rtx-trade-history-line')!;
    expect(declarationsFor(originalLine)).toEqual([expect.stringContaining(';opacity:0.5;')]);
    expect(f.options.historyOverlayNodeDataRef.current[0]).toMatchObject({ startMarkerSide: 'SELL', endMarkerSide: 'BUY' });
    f.settings.showArrows = false; f.settings.lineOpacity = 0.8; f.render([closed]);
    expect(originalLine.isConnected).toBe(false);
    expect(f.host.querySelectorAll('.rtx-trade-marker,.rtx-trade-marker-hover-target')).toHaveLength(0);
    expect(f.options.historyOverlayNodeDataRef.current[0].startMarkerSide).toBeUndefined();
    // jsdom 27 drops this complete, existing CSS block although its individual
    // declarations parse. Assert the actual replacement node's setter input.
    const replacementLine = f.host.querySelector<HTMLElement>('.rtx-trade-history-line')!;
    expect(declarationsFor(replacementLine)).toEqual([expect.stringContaining(';opacity:0.8;')]);
    f.settings.showArrows = true; f.settings.showLines = false; f.render([closed]);
    expect(f.host.querySelectorAll('.rtx-trade-history-line')).toHaveLength(0);
    expect(f.host.querySelectorAll('.rtx-trade-marker-hover-target[tabindex="0"]')).toHaveLength(2);
    f.settings.showArrows = false; f.render([closed]);
    expect(f.options.historyOverlayNodesRef.current).toHaveLength(0);
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

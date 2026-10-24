import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTradeOverlayDomRuntime } from './createTradeOverlayDomRuntime';
import type { ActiveTradeSnapshot, TradeLevelOverride } from './tradeRuntimeContracts';
import {
  CHART_POSITION_MODIFY_EVENT,
  resolveChartPositionModifyTarget,
  type ChartPositionModifyDetail,
} from '../../../utils/chartTradeControls';

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

function createRuntime(lightSurface = false) {
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
    chartThemeRef: { current: { background: lightSurface ? '#fafbfc' : '#000000' } } as RuntimeOptions['chartThemeRef'],
    digits: 2, historyOverlayNodeDataRef: { current: [] }, historyOverlayNodesRef: { current: [] },
    isChartSurfaceLight: () => lightSurface, overlayRef: { current: overlay },
    pendingTradeLevelModifyRequestsRef: { current: new Map() }, persistTradeLevelOverrides: vi.fn(),
    prevTimeframeRef: { current: 'M1' }, seriesRef: { current: null }, timeframe: 'M1',
    tr: (source, values) => typeof source === 'string'
      ? source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(values?.[key] ?? match)) as typeof source
      : source,
    tradeControlLiveUpdatersRef: { current: [] },
    tradeLevelLastKnownLevelsRef: { current: new Map() }, tradeLevelModifyRequestSeqRef: { current: 0 },
    tradeLevelOptimisticGraceUntilRef: { current: new Map() }, tradeLevelOverridesRef: { current: new Map() },
    deleteTradeLevelState: (state, owner) => { state.delete(owner.key); },
    formatTradeLevelBadgePrice: price => price.toFixed(2),
    getTradeLevelStateKeys: owner => [owner.key], getTradeTicketLabel: key => key.replace('trade:', ''),
    resolveSymbolTick: () => null,
    setTradeLevelState: (state, owner, levels) => { state.set(owner.key, levels); },
  };
  return { host, overlay, options, runtime: createTradeOverlayDomRuntime(options) };
}

describe('SL/TP chart controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    modifyPosition.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([false, true])('shares one neutral entry line and axis label across BUY/SELL tickets, light=%s', lightSurface => {
    const { host, options, runtime } = createRuntime(lightSurface);
    options.seriesRef.current = {
      priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    } as NonNullable<RuntimeOptions['seriesRef']['current']>;
    const owners: ActiveTradeSnapshot[] = [
      { ...trade, side: 'BUY' },
      { ...trade, key: 'trade:9302301', side: 'SELL' },
    ];
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    runtime.createEntryPriceLevels(owners, new Set(owners.map(owner => owner.key)));
    for (const owner of owners) {
      runtime.createEntryControlsForTrade(owner, { sl: 87000, tp: 85118.19 }, { showAxisPriceLine: false });
    }

    const lines = host.querySelectorAll<HTMLElement>('.rtx-trade-level-line--entry');
    const badges = host.querySelectorAll<HTMLElement>('.rtx-trade-axis-price-badge');
    expect(lines).toHaveLength(1);
    expect(badges).toHaveLength(1);
    const neutral = lightSurface ? '#475569' : '#b9bcc6';
    expect(lines[0]).toHaveStyle({ borderTopColor: neutral });
    expect(badges[0]).toHaveStyle({ color: neutral });
    expect(lines[0].dataset.tradeKey).toBeUndefined();
    expect(host.querySelectorAll('.rtx-trade-level-hit-area')).toHaveLength(0);
    const controls = host.querySelectorAll<HTMLElement>('.rtx-trade-controls--entry');
    expect(controls).toHaveLength(2);
    for (const [index, control] of Array.from(controls).entries()) {
      expect(control.dataset.entryPrice).toBe(String(trade.entryPrice));
      expect(control.dataset.tradeKey).toBe(owners[index].key);
      control.querySelector<HTMLButtonElement>('button.rtx-trade-dock-chip--sl')!.click();
    }
    const modifications = dispatch.mock.calls.map(([event]) => event)
      .filter(event => event.type === CHART_POSITION_MODIFY_EVENT) as CustomEvent<ChartPositionModifyDetail>[];
    expect(modifications.map(event => event.detail.ticket)).toEqual([9302300, 9302301]);
    expect(modifyPosition).not.toHaveBeenCalled();
    expect(options.tradeLevelOverridesRef.current.size).toBe(0);
  });

  it('retains side color for equal-price same-side positions without merging their SL lines', () => {
    const { host, options, runtime } = createRuntime();
    options.seriesRef.current = {
      priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    } as NonNullable<RuntimeOptions['seriesRef']['current']>;
    const owners = [trade, { ...trade, key: 'trade:9302301' }];
    runtime.createEntryPriceLevels(owners, new Set(owners.map(owner => owner.key)));
    for (const owner of owners) {
      runtime.createPriceLevel('SL', 87000, '#ef4444', { tradeKey: owner.key, role: 'SL', labelVariant: 'none' });
    }
    expect(host.querySelectorAll('.rtx-trade-level-line--entry')).toHaveLength(1);
    expect(host.querySelector('.rtx-trade-level-line--entry')).toHaveStyle({ borderTopColor: '#ef4444' });
    expect(host.querySelectorAll('.rtx-trade-level-line--sl')).toHaveLength(2);
    expect(Array.from(host.querySelectorAll<HTMLElement>('.rtx-trade-level-hit-area')).map(node => [node.dataset.tradeKey, node.dataset.role]))
      .toEqual(owners.map(owner => [owner.key, 'SL']));
  });

  it('keeps different exact prices separate even when both labels and chart coordinates match', () => {
    const { host, options, runtime } = createRuntime();
    options.seriesRef.current = {
      priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
      priceToCoordinate: () => 100,
    } as unknown as NonNullable<RuntimeOptions['seriesRef']['current']>;
    const owners = [trade, { ...trade, key: 'trade:9302301', entryPrice: trade.entryPrice + 0.001 }];
    runtime.createEntryPriceLevels(owners, new Set(owners.map(owner => owner.key)));
    const badges = host.querySelectorAll<HTMLElement>('.rtx-trade-axis-price-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe(badges[1].textContent);
    expect(options.activeOverlayNodeDataRef.current.filter(node => node.kind === 'horizontal-line').map(node => node.price))
      .toEqual(owners.map(owner => owner.entryPrice));
    expect(Array.from(host.querySelectorAll<HTMLElement>('.rtx-trade-level-hit-area')).map(node => node.dataset.tradeKey))
      .toEqual(owners.map(owner => owner.key));
  });

  it('uses custom chart ink for mixed-side groups and leaves a retained singleton non-interactive', () => {
    const { host, options, runtime } = createRuntime();
    options.chartThemeRef.current.axisText = '#8090a0';
    runtime.createEntryPriceLevels([trade, { ...trade, key: 'trade:9302301', side: 'BUY' }], new Set());
    expect(host.querySelector('.rtx-trade-level-line--entry')).toHaveStyle({ borderTopColor: '#8090a0' });
    runtime.createEntryPriceLevels([{ ...trade, entryPrice: 86000 }], new Set());
    expect(host.querySelectorAll('.rtx-trade-level-line--entry')).toHaveLength(2);
    expect(host.querySelectorAll('.rtx-trade-level-hit-area')).toHaveLength(0);
  });

  it('registers entry and SL/TP controls at their actual prices without connector nodes', () => {
    const { host, options, runtime } = createRuntime();
    const levels = { sl: 87000, tp: 85118.19 };
    runtime.createEntryControlsForTrade(trade, levels, { showAxisPriceLine: false });
    runtime.createLevelControlsForTrade(trade, 'SL', levels);
    runtime.createLevelControlsForTrade(trade, 'TP', levels);
    expect(options.activeOverlayNodeDataRef.current.filter(node => node.kind === 'price-badge').map(node => node.price))
      .toEqual([trade.entryPrice, levels.sl, levels.tp]);
    expect(host.querySelector('.rtx-trade-control-leader')).toBeNull();
    expect(Array.from(host.querySelectorAll<HTMLElement>('.rtx-trade-controls--entry, .rtx-trade-controls--level'))
      .map(node => [node.dataset.tradeKey, node.dataset.role]))
      .toEqual([[trade.key, 'ENTRY'], [trade.key, 'SL'], [trade.key, 'TP']]);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it.each([
    { sl: 0, tp: 0 },
    { sl: 87000, tp: 0 },
    { sl: 0, tp: 85118.19 },
    { sl: 87000, tp: 85118.19 },
  ])('keeps entry access to both levels without chart coordinates: %j', levels => {
    const { host, runtime } = createRuntime();
    runtime.createEntryControlsForTrade(trade, levels);
    const entry = host.querySelector('.rtx-trade-controls--entry')!;
    for (const role of ['SL', 'TP'] as const) {
      const chip = entry.querySelector<HTMLElement>(`.rtx-trade-dock-chip--${role.toLowerCase()}`)!;
      expect(chip).not.toBeNull();
      expect(chip.dataset.tradeKey).toBe(trade.key);
      expect(chip.dataset.role).toBe(role);
      expect(chip.style.display).toBe('inline-flex');
      if (levels[role === 'SL' ? 'sl' : 'tp'] > 0) {
        expect(chip.matches('button.rtx-trade-control-btn')).toBe(true);
        expect(chip).toHaveAttribute('type', 'button');
        expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
        expect(chip).toHaveAttribute('aria-label', expect.stringContaining('Modify Position'));
        expect(chip.title).toContain(levels[role === 'SL' ? 'sl' : 'tp'].toFixed(2));
      } else {
        expect(chip.matches('div.rtx-trade-level-badge')).toBe(true);
        expect(chip.classList.contains('rtx-trade-control-btn')).toBe(false);
      }
    }
    expect(entry.querySelectorAll('.rtx-trade-brackets > *')).toHaveLength(2);
  });

  it.each(['SL', 'TP'] as const)('opens Modify Position for the exact %s identity without submitting a change', role => {
    const { host, options, runtime } = createRuntime();
    const owner = { ...trade, symbol: 'BTCUSD.pro' };
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    runtime.createEntryControlsForTrade(owner, { sl: 87000, tp: 85118.19 });
    const button = host.querySelector<HTMLButtonElement>(`button.rtx-trade-dock-chip--${role.toLowerCase()}`)!;
    const chartPointerDown = vi.fn();
    const chartMouseDown = vi.fn();
    host.addEventListener('pointerdown', chartPointerDown);
    host.addEventListener('mousedown', chartMouseDown);
    for (const type of ['pointerdown', 'mousedown']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(chartPointerDown).not.toHaveBeenCalled();
    expect(chartMouseDown).not.toHaveBeenCalled();
    button.click();
    const events = dispatch.mock.calls.map(([event]) => event)
      .filter(event => event.type === CHART_POSITION_MODIFY_EVENT) as CustomEvent<ChartPositionModifyDetail>[];
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ ticket: 9302300, symbol: 'BTCUSD.pro', sessionScope: options.brokerAccountSessionScope });
    const position = { id: 9302300, symbol: 'BTCUSD.pro' };
    expect(resolveChartPositionModifyTarget(events[0].detail, options.brokerAccountSessionScope, [position])).toBe(position);
    expect(resolveChartPositionModifyTarget(events[0].detail, 'OtherBroker:200003', [position])).toBeNull();
    expect(resolveChartPositionModifyTarget(events[0].detail, options.brokerAccountSessionScope, [{ ...position, symbol: 'BTCUSD' }])).toBeNull();
    expect(modifyPosition).not.toHaveBeenCalled();
    expect(options.tradeLevelOverridesRef.current.size).toBe(0);
  });

  it.each(['trade:9302300invalid', 'trade:9302300.5', 'trade:9007199254740992'])('does not turn an invalid ticket into a Modify request: %s', key => {
    const { host, runtime } = createRuntime();
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    runtime.createEntryControlsForTrade({ ...trade, key }, { sl: 87000, tp: 85118.19 });
    host.querySelector<HTMLButtonElement>('button.rtx-trade-dock-chip--sl')!.click();
    expect(dispatch.mock.calls.some(([event]) => event.type === CHART_POSITION_MODIFY_EVENT)).toBe(false);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it.each([false, true])('shares SL/TP label colors with docked shortcuts and price-axis badges, light=%s', lightSurface => {
    const { host, options, runtime } = createRuntime(lightSurface);
    options.seriesRef.current = {
      priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
    } as NonNullable<RuntimeOptions['seriesRef']['current']>;
    runtime.createEntryControlsForTrade(trade, { sl: 0, tp: 0 });
    for (const role of ['SL', 'TP'] as const) {
      const color = role === 'SL'
        ? (lightSurface ? '#664300' : '#fbbf24')
        : (lightSurface ? '#05564f' : '#4ade80');
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
      backgroundColor: '#fafbfc',
      color: side === 'BUY' ? '#153eaa' : '#981b24',
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
    expect(hitArea.style.cursor).toBe('default');
    expect(bar.style.cursor).toBe('default');
    expect(bar.querySelector('.rtx-trade-level-drag-label')).toHaveStyle({ cursor: 'grab' });
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

  it.each(['SL', 'TP'] as const)('limits the grab cursor to the %s word in a plain level label', role => {
    const { host, runtime } = createRuntime();
    const label = `${role} #9302300 87000.00`;
    runtime.createPriceLevel(label, 87000, '#999999', {
      tradeKey: trade.key, role, labelVariant: 'lineText',
    });
    const badge = host.querySelector<HTMLElement>('.rtx-trade-level-badge')!;
    expect(badge.textContent).toBe(label);
    expect(badge.style.cursor).toBe('default');
    expect(host.querySelector<HTMLElement>('.rtx-trade-level-hit-area')!.style.cursor).toBe('default');
    const dragLabels = badge.querySelectorAll<HTMLElement>('[style*="cursor: grab"]');
    expect(dragLabels).toHaveLength(1);
    expect(dragLabels[0].textContent).toBe(role);
  });

  it.each(['SL', 'TP'] as const)('restores chart and table levels after the broker rejects removing %s', async role => {
    const { host, options, runtime } = createRuntime();
    const levels = { sl: 87000, tp: 85118.19 };
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    modifyPosition.mockRejectedValueOnce(new Error('Broker rejected the update'));
    runtime.createLevelControlsForTrade(trade, role, levels);
    host.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--remove')!.click();
    await Promise.resolve();
    await Promise.resolve();

    const modifications = dispatch.mock.calls.map(([event]) => event)
      .filter(event => event.type === 'rtx:trade-modified') as CustomEvent[];
    expect(modifications.map(event => event.detail)).toEqual([
      {
        id: 9302300, symbol: trade.symbol,
        sl: role === 'SL' ? 0 : levels.sl, tp: role === 'TP' ? 0 : levels.tp,
        sessionScope: options.brokerAccountSessionScope,
      },
      { id: 9302300, symbol: trade.symbol, ...levels, sessionScope: options.brokerAccountSessionScope },
    ]);
    expect(options.tradeLevelOverridesRef.current.get(trade.key)).toEqual(levels);
    expect(options.tradeLevelLastKnownLevelsRef.current.get(trade.key)).toEqual(levels);
    expect(options.pendingTradeLevelModifyRequestsRef.current.has(trade.key)).toBe(false);
    expect(options.tradeLevelOptimisticGraceUntilRef.current.has(trade.key)).toBe(false);
    const feedback = dispatch.mock.calls.map(([event]) => event)
      .filter(event => event.type === 'rtx:order-feedback') as CustomEvent[];
    // Non-geometry errors route through formatOrderError (never a bare
    // generic): the feedback purpose is unchanged, the text is informative.
    expect(feedback.map(event => event.detail)).toEqual([
      { message: 'Order failed: Broker rejected the update', type: 'error' },
    ]);
  });

  it.each(['SL', 'TP'] as const)('preserves a rejected %s change when the other role is attempted while pending', async firstRole => {
    const { host, options, runtime } = createRuntime();
    const levels = { sl: 87000, tp: 85118.19 };
    const otherRole = firstRole === 'SL' ? 'TP' : 'SL';
    const otherTrade = { ...trade, key: 'trade:9302301' };
    let rejectFirst!: (reason: Error) => void;
    modifyPosition.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectFirst = reject; }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const remove = (owner: ActiveTradeSnapshot, role: 'SL' | 'TP', current: TradeLevelOverride) => {
      runtime.createLevelControlsForTrade(owner, role, current);
      host.querySelector<HTMLButtonElement>(
        `.rtx-trade-controls--${role.toLowerCase()}[data-trade-key="${owner.key}"] .rtx-trade-control-btn--remove`,
      )!.click();
    };

    remove(trade, firstRole, levels);
    // The next render includes the first request's optimistic level removal.
    remove(trade, otherRole, options.tradeLevelOverridesRef.current.get(trade.key)!);
    remove(otherTrade, 'TP', levels);
    await Promise.resolve();
    rejectFirst(new Error('The first protection change was rejected'));
    await Promise.resolve();
    await Promise.resolve();

    expect(options.tradeLevelOverridesRef.current.get(trade.key)).toEqual(levels);
    expect(options.tradeLevelLastKnownLevelsRef.current.get(trade.key)).toEqual(levels);
    expect(modifyPosition.mock.calls).toEqual([
      [9302300, firstRole === 'SL' ? { price_sl: 0 } : { price_tp: 0 }],
      [9302301, { price_tp: 0 }],
    ]);
    expect(options.tradeLevelOverridesRef.current.get(otherTrade.key)).toEqual({ sl: levels.sl, tp: 0 });
    expect(options.pendingTradeLevelModifyRequestsRef.current.size).toBe(0);
    expect(dispatch.mock.calls.some(([event]) => event instanceof CustomEvent
      && event.type === 'rtx:order-feedback'
      && event.detail.message === 'Modify Position: Processing...')).toBe(true);
  });

  it.each(['SL', 'TP'] as const)('does not roll back a newer request or show a stale %s failure', async role => {
    const { host, options, runtime } = createRuntime();
    let rejectRequest!: (reason: Error) => void;
    modifyPosition.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectRequest = reject; }));
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runtime.createLevelControlsForTrade(trade, role, { sl: 87000, tp: 85118.19 });
    host.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--remove')!.click();
    const newerLevels = { sl: 88000, tp: 85000 };
    options.pendingTradeLevelModifyRequestsRef.current.set(trade.key, 2);
    options.tradeLevelOverridesRef.current.set(trade.key, newerLevels);
    options.tradeLevelLastKnownLevelsRef.current.set(trade.key, newerLevels);
    dispatch.mockClear();
    rejectRequest(new Error('The old request was rejected'));
    await Promise.resolve();
    await Promise.resolve();

    expect(options.tradeLevelOverridesRef.current.get(trade.key)).toEqual(newerLevels);
    expect(options.tradeLevelLastKnownLevelsRef.current.get(trade.key)).toEqual(newerLevels);
    expect(options.pendingTradeLevelModifyRequestsRef.current.get(trade.key)).toBe(2);
    expect(dispatch).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});

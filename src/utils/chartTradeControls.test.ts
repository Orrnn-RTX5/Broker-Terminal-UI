import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { i18nReady } from '../i18n';

import {
  CHART_POSITION_ACTION_EVENT,
  bindTradeLevelHoverTarget,
  type ChartPositionActionDetail,
  computeSignedPips,
  createDockedLevelChip,
  createEntryTradeControlBar,
  createTradeLevelControlBar,
  dispatchChartPositionAction,
  estimateTradeLevelMoney,
  estimateTradeMoneyAtPrice,
  formatMoneyLabel,
  formatPipsLabel,
  formatVolumeLots,
  getPipSize,
  refreshChartUiTranslations,
  THOUSANDS_SEPARATOR,
} from './chartTradeControls';

/** Swap plain spaces for the chip separator so expected strings stay readable. */
const grouped = (text: string): string => text.replace(/ /g, THOUSANDS_SEPARATOR);

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('pip math', () => {
  it('derives the standard pip size from symbol digits', () => {
    expect(getPipSize(5)).toBeCloseTo(0.0001, 10); // EURUSD
    expect(getPipSize(3)).toBeCloseTo(0.01, 10);   // USDJPY
    expect(getPipSize(2)).toBeCloseTo(0.1, 10);    // XAUUSD
    expect(getPipSize(1)).toBe(1);
    expect(getPipSize(0)).toBe(1);
    expect(getPipSize(Number.NaN)).toBe(1);
  });

  it('signs pips by trade direction', () => {
    // BUY gains when price rises.
    expect(computeSignedPips('BUY', 4595.63, 4605.78, 2)).toBeCloseTo(101.5, 5);
    // SELL gains when price falls.
    expect(computeSignedPips('SELL', 4605.78, 4595.63, 2)).toBeCloseTo(101.5, 5);
    expect(computeSignedPips('SELL', 4605.78, 4678.13, 2)).toBeCloseTo(-723.5, 5);
    expect(computeSignedPips('BUY', 1.10000, 1.10123, 5)).toBeCloseTo(12.3, 5);
  });
});

describe('money estimate', () => {
  it('estimates XAUUSD money using the metal contract size', () => {
    const money = estimateTradeMoneyAtPrice({
      symbol: 'XAUUSD',
      side: 'SELL',
      volume: 1,
      entryPrice: 4605.78,
      price: 4595.63,
    });
    expect(money).toBeCloseTo(1015.0, 3);
  });

  it('prefers an explicit contract size and rejects unusable inputs', () => {
    const money = estimateTradeMoneyAtPrice({
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.5,
      entryPrice: 1.1,
      price: 1.101,
      contractSize: 100000,
    });
    expect(money).toBeCloseTo(50, 5);
    expect(estimateTradeMoneyAtPrice({ symbol: 'EURUSD', side: 'BUY', volume: 0, entryPrice: 1.1, price: 1.2 })).toBeNull();
    expect(estimateTradeMoneyAtPrice({ symbol: '??', side: 'BUY', volume: 1, entryPrice: 1.1, price: 1.2 })).toBeNull();
  });
});

describe('estimateTradeLevelMoney', () => {
  it('scales the backend profit by pip distance when a baseline exists', () => {
    // SELL from 4600, now at 4590 => +100 pips baseline worth 100 USD.
    const money = estimateTradeLevelMoney({
      symbol: 'XAUUSD',
      side: 'SELL',
      volume: 1,
      entryPrice: 4600,
      levelPrice: 4550,
      digits: 2,
      backendPnl: 100,
      currentPrice: 4590,
    });
    expect(money).toBeCloseTo(500, 5);
  });

  it('falls back to the contract estimate when the baseline is too small', () => {
    const money = estimateTradeLevelMoney({
      symbol: 'XAUUSD',
      side: 'SELL',
      volume: 1,
      entryPrice: 4600,
      levelPrice: 4550,
      digits: 2,
      backendPnl: 0,
      currentPrice: 4600, // zero pips baseline
    });
    expect(money).toBeCloseTo(5000, 3); // 50 price move x 100 oz
  });

  it('returns null for unusable level prices', () => {
    expect(estimateTradeLevelMoney({
      symbol: 'XAUUSD',
      side: 'BUY',
      volume: 1,
      entryPrice: 4600,
      levelPrice: Number.NaN,
      digits: 2,
    })).toBeNull();
  });
});

describe('labels', () => {
  it('formats money with grouped thousands and two decimals', () => {
    expect(formatMoneyLabel(1008)).toBe(grouped('1 008.00'));
    expect(formatMoneyLabel(-7242)).toBe(grouped('-7 242.00'));
    expect(formatMoneyLabel(4975.004)).toBe(grouped('4 975.00'));
    expect(formatMoneyLabel(999)).toBe('999.00');
    expect(formatMoneyLabel(null)).toBe('—');
  });

  it('formats pips with one decimal', () => {
    expect(formatPipsLabel(101.53)).toBe('101.5');
    expect(formatPipsLabel(-723.46)).toBe('-723.5');
    expect(formatPipsLabel(Number.NaN)).toBe('—');
  });

  it('trims trailing zeros from lot volumes', () => {
    expect(formatVolumeLots(1)).toBe('1');
    expect(formatVolumeLots(0.5)).toBe('0.5');
    expect(formatVolumeLots(1.25)).toBe('1.25');
  });
});

describe('dispatchChartPositionAction', () => {
  it('publishes a window event with a numeric ticket', () => {
    const seen: ChartPositionActionDetail[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent<ChartPositionActionDetail>).detail);
    window.addEventListener(CHART_POSITION_ACTION_EVENT, listener);
    dispatchChartPositionAction({ action: 'reverse', ticket: 123, symbol: 'XAUUSD' });
    dispatchChartPositionAction({ action: 'close', ticket: Number.NaN, symbol: 'XAUUSD' });
    window.removeEventListener(CHART_POSITION_ACTION_EVENT, listener);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ action: 'reverse', ticket: 123, symbol: 'XAUUSD' });
  });
});

describe('createEntryTradeControlBar', () => {
  it('preserves every action with close grouped beside the live profit', () => {
    const onAction = vi.fn();
    const onShare = vi.fn();
    const { root } = createEntryTradeControlBar({
      tradeKey: 'trade:outlined', ticket: 987, symbol: 'XAUUSD', side: 'BUY',
      volume: 0.01, isLightSurface: false, leftInset: 10, plainLabel: true, onAction, onShare,
    });
    for (const action of ['share', 'reverse', 'double', 'close']) {
      const button = root.querySelector<HTMLButtonElement>(`.rtx-trade-control-btn--${action}`)!;
      expect(button.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
      button.click();
    }
    const capsule = root.querySelector('.rtx-trade-primary')!;
    expect(capsule.querySelector('.rtx-trade-chip--volume')).not.toBeNull();
    expect(capsule.querySelector('.rtx-trade-chip--money')).not.toBeNull();
    expect(capsule.lastElementChild).toBe(root.querySelector('.rtx-trade-control-btn--close'));
    expect(root.querySelector('.rtx-trade-brackets')).not.toBeNull();
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['reverse', 'double', 'close']);
  });

  it.each(['BUY', 'SELL'] as const)('formats compact %s labels with volume and signed account-currency profit', (side) => {
    const { root, setLiveMetrics } = createEntryTradeControlBar({
      tradeKey: 'trade:compact', ticket: 987, symbol: 'XAUUSD', side,
      volume: 0.01, isLightSurface: false, leftInset: 10, plainLabel: true, currencyLabel: 'EUR',
    });
    expect(root.dataset.align).toBe('right');
    expect(root.style.transform).toBe('translateY(-50%)');
    expect(root.tabIndex).toBe(0);
    expect(root.querySelector('.rtx-trade-chip--volume')?.textContent).toBe(`${side} 0.01`);
    expect(root.querySelector<HTMLElement>('.rtx-trade-chip--pips')?.style.display).toBe('none');
    setLiveMetrics(10, 1.75);
    expect(root.querySelector('.rtx-trade-chip--money')?.textContent).toBe('+1.75 EUR');
    setLiveMetrics(-10, -3.79);
    expect(root.querySelector('.rtx-trade-chip--money')?.textContent).toBe('-3.79 EUR');
    setLiveMetrics(0, 0);
    expect(root.querySelector('.rtx-trade-chip--money')?.textContent).toBe('0.00 EUR');
  });

  it.each([false, true])('updates plain metric colors as profit changes, light=%s', (isLightSurface) => {
    const { root, setLiveMetrics } = createEntryTradeControlBar({
      tradeKey: 'trade:color', ticket: 987, symbol: 'XAUUSD', side: 'SELL',
      volume: 1, isLightSurface, leftInset: 10, plainLabel: true,
    });
    document.body.appendChild(root);
    const pips = root.querySelector<HTMLElement>('.rtx-trade-chip--pips')!;
    const money = root.querySelector<HTMLElement>('.rtx-trade-chip--money')!;
    const neutral = money.style.color;
    const profit = isLightSurface ? '#00897b' : '#26a69a';
    const loss = isLightSurface ? '#d32f2f' : '#f23645';
    setLiveMetrics(12, 4.5);
    expect(pips).toHaveStyle({ color: profit });
    expect(money).toHaveStyle({ color: profit });
    setLiveMetrics(-8, -3.5);
    expect(pips).toHaveStyle({ color: loss });
    expect(money).toHaveStyle({ color: loss });
    setLiveMetrics(2, -0.4);
    expect(pips).toHaveStyle({ color: profit });
    expect(money).toHaveStyle({ color: loss });
    setLiveMetrics(0, -0.001);
    expect(pips.style.color).toBe(neutral);
    expect(money.style.color).toBe(neutral);
    setLiveMetrics(null, Number.NaN);
    expect(pips.style.color).toBe(neutral);
    expect(money.style.color).toBe(neutral);
    expect(root.style.backgroundColor).toBe('transparent');
  });

  const buildBar = (onAction?: (action: string) => void) => createEntryTradeControlBar({
    tradeKey: 'trade:987',
    ticket: 987,
    symbol: 'XAUUSD',
    side: 'SELL',
    volume: 1,
    isLightSurface: false,
    leftInset: 10,
    onAction: onAction as never,
  });

  it('changes language in place while preserving metric values and trading action IDs', async () => {
    await i18nReady;
    await i18n.changeLanguage('en');
    const onAction = vi.fn();
    const { root, setLiveMetrics } = buildBar(onAction);
    document.body.appendChild(root);
    setLiveMetrics(101.5, 1008);
    const reverse = root.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--reverse')!;
    const moneyValue = root.querySelector('.rtx-trade-chip--money .rtx-trade-chip-value');
    const originalMoney = moneyValue?.textContent;
    try {
      await i18n.changeLanguage('ko');
      refreshChartUiTranslations(document.body);
      expect(root.querySelector('.rtx-trade-chip--volume')?.textContent).toContain('1랏');
      expect(reverse.title).toContain('새 주문');
      expect(root.querySelector('.rtx-trade-control-btn--reverse')).toBe(reverse);
      expect(root.querySelector('.rtx-trade-chip--money .rtx-trade-chip-value')).toBe(moneyValue);
      expect(moneyValue?.textContent).toBe(originalMoney);
      expect(root.dataset.tradeKey).toBe('trade:987');
      expect(root.dataset.role).toBe('ENTRY');
      reverse.click();
      expect(onAction).toHaveBeenCalledWith('reverse');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('keeps the drag-badge contract classes and datasets on the bar root', () => {
    const { root } = buildBar();
    expect(root.classList.contains('rtx-trade-level-badge')).toBe(true);
    expect(root.classList.contains('rtx-trade-controls')).toBe(true);
    expect(root.dataset.tradeKey).toBe('trade:987');
    expect(root.dataset.role).toBe('ENTRY');
    expect(root.dataset.leftInset).toBe('10');
  });

  it('renders volume, pips and money chips plus the three action buttons', () => {
    const { root, setLiveMetrics } = buildBar();
    expect(root.querySelector('.rtx-trade-chip--volume')?.textContent).toContain('1 lots');
    expect(root.querySelectorAll('.rtx-trade-control-btn')).toHaveLength(3);
    expect(root.querySelector('.rtx-trade-control-btn--reverse')).toBeTruthy();
    expect(root.querySelector('.rtx-trade-control-btn--double')).toBeTruthy();
    expect(root.querySelector('.rtx-trade-control-btn--close')).toBeTruthy();

    setLiveMetrics(101.5, 1008);
    expect(root.querySelector('.rtx-trade-chip--pips')?.textContent).toBe('pips:101.5');
    expect(root.querySelector('.rtx-trade-chip--money')?.textContent).toBe(grouped('USD:1 008.00'));
  });

  it('fills dark entry Pips and USD chips red for SELL and blue for BUY', () => {
    const sell = buildBar().root;
    const buy = createEntryTradeControlBar({
      tradeKey: 'trade:988',
      ticket: 988,
      symbol: 'XAUUSD',
      side: 'BUY',
      volume: 1,
      isLightSurface: false,
      leftInset: 10,
    }).root;

    for (const selector of ['.rtx-trade-chip--pips', '.rtx-trade-chip--money']) {
      expect(sell.querySelector(selector)).toHaveStyle({ backgroundColor: '#ef4444', color: '#ffffff' });
      expect(buy.querySelector(selector)).toHaveStyle({ backgroundColor: '#2962ff', color: '#ffffff' });
    }
  });

  it('keeps light entry metric chips on the neutral light surface', () => {
    const { root } = createEntryTradeControlBar({
      tradeKey: 'trade:989',
      ticket: 989,
      symbol: 'XAUUSD',
      side: 'SELL',
      volume: 1,
      isLightSurface: true,
      leftInset: 10,
    });

    expect(root.querySelector('.rtx-trade-chip--pips')).toHaveStyle({ backgroundColor: '#ffffff', color: '#111827' });
    expect(root.querySelector('.rtx-trade-chip--money')).toHaveStyle({ backgroundColor: '#ffffff', color: '#111827' });
    expect(root.querySelector('.rtx-trade-chip--volume')).toHaveStyle({ backgroundColor: '#dc2626', color: '#ffffff' });
  });

  it('dispatches the position action event when a button is clicked', () => {
    const actions: string[] = [];
    const seen: ChartPositionActionDetail[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent<ChartPositionActionDetail>).detail);
    window.addEventListener(CHART_POSITION_ACTION_EVENT, listener);
    const { root } = buildBar((action) => actions.push(action));
    document.body.appendChild(root);

    (root.querySelector('.rtx-trade-control-btn--reverse') as HTMLButtonElement).click();
    (root.querySelector('.rtx-trade-control-btn--double') as HTMLButtonElement).click();
    (root.querySelector('.rtx-trade-control-btn--close') as HTMLButtonElement).click();
    window.removeEventListener(CHART_POSITION_ACTION_EVENT, listener);

    expect(actions).toEqual(['reverse', 'double', 'close']);
    expect(seen.map((detail) => detail.action)).toEqual(['reverse', 'double', 'close']);
    expect(seen.every((detail) => detail.ticket === 987 && detail.symbol === 'XAUUSD')).toBe(true);
  });

  it('renders the gray share button first when onShare is provided', () => {
    const onShare = vi.fn();
    const { root } = createEntryTradeControlBar({
      tradeKey: 'trade:987',
      ticket: 987,
      symbol: 'XAUUSD',
      side: 'SELL',
      volume: 1,
      isLightSurface: false,
      leftInset: 10,
      onShare,
    });
    document.body.appendChild(root);
    const buttons = root.querySelectorAll('.rtx-trade-control-btn');
    expect(buttons).toHaveLength(4);
    expect(buttons[0].classList.contains('rtx-trade-control-btn--share')).toBe(true);

    const seen: ChartPositionActionDetail[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent<ChartPositionActionDetail>).detail);
    window.addEventListener(CHART_POSITION_ACTION_EVENT, listener);
    (buttons[0] as HTMLButtonElement).click();
    window.removeEventListener(CHART_POSITION_ACTION_EVENT, listener);

    expect(onShare).toHaveBeenCalledTimes(1);
    // Share is chart-local; it must not dispatch a position action.
    expect(seen).toHaveLength(0);
  });

  it('stops button pointerdown from reaching the chart drag logic', () => {
    const { root } = buildBar();
    document.body.appendChild(root);
    const outer = vi.fn();
    document.body.addEventListener('pointerdown', outer);
    const button = root.querySelector('.rtx-trade-control-btn--close') as HTMLButtonElement;
    button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    document.body.removeEventListener('pointerdown', outer);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('createTradeLevelControlBar', () => {
  it.each(['SL', 'TP'] as const)('omits pips from the web %s label and preserves its remove action', (role) => {
    const onRemove = vi.fn();
    const bar = createTradeLevelControlBar({
      tradeKey: 'trade:987', role, side: 'BUY', label: role, pips: 10, money: 5,
      isLightSurface: false, leftInset: 10, onRemove,
      hoverDetails: { entryPrice: 100, levelPrice: 101, digits: 2, tickSize: 0.01 },
    });
    expect(bar.querySelector('.rtx-trade-chip--pips')).toBeNull();
    expect(bar.querySelector('.rtx-trade-chip--money')?.textContent).toBe('USD:5.00');
    const remove = bar.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--remove')!;
    expect(remove).not.toBeNull();
    remove.click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shares hover feedback with the price line without triggering removal', () => {
    const onHoverChange = vi.fn();
    const onRemove = vi.fn();
    const bar = createTradeLevelControlBar({
      tradeKey: 'trade:987', role: 'SL', side: 'BUY', label: 'SL', pips: -10, money: -5,
      isLightSurface: false, leftInset: 10, onRemove, onHoverChange,
      hoverDetails: { entryPrice: 100, levelPrice: 99, digits: 2, tickSize: 0.01 },
    });
    const line = document.createElement('div');
    document.body.append(bar, line);
    bindTradeLevelHoverTarget(bar, line);
    line.dispatchEvent(new MouseEvent('mouseenter'));
    expect(bar.querySelector<HTMLElement>('[role="tooltip"]')!.style.display).toBe('block');
    expect(bar.querySelector<HTMLElement>('.rtx-trade-level-hover-handle')!.style.display).toBe('block');
    expect(bar.style.borderStyle).toBe('solid');
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    line.dispatchEvent(new MouseEvent('mouseleave'));
    expect(bar.querySelector<HTMLElement>('[role="tooltip"]')!.style.display).toBe('none');
    expect(bar.querySelector<HTMLElement>('.rtx-trade-level-hover-handle')!.style.display).toBe('none');
    expect(bar.style.borderStyle).toBe('dotted');
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it.each([
    ['BUY', 'SL', 81155, 'Stop loss -0.08%  -66 ticks'],
    ['BUY', 'TP', 81299, 'Take profit +0.10%  +78 ticks'],
    ['SELL', 'SL', 81299, 'Stop loss -0.10%  -78 ticks'],
    ['SELL', 'TP', 81155, 'Take profit +0.08%  +66 ticks'],
  ] as const)('shows %s %s hover details and hides them when dragging', (side, role, levelPrice, expected) => {
    const onRemove = vi.fn();
    const bar = createTradeLevelControlBar({
      tradeKey: 'trade:987', role, side, label: role, pips: 0, money: 0,
      isLightSurface: false, leftInset: 10, onRemove,
      title: 'Old native title',
      hoverDetails: { entryPrice: 81221, levelPrice, digits: 0, tickSize: 1 },
    });
    document.body.appendChild(bar);
    const tooltip = bar.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.style.display).toBe('none');
    expect(bar.hasAttribute('title')).toBe(false);
    expect(bar.getAttribute('aria-describedby')).toBe(tooltip.id);
    bar.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.children[0].textContent).toBe(expected);
    expect(tooltip.children[1].textContent).toBe(`Price ${levelPrice.toLocaleString()}`);
    bar.dispatchEvent(new Event('pointerdown'));
    expect(tooltip.style.display).toBe('none');
    bar.dispatchEvent(new FocusEvent('focusin'));
    expect(tooltip.style.display).toBe('block');
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltip.style.display).toBe('none');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('builds an SL bar with metrics and a remove button', () => {
    const onRemove = vi.fn();
    const bar = createTradeLevelControlBar({
      tradeKey: 'trade:987',
      role: 'SL',
      side: 'SELL',
      label: 'SL',
      pips: -723.5,
      money: -7242,
      isLightSurface: false,
      leftInset: 10,
      onRemove,
    });
    expect(bar.dataset.role).toBe('SL');
    expect(bar.dataset.tradeKey).toBe('trade:987');
    expect(bar.classList.contains('rtx-trade-level-badge')).toBe(true);
    expect(bar.querySelector('.rtx-trade-chip--pips')?.textContent).toBe('pips:-723.5');
    expect(bar.querySelector('.rtx-trade-chip--money')?.textContent).toBe(grouped('USD:-7 242.00'));
    expect(bar.querySelector('.rtx-trade-chip--pips')).toHaveStyle({ backgroundColor: '#10151c', color: '#e6ecf5' });
    expect(bar.querySelector('.rtx-trade-chip--money')).toHaveStyle({ backgroundColor: '#10151c', color: '#e6ecf5' });

    (bar.querySelector('.rtx-trade-control-btn--remove') as HTMLButtonElement).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('createDockedLevelChip', () => {
  it('uses the light field surface and restores its outline after hover', () => {
    const chip = createDockedLevelChip({ tradeKey: 'trade:987', role: 'SL', label: 'SL', isLightSurface: true, leftInset: 10 });
    document.body.appendChild(chip);
    expect(chip).toHaveStyle({ backgroundColor: '#f2f6fc', color: '#4b5563', borderColor: '#7d8796' });
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    expect(chip).toHaveStyle({ borderTopColor: '#64748b' });
    chip.dispatchEvent(new MouseEvent('mouseleave'));
    expect(chip).toHaveStyle({ borderTopColor: '#7d8796' });
  });

  it('builds a draggable docked handle with the level role dataset', () => {
    const chip = createDockedLevelChip({
      tradeKey: 'trade:987',
      role: 'TP',
      label: 'TP 2',
      isLightSurface: false,
      leftInset: 10,
    });
    expect(chip.classList.contains('rtx-trade-level-badge')).toBe(true);
    expect(chip.classList.contains('rtx-trade-dock-chip')).toBe(true);
    expect(chip.dataset.role).toBe('TP');
    expect(chip.dataset.tradeKey).toBe('trade:987');
    expect(chip.textContent).toContain('TP 2');
    expect(chip.title).toMatch(/take profit/i);
  });
});

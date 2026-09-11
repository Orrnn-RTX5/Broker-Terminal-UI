import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { i18nReady } from '../i18n';

import {
  CHART_POSITION_ACTION_EVENT,
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

    expect(root.querySelector('.rtx-trade-chip--pips')).toHaveStyle({ backgroundColor: '#ffffff', color: '#232c39' });
    expect(root.querySelector('.rtx-trade-chip--money')).toHaveStyle({ backgroundColor: '#ffffff', color: '#232c39' });
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

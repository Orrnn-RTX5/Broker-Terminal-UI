/**
 * cTrader-style on-chart position controls.
 *
 * Builds the DOM for the per-position control bar rendered on the entry line
 * (volume + live Pips / money chips + Reverse / Double / Close buttons), the
 * SL/TP level bars (grip + Pips / money chips + remove button) and the docked
 * SL/TP drag handles shown next to the entry bar before a level exists.
 *
 * The TradingChart overlay positions these elements; this module only builds
 * them and owns the shared math/formatting so it stays unit-testable.
 */

import { getExposureContractSize, parseExposureSymbol } from '../components/BottomDock.exposure';
import { translateUi as tr } from '../hooks/useUiTranslation';

// Presentation-only updates keep the original nodes and their trading action
// listeners intact when the language changes. Detached overlays remain GC-able.
const chartUiBindings = new WeakMap<HTMLElement, () => void>();
export const bindChartUiTranslation = (element: HTMLElement, update: () => void): void => {
  chartUiBindings.set(element, update);
  element.dataset.chartUiBound = 'true';
  update();
};
export const refreshChartUiTranslations = (host: ParentNode): void => {
  host.querySelectorAll<HTMLElement>('[data-chart-ui-bound]').forEach(element => {
    chartUiBindings.get(element)?.();
  });
};

export type ChartTradeSide = 'BUY' | 'SELL';
export type ChartTradeLevelRole = 'SL' | 'TP';

// ---------------------------------------------------------------------------
// Position action event (consumed by App.tsx)
// ---------------------------------------------------------------------------

export const CHART_POSITION_ACTION_EVENT = 'rtx:chart-position-action';

export type ChartPositionActionType = 'close' | 'reverse' | 'double';

export interface ChartPositionActionDetail {
  action: ChartPositionActionType;
  ticket: number;
  symbol: string;
}

export const dispatchChartPositionAction = (detail: ChartPositionActionDetail): void => {
  if (typeof window === 'undefined') return;
  const ticket = Number(detail?.ticket);
  if (!Number.isFinite(ticket) || ticket <= 0) return;
  window.dispatchEvent(new CustomEvent<ChartPositionActionDetail>(CHART_POSITION_ACTION_EVENT, {
    detail: { ...detail, ticket },
  }));
};

// ---------------------------------------------------------------------------
// Pip / money math
// ---------------------------------------------------------------------------

/** Standard pip: one tenth-point above 1 digit (5-digit FX -> 0.0001, XAU 2 digits -> 0.1). */
export const getPipSize = (digits: number): number => {
  if (!Number.isFinite(digits) || digits <= 1) return 1;
  return Math.pow(10, -(Math.floor(digits) - 1));
};

/** Signed pip distance from entry to `price` in the direction of the trade. */
export const computeSignedPips = (
  side: ChartTradeSide,
  entryPrice: number,
  price: number,
  digits: number,
): number => {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(price)) return Number.NaN;
  const diff = side === 'SELL' ? entryPrice - price : price - entryPrice;
  return diff / getPipSize(digits);
};

export interface TradeMoneyEstimateInput {
  symbol: string;
  side: ChartTradeSide;
  volume: number;
  entryPrice: number;
  price: number;
  contractSize?: number;
}

/**
 * Quote-currency P/L estimate at `price`. Used as fallback only — when the
 * backend reports live profit for the position, callers scale that instead so
 * cross-currency conversion stays backend-authoritative.
 */
export const estimateTradeMoneyAtPrice = (input: TradeMoneyEstimateInput): number | null => {
  const { symbol, side, volume, entryPrice, price } = input;
  if (!(volume > 0) || !(entryPrice > 0) || !(price > 0)) return null;
  const parsed = parseExposureSymbol(symbol);
  if (!parsed) return null;
  const contractSize = input.contractSize && input.contractSize > 0
    ? input.contractSize
    : getExposureContractSize({ contractSize: input.contractSize }, parsed.base, parsed.quote);
  const direction = side === 'SELL' ? -1 : 1;
  const money = (price - entryPrice) * direction * volume * contractSize;
  return Number.isFinite(money) ? money : null;
};

export interface TradeLevelMoneyInput {
  symbol: string;
  side: ChartTradeSide;
  volume: number;
  entryPrice: number;
  levelPrice: number;
  digits: number;
  /** Live backend profit for the position, when known. */
  backendPnl?: number | null;
  /** Live close price for the position (bid for BUY, ask for SELL). */
  currentPrice?: number | null;
  contractSize?: number;
}

/**
 * Projected money at a level. Scales the backend-reported live profit by pip
 * distance when a usable baseline exists (keeps account-currency conversion
 * backend-authoritative); otherwise falls back to the contract-size estimate.
 */
export const estimateTradeLevelMoney = (input: TradeLevelMoneyInput): number | null => {
  const levelPips = computeSignedPips(input.side, input.entryPrice, input.levelPrice, input.digits);
  if (!Number.isFinite(levelPips)) return null;
  const backendPnl = Number(input.backendPnl);
  const currentPips = input.currentPrice == null
    ? Number.NaN
    : computeSignedPips(input.side, input.entryPrice, Number(input.currentPrice), input.digits);
  if (Number.isFinite(backendPnl) && Number.isFinite(currentPips) && Math.abs(currentPips) >= 1) {
    return backendPnl * (levelPips / currentPips);
  }
  return estimateTradeMoneyAtPrice({
    symbol: input.symbol,
    side: input.side,
    volume: input.volume,
    entryPrice: input.entryPrice,
    price: input.levelPrice,
    contractSize: input.contractSize,
  });
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Non-breaking space keeps grouped numbers on one line inside the chips. */
export const THOUSANDS_SEPARATOR = '\u00a0';

const groupThousands = (intPart: string): string => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);

export const formatMoneyLabel = (value: number | null | undefined): string => {
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const sign = numeric < 0 ? '-' : '';
  const [intPart, decPart] = Math.abs(numeric).toFixed(2).split('.');
  return `${sign}${groupThousands(intPart)}.${decPart}`;
};

export const formatPipsLabel = (pips: number | null | undefined): string => {
  if (pips == null) return '—';
  const numeric = Number(pips);
  if (!Number.isFinite(numeric)) return '—';
  const sign = numeric < 0 ? '-' : '';
  const [intPart, decPart] = Math.abs(numeric).toFixed(1).split('.');
  return `${sign}${groupThousands(intPart)}.${decPart}`;
};

export const formatVolumeLots = (volume: number): string => {
  const numeric = Number(volume);
  if (!Number.isFinite(numeric)) return '0';
  const fixed = numeric.toFixed(2);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
};

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const TRADE_CONTROL_SIDE_COLORS: Record<ChartTradeSide, string> = {
  BUY: '#22c55e',
  SELL: '#ef4444',
};

const TRADE_CONTROL_LIGHT_SIDE_COLORS: Record<ChartTradeSide, string> = {
  BUY: '#2563eb',
  SELL: '#dc2626',
};

const TRADE_CONTROL_DARK_ENTRY_METRIC_COLORS: Record<ChartTradeSide, string> = {
  BUY: '#2962ff',
  SELL: '#ef4444',
};

export const TRADE_CONTROL_ACTION_COLOR = '#2563eb';
const TRADE_CONTROL_ACTION_HOVER_COLOR = '#3b82f6';
export const TRADE_CONTROL_SHARE_COLOR = '#5b6472';
const TRADE_CONTROL_SHARE_HOVER_COLOR = '#6f7a8a';

interface TradeControlSurface {
  chipBackground: string;
  chipText: string;
  dockBackground: string;
  dockBorder: string;
  dockText: string;
  shadow: string;
}

// Chip surfaces are fully opaque: with many stacked positions the Pips/USD
// text must stay readable over lines, candles and neighbouring bars.
const getTradeControlSurface = (isLightSurface: boolean): TradeControlSurface => (
  isLightSurface
    ? {
      chipBackground: '#ffffff',
      chipText: '#111827',
      dockBackground: '#f2f6fc',
      dockBorder: '#7d8796',
      dockText: '#4b5563',
      shadow: '0 1px 3px rgba(15,23,42,0.12)',
    }
    : {
      chipBackground: '#10151c',
      chipText: '#e6ecf5',
      dockBackground: '#10151c',
      dockBorder: '#6f7683',
      dockText: '#c3cad6',
      shadow: '0 2px 8px rgba(0,0,0,0.32)',
    }
);

// ---------------------------------------------------------------------------
// SVG glyphs
// ---------------------------------------------------------------------------

const sideArrowSvg = (side: ChartTradeSide): string => (
  side === 'SELL'
    ? '<svg width="9" height="10" viewBox="0 0 10 12" aria-hidden="true"><path d="M5 10.6 1.4 6.6h2.2V1.4h2.8v5.2h2.2Z" fill="#fff"/></svg>'
    : '<svg width="9" height="10" viewBox="0 0 10 12" aria-hidden="true"><path d="M5 1.4 8.6 5.4H6.4v5.2H3.6V5.4H1.4Z" fill="#fff"/></svg>'
);

const shareSvg = '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="#fff" stroke-width="1.4"><circle cx="10.8" cy="3" r="1.9"/><circle cx="3.2" cy="7" r="1.9"/><circle cx="10.8" cy="11" r="1.9"/><path d="M4.9 6.1 9.1 3.9M4.9 7.9l4.2 2.2"/></svg>';
const reverseSvg = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 12V7.1a3.6 3.6 0 0 1 7.2 0v3.1"/><path d="M8.5 8.3l2.1 2.4 2.1-2.4"/></svg>';
const doubleSvg = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.4 11.6V3.4"/><path d="M2.1 5.7 4.4 3.4l2.3 2.3"/><path d="M9.6 11.6V3.4"/><path d="M7.3 5.7 9.6 3.4l2.3 2.3"/></svg>';
const closeSvg = '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M3.6 3.6l6.8 6.8M10.4 3.6l-6.8 6.8"/></svg>';

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------

const CHIP_FONT = "font-size:10px;font-family:Consolas,'Courier New',monospace;font-weight:700;line-height:14px;letter-spacing:0.01em;";

const stopOverlayInteraction = (event: Event): void => {
  event.stopPropagation();
};

const createControlButton = (
  variant: 'share' | 'reverse' | 'double' | 'close' | 'remove',
  title: string,
  iconSvg: string,
  background: string,
  hoverBackground: string,
  onActivate: () => void,
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `rtx-trade-control-btn rtx-trade-control-btn--${variant}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = iconSvg;
  button.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;background-color:${background};border:1px solid rgba(255,255,255,0.32);border-radius:2px;cursor:pointer;pointer-events:auto;box-sizing:border-box;flex:0 0 auto;`;
  button.addEventListener('pointerdown', stopOverlayInteraction);
  button.addEventListener('mousedown', stopOverlayInteraction);
  button.addEventListener('mouseenter', () => { button.style.backgroundColor = hoverBackground; });
  button.addEventListener('mouseleave', () => { button.style.backgroundColor = background; });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    onActivate();
  });
  return button;
};

const createMetricChip = (
  variant: 'pips' | 'money',
  label: string,
  initialValue: string,
  surface: TradeControlSurface,
  accentColor: string,
  filledBackground?: string,
): { chip: HTMLSpanElement; valueEl: HTMLSpanElement } => {
  const chip = document.createElement('span');
  chip.className = `rtx-trade-chip rtx-trade-chip--${variant}`;
  const background = filledBackground ?? surface.chipBackground;
  const textColor = filledBackground ? '#ffffff' : surface.chipText;
  chip.style.cssText = `display:inline-flex;align-items:center;gap:3px;padding:2px 6px;margin-left:-1px;background-color:${background};border:1px solid ${accentColor};color:${textColor};${CHIP_FONT}white-space:nowrap;box-sizing:border-box;flex:0 0 auto;`;
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  if (variant === 'pips') bindChartUiTranslation(labelEl, () => {
    labelEl.textContent = `${tr('pips')}:`;
  });
  labelEl.style.cssText = 'opacity:0.78;font-weight:600;';
  const valueEl = document.createElement('span');
  valueEl.className = 'rtx-trade-chip-value';
  valueEl.textContent = initialValue;
  chip.appendChild(labelEl);
  chip.appendChild(valueEl);
  return { chip, valueEl };
};

export interface EntryTradeControlBarOptions {
  tradeKey: string;
  ticket: number;
  symbol: string;
  side: ChartTradeSide;
  volume: number;
  isLightSurface: boolean;
  leftInset: number;
  currencyLabel?: string;
  title?: string;
  onAction?: (action: ChartPositionActionType) => void;
  /** Renders the gray share button (copies a share URL) when provided. */
  onShare?: () => void;
}

export interface EntryTradeControlBarHandles {
  root: HTMLDivElement;
  setLiveMetrics: (pips: number | null, money: number | null) => void;
}

/**
 * `[volume ⬍][Pips: x][USD: y]  [reverse][double][close]` bar anchored on the
 * entry line. The chip area doubles as the ENTRY drag handle (creates SL/TP),
 * so it keeps the `rtx-trade-level-badge` contract classes and datasets; the
 * buttons opt out of dragging via the `rtx-trade-control-btn` guard.
 */
export const createEntryTradeControlBar = (options: EntryTradeControlBarOptions): EntryTradeControlBarHandles => {
  const {
    tradeKey, ticket, symbol, side, volume, isLightSurface, leftInset,
    currencyLabel = 'USD', title, onAction, onShare,
  } = options;
  const sideColor = (isLightSurface ? TRADE_CONTROL_LIGHT_SIDE_COLORS : TRADE_CONTROL_SIDE_COLORS)[side];
  const surface = getTradeControlSurface(isLightSurface);
  const actionHoverColor = isLightSurface ? '#1d4ed8' : TRADE_CONTROL_ACTION_HOVER_COLOR;

  const root = document.createElement('div');
  root.className = 'rtx-trade-level-badge rtx-trade-controls rtx-trade-controls--entry';
  root.dataset.tradeKey = tradeKey;
  root.dataset.role = 'ENTRY';
  root.dataset.leftInset = String(leftInset);
  // The overlay relayout restores this display mode when unhiding the node.
  root.dataset.display = 'inline-flex';
  if (title) root.title = title;
  root.style.cssText = `position:absolute;left:${leftInset}px;display:none;align-items:center;z-index:22;pointer-events:auto;cursor:grab;transform:translateY(-50%);width:max-content;box-sizing:border-box;overflow:hidden;user-select:none;touch-action:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,${isLightSurface ? '0.18' : '0.4'}));`;

  const chipGroup = document.createElement('span');
  chipGroup.style.cssText = 'display:inline-flex;align-items:stretch;';

  const volumeChip = document.createElement('span');
  volumeChip.className = 'rtx-trade-chip rtx-trade-chip--volume';
  volumeChip.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 7px;background-color:${sideColor};border:1px solid ${sideColor};color:#fff;${CHIP_FONT}white-space:nowrap;box-sizing:border-box;flex:0 0 auto;`;
  const volumeText = document.createElement('span');
  bindChartUiTranslation(volumeText, () => {
    volumeText.textContent = tr('{{value0}} lots', { value0: formatVolumeLots(volume) });
  });
  const volumeArrow = document.createElement('span');
  volumeArrow.style.cssText = 'display:inline-flex;align-items:center;';
  volumeArrow.innerHTML = sideArrowSvg(side);
  volumeChip.appendChild(volumeText);
  volumeChip.appendChild(volumeArrow);

  const darkMetricBackground = isLightSurface
    ? undefined
    : TRADE_CONTROL_DARK_ENTRY_METRIC_COLORS[side];
  const pips = createMetricChip('pips', 'Pips:', '—', surface, sideColor, darkMetricBackground);
  const money = createMetricChip('money', `${currencyLabel}:`, '—', surface, sideColor, darkMetricBackground);

  chipGroup.appendChild(volumeChip);
  chipGroup.appendChild(pips.chip);
  chipGroup.appendChild(money.chip);

  const buttonGroup = document.createElement('span');
  buttonGroup.className = 'rtx-trade-control-actions';
  buttonGroup.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-left:6px;';
  const emitAction = (action: ChartPositionActionType) => {
    onAction?.(action);
    dispatchChartPositionAction({ action, ticket, symbol });
  };
  if (onShare) {
    buttonGroup.appendChild(createControlButton('share', 'Copy trade share link', shareSvg, isLightSurface ? '#5f6b7a' : TRADE_CONTROL_SHARE_COLOR, isLightSurface ? '#64748b' : TRADE_CONTROL_SHARE_HOVER_COLOR, onShare));
  }
  buttonGroup.appendChild(createControlButton('reverse', 'Reverse position (open the opposite side)', reverseSvg, TRADE_CONTROL_ACTION_COLOR, actionHoverColor, () => emitAction('reverse')));
  buttonGroup.appendChild(createControlButton('double', 'Double position (open the same trade again)', doubleSvg, TRADE_CONTROL_ACTION_COLOR, actionHoverColor, () => emitAction('double')));
  buttonGroup.appendChild(createControlButton('close', 'Close position', closeSvg, TRADE_CONTROL_ACTION_COLOR, actionHoverColor, () => emitAction('close')));

  root.appendChild(chipGroup);
  root.appendChild(buttonGroup);
  const actionTitles = {
    share: () => `${tr('Copy')} · ${tr('Trade')} URL`,
    reverse: () => `${tr('Close position')} · ${tr('New Order')}: ${tr(side === 'BUY' ? 'SELL' : 'BUY')} ${tr('{{value0}} lots', { value0: formatVolumeLots(volume) })}`,
    double: () => `${tr('New Order')}: ${tr(side)} ${tr('{{value0}} lots', { value0: formatVolumeLots(volume) })}`,
    close: () => tr('Close position'),
  };
  for (const [action, getTitle] of Object.entries(actionTitles)) {
    const button = buttonGroup.querySelector<HTMLButtonElement>(`.rtx-trade-control-btn--${action}`);
    if (button) bindChartUiTranslation(button, () => {
      button.title = getTitle();
      button.setAttribute('aria-label', button.title);
    });
  }

  let lastPipsText = '';
  let lastMoneyText = '';
  const setLiveMetrics = (livePips: number | null, liveMoney: number | null) => {
    const pipsText = formatPipsLabel(livePips);
    if (pipsText !== lastPipsText) {
      lastPipsText = pipsText;
      pips.valueEl.textContent = pipsText;
    }
    const moneyText = formatMoneyLabel(liveMoney);
    if (moneyText !== lastMoneyText) {
      lastMoneyText = moneyText;
      money.valueEl.textContent = moneyText;
    }
  };

  return { root, setLiveMetrics };
};

export interface TradeLevelControlBarOptions {
  tradeKey: string;
  role: ChartTradeLevelRole;
  side: ChartTradeSide;
  label: string;
  pips: number | null;
  money: number | null;
  isLightSurface: boolean;
  leftInset: number;
  currencyLabel?: string;
  title?: string;
  onRemove: () => void;
}

/**
 * `[SL][Pips: x][USD: y][✕]` bar anchored on an existing SL/TP line. The
 * chips are the drag handle for repositioning; ✕ removes the level.
 */
export const createTradeLevelControlBar = (options: TradeLevelControlBarOptions): HTMLDivElement => {
  const {
    tradeKey, role, side, label, pips, money, isLightSurface, leftInset,
    currencyLabel = 'USD', title, onRemove,
  } = options;
  const sideColor = (isLightSurface ? TRADE_CONTROL_LIGHT_SIDE_COLORS : TRADE_CONTROL_SIDE_COLORS)[side];
  const surface = getTradeControlSurface(isLightSurface);

  const root = document.createElement('div');
  root.className = `rtx-trade-level-badge rtx-trade-controls rtx-trade-controls--level rtx-trade-controls--${role.toLowerCase()}`;
  root.dataset.tradeKey = tradeKey;
  root.dataset.role = role;
  root.dataset.leftInset = String(leftInset);
  root.dataset.display = 'inline-flex';
  if (title) root.title = title;
  root.style.cssText = `position:absolute;left:${leftInset}px;display:none;align-items:center;z-index:21;pointer-events:auto;cursor:grab;transform:translateY(-50%);width:max-content;box-sizing:border-box;overflow:hidden;user-select:none;touch-action:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,${isLightSurface ? '0.18' : '0.4'}));`;

  const roleChip = document.createElement('span');
  roleChip.className = 'rtx-trade-chip rtx-trade-chip--role';
  roleChip.style.cssText = `display:inline-flex;align-items:center;padding:2px 6px;background-color:${surface.chipBackground};border:1px solid ${sideColor};color:${surface.chipText};${CHIP_FONT}white-space:nowrap;box-sizing:border-box;flex:0 0 auto;`;
  const roleText = document.createElement('span');
  bindChartUiTranslation(roleText, () => { roleText.textContent = tr(label); });
  roleChip.appendChild(roleText);

  const pipsChip = createMetricChip('pips', 'Pips:', formatPipsLabel(pips), surface, sideColor);
  const moneyChip = createMetricChip('money', `${currencyLabel}:`, formatMoneyLabel(money), surface, sideColor);

  const removeTitle = role === 'SL' ? 'Remove Stop Loss' : 'Remove Take Profit';
  const removeButton = createControlButton('remove', removeTitle, closeSvg, sideColor, sideColor, onRemove);
  bindChartUiTranslation(removeButton, () => {
    removeButton.title = tr('Delete {{value0}}', { value0: tr(role === 'SL' ? 'Stop loss' : 'Take profit') });
    removeButton.setAttribute('aria-label', removeButton.title);
  });
  removeButton.style.width = '18px';
  removeButton.style.height = '18px';
  removeButton.style.marginLeft = '4px';

  root.appendChild(roleChip);
  root.appendChild(pipsChip.chip);
  root.appendChild(moneyChip.chip);
  root.appendChild(removeButton);
  return root;
};

export interface DockedLevelChipOptions {
  tradeKey: string;
  role: ChartTradeLevelRole;
  label: string;
  isLightSurface: boolean;
  leftInset: number;
  title?: string;
}

/**
 * Small `[SL]` / `[TP]` handle docked above/below the entry bar while the
 * position has no such level yet. Dragging it creates the level (existing
 * overlay drag logic picks it up via the badge class + role dataset).
 */
export const createDockedLevelChip = (options: DockedLevelChipOptions): HTMLDivElement => {
  const { tradeKey, role, label, isLightSurface, leftInset, title } = options;
  const surface = getTradeControlSurface(isLightSurface);

  const root = document.createElement('div');
  root.className = `rtx-trade-level-badge rtx-trade-controls rtx-trade-dock-chip rtx-trade-dock-chip--${role.toLowerCase()}`;
  root.dataset.tradeKey = tradeKey;
  root.dataset.role = role;
  root.dataset.leftInset = String(leftInset);
  root.dataset.display = 'inline-flex';
  bindChartUiTranslation(root, () => {
    root.title = title ?? `${tr('Add')} · ${tr(role === 'SL' ? 'Stop loss' : 'Take profit')}`;
  });
  root.style.cssText = `position:absolute;left:${leftInset}px;display:none;align-items:center;padding:1px 7px;background-color:${surface.dockBackground};border:1px solid ${surface.dockBorder};color:${surface.dockText};${CHIP_FONT}white-space:nowrap;z-index:21;pointer-events:auto;cursor:grab;transform:translateY(-50%);width:max-content;box-sizing:border-box;user-select:none;touch-action:none;`;
  if (isLightSurface) {
    root.addEventListener('mouseenter', () => { root.style.borderColor = '#64748b'; });
    root.addEventListener('mouseleave', () => { root.style.borderColor = surface.dockBorder; });
  }

  const text = document.createElement('span');
  bindChartUiTranslation(text, () => { text.textContent = label.replace(role, tr(role)); });
  root.appendChild(text);
  return root;
};

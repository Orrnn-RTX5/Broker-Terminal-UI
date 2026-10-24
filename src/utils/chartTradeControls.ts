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

import { getExposureContractSize } from '../components/BottomDock.exposure';
import { translateUi as tr } from '../hooks/useUiTranslation';
import { getPipSizeFromDigits } from './symbolUtils';

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
// Modify-position dialog event (consumed by the persistent App shell)
// ---------------------------------------------------------------------------

export const CHART_POSITION_MODIFY_EVENT = 'rtx:chart-position-modify';
export const CHART_PENDING_ORDER_CANCEL_EVENT = 'rtx:chart-pending-order-cancel';
export const CHART_TRADE_LEVEL_CLICK_SLOP_PX = 4;

export interface ChartPositionModifyDetail {
  ticket: number;
  symbol: string;
  sessionScope: string;
  kind?: 'position' | 'pending-order';
}

export const dispatchChartPositionModify = (detail: ChartPositionModifyDetail): void => {
  if (typeof window === 'undefined') return;
  const ticket = Number(detail?.ticket);
  const symbol = String(detail?.symbol ?? '').trim();
  const sessionScope = String(detail?.sessionScope ?? '').trim();
  if (!Number.isSafeInteger(ticket) || ticket <= 0 || !symbol || !sessionScope) return;
  window.dispatchEvent(new CustomEvent<ChartPositionModifyDetail>(CHART_POSITION_MODIFY_EVENT, {
    detail: { ticket, symbol, sessionScope },
  }));
};

export interface ChartPositionIdentity {
  id?: unknown;
  ticket?: unknown;
  symbol?: unknown;
}

export const resolveChartPositionModifyTarget = <T extends ChartPositionIdentity>(
  detail: ChartPositionModifyDetail | null | undefined,
  currentSessionScope: string,
  positions: readonly T[],
): T | null => {
  const ticket = Number(detail?.ticket);
  const symbol = String(detail?.symbol ?? '').trim().toUpperCase();
  if (
    !Number.isSafeInteger(ticket)
    || ticket <= 0
    || !symbol
    || !detail?.sessionScope
    || detail.sessionScope !== currentSessionScope
  ) return null;

  return positions.find(position => (
    Number(position.id ?? position.ticket) === ticket
    && String(position.symbol ?? '').trim().toUpperCase() === symbol
  )) ?? null;
};

/**
 * Latches once a level gesture exceeds click slop. Returning to the starting
 * point must remain a drag so a completed drag can never open the dialog.
 */
export const hasChartTradeLevelGestureDragged = (
  pointerDownY: number,
  currentY: number,
  alreadyDragged = false,
): boolean => alreadyDragged
  || !Number.isFinite(pointerDownY)
  || !Number.isFinite(currentY)
  || Math.abs(currentY - pointerDownY) >= CHART_TRADE_LEVEL_CLICK_SLOP_PX;

// ---------------------------------------------------------------------------
// Pip / money math
// ---------------------------------------------------------------------------

/**
 * Pip size from broker digits, via the terminal's single pip rule
 * (getPipSizeFromDigits: 5 -> 0.0001, 3 -> 0.01, 2 -> 0.01), so the chart
 * shows the same pip count as the spread and order panels. Null when the
 * symbol's precision is unknown (no guessed pip).
 */
export const getPipSize = (digits: number | null | undefined): number | null => getPipSizeFromDigits(digits);

/** Signed pip distance from entry to `price` in the direction of the trade. */
export const computeSignedPips = (
  side: ChartTradeSide,
  entryPrice: number,
  price: number,
  digits: number | null | undefined,
): number | null => {
  const pipSize = getPipSize(digits);
  if (pipSize === null) return null;
  if (!Number.isFinite(entryPrice) || !Number.isFinite(price)) return Number.NaN;
  const diff = side === 'SELL' ? entryPrice - price : price - entryPrice;
  return diff / pipSize;
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
  // Broker contract size only (caller row, then catalog); unknown -> no
  // estimate rather than a symbol-name lot multiplier.
  const contractSize = getExposureContractSize({ symbol, contractSize: input.contractSize });
  if (contractSize === null) return null;
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

// Chart backgrounds can be customized independently of the app theme. Keep
// the dark position controls on an opaque charcoal surface so chart lines do
// not show through the labels, and reserve color for trade meaning.
export const DARK_CHART_TRADE_COLORS = {
  surface: '#191a1e',
  border: '#94a3b8',
  divider: '#4b5563',
  action: '#e5e7eb',
  text: '#ffffff',
  actionIcon: '#f4f4f6',
  actionHover: '#292a30',
  buy: '#72b0ff',
  sell: '#ff8589',
  buyBackground: '#191a1e',
  sellBackground: '#191a1e',
  tp: '#4ade80',
  sl: '#fbbf24',
  profit: '#72b0ff',
  loss: '#ff8589',
} as const;

// Small overlay labels need readable side colors on softly tinted surfaces.
// Chart backgrounds remain authoritative when choosing the light palette.
export const LIGHT_CHART_TRADE_COLORS = {
  surface: '#ffffff',
  border: '#52647b',
  divider: '#b0bdce',
  action: '#172033',
  actionHover: '#e2e8f0',
  buy: '#153eaa',
  sell: '#981b24',
  tp: '#05564f',
  sl: '#664300',
  profit: '#153eaa',
  loss: '#981b24',
} as const;

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
      chipText: '#182230',
      dockBackground: '#ffffff',
      dockBorder: '#697b91',
      dockText: '#334155',
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

// Use the terminal's 16-unit outline grid at a legible optical size inside
// the compact buttons. Keep all four actions on the same stroke and baseline.
const webActionSvg = (path: string): string => `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none"><path d="${path}"/></svg>`;
const webShareSvg = webActionSvg('M6 5.5H4.5a2.5 2.5 0 0 0 0 5H6M10 5.5h1.5a2.5 2.5 0 0 1 0 5H10M5.5 8h5');
const webDoubleSvg = webActionSvg('M11 2H3a1 1 0 0 0-1 1v8M6 5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z');
const webReverseSvg = webActionSvg('M3.5 13V7.6a3.6 3.6 0 0 1 7.2 0v3.6M8.5 9l2.2 2.4L12.9 9');
const webCloseSvg = webActionSvg('M4 4l8 8M12 4l-8 8');

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
  plainTextColor?: string,
): HTMLButtonElement => {
  if (plainTextColor) {
    background = 'transparent';
    hoverBackground = 'rgba(127,127,127,0.15)';
    iconSvg = iconSvg.replaceAll('#fff', 'currentColor');
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `rtx-trade-control-btn rtx-trade-control-btn--${variant}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = iconSvg;
  button.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;background-color:${background};border:1px solid rgba(255,255,255,0.32);border-radius:2px;cursor:pointer;pointer-events:auto;box-sizing:border-box;flex:0 0 auto;`;
  if (plainTextColor) {
    button.style.color = plainTextColor;
    button.style.borderColor = 'transparent';
  }
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
  kind?: 'position' | 'pending';
  orderTypeLabel?: string;
  volume: number;
  isLightSurface: boolean;
  leftInset: number;
  /** Show entry information directly on the line without a filled ribbon. */
  plainLabel?: boolean;
  chartBackground?: string;
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
  const actionHoverColor = isLightSurface ? LIGHT_CHART_TRADE_COLORS.buy : TRADE_CONTROL_ACTION_HOVER_COLOR;
  const plainSideColor = isLightSurface
    ? (side === 'BUY' ? LIGHT_CHART_TRADE_COLORS.buy : LIGHT_CHART_TRADE_COLORS.sell)
    : (side === 'BUY' ? DARK_CHART_TRADE_COLORS.buy : DARK_CHART_TRADE_COLORS.sell);
  const plainNeutralColor = isLightSurface ? '#111827' : DARK_CHART_TRADE_COLORS.text;
  const plainBackground = isLightSurface
    ? LIGHT_CHART_TRADE_COLORS.surface
    : DARK_CHART_TRADE_COLORS.surface;
  const plainBorderColor = isLightSurface ? LIGHT_CHART_TRADE_COLORS.border : DARK_CHART_TRADE_COLORS.border;
  const plainActionColor = isLightSurface ? LIGHT_CHART_TRADE_COLORS.action : DARK_CHART_TRADE_COLORS.action;

  const root = document.createElement('div');
  root.className = 'rtx-trade-level-badge rtx-trade-controls rtx-trade-controls--entry';
  root.dataset.tradeKey = tradeKey;
  root.dataset.role = 'ENTRY';
  root.dataset.leftInset = String(leftInset);
  // The overlay relayout restores this display mode when unhiding the node.
  root.dataset.display = 'inline-flex';
  if (title) root.title = title;
  root.style.cssText = `position:absolute;left:${leftInset}px;display:none;align-items:center;z-index:22;pointer-events:auto;cursor:default;transform:translateY(-50%);width:max-content;box-sizing:border-box;overflow:hidden;user-select:none;touch-action:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,${isLightSurface ? '0.18' : '0.4'}));`;

  const chipGroup = document.createElement('span');
  chipGroup.style.cssText = 'display:inline-flex;align-items:stretch;';

  const volumeChip = document.createElement('span');
  volumeChip.className = 'rtx-trade-chip rtx-trade-chip--volume';
  volumeChip.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 7px;background-color:${sideColor};border:1px solid ${sideColor};color:#fff;${CHIP_FONT}white-space:nowrap;box-sizing:border-box;flex:0 0 auto;`;
  if (options.plainLabel) {
    const sideText = document.createElement('span');
    sideText.className = 'rtx-trade-side-label';
    sideText.style.color = 'inherit';
    sideText.style.fontWeight = '600';
    sideText.style.letterSpacing = '0.02em';
    sideText.style.setProperty('--rtx-type-weight', '600');
    bindChartUiTranslation(sideText, () => {
      sideText.textContent = `${tr(options.orderTypeLabel || side)} `;
    });
    volumeChip.appendChild(sideText);
  }
  const volumeText = document.createElement('span');
  bindChartUiTranslation(volumeText, () => {
    const lots = tr('{{value0}} lots', { value0: formatVolumeLots(volume) });
    volumeText.textContent = options.plainLabel ? formatVolumeLots(volume) : lots;
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

  if (options.plainLabel) {
    root.classList.add('rtx-trade-controls--plain');
    root.style.setProperty('--rtx-type-size', 'max(12px, calc(var(--rtx-ui-font-size, 14px) - 2px))');
    root.style.fontSize = 'var(--rtx-type-size, 12px)';
    root.style.setProperty('--rtx-trade-entry-weight', '400');
    root.style.setProperty('--rtx-type-weight', 'var(--rtx-trade-entry-weight)');
    root.style.fontWeight = '400';
    root.style.setProperty('--rtx-type-family', 'var(--rtx-ui-font-family, "Segoe UI", Tahoma, Arial, sans-serif)');
    root.style.fontFamily = 'var(--rtx-ui-font-family, "Segoe UI", Tahoma, Arial, sans-serif)';
    root.style.lineHeight = '16px';
    root.style.filter = 'none';
    root.style.overflow = 'hidden';
    root.style.transform = 'translateY(-50%)';
    root.style.height = 'auto';
    root.style.minHeight = '18px';
    root.style.flexWrap = 'wrap';
    root.style.gap = '0 3px';
    // Keep the active-position strip beside the chart's left edge. The chart
    // relayout only overrides controls explicitly marked as right-aligned.
    root.dataset.align = 'left';
    root.tabIndex = 0;
    // One opaque surface keeps chart lines out of the gaps between controls.
    // A flat one-pixel stroke supplies the border without changing drag geometry.
    root.style.backgroundColor = plainBackground;
    root.style.borderRadius = '3px';
    root.style.boxShadow = isLightSurface
      ? `0 0 0 1px ${plainBorderColor}, 0 2px 6px rgba(15, 23, 42, 0.16)`
      : `0 0 0 1px ${plainBorderColor}, 0 2px 10px rgba(0, 0, 0, 0.65)`;
    root.style.textShadow = 'none';
    chipGroup.className = 'rtx-trade-primary';
    chipGroup.style.alignItems = 'center';
    chipGroup.style.border = '1px solid transparent';
    chipGroup.style.borderRadius = '0';
    chipGroup.style.height = '18px';
    chipGroup.style.boxSizing = 'border-box';
    chipGroup.style.overflow = 'hidden';
    chipGroup.style.minWidth = '0';
    chipGroup.style.padding = '0 2px 0 7px';
    chipGroup.style.gap = '7px';
    chipGroup.style.backgroundColor = plainBackground;
    for (const chip of [volumeChip, pips.chip, money.chip]) {
      chip.style.backgroundColor = 'transparent';
      chip.style.border = '0';
      chip.style.color = plainNeutralColor;
      chip.style.fontFamily = 'var(--rtx-ui-font-family, "Segoe UI", Tahoma, Arial, sans-serif)';
      chip.style.fontSize = 'inherit';
      chip.style.fontWeight = '400';
      chip.style.setProperty('--rtx-type-weight', '400');
      chip.style.lineHeight = '16px';
      chip.style.letterSpacing = 'normal';
      chip.style.fontVariantNumeric = 'tabular-nums';
      chip.style.padding = '0';
      chip.style.marginLeft = '0';
      chip.style.height = '16px';
    }
    for (const metric of [pips.chip, money.chip]) {
      const label = metric.firstElementChild as HTMLElement;
      label.style.fontWeight = '400';
      label.style.setProperty('--rtx-type-weight', '400');
      label.style.opacity = '1';
    }
    // Compact entry information, with the account currency after the P/L.
    pips.chip.style.display = 'none';
    volumeChip.style.backgroundColor = plainBackground;
    volumeChip.style.color = plainSideColor;
    volumeChip.style.fontWeight = '400';
    volumeChip.style.setProperty('--rtx-type-weight', '400');
    // Explicit flex gap keeps side/volume and value/currency visually separated
    // because CSS Flexbox collapses leading/trailing spaces inside flex items.
    volumeChip.style.gap = '4px';
    volumeText.style.color = plainNeutralColor;
    volumeText.style.fontWeight = '400';
    volumeText.style.setProperty('--rtx-type-weight', '400');
    money.chip.style.gap = '4px';
    money.valueEl.style.fontWeight = '600';
    money.valueEl.style.setProperty('--rtx-type-weight', '600');
    const currencySuffix = money.chip.firstElementChild as HTMLElement;
    currencySuffix.textContent = ` ${currencyLabel}`;
    currencySuffix.style.color = plainNeutralColor;
    currencySuffix.style.fontSize = 'inherit';
    currencySuffix.style.fontWeight = '400';
    currencySuffix.style.setProperty('--rtx-type-size', 'inherit');
    currencySuffix.style.setProperty('--rtx-type-weight', '400');
    money.chip.appendChild(currencySuffix);
    volumeArrow.style.display = 'none';
  }

  const buttonGroup = document.createElement('span');
  buttonGroup.className = 'rtx-trade-control-actions';
  buttonGroup.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-left:6px;flex:0 0 auto;';
  if (options.plainLabel) {
    buttonGroup.style.gap = '3px';
    buttonGroup.style.marginLeft = '0';
  }
  const emitAction = (action: ChartPositionActionType) => {
    onAction?.(action);
    if (options.kind !== 'pending') {
      dispatchChartPositionAction({ action, ticket, symbol });
    }
  };
  const plainTextColor = options.plainLabel ? plainActionColor : undefined;
  if (onShare && options.kind !== 'pending') {
    buttonGroup.appendChild(createControlButton('share', 'Copy trade share link', options.plainLabel ? webShareSvg : shareSvg, isLightSurface ? '#5f6b7a' : TRADE_CONTROL_SHARE_COLOR, isLightSurface ? '#64748b' : TRADE_CONTROL_SHARE_HOVER_COLOR, onShare, plainTextColor));
  }
  const reverseBtn = createControlButton('reverse', 'Reverse position (open the opposite side)', options.plainLabel ? webReverseSvg : reverseSvg, TRADE_CONTROL_ACTION_COLOR, actionHoverColor, () => emitAction('reverse'), plainTextColor);
  const doubleBtn = createControlButton('double', 'Double position (open the same trade again)', options.plainLabel ? webDoubleSvg : doubleSvg, TRADE_CONTROL_ACTION_COLOR, actionHoverColor, () => emitAction('double'), plainTextColor);
  if (options.kind === 'pending') {
    reverseBtn.style.display = 'none';
    doubleBtn.style.display = 'none';
  }
  buttonGroup.appendChild(reverseBtn);
  buttonGroup.appendChild(doubleBtn);
  buttonGroup.appendChild(createControlButton('close', options.kind === 'pending' ? 'Cancel pending order' : 'Close position', options.plainLabel ? webCloseSvg : closeSvg, TRADE_CONTROL_ACTION_COLOR, actionHoverColor, () => emitAction('close'), plainTextColor));

  if (options.plainLabel) {
    for (const button of buttonGroup.querySelectorAll('button')) {
      const isClose = button.classList.contains('rtx-trade-control-btn--close');
      const restingBackground = 'transparent';
      const restingColor = isLightSurface || isClose ? plainActionColor : DARK_CHART_TRADE_COLORS.actionIcon;
      button.style.width = '16px';
      button.style.height = '16px';
      button.style.color = restingColor;
      button.style.border = '0';
      button.style.borderRadius = '0';
      button.style.backgroundColor = restingBackground;
      button.querySelector('svg')?.setAttribute('stroke-width', '1.6');
      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = isLightSurface
          ? (isClose ? '#fff0f1' : LIGHT_CHART_TRADE_COLORS.actionHover)
          : isClose ? '#3b2529' : DARK_CHART_TRADE_COLORS.actionHover;
        if (isClose) button.style.color = isLightSurface ? LIGHT_CHART_TRADE_COLORS.loss : DARK_CHART_TRADE_COLORS.loss;
      });
      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = restingBackground;
        button.style.color = restingColor;
      });
    }
    const reverseButton = buttonGroup.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--reverse')!;
    const doubleButton = buttonGroup.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--double')!;
    const closeButton = buttonGroup.querySelector<HTMLButtonElement>('.rtx-trade-control-btn--close')!;
    buttonGroup.insertBefore(doubleButton, reverseButton);
    const secondaryGroup = document.createElement('span');
    secondaryGroup.className = 'rtx-trade-secondary';
    secondaryGroup.style.cssText = `display:inline-flex;align-items:center;gap:2px;height:18px;padding:0 1px;box-sizing:border-box;border:1px solid transparent;background-color:${plainBackground};overflow:hidden;`;
    for (const button of Array.from(buttonGroup.querySelectorAll<HTMLButtonElement>('button'))) {
      if (button === closeButton) continue;
      secondaryGroup.appendChild(button);
    }
    buttonGroup.prepend(secondaryGroup);
    const brackets = document.createElement('span');
    brackets.className = 'rtx-trade-brackets';
    brackets.style.cssText = `display:inline-flex;align-items:center;gap:3px;height:18px;box-sizing:border-box;border:1px solid transparent;background-color:${plainBackground};padding:0 2px 0 1px;`;
    buttonGroup.appendChild(brackets);
    chipGroup.appendChild(closeButton);
    root.appendChild(buttonGroup);
    root.appendChild(chipGroup);
  } else {
    root.appendChild(chipGroup);
    root.appendChild(buttonGroup);
  }
  const actionTitles = {
    share: () => `${tr('Copy')} · ${tr('Trade')} URL`,
    reverse: () => `${tr('Close position')} · ${tr('New Order')}: ${tr(side === 'BUY' ? 'SELL' : 'BUY')} ${tr('{{value0}} lots', { value0: formatVolumeLots(volume) })}`,
    double: () => `${tr('New Order')}: ${tr(side)} ${tr('{{value0}} lots', { value0: formatVolumeLots(volume) })}`,
    close: () => tr('Close position'),
  };
  for (const [action, getTitle] of Object.entries(actionTitles)) {
    const button = root.querySelector<HTMLButtonElement>(`.rtx-trade-control-btn--${action}`);
    if (button) bindChartUiTranslation(button, () => {
      button.title = getTitle();
      button.setAttribute('aria-label', button.title);
    });
  }

  let lastPipsText = '';
  let lastMoneyText = '';
  const updateMetricColor = (chip: HTMLElement, value: number | null, decimals: number) => {
    if (!options.plainLabel) return;
    const displayedValue = value != null && Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;
    chip.style.color = displayedValue > 0
      ? (isLightSurface ? LIGHT_CHART_TRADE_COLORS.profit : DARK_CHART_TRADE_COLORS.profit)
      : displayedValue < 0
        ? (isLightSurface ? LIGHT_CHART_TRADE_COLORS.loss : DARK_CHART_TRADE_COLORS.loss)
        : plainNeutralColor;
  };
  const setLiveMetrics = (livePips: number | null, liveMoney: number | null) => {
    const pipsText = formatPipsLabel(livePips);
    if (pipsText !== lastPipsText) {
      lastPipsText = pipsText;
      pips.valueEl.textContent = pipsText;
      updateMetricColor(pips.chip, livePips, 1);
    }
    const positiveMoney = liveMoney != null && Number.isFinite(liveMoney) && Number(liveMoney.toFixed(2)) > 0;
    const moneyText = `${options.plainLabel && positiveMoney ? '+' : ''}${formatMoneyLabel(liveMoney)}`;
    if (moneyText !== lastMoneyText) {
      lastMoneyText = moneyText;
      money.valueEl.textContent = moneyText;
      updateMetricColor(money.chip, liveMoney, 2);
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
  hoverDetails?: { entryPrice: number; levelPrice: number; digits: number; tickSize: number };
  chartBackground?: string;
  onHoverChange?: (active: boolean) => void;
}

let tradeLevelTooltipId = 0;
const tradeLevelHoverBindings = new WeakMap<HTMLElement, { show: () => void; hide: () => void }>();

/** Share the label's feedback with its full-width, draggable price line. */
export const bindTradeLevelHoverTarget = (label: HTMLElement, target: HTMLElement): void => {
  const binding = tradeLevelHoverBindings.get(label);
  if (!binding) return;
  target.removeAttribute('title');
  target.addEventListener('mouseenter', binding.show);
  target.addEventListener('mouseleave', binding.hide);
  target.addEventListener('pointerdown', binding.hide);
};

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
  root.style.cssText = `position:absolute;left:${leftInset}px;display:none;align-items:center;z-index:21;pointer-events:auto;cursor:default;transform:translateY(-50%);width:max-content;box-sizing:border-box;overflow:hidden;user-select:none;touch-action:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,${isLightSurface ? '0.18' : '0.4'}));`;

  const roleChip = document.createElement('span');
  roleChip.className = 'rtx-trade-chip rtx-trade-chip--role';
  roleChip.style.cssText = `display:inline-flex;align-items:center;padding:2px 6px;background-color:${surface.chipBackground};border:1px solid ${sideColor};color:${surface.chipText};${CHIP_FONT}white-space:nowrap;box-sizing:border-box;flex:0 0 auto;`;
  const roleText = document.createElement('span');
  roleText.className = 'rtx-trade-level-drag-label';
  roleText.style.cursor = 'grab';
  bindChartUiTranslation(roleText, () => { roleText.textContent = tr(label); });
  roleChip.appendChild(roleText);

  const pipsChip = createMetricChip('pips', 'Pips:', formatPipsLabel(pips), surface, sideColor);
  const moneyChip = createMetricChip('money', `${currencyLabel}:`, formatMoneyLabel(money), surface, sideColor);

  const removeTitle = role === 'SL' ? 'Remove Stop Loss' : 'Remove Take Profit';
  const levelAccent = role === 'TP'
    ? (isLightSurface ? LIGHT_CHART_TRADE_COLORS.tp : DARK_CHART_TRADE_COLORS.tp)
    : (isLightSurface ? LIGHT_CHART_TRADE_COLORS.sl : DARK_CHART_TRADE_COLORS.sl);
  const removeButton = createControlButton('remove', removeTitle, closeSvg, sideColor, sideColor, onRemove, options.hoverDetails ? levelAccent : undefined);
  bindChartUiTranslation(removeButton, () => {
    removeButton.title = tr('Delete {{value0}}', { value0: tr(role === 'SL' ? 'Stop loss' : 'Take profit') });
    removeButton.setAttribute('aria-label', removeButton.title);
  });
  removeButton.style.width = '24px';
  removeButton.style.height = '24px';
  removeButton.style.marginLeft = '4px';

  root.appendChild(roleChip);
  if (!options.hoverDetails) root.appendChild(pipsChip.chip);
  root.appendChild(moneyChip.chip);
  root.appendChild(removeButton);
  if (options.hoverDetails) {
    root.dataset.align = 'right';
    root.style.setProperty('--rtx-type-size', 'max(12px, calc(var(--rtx-ui-font-size, 14px) - 2px))');
    root.style.setProperty('--rtx-type-weight', '500');
    root.style.filter = 'none';
    root.style.minHeight = '18px';
    root.style.backgroundColor = isLightSurface
      ? (options.chartBackground ?? '#fafbfc')
      : DARK_CHART_TRADE_COLORS.surface;
    root.style.border = `1px dotted ${levelAccent}`;
    root.style.borderRadius = '3px';
    root.style.boxShadow = isLightSurface
      ? '0 1px 4px rgba(15, 23, 42, 0.14)'
      : '0 2px 8px rgba(0, 0, 0, 0.58)';
    removeButton.style.width = '16px';
    removeButton.style.height = '16px';
    removeButton.style.marginLeft = '2px';
    for (const chip of [roleChip, pipsChip.chip, moneyChip.chip]) {
      chip.style.backgroundColor = 'transparent';
      chip.style.border = '0';
      chip.style.color = levelAccent;
      chip.style.fontFamily = 'var(--rtx-ui-font-family, "Segoe UI", Tahoma, Arial, sans-serif)';
      chip.style.fontWeight = '500';
      chip.style.fontSize = '12px';
      chip.style.setProperty('--rtx-type-size', '12px');
      chip.style.setProperty('--rtx-type-weight', '500');
      chip.style.padding = '0 5px';
      chip.style.lineHeight = '16px';
      chip.style.height = '16px';
      const label = chip.firstElementChild as HTMLElement;
      label.style.fontWeight = '500';
      label.style.setProperty('--rtx-type-weight', '500');
      label.style.opacity = '1';
    }
    roleChip.style.fontWeight = '600';
    roleChip.style.setProperty('--rtx-type-weight', '600');
    roleText.style.fontWeight = '600';
    roleText.style.setProperty('--rtx-type-weight', '600');
    moneyChip.valueEl.style.fontWeight = '600';
    moneyChip.valueEl.style.setProperty('--rtx-type-weight', '600');
    const handle = document.createElement('span');
    handle.className = 'rtx-trade-level-hover-handle';
    handle.style.cssText = 'position:absolute;right:-12px;top:50%;width:6px;height:6px;transform:translateY(-50%);border:1px solid #5b9bff;border-radius:50%;background:#91baff;box-shadow:0 0 0 3px rgba(91,155,255,0.16);pointer-events:none;display:none;';
    root.appendChild(handle);
    const { entryPrice, levelPrice, digits, tickSize } = options.hoverDetails;
    const change = side === 'SELL' ? entryPrice - levelPrice : levelPrice - entryPrice;
    const percent = entryPrice > 0 ? change / entryPrice * 100 : 0;
    const ticks = tickSize > 0 ? change / tickSize : 0;
    const signed = (value: number, decimals: number) => {
      const rounded = Number(value.toFixed(decimals));
      return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
    };
    const tooltip = document.createElement('span');
    tooltip.className = 'rtx-trade-level-tooltip';
    tooltip.id = `rtx-level-tooltip-${++tradeLevelTooltipId}`;
    tooltip.setAttribute('role', 'tooltip');
    Object.assign(tooltip.style, {
      position: 'absolute', bottom: 'calc(100% + 8px)', left: '0', display: 'none',
      width: 'max-content', maxWidth: '280px', padding: '5px 8px', borderRadius: '2px',
      backgroundColor: '#2a2a2a', color: '#ffffff', fontFamily: 'Arial, sans-serif',
      fontSize: '12px', fontWeight: '400', lineHeight: '17px', whiteSpace: 'normal',
      pointerEvents: 'none', textAlign: 'left', boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
    });
    const summary = document.createElement('span');
    const price = document.createElement('span');
    summary.style.display = 'block';
    price.style.display = 'block';
    const arrow = document.createElement('span');
    arrow.style.cssText = 'position:absolute;top:100%;left:18px;border:5px solid transparent;border-top-color:#2a2a2a;';
    tooltip.append(summary, price, arrow);
    root.appendChild(tooltip);
    root.style.overflow = 'visible';
    root.tabIndex = 0;
    root.removeAttribute('title');
    root.setAttribute('aria-describedby', tooltip.id);
    bindChartUiTranslation(tooltip, () => {
      summary.textContent = `${tr(role === 'SL' ? 'Stop loss' : 'Take profit')} ${signed(percent, 2)}%  ${signed(ticks, 0)} ${tr('ticks')}`;
      price.textContent = `${tr('Price')} ${levelPrice.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
    });
    const hideTooltip = () => {
      tooltip.style.display = 'none';
      handle.style.display = 'none';
      root.style.borderStyle = 'dotted';
      root.style.zIndex = '21';
      options.onHoverChange?.(false);
    };
    const showTooltip = () => {
      tooltip.style.display = 'block';
      handle.style.display = 'block';
      root.style.borderStyle = 'solid';
      root.style.zIndex = '100';
      options.onHoverChange?.(true);
      tooltip.style.left = '0';
      tooltip.style.bottom = 'calc(100% + 8px)';
      tooltip.style.top = 'auto';
      arrow.style.top = '100%';
      arrow.style.bottom = 'auto';
      arrow.style.borderColor = 'transparent';
      arrow.style.borderTopColor = '#2a2a2a';
      const bounds = root.parentElement?.getBoundingClientRect();
      const rect = tooltip.getBoundingClientRect();
      if (bounds && rect.right > bounds.right - 8) tooltip.style.left = `${Math.min(0, bounds.right - 8 - rect.right)}px`;
      if (bounds && rect.top < bounds.top + 4) {
        tooltip.style.bottom = 'auto';
        tooltip.style.top = 'calc(100% + 8px)';
        arrow.style.top = 'auto';
        arrow.style.bottom = '100%';
        arrow.style.borderTopColor = 'transparent';
        arrow.style.borderBottomColor = '#2a2a2a';
      }
    };
    root.addEventListener('mouseenter', showTooltip);
    root.addEventListener('mouseleave', hideTooltip);
    root.addEventListener('focusin', showTooltip);
    root.addEventListener('focusout', hideTooltip);
    root.addEventListener('pointerdown', hideTooltip);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
    tradeLevelHoverBindings.set(root, { show: showTooltip, hide: hideTooltip });
  }
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
  root.style.cssText = `position:absolute;left:${leftInset}px;display:none;align-items:center;padding:1px 7px;background-color:${surface.dockBackground};border:1px solid ${surface.dockBorder};color:${surface.dockText};${CHIP_FONT}white-space:nowrap;z-index:21;pointer-events:auto;cursor:default;transform:translateY(-50%);width:max-content;box-sizing:border-box;user-select:none;touch-action:none;`;
  if (isLightSurface) {
    root.addEventListener('mouseenter', () => { root.style.borderColor = '#64748b'; });
    root.addEventListener('mouseleave', () => { root.style.borderColor = surface.dockBorder; });
  }

  const text = document.createElement('span');
  text.className = 'rtx-trade-level-drag-label';
  text.style.cursor = 'grab';
  bindChartUiTranslation(text, () => { text.textContent = label.replace(role, tr(role)); });
  root.appendChild(text);
  return root;
};

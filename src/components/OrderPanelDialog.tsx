import { useUiTranslation } from '../hooks/useUiTranslation';
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import {
  resolveDefaultTradeDeviation,
  resolveDefaultTradeVolume,
  useSettingsStore,
  useTradeDefaults,
} from '../store/useSettingsStore';
import { getEffectiveChartColors, useChartSettingsStore } from '../store/useChartSettingsStore';
import { candleAggregationService } from '../services/candleAggregationService';
import { useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import { useLiveOrderBook } from '../hooks/useLiveMarketData';
import {
  getMarketStatusTradeBlockMessage,
  shouldBlockSymbolTrading,
  type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { formatSpreadDisplayWithUnit } from '../utils/spread';
import { RTX_ADVANCED_VIEW_CHANGE_EVENT } from '../utils/advancedViewRootClasses';
import { tradeApi } from '../api/trade';
import { getStoredAccountLogin } from '../api/tradeGateway';
import { buildOrderTicketSymbolOptions } from '../utils/accountSymbolUniverse';
import { resolveSymbolDescription } from '../utils/symbolDescription';
import { resolveSpecDigits } from '../utils/symbolUtils';
import { readRegisteredSymbolPriceSpec, readRegisteredSymbolStopsLevel } from '../services/dailyChangePriceModeRegistry';
import { BrokerLogoImage } from './BrokerLogoImage';
import { BROKER_CHROME_EVENT, getBrokerChrome, type BrokerChromeState } from '../services/brokerPresentation';
import { brokerDisplayName, isBrokerName } from '../services/brokerDisplayName';
import { getLogoUrl, getWebTerminalTitle } from '../hooks/useTerminalTitle';
import { depthExecutionForLevel } from './depthOfMarketModel';
import '../styles/order-panel-dialog.css';

// Symbol display names
const SYMBOL_NAMES: Record<string, string> = {
  EURUSD: 'Euro / US Dollar',
  GBPUSD: 'Pound / US Dollar',
  USDJPY: 'US Dollar / Yen',
  XAUUSD: 'Gold / US Dollar',
  XAGUSD: 'Silver / US Dollar',
  BTCUSD: 'Bitcoin / US Dollar',
  ETHUSD: 'Ethereum / US Dollar',
  AUDUSD: 'Aussie / US Dollar',
  USDCAD: 'US Dollar / CAD',
  USDCHF: 'US Dollar / Franc',
  NZDUSD: 'Kiwi / US Dollar',
  EURJPY: 'Euro / Yen',
  GBPJPY: 'Pound / Yen',
};

export type OrderType =
  | 'Market Execution'
  | 'Limit Order'
  | 'Stop Order'
  | 'Stop Limit Order'
  | 'Buy Limit'
  | 'Sell Limit'
  | 'Buy Stop'
  | 'Sell Stop'
  | 'Buy Stop Limit'
  | 'Sell Stop Limit';

const isLimitOrderType = (type: OrderType): boolean => (
  type === 'Limit Order' || type === 'Buy Limit' || type === 'Sell Limit'
);

const isStopOrderType = (type: OrderType): boolean => (
  type === 'Stop Order' || type === 'Buy Stop' || type === 'Sell Stop'
);

const isStopLimitOrderType = (type: OrderType): boolean => (
  type === 'Stop Limit Order' || type === 'Buy Stop Limit' || type === 'Sell Stop Limit'
);

const alignOrderTypeToSide = (type: OrderType, submitSide: 'buy' | 'sell'): OrderType => {
  const prefix = submitSide === 'buy' ? 'Buy' : 'Sell';
  if (type === 'Buy Limit' || type === 'Sell Limit') return `${prefix} Limit`;
  if (type === 'Buy Stop' || type === 'Sell Stop') return `${prefix} Stop`;
  if (type === 'Buy Stop Limit' || type === 'Sell Stop Limit') return `${prefix} Stop Limit`;
  return type;
};

export type FillPolicy = 'Fill or Kill' | 'Immediate or Cancel' | 'Return';
export type ExpirationType = 'GTC' | 'Today' | 'Specified' | 'Specified day';

interface OrderPanelProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  currentPrice: { bid: number; ask: number };
  onSubmitOrder: (order: any) => Promise<void> | void;
  // Chart prefill (SUI-T10): when provided, the dialog opens with this order
  // type and price instead of blank defaults. Side still follows Buy/Sell.
  initialOrderType?: OrderType;
  initialPrice?: number;
  // Chart entry-point side (ITEM 2 / T10 side preselection): when provided
  // ('BUY'/'SELL'), the Buy/Sell submit path defaults to it while both
  // buttons stay functional. Invalid values are ignored (default flow).
  initialSide?: 'BUY' | 'SELL';
  marketStatus?: NormalizedMarketStatus;
  /**
   * Symbols the logged-in account may trade (its group catalogue). When
   * provided, the symbol dropdown offers only these instead of every quote
   * present in the tick store.
   */
  symbols?: readonly string[];
  /**
   * Broker instrument catalog rows (e.g. useMarketInstruments().symbols).
   * The dialog reads only broker data from them (contract_size, digits,
   * tick_size) for the currently selected symbol. Absent rows = unknown.
   */
  instruments?: readonly OrderPanelInstrumentRow[];
}

/** Broker catalog fields the dialog consumes (subset of MarketInstrument). */
export interface OrderPanelInstrumentRow {
  symbol: string;
  digits?: number;
  tickSize?: number;
  contractSize?: number;
  stops_level?: number;
  stopsLevel?: number;
}

export interface OrderPanelInstrumentConfig {
  /** Broker quote precision, or null when no broker data publishes it. */
  digits: number | null;
  /** Broker tick size, else 10^-digits; null when neither is known. */
  priceStep: number | null;
  /** Broker contract size, or null when the catalog does not publish it. */
  contractSize: number | null;
}

const readPositiveFinite = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const readNonNegativeInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
};

export function resolveInstrumentStopsLevel(
  sym: string,
  instrument?: Partial<OrderPanelInstrumentRow> | null,
  liveTick?: { stops_level?: unknown; stopsLevel?: unknown } | null,
): number | null {
  return readRegisteredSymbolStopsLevel(sym)
    ?? readNonNegativeInt(instrument?.stops_level ?? instrument?.stopsLevel)
    ?? readNonNegativeInt(liveTick?.stops_level ?? liveTick?.stopsLevel);
}

/**
 * TERM-DIGITS-WL: instrument properties come ONLY from broker data, never
 * from the symbol name. Sources, in order: the registered broker catalog
 * (readRegisteredSymbolPriceSpec), the catalog row passed to the dialog,
 * then the live tick/quote payload digits. Unknown values stay null; the
 * symbol is used only as a lookup key into broker data.
 */
export function getInstrumentConfig(
  sym: string,
  liveDigits?: unknown,
  instrument?: Partial<OrderPanelInstrumentRow> | null,
): OrderPanelInstrumentConfig {
  const catalog = readRegisteredSymbolPriceSpec(sym);
  const digits = resolveSpecDigits(catalog.digits, instrument?.digits, liveDigits);
  const tickSize = readPositiveFinite(catalog.tickSize) ?? readPositiveFinite(instrument?.tickSize);
  const priceStep = tickSize ?? (digits === null ? null : Math.pow(10, -digits));
  return {
    digits,
    priceStep,
    contractSize: readPositiveFinite(instrument?.contractSize),
  };
}

/** Broker digits -> fixed precision; unknown digits -> raw value (no guess). */
function formatDialogPrice(price: number, digits: number | null): string {
  return digits === null ? String(price) : price.toFixed(digits);
}

// Format number with space separators (MT5 style: "1 000")
function formatMargin(val: number): string {
  const rounded = Math.round(val);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatRequiredMargin(val: number | null, currency: string): string {
  if (val === null || !Number.isFinite(val)) return '—';
  return `${formatMargin(val)} ${currency}`.trim();
}

function formatMt5QuotePrice(price: number, digits: number | null): string {
  if (!Number.isFinite(price) || price <= 0) return digits === null ? '—' : (0).toFixed(digits);
  const fixed = formatDialogPrice(price, digits);
  // Raw values in exponent notation (unknown digits) are shown verbatim.
  if (/e/i.test(fixed)) return fixed;
  const [intPart, decPart] = fixed.split('.');
  const spacedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${spacedInt}.${decPart}` : spacedInt;
}

function formatContractUnitsSummary(volumeStr: string, symbol: string, contractSize: number | null): string {
  const vol = Number.parseFloat(volumeStr);
  if (!Number.isFinite(vol) || vol <= 0) return `0 ${symbol}`;
  // Unknown broker contract size: honest unknown, never a guessed lot size.
  if (contractSize === null) return '—';
  const units = Number((vol * contractSize).toFixed(4));
  const [intPart, decPart] = String(units).split('.');
  const spacedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const formatted = decPart ? `${spacedInt}.${decPart}` : spacedInt;
  return `${formatted} ${symbol}`;
}

function formatDefaultExpirationDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
}

// Parse a dialog expiration date string `DD.MM.YY HH:mm` or ISO `YYYY-MM-DDTHH:mm`
// (local time) to a Date, or null when unparseable. Strict shape: rejects overflow dates
// (e.g. 31.02.26) by round-tripping the components.
const parseDialogExpirationDate = (value: string): Date | null => {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?$/.exec(trimmed);
  if (isoMatch) {
    const [, yyyy, mm, dd, hh = '00', min = '00'] = isoMatch;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
    if (
      date.getFullYear() !== Number(yyyy)
      || date.getMonth() !== Number(mm) - 1
      || date.getDate() !== Number(dd)
      || date.getHours() !== Number(hh)
      || date.getMinutes() !== Number(min)
    ) return null;
    return date;
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, dd, mm, yy, hh, min] = match;
  const date = new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
  if (
    date.getDate() !== Number(dd) || date.getMonth() !== Number(mm) - 1
    || date.getFullYear() !== 2000 + Number(yy) || date.getHours() !== Number(hh)
    || date.getMinutes() !== Number(min)
  ) return null;
  return date;
};

export const formatDateTimeLocalValue = (ms: number): string => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const parseDateTimeLocalToDisplay = (isoLocal: string): string => {
  const parsed = parseDialogExpirationDate(isoLocal);
  if (!parsed) return isoLocal;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yy = String(parsed.getFullYear()).slice(-2);
  const hh = String(parsed.getHours()).padStart(2, '0');
  const min = String(parsed.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
};

export const formatDisplayToDateTimeLocal = (value: string, dateOnly = false): string => {
  const parsed = parseDialogExpirationDate(value);
  if (!parsed) return '';
  const full = formatDateTimeLocalValue(parsed.getTime());
  return dateOnly ? full.slice(0, 10) : full;
};

/**
 * Resolve the dialog expiration choice to whole epoch SECONDS for the order
 * wire (SUI-T2). Semantics (local time, documented): GTC → undefined (no
 * expiry); Today → end of the current local day; Specified day → end of the
 * selected local date; Specified → the exact selected local datetime. Past or
 * unparseable dated values THROW so submit blocks fail-closed (never 0/NaN).
 */
export const resolveDialogExpirationTimestamp = (
  expiration: ExpirationType,
  expirationDateStr: string,
  nowMs = Date.now(),
): number | undefined => {
  if (expiration === 'GTC') return undefined;
  if (expiration === 'Today') {
    const end = new Date(nowMs);
    end.setHours(23, 59, 59, 0);
    const seconds = Math.floor(end.getTime() / 1000);
    if (!(seconds * 1000 > nowMs)) throw new Error('Expiration must be in the future');
    return seconds;
  }
  const parsed = parseDialogExpirationDate(expirationDateStr);
  if (!parsed) throw new Error('Enter a valid expiration date (DD.MM.YY HH:mm)');
  if (expiration === 'Specified day') parsed.setHours(23, 59, 59, 0);
  const seconds = Math.floor(parsed.getTime() / 1000);
  if (!(seconds * 1000 > nowMs)) throw new Error('Expiration must be in the future');
  return seconds;
};

// SUI-T8: the ticket's last lot size feeds `last-used` volume mode. Kept at
// module scope so the field initializer and the open-reset share one read path.
function readStoredLotSize(): unknown {
  try {
    return localStorage.getItem('lastLotSize');
  } catch {
    return undefined;
  }
}

type TickChartColors = {
  background: string;
  foreground: string;
  grid: string;
  barUp?: string;
  barDown?: string;
  bullCandle?: string;
  bearCandle?: string;
  bidPriceLine?: string;
  askPriceLine?: string;
  stopLevels?: string;
};

type TickPoint = { time: number; bid: number; ask: number };

const formatTickTimeShort = (time: number, includeSeconds = false): string => {
  const date = new Date(time);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!includeSeconds) return `${hh}:${mm}`;
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const formatTickDate = (time: number): string => {
  const date = new Date(time);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
};

type MiniChartDisplayType = 'bar' | 'candlestick' | 'line' | 'dot' | 'area' | 'hlc';

const MINI_CHART_TYPE_OPTIONS: ReadonlyArray<{ id: MiniChartDisplayType; label: string }> = [
  { id: 'bar', label: 'Bar chart' },
  { id: 'candlestick', label: 'Candlestick chart' },
  { id: 'line', label: 'Line chart' },
  { id: 'dot', label: 'Dot chart' },
  { id: 'area', label: 'Area chart' },
  { id: 'hlc', label: 'HLC chart' },
];

function MiniChartTypeIcon({ type }: { type: MiniChartDisplayType }) {
  switch (type) {
    case 'bar':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 3.5V12.5M2.3 6.5H4M4 9.5H5.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          <path d="M8 2.5V13.5M6.3 8.5H8M8 5.5H9.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          <path d="M12 4V12M10.3 6H12M12 9H13.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case 'candlestick':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3.5 3V13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <rect x="2.2" y="5.5" width="2.6" height="5" rx="0.4" fill="currentColor" />
          <path d="M8 2V4.2M8 10.4V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <rect x="6.7" y="4.2" width="2.6" height="6.2" rx="0.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M12.5 3.5V12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <rect x="11.2" y="5.8" width="2.6" height="4.4" rx="0.4" fill="currentColor" />
        </svg>
      );
    case 'line':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M1.8 10.5L4.8 12.6L8.2 6.8L11.2 9.4L14.2 3.6"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'dot':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="3" cy="10.5" r="1.2" fill="currentColor" />
          <circle cx="5.6" cy="8.2" r="1.2" fill="currentColor" />
          <circle cx="7.8" cy="11.2" r="1.2" fill="currentColor" />
          <circle cx="9.8" cy="6.2" r="1.2" fill="currentColor" />
          <circle cx="11.8" cy="8.8" r="1.2" fill="currentColor" />
          <circle cx="13.5" cy="4.8" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'area':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M1.8 11.2L5.2 7.4L8.4 9.6L12.6 4.5L14.2 6.2V12.8H1.8V11.2Z"
            fill="currentColor"
            fillOpacity="0.28"
          />
          <path
            d="M1.8 11.2L5.2 7.4L8.4 9.6L12.6 4.5L14.2 6.2"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M1.8 13H14.2" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.4 1.4" />
        </svg>
      );
    case 'hlc':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 3.5V12.5M4 9.5H5.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          <path d="M8 2.5V13.5M8 5.5H9.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          <path d="M12 4V12M12 8.5H13.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
  }
}

// ─── Enterprise MT5 Tick & Candlestick Chart ──────────────────────
function MiniTickChart({
  symbol,
  bid,
  ask,
  digits,
  priceStep,
  chartColors,
  orderPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  symbol: string;
  bid: number;
  ask: number;
  /** Broker digits; null = unknown (raw prices, no interpolated axis labels). */
  digits: number | null;
  /** Broker tick size or 10^-digits; null = unknown. */
  priceStep: number | null;
  chartColors: TickChartColors;
  orderPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  volumeText?: string;
  sideHint?: 'buy' | 'sell' | null;
}) {
  const tr = useUiTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartTypeMenuRef = useRef<HTMLDivElement>(null);
  const tickHistoryRef = useRef<TickPoint[]>([]);
  const frameRef = useRef<number | null>(null);
  const [miniChartType, setMiniChartType] = useState<MiniChartDisplayType>('candlestick');
  const [isChartTypeMenuOpen, setIsChartTypeMenuOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const showPriceLines = true;
  const chartShift = true;

  useEffect(() => {
    if (!isChartTypeMenuOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (chartTypeMenuRef.current && !chartTypeMenuRef.current.contains(event.target as Node)) {
        setIsChartTypeMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsChartTypeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isChartTypeMenuOpen]);

  const allPositions = useAppStore((s) => s.positions);
  const allOrders = useAppStore((s) => s.orders);
  const normalizedTargetSymbol = symbol.trim().toUpperCase();

  const symbolPositions = useMemo(
    () => (allPositions ?? []).filter((p) => String(p?.symbol ?? '').trim().toUpperCase() === normalizedTargetSymbol),
    [allPositions, normalizedTargetSymbol],
  );
  const symbolPendingOrders = useMemo(
    () => (allOrders ?? []).filter(
      (o) => String(o?.symbol ?? '').trim().toUpperCase() === normalizedTargetSymbol
        && (!o.status || o.status === 'PENDING'),
    ),
    [allOrders, normalizedTargetSymbol],
  );

  useEffect(() => {
    tickHistoryRef.current = [];
  }, [symbol]);

  useEffect(() => {
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return;

    const now = Date.now();
    const nextTick = { time: now, bid, ask };
    const cutoff = now - 300_000;
    const retained = tickHistoryRef.current.filter((tick) => tick.time >= cutoff);
    const lastTick = retained[retained.length - 1];

    if (lastTick && lastTick.bid === bid && lastTick.ask === ask) {
      retained[retained.length - 1] = nextTick;
    } else {
      retained.push(nextTick);
    }

    tickHistoryRef.current = retained.slice(-180);
  }, [bid, ask]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const readCssValue = (name: string, fallback: string): string => {
      const value = window.getComputedStyle(canvas).getPropertyValue(name).trim();
      return value || fallback;
    };

    const draw = () => {
      const cssWidth = Math.max(260, Math.round(canvas.clientWidth || 323));
      const cssHeight = Math.max(240, Math.round(canvas.clientHeight || 371));
      const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const backingWidth = Math.round(cssWidth * pixelRatio);
      const backingHeight = Math.round(cssHeight * pixelRatio);

      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // Exact trading chart color palette from useChartSettingsStore
      const candleUpBody = chartColors.bullCandle || chartColors.barUp || '#089981';
      const candleDownBody = chartColors.bearCandle || chartColors.barDown || '#F23645';
      const candleUpBorder = chartColors.barUp || candleUpBody;
      const candleDownBorder = chartColors.barDown || candleDownBody;

      const palette = {
        background: chartColors.background || readCssValue('--bg-primary', '#000000'),
        foreground: chartColors.foreground || readCssValue('--text-secondary', '#ffffff'),
        grid: chartColors.grid || readCssValue('--border-primary', 'rgba(255,255,255,0.12)'),
        axisSurface: chartColors.background || readCssValue('--order-chart-axis-surface', '#000000'),
        axis: readCssValue('color', '#a1a1aa'),
        bid: chartColors.bidPriceLine || readCssValue('--order-bid', '#778899'),
        ask: chartColors.askPriceLine || readCssValue('--order-ask', '#F23645'),
        stopLevel: chartColors.stopLevels || '#F23645',
        tagText: readCssValue('--order-tag-text', '#fff'),
        monoFont: readCssValue('--font-mono', 'Tahoma, Segoe UI, Consolas, monospace'),
      };

      const tokenSize = Number.parseFloat(readCssValue('--rtx-ui-font-size', '11'));
      const fontSize = Number.isFinite(tokenSize) && tokenSize > 0 ? Math.min(11.5, Math.max(11, tokenSize)) : 11.5;
      const fontFamily = document.documentElement.classList.contains('rtx-skin-untitled-light')
        ? readCssValue('--font-sans', palette.monoFont)
        : palette.monoFont;
      const bodyFont = `500 ${fontSize}px ${fontFamily}`;
      const controlFont = `600 ${fontSize}px ${fontFamily}`;
      ctx.font = controlFont;

      const width = cssWidth;
      const height = cssHeight;
      const left = 4;
      const samplePrice = Math.max(Math.abs(bid), Math.abs(ask), 100);
      const right = Math.max(68, Math.ceil(ctx.measureText(formatDialogPrice(samplePrice, digits)).width) + 20);
      const tagHeight = 17;
      const top = 6;
      const bottom = 22;
      const plotWidth = Math.max(80, width - left - right);
      const plotHeight = Math.max(80, height - top - bottom);
      const plotRight = left + plotWidth;
      const plotBottom = top + plotHeight;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = palette.axisSurface;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = palette.background;
      ctx.fillRect(left, top, plotWidth, plotHeight);

      // Dashed trading chart grid (8 rows x 7 columns)
      const gridRows = 8;
      const gridCols = 7;
      ctx.strokeStyle = palette.grid;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 0.8;
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([2, 2]);
      for (let r = 1; r < gridRows; r += 1) {
        const y = Math.round(top + (r / gridRows) * plotHeight) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
      }
      for (let c = 1; c < gridCols; c += 1) {
        const x = Math.round(left + (c / gridCols) * plotWidth) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
      }
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Outer plot border & right price scale separator line (matching TradingChart)
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, plotWidth - 1, plotHeight - 1);
      ctx.beginPath();
      ctx.moveTo(plotRight + 0.5, top);
      ctx.lineTo(plotRight + 0.5, plotBottom);
      ctx.strokeStyle = palette.foreground;
      ctx.globalAlpha = 0.28;
      ctx.stroke();
      ctx.globalAlpha = 1;

      const fullHistory = tickHistoryRef.current;
      const visibleCount = Math.max(10, Math.round(90 / Math.max(0.5, zoomLevel)));
      const history = fullHistory.slice(-visibleCount);

      // Read live M1 candles from candleAggregationService (same source as TradingChart)
      const maxCandleBars = Math.min(36, Math.max(12, Math.round(28 / Math.max(0.5, zoomLevel))));
      const aggregatedM1 = candleAggregationService.getCandles(symbol, 'M1', true, false);
      const liveM1Candles = aggregatedM1.slice(-maxCandleBars).map((c) => ({ ...c }));
      if (liveM1Candles.length > 0 && bid > 0) {
        const lastBar = liveM1Candles[liveM1Candles.length - 1];
        lastBar.close = bid;
        lastBar.high = Math.max(lastBar.high, bid);
        lastBar.low = Math.min(lastBar.low, bid);
      }

      if (history.length === 0 && liveM1Candles.length === 0 && (bid <= 0 || ask <= 0)) {
        ctx.fillStyle = palette.axis;
        ctx.font = bodyFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tr('Waiting for the first live quote from the broker.'), left + plotWidth / 2, top + plotHeight / 2, plotWidth - 20);
        return;
      }

      const seedHistory = history.length > 0
        ? history
        : [{ time: Date.now(), bid, ask }];
      const plotHistory = seedHistory.length === 1
        ? [{ ...seedHistory[0], time: seedHistory[0].time - 1_000 }, seedHistory[0]]
        : seedHistory;

      // Build fallback real tick candles when historical M1 candles aren't in candleAggregationService yet
      const candlesToDraw = liveM1Candles.length >= 2
        ? liveM1Candles
        : (() => {
            const bucketCount = Math.min(18, Math.max(1, plotHistory.length));
            const chunkSize = Math.max(1, Math.ceil(plotHistory.length / bucketCount));
            const bars: Array<{ time: number; open: number; high: number; low: number; close: number }> = [];
            for (let i = 0; i < plotHistory.length; i += chunkSize) {
              const slice = plotHistory.slice(i, i + chunkSize);
              if (slice.length === 0) continue;
              const open = slice[0].bid;
              const close = slice[slice.length - 1].bid;
              let high = Math.max(open, close);
              let low = Math.min(open, close);
              for (const pt of slice) {
                high = Math.max(high, pt.bid, pt.ask);
                low = Math.min(low, pt.bid);
              }
              bars.push({
                time: Math.floor(slice[0].time / 1000),
                open,
                high,
                low,
                close,
              });
            }
            return bars;
          })();

      let minPrice = Number.POSITIVE_INFINITY;
      let maxPrice = Number.NEGATIVE_INFINITY;
      for (const bar of candlesToDraw) {
        if (Number.isFinite(bar.low) && bar.low > 0) minPrice = Math.min(minPrice, bar.low);
        if (Number.isFinite(bar.high) && bar.high > 0) maxPrice = Math.max(maxPrice, bar.high);
      }
      for (const tick of plotHistory) {
        if (tick.bid > 0) minPrice = Math.min(minPrice, tick.bid);
        if (tick.ask > 0) maxPrice = Math.max(maxPrice, tick.ask);
      }
      for (const extraPrice of [orderPrice, stopLossPrice, takeProfitPrice]) {
        if (typeof extraPrice === 'number' && Number.isFinite(extraPrice) && extraPrice > 0) {
          minPrice = Math.min(minPrice, extraPrice);
          maxPrice = Math.max(maxPrice, extraPrice);
        }
      }
      for (const pos of symbolPositions) {
        const entry = Number(pos.openPrice ?? pos.open_price ?? pos.price_open ?? 0);
        if (Number.isFinite(entry) && entry > 0) {
          minPrice = Math.min(minPrice, entry);
          maxPrice = Math.max(maxPrice, entry);
        }
        if (Number.isFinite(pos.sl) && pos.sl > 0) {
          minPrice = Math.min(minPrice, pos.sl);
          maxPrice = Math.max(maxPrice, pos.sl);
        }
        if (Number.isFinite(pos.tp) && pos.tp > 0) {
          minPrice = Math.min(minPrice, pos.tp);
          maxPrice = Math.max(maxPrice, pos.tp);
        }
      }
      for (const ord of symbolPendingOrders) {
        if (Number.isFinite(ord.price) && ord.price > 0) {
          minPrice = Math.min(minPrice, ord.price);
          maxPrice = Math.max(maxPrice, ord.price);
        }
      }

      const brokerStep = priceStep !== null && Number.isFinite(priceStep) && priceStep > 0 ? priceStep : null;
      const observedRange = maxPrice - minPrice;
      const minimumRange = Math.max((brokerStep ?? 0) * 16, Math.abs(ask - bid) * 4);
      if (observedRange < minimumRange) {
        const midpoint = (maxPrice + minPrice) / 2;
        minPrice = midpoint - minimumRange / 2;
        maxPrice = midpoint + minimumRange / 2;
      }
      const padding = Math.max((maxPrice - minPrice) * 0.12, (brokerStep ?? 0) * 2);
      minPrice -= padding;
      maxPrice += padding;
      if (!(maxPrice - minPrice > 0)) {
        const visualSpan = Math.abs((maxPrice + minPrice) / 2) * 1e-6 || 1;
        minPrice -= visualSpan;
        maxPrice += visualSpan;
      }
      const totalRange = maxPrice - minPrice;

      const timeStart = liveM1Candles.length >= 2
        ? liveM1Candles[0].time * 1000
        : plotHistory[0].time;
      const timeEnd = liveM1Candles.length >= 2
        ? liveM1Candles[liveM1Candles.length - 1].time * 1000
        : plotHistory[plotHistory.length - 1].time;
      const timeRange = Math.max(timeEnd - timeStart, 1_000);
      const usablePlotWidth = chartShift ? plotWidth * 0.88 : plotWidth;
      const xOf = (time: number) => left + ((time - timeStart) / timeRange) * usablePlotWidth;
      const yOf = (price: number) => top + plotHeight - ((price - minPrice) / totalRange) * plotHeight;

      const isLightSkin = document.documentElement.classList.contains('rtx-skin-untitled-light');
      const scaleLabelColor = isLightSkin ? '#1e293b' : '#f1f5f9';
      const scaleTickColor = isLightSkin ? '#64748b' : '#94a3b8';

      // Track occupied vertical slots on the right price scale so tags and static labels never overlap
      const occupiedTagYs: number[] = [];
      const clampTagY = (rawY: number) => Math.max(top + tagHeight / 2, Math.min(plotBottom - tagHeight / 2, rawY));

      // Pre-compute Bid & Ask tag Y positions with collision separation when spread is tight
      const lastTick = plotHistory[plotHistory.length - 1];
      let resolvedBidTagY: number | null = null;
      let resolvedAskTagY: number | null = null;
      if (showPriceLines && lastTick) {
        const hasBid = lastTick.bid > 0;
        const hasAsk = lastTick.ask > 0;
        if (hasBid && hasAsk) {
          let askY = clampTagY(yOf(lastTick.ask));
          let bidY = clampTagY(yOf(lastTick.bid));
          const minGap = tagHeight + 2;
          if (Math.abs(bidY - askY) < minGap) {
            const midY = (askY + bidY) * 0.5;
            askY = clampTagY(midY - minGap * 0.5);
            bidY = clampTagY(askY + minGap);
            if (bidY - askY < minGap) {
              askY = clampTagY(bidY - minGap);
            }
          }
          resolvedAskTagY = askY;
          resolvedBidTagY = bidY;
          occupiedTagYs.push(askY, bidY);
        } else if (hasBid) {
          resolvedBidTagY = clampTagY(yOf(lastTick.bid));
          occupiedTagYs.push(resolvedBidTagY);
        } else if (hasAsk) {
          resolvedAskTagY = clampTagY(yOf(lastTick.ask));
          occupiedTagYs.push(resolvedAskTagY);
        }
      }

      const registerOccupiedLevel = (priceVal: number | undefined) => {
        if (typeof priceVal !== 'number' || !Number.isFinite(priceVal) || priceVal <= 0) return;
        const rawY = yOf(priceVal);
        if (rawY < top - 4 || rawY > plotBottom + 4) return;
        occupiedTagYs.push(clampTagY(rawY));
      };
      for (const pos of symbolPositions) {
        registerOccupiedLevel(Number(pos.openPrice ?? pos.open_price ?? pos.price_open ?? 0));
        registerOccupiedLevel(pos.sl);
        registerOccupiedLevel(pos.tp);
      }
      for (const ord of symbolPendingOrders) {
        registerOccupiedLevel(ord.price);
        registerOccupiedLevel(ord.sl);
        registerOccupiedLevel(ord.tp);
      }
      registerOccupiedLevel(orderPrice);
      registerOccupiedLevel(stopLossPrice);
      registerOccupiedLevel(takeProfitPrice);

      // Right-side price scale surface & separator line
      ctx.fillStyle = isLightSkin
        ? (palette.axisSurface || '#f1f5f9')
        : '#090d14';
      ctx.fillRect(plotRight + 1, top, right - 1, plotHeight);
      ctx.beginPath();
      ctx.moveTo(plotRight + 0.5, top);
      ctx.lineTo(plotRight + 0.5, plotBottom);
      ctx.strokeStyle = scaleTickColor;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Right-side price scale labels & tick marks (skipping slots occupied by active price tags)
      ctx.font = bodyFont;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let r = 0; r <= gridRows; r += 1) {
        const price = maxPrice - (r / gridRows) * totalRange;
        const y = Math.round(top + (r / gridRows) * plotHeight) + 0.5;
        const collidesWithActiveTag = occupiedTagYs.some((tagY) => Math.abs(y - tagY) < tagHeight * 0.88);
        if (collidesWithActiveTag) continue;

        ctx.beginPath();
        ctx.moveTo(plotRight + 0.5, y);
        ctx.lineTo(plotRight + 5, y);
        ctx.strokeStyle = scaleTickColor;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = scaleLabelColor;
        ctx.globalAlpha = 0.96;
        const labelText = digits !== null ? price.toFixed(digits) : formatDialogPrice(price, digits);
        ctx.fillText(labelText, plotRight + 7, y);
      }
      ctx.globalAlpha = 1;

      // Bottom time axis labels (with horizontal overlap protection)
      ctx.font = bodyFont;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = scaleLabelColor;
      ctx.globalAlpha = 0.9;
      const startDateLabel = formatTickDate(timeStart);
      const endTimeLabel = formatTickTimeShort(timeEnd, true);
      const minCenterX = left + Math.ceil(ctx.measureText(startDateLabel).width) + 22;
      const maxCenterX = plotRight - Math.ceil(ctx.measureText(endTimeLabel).width) - 22;

      ctx.textAlign = 'left';
      ctx.fillText(startDateLabel, left, height - 5);
      for (let c = 2; c < gridCols; c += 1) {
        const t = timeStart + (c / gridCols) * timeRange;
        const x = left + (c / gridCols) * plotWidth;
        if (x < minCenterX || x > maxCenterX) continue;
        ctx.textAlign = 'center';
        ctx.fillText(formatTickTimeShort(t, false), x, height - 5);
      }
      ctx.textAlign = 'right';
      ctx.fillText(endTimeLabel, plotRight, height - 5);
      ctx.globalAlpha = 1;

      const barCount = Math.max(1, candlesToDraw.length);
      const slotWidth = usablePlotWidth / Math.max(barCount, 12);
      const candleWidth = Math.max(3, Math.min(11, Math.floor(slotWidth * 0.68)));
      const halfTickArm = Math.max(2, Math.floor(candleWidth / 2));

      if (miniChartType === 'candlestick') {
        candlesToDraw.forEach((bar, index) => {
          const cx = barCount === 1
            ? Math.round(left + usablePlotWidth * 0.5) + 0.5
            : Math.round(left + ((index + 0.5) / barCount) * usablePlotWidth) + 0.5;
          const isBull = bar.close >= bar.open;
          const bodyColor = isBull ? candleUpBody : candleDownBody;
          const borderColor = isBull ? candleUpBorder : candleDownBorder;

          const yHigh = Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.high)));
          const yLow = Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.low)));
          const yOpen = Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.open)));
          const yClose = Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.close)));

          ctx.beginPath();
          ctx.moveTo(cx, yHigh);
          ctx.lineTo(cx, yLow);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1;
          ctx.stroke();

          const bodyTop = Math.round(Math.min(yOpen, yClose));
          const bodyHeight = Math.max(2, Math.round(Math.abs(yClose - yOpen)));
          const bodyLeft = Math.round(cx - candleWidth / 2);
          ctx.fillStyle = bodyColor;
          ctx.fillRect(bodyLeft, bodyTop, candleWidth, bodyHeight);
          if (candleWidth >= 4) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(bodyLeft + 0.5, bodyTop + 0.5, candleWidth - 1, Math.max(1, bodyHeight - 1));
          }
        });
      } else if (miniChartType === 'bar' || miniChartType === 'hlc') {
        candlesToDraw.forEach((bar, index) => {
          const cx = barCount === 1
            ? Math.round(left + usablePlotWidth * 0.5) + 0.5
            : Math.round(left + ((index + 0.5) / barCount) * usablePlotWidth) + 0.5;
          const isBull = bar.close >= bar.open;
          const strokeColor = isBull ? candleUpBorder : candleDownBorder;

          const yHigh = Math.round(Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.high)))) + 0.5;
          const yLow = Math.round(Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.low)))) + 0.5;
          const yOpen = Math.round(Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.open)))) + 0.5;
          const yClose = Math.round(Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.close)))) + 0.5;

          ctx.beginPath();
          ctx.moveTo(cx, yHigh);
          ctx.lineTo(cx, yLow);
          if (miniChartType === 'bar') {
            ctx.moveTo(cx - halfTickArm, yOpen);
            ctx.lineTo(cx, yOpen);
          }
          ctx.moveTo(cx, yClose);
          ctx.lineTo(cx + halfTickArm, yClose);
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        });
      } else if (miniChartType === 'line' || miniChartType === 'area' || miniChartType === 'dot') {
        const points = candlesToDraw.length >= 2
          ? candlesToDraw.map((bar, index) => ({
              x: barCount === 1
                ? left + usablePlotWidth * 0.5
                : left + ((index + 0.5) / barCount) * usablePlotWidth,
              y: Math.max(top + 2, Math.min(plotBottom - 2, yOf(bar.close))),
            }))
          : plotHistory.map((tick) => ({
              x: xOf(tick.time),
              y: Math.max(top + 2, Math.min(plotBottom - 2, yOf(tick.bid > 0 ? tick.bid : tick.ask))),
            }));

        const lineStroke = chartColors.lineGraph || '#3b82f6';
        if (points.length > 0) {
          if (miniChartType === 'area' && points.length >= 2) {
            ctx.save();
            ctx.beginPath();
            points.forEach((pt, idx) => {
              if (idx === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            });
            ctx.lineTo(points[points.length - 1].x, plotBottom);
            ctx.lineTo(points[0].x, plotBottom);
            ctx.closePath();
            ctx.fillStyle = lineStroke;
            ctx.globalAlpha = 0.22;
            ctx.fill();
            ctx.restore();
          }

          if (miniChartType === 'line' || miniChartType === 'area') {
            ctx.beginPath();
            points.forEach((pt, idx) => {
              if (idx === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            });
            ctx.strokeStyle = lineStroke;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          if (miniChartType === 'dot') {
            ctx.fillStyle = lineStroke;
            points.forEach((pt) => {
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
              ctx.fill();
            });
          }
        }
      }

      // When in tick-only mode (no historical M1 bars) on candlestick/bar/hlc, also overlay live tick lines
      if (liveM1Candles.length < 2 && (miniChartType === 'candlestick' || miniChartType === 'bar' || miniChartType === 'hlc')) {
        const traceLine = (key: 'bid' | 'ask', color: string) => {
          ctx.beginPath();
          plotHistory.forEach((tick, index) => {
            const x = xOf(tick.time);
            const y = yOf(tick[key]);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.strokeStyle = color;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 1.15;
          ctx.stroke();
        };
        traceLine('bid', palette.bid);
        traceLine('ask', palette.ask);
      }

      // Helper to draw a high-contrast right-side price scale tag
      const drawPriceAxisTag = (
        priceVal: number,
        bg: string,
        textColor = '#ffffff',
        overrideTagY?: number | null,
      ) => {
        if (!Number.isFinite(priceVal) || priceVal <= 0) return;
        const rawY = yOf(priceVal);
        const lineY = Math.round(Math.max(top, Math.min(plotBottom, rawY))) + 0.5;
        const clampedY = overrideTagY ?? clampTagY(rawY);
        const tagTop = Math.round(clampedY - tagHeight / 2);
        const tagWidth = right - 3;

        // Connector tick from lineY to tag center if separated
        ctx.beginPath();
        ctx.moveTo(plotRight, lineY);
        ctx.lineTo(plotRight + 3, clampedY);
        ctx.strokeStyle = bg;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Tag pill background + subtle top/bottom border for crisp legibility
        ctx.fillStyle = bg;
        ctx.fillRect(plotRight + 2, tagTop, tagWidth, tagHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.lineWidth = 1;
        ctx.strokeRect(plotRight + 2.5, tagTop + 0.5, tagWidth - 1, tagHeight - 1);

        ctx.fillStyle = textColor;
        ctx.font = controlFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatDialogPrice(priceVal, digits), plotRight + 7, clampedY + 0.5);
      };

      // Helper to draw horizontal level line + left badge + right price scale tag (for trades & order levels)
      const drawTradeOrOrderLine = (
        levelPrice: number | undefined,
        badgeLabel: string,
        lineColor: string,
        tagBg: string,
        dashed = true,
      ) => {
        if (typeof levelPrice !== 'number' || !Number.isFinite(levelPrice) || levelPrice <= 0) return;
        const rawY = yOf(levelPrice);
        if (rawY < top - 4 || rawY > plotBottom + 4) return;
        const clampedY = Math.round(clampTagY(rawY)) + 0.5;

        ctx.save();
        if (dashed && typeof ctx.setLineDash === 'function') {
          ctx.setLineDash([4, 3]);
        }
        ctx.beginPath();
        ctx.moveTo(left, clampedY);
        ctx.lineTo(plotRight, clampedY);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        if (badgeLabel) {
          ctx.font = controlFont;
          const labelWidth = Math.ceil(ctx.measureText(badgeLabel).width) + 10;
          const boxH = 15;
          const boxX = left + 4;
          const boxY = Math.round(clampedY - boxH / 2);
          ctx.fillStyle = tagBg;
          ctx.fillRect(boxX, boxY, labelWidth, boxH);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeLabel, boxX + 5, clampedY);
        }

        drawPriceAxisTag(levelPrice, tagBg, '#ffffff');
      };

      // Draw active open positions on this symbol (same as main TradingChart)
      for (const pos of symbolPositions) {
        const entryPrice = Number(pos.openPrice ?? pos.open_price ?? pos.price_open ?? 0);
        const isBuy = String(pos.side ?? '').toUpperCase() === 'BUY';
        const vol = Number(pos.volume ?? pos.quantity ?? 0);
        const tradeColor = isBuy ? '#2563eb' : '#dc2626';
        const sideText = isBuy ? 'BUY' : 'SELL';
        drawTradeOrOrderLine(
          entryPrice,
          `${sideText} ${vol > 0 ? vol : ''}`.trim(),
          tradeColor,
          tradeColor,
          true,
        );
        if (Number.isFinite(pos.sl) && pos.sl > 0) {
          drawTradeOrOrderLine(pos.sl, `SL`, palette.stopLevel, '#b91c1c', true);
        }
        if (Number.isFinite(pos.tp) && pos.tp > 0) {
          drawTradeOrOrderLine(pos.tp, `TP`, '#22c55e', '#15803d', true);
        }
      }

      // Draw active pending orders on this symbol
      for (const ord of symbolPendingOrders) {
        const isBuy = String(ord.side ?? '').toUpperCase() === 'BUY';
        const tradeColor = isBuy ? '#2563eb' : '#dc2626';
        const typeLabel = `${ord.side} ${ord.type}`.replace('_', ' ');
        drawTradeOrOrderLine(
          ord.price,
          `${typeLabel} ${ord.volume}`,
          tradeColor,
          tradeColor,
          true,
        );
        if (typeof ord.sl === 'number' && Number.isFinite(ord.sl) && ord.sl > 0) {
          drawTradeOrOrderLine(ord.sl, 'SL', palette.stopLevel, '#b91c1c', true);
        }
        if (typeof ord.tp === 'number' && Number.isFinite(ord.tp) && ord.tp > 0) {
          drawTradeOrOrderLine(ord.tp, 'TP', '#22c55e', '#15803d', true);
        }
      }

      // Draw draft order levels (Price, SL, TP) when entered in the dialog
      drawTradeOrOrderLine(orderPrice, 'Price', '#9ca3af', '#4b5563', true);
      drawTradeOrOrderLine(stopLossPrice, 'SL', palette.stopLevel, '#b91c1c', true);
      drawTradeOrOrderLine(takeProfitPrice, 'TP', '#2563eb', '#1d4ed8', true);

      // Draw live Bid & Ask price lines and right-side price scale tags last so they stay on top
      if (showPriceLines && lastTick) {
        const bidLineColor = palette.bid && palette.bid.toLowerCase() !== '#778899' ? palette.bid : '#3b82f6';
        const bidTagBg = '#1d4ed8';
        const askLineColor = palette.ask || '#ef4444';
        const askTagBg = '#dc2626';

        ctx.lineWidth = 1;
        if (lastTick.bid > 0) {
          const y = Math.round(Math.max(top, Math.min(plotBottom, yOf(lastTick.bid)))) + 0.5;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(plotRight, y);
          ctx.strokeStyle = bidLineColor;
          ctx.stroke();
          drawPriceAxisTag(lastTick.bid, bidTagBg, '#ffffff', resolvedBidTagY);
        }
        if (lastTick.ask > 0) {
          const y = Math.round(Math.max(top, Math.min(plotBottom, yOf(lastTick.ask)))) + 0.5;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(plotRight, y);
          ctx.strokeStyle = askLineColor;
          ctx.stroke();
          drawPriceAxisTag(lastTick.ask, askTagBg, '#ffffff', resolvedAskTagY);
        }
      }
    };

    const scheduleDraw = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        draw();
      });
    };

    scheduleDraw();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleDraw);
    resizeObserver?.observe(canvas);

    const themeObserver = new MutationObserver(scheduleDraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    if (document.body) {
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
    };
  }, [
    ask,
    bid,
    chartColors,
    chartShift,
    digits,
    miniChartType,
    priceStep,
    orderPrice,
    showPriceLines,
    stopLossPrice,
    symbol,
    symbolPendingOrders,
    symbolPositions,
    takeProfitPrice,
    tr,
    zoomLevel,
  ]);

  const activeChartTypeOption = MINI_CHART_TYPE_OPTIONS.find((opt) => opt.id === miniChartType) ?? MINI_CHART_TYPE_OPTIONS[1];

  return (
    <div className="rtx-order-dialog__chart-shell">
      <div className="rtx-order-dialog__chart-toolbar" role="toolbar" aria-label={tr("Tick chart toolbar")}>
        <div className="rtx-order-dialog__chart-type-wrap" ref={chartTypeMenuRef}>
          <button
            type="button"
            className={`rtx-order-dialog__chart-type-btn ${isChartTypeMenuOpen ? 'rtx-order-dialog__chart-type-btn--open' : ''}`}
            title={tr(activeChartTypeOption.label)}
            aria-label={tr("Chart type")}
            aria-haspopup="menu"
            aria-expanded={isChartTypeMenuOpen}
            data-testid="order-mini-chart-type-trigger"
            onClick={() => setIsChartTypeMenuOpen((prev) => !prev)}
          >
            <MiniChartTypeIcon type={miniChartType} />
            <svg
              className="rtx-order-dialog__chart-type-caret"
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              aria-hidden="true"
            >
              <path d="M1.5 2.75L4 5.25L6.5 2.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {isChartTypeMenuOpen && (
            <div
              className="rtx-order-dialog__chart-type-menu"
              role="menu"
              aria-label={tr("Chart type")}
              data-testid="order-mini-chart-type-menu"
            >
              {MINI_CHART_TYPE_OPTIONS.map((opt) => {
                const isSelected = opt.id === miniChartType;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    className={`rtx-order-dialog__chart-type-item ${isSelected ? 'rtx-order-dialog__chart-type-item--active' : ''}`}
                    onClick={() => {
                      setMiniChartType(opt.id);
                      setIsChartTypeMenuOpen(false);
                    }}
                  >
                    <span className="rtx-order-dialog__chart-type-item-icon" aria-hidden="true">
                      <MiniChartTypeIcon type={opt.id} />
                    </span>
                    <span className="rtx-order-dialog__chart-type-item-label">{tr(opt.label)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="rtx-order-dialog__toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className="rtx-order-dialog__toolbar-btn"
          title={tr("Zoom out")}
          onClick={() => setZoomLevel((z) => Math.max(0.5, Number((z - 0.5).toFixed(1))))}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="#7a7a85" strokeWidth="1.2" />
            <path d="M4.8 7H9.2M10.5 10.5L14 14" stroke="#7a7a85" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="rtx-order-dialog__toolbar-btn"
          title={tr("Zoom in")}
          onClick={() => setZoomLevel((z) => Math.min(4, Number((z + 0.5).toFixed(1))))}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="#3687ff" strokeWidth="1.2" />
            <path d="M7 4.8V9.2M4.8 7H9.2M10.5 10.5L14 14" stroke="#3687ff" strokeWidth="1.2" />
          </svg>
        </button>

        <div className="rtx-order-dialog__chart-quotes-sr" aria-label={tr("{{value0}} live bid and ask", { value0: symbol })}>
          <span>{tr("Bid ")}<strong>{bid > 0 ? formatDialogPrice(bid, digits) : '—'}</strong></span>
          <span>{tr("Ask ")}<strong>{ask > 0 ? formatDialogPrice(ask, digits) : '—'}</strong></span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={323}
        height={371}
        className="rtx-order-dialog__chart-canvas"
        data-testid="order-mini-tick-chart"
        role="img"
        aria-label={tr("Live {{value0}} bid and ask tick chart", { value0: symbol })}
      />
    </div>
  );
}

// ─── MT5 Depth of Market Pane ────────────────────────────────────
const DOM_LADDER_LEVELS = 6;

function OrderDialogDomPane({
  symbol,
  bid,
  ask,
  digits,
  priceStep,
  onToggleTickChart,
  onSelectDomPrice,
}: {
  symbol: string;
  bid: number;
  ask: number;
  /** Broker digits; null = unknown (raw prices, no rounding). */
  digits: number | null;
  /** Broker tick size or 10^-digits; null = unknown (no synthetic levels). */
  priceStep: number | null;
  onToggleTickChart: () => void;
  onSelectDomPrice: (price: number, side: 'buy' | 'sell') => void;
}) {
  const tr = useUiTranslation();
  const orderBookResult = useLiveOrderBook(symbol, DOM_LADDER_LEVELS);
  const rawOrderBook = (orderBookResult && 'orderBook' in orderBookResult ? orderBookResult.orderBook : orderBookResult) as {
    asks?: { price: number; volume: number }[];
    bids?: { price: number; volume: number }[];
  } | null;
  const reloadOrderBook = orderBookResult && 'reload' in orderBookResult && typeof orderBookResult.reload === 'function'
    ? orderBookResult.reload
    : undefined;
  const [showVolumeBars, setShowVolumeBars] = useState(true);

  // Ladder spacing comes from broker data only (tick size, else 10^-digits).
  const stepUnit = priceStep !== null && Number.isFinite(priceStep) && priceStep > 0 ? priceStep : null;

  const { asks, bids, maxVolume } = useMemo(() => {
    const liveAsks = Array.isArray(rawOrderBook?.asks) ? rawOrderBook.asks.slice(0, DOM_LADDER_LEVELS) : [];
    const liveBids = Array.isArray(rawOrderBook?.bids) ? rawOrderBook.bids.slice(0, DOM_LADDER_LEVELS) : [];
    const roundLevel = (price: number) => (digits === null ? price : Number(price.toFixed(digits)));
    const canSynthesize = stepUnit !== null && (ask > 0 || bid > 0);
    const step = stepUnit ?? 0;
    const safeAsk = ask > 0 ? ask : bid + step * 2;
    const safeBid = bid > 0 ? bid : Math.max(step, safeAsk - step * 2);

    // Use live order-book levels when published by the broker; if no depth feed is
    // published by the backend, synthesize price ladder steps from live bid/ask +
    // broker tick step with volume = 0 (never invent volume numbers).
    const sortedLiveAsksAsc = [...liveAsks].sort((a, b) => a.price - b.price);
    const sortedLiveBidsDesc = [...liveBids].sort((a, b) => b.price - a.price);

    const resolvedAsks = sortedLiveAsksAsc.length > 0
      ? (() => {
          const bestBookAsk = sortedLiveAsksAsc[0].price;
          const canShiftAsk = digits !== null && step > 0 && safeAsk > 0
            && Math.abs(safeAsk - bestBookAsk) > 0
            && Math.abs(safeAsk - bestBookAsk) < step * 250;
          const askShiftDelta = canShiftAsk ? (safeAsk - bestBookAsk) : 0;
          return sortedLiveAsksAsc
            .map((lvl) => ({
              price: askShiftDelta !== 0 ? roundLevel(lvl.price + askShiftDelta) : lvl.price,
              volume: Number(lvl.volume) > 0 ? Number(lvl.volume) : 0,
            }))
            .sort((a, b) => b.price - a.price);
        })()
      : !canSynthesize
        ? []
        : Array.from({ length: DOM_LADDER_LEVELS }, (_, idx) => {
            const offsetFromBest = DOM_LADDER_LEVELS - 1 - idx;
            return {
              price: roundLevel(safeAsk + offsetFromBest * step),
              volume: 0,
            };
          });

    const resolvedBids = sortedLiveBidsDesc.length > 0
      ? (() => {
          const bestBookBid = sortedLiveBidsDesc[0].price;
          const canShiftBid = digits !== null && step > 0 && safeBid > 0
            && Math.abs(safeBid - bestBookBid) > 0
            && Math.abs(safeBid - bestBookBid) < step * 250;
          const bidShiftDelta = canShiftBid ? (safeBid - bestBookBid) : 0;
          return sortedLiveBidsDesc
            .map((lvl) => ({
              price: bidShiftDelta !== 0 ? roundLevel(Math.max(step, lvl.price + bidShiftDelta)) : lvl.price,
              volume: Number(lvl.volume) > 0 ? Number(lvl.volume) : 0,
            }))
            .sort((a, b) => b.price - a.price);
        })()
      : !canSynthesize
        ? []
        : Array.from({ length: DOM_LADDER_LEVELS }, (_, idx) => ({
            price: roundLevel(Math.max(step, safeBid - idx * step)),
            volume: 0,
          }));

    const allVols = [...resolvedAsks, ...resolvedBids].map((r) => r.volume);
    return {
      asks: resolvedAsks,
      bids: resolvedBids,
      maxVolume: Math.max(...allVols, 1),
    };
  }, [ask, bid, digits, rawOrderBook?.asks, rawOrderBook?.bids, stepUnit]);

  return (
    <div className="rtx-order-dialog__dom" data-testid="order-dom-pane">
      <div className="rtx-order-dialog__dom-toolbar" role="toolbar" aria-label={tr("Depth of Market toolbar")}>
        <button
          type="button"
          className="rtx-order-dialog__toolbar-btn"
          title={tr("Tick chart")}
          onClick={onToggleTickChart}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M1.5 7L4.5 3.5L7.5 6.5L11.5 2.5L14.5 5.5" stroke="#3687ff" strokeWidth="1.3" />
            <rect x="8.5" y="8.5" width="5" height="5" rx="1" stroke="#3687ff" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className={`rtx-order-dialog__toolbar-btn ${showVolumeBars ? 'rtx-order-dialog__toolbar-btn--active' : ''}`}
          title={tr("Depth of Market mode")}
          onClick={() => setShowVolumeBars((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="4" y="2" width="8" height="12" stroke="#3687ff" strokeWidth="1.2" />
            <path d="M2 5.5H14M2 10.5H14" stroke="#3687ff" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="rtx-order-dialog__toolbar-btn"
          title={tr("Center spread")}
          onClick={() => {
            void reloadOrderBook?.();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4H14M2 12H14M5 8H11" stroke="#7a7a85" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="rtx-order-dialog__dom-table-wrap">
        <table className="rtx-order-dialog__dom-table" aria-label={tr("Depth of Market")}>
          <thead>
            <tr>
              <th>{tr("Volume")}</th>
              <th>{tr("Price")}</th>
              <th>{tr("Trade")}</th>
            </tr>
          </thead>
          <tbody>
            {asks.map((level, idx) => {
              const hasVolume = level.volume > 0;
              const barPct = showVolumeBars && hasVolume ? Math.min(100, Math.round((level.volume / maxVolume) * 100)) : 0;
              return (
                <tr
                  key={`ask-${idx}`}
                  className={`rtx-order-dialog__dom-row rtx-order-dialog__dom-row--ask ${idx === asks.length - 1 ? 'rtx-order-dialog__dom-row--best-ask' : ''}`}
                >
                  <td className="rtx-order-dialog__dom-vol">
                    {showVolumeBars && hasVolume && (
                      <span
                        className="rtx-order-dialog__dom-bar rtx-order-dialog__dom-bar--ask"
                        style={{ width: `${barPct}%` }}
                        aria-hidden="true"
                      />
                    )}
                    {hasVolume ? <span className="rtx-order-dialog__dom-vol-text">{level.volume}</span> : null}
                  </td>
                  <td
                    className="rtx-order-dialog__dom-price rtx-order-dialog__dom-price--ask"
                    onClick={() => onSelectDomPrice(level.price, 'sell')}
                  >
                    {formatDialogPrice(level.price, digits)}
                  </td>
                  <td className="rtx-order-dialog__dom-trade">
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--sell"
                      title={tr("Sell at {{value0}}", { value0: formatDialogPrice(level.price, digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'sell')}
                    >
                      ∨
                    </button>
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--buy"
                      title={tr("Buy at {{value0}}", { value0: formatDialogPrice(level.price, digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'buy')}
                    >
                      ∧
                    </button>
                  </td>
                </tr>
              );
            })}
            {bids.map((level, idx) => {
              const hasVolume = level.volume > 0;
              const barPct = showVolumeBars && hasVolume ? Math.min(100, Math.round((level.volume / maxVolume) * 100)) : 0;
              return (
                <tr
                  key={`bid-${idx}`}
                  className={`rtx-order-dialog__dom-row rtx-order-dialog__dom-row--bid ${idx === 0 ? 'rtx-order-dialog__dom-row--best-bid' : ''}`}
                >
                  <td className="rtx-order-dialog__dom-vol">
                    {showVolumeBars && hasVolume && (
                      <span
                        className="rtx-order-dialog__dom-bar rtx-order-dialog__dom-bar--bid"
                        style={{ width: `${barPct}%` }}
                        aria-hidden="true"
                      />
                    )}
                    {hasVolume ? <span className="rtx-order-dialog__dom-vol-text">{level.volume}</span> : null}
                  </td>
                  <td
                    className="rtx-order-dialog__dom-price rtx-order-dialog__dom-price--bid"
                    onClick={() => onSelectDomPrice(level.price, 'buy')}
                  >
                    {formatDialogPrice(level.price, digits)}
                  </td>
                  <td className="rtx-order-dialog__dom-trade">
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--sell"
                      title={tr("Sell at {{value0}}", { value0: formatDialogPrice(level.price, digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'sell')}
                    >
                      ∨
                    </button>
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--buy"
                      title={tr("Buy at {{value0}}", { value0: formatDialogPrice(level.price, digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'buy')}
                    >
                      ∧
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type DialogSubmitSide = 'buy' | 'sell';

function resolveSideForOrderType(type: OrderType | undefined): DialogSubmitSide | null {
  if (!type) return null;
  if (type.startsWith('Buy ')) return 'buy';
  if (type.startsWith('Sell ')) return 'sell';
  return null;
}

// ITEM 2 (T10 side preselection): normalize the chart-provided side.
// Fail-closed: anything other than BUY/SELL resolves to null (default flow).
function normalizeInitialDialogSide(value: unknown): DialogSubmitSide | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'BUY') return 'buy';
  if (normalized === 'SELL') return 'sell';
  return null;
}

/**
 * Draft side for the order-panel draft pipeline (App openOrderPanelForSymbol).
 * Fail-closed: only exact BUY/SELL (any case, trimmed) produce a preselected
 * side; everything else yields undefined (dialog default flow).
 */
export function resolveOrderPanelSide(value: unknown): 'BUY' | 'SELL' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === 'BUY' || normalized === 'SELL' ? normalized : undefined;
}

// ─── Main Order Dialog ──────────────────────────────────────
export function OrderPanelDialog({
  isOpen,
  onClose,
  symbol: initialSymbol,
  currentPrice,
  onSubmitOrder,
  initialOrderType,
  initialPrice,
  initialSide,
  marketStatus,
  symbols: accountSymbols,
  instruments,
}: OrderPanelProps) {
  const tr = useUiTranslation();
  const [symbol, setSymbol] = useState(initialSymbol);
  // ITEM 2 (T10 side preselection): the Buy/Sell submit path defaults to the
  // chart-implied side while both buttons stay functional (user can switch
  // by pressing the other button). Null = default flow (absent/invalid).
  const [selectedSide, setSelectedSide] = useState<DialogSubmitSide | null>(() =>
    normalizeInitialDialogSide(initialSide) ?? resolveSideForOrderType(initialOrderType),
  );
  // SUI-T2 keeps honoring explicit caller props; SUI-T8 seeds the rest from
  // the persisted Options trade defaults (no literals).
  const [orderType, setOrderType] = useState<OrderType>(initialOrderType ?? 'Market Execution');
  // SUI-T8: seed the ticket from the persisted Options trade defaults.
  // `default` mode uses the configured default; `last-used` volume mode
  // prefers the ticket's last lot size. Every fallback derives from the
  // store itself — never a literal.
  const tradeDefaults = useTradeDefaults();
  const [volumeStr, setVolumeStr] = useState(() =>
    String(resolveDefaultTradeVolume(tradeDefaults, { lastUsedVolume: readStoredLotSize() })),
  );
  const [deviationStr, setDeviationStr] = useState(() =>
    String(resolveDefaultTradeDeviation(tradeDefaults)),
  );
  // Price inputs start blank (never a fake '0.00'): the submit path omits
  // non-positive values, and SL/TP validity depends on the Buy/Sell side
  // chosen at submit time.
  const [priceStr, setPriceStr] = useState(() => (
    initialPrice !== undefined && Number.isFinite(initialPrice) && initialPrice > 0
      ? String(initialPrice)
      : ''
  ));
  const [stopLimitPriceStr, setStopLimitPriceStr] = useState('');
  const [stopLossStr, setStopLossStr] = useState('');
  const [takeProfitStr, setTakeProfitStr] = useState('');
  const [fillPolicy, setFillPolicy] = useState<FillPolicy>('Fill or Kill');
  const [expiration, setExpiration] = useState<ExpirationType>('GTC');
  const [expirationDateStr, setExpirationDateStr] = useState(formatDefaultExpirationDate);
  const [comment, setComment] = useState('');
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiredMargin, setRequiredMargin] = useState<number | null>(null);
  const [marginCurrency, setMarginCurrency] = useState('');

  // Left sidebar & right pane view toggles (MT5 desktop layout)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [showOneClickTrading, setShowOneClickTrading] = useState(true);
  const [showTickChart, setShowTickChart] = useState(true);
  const [showDom, setShowDom] = useState(true);
  const [marketRangeEnabled, setMarketRangeEnabled] = useState(true);
  const [slEnabled, setSlEnabled] = useState(false);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(false);
  const [breakEvenEnabled, setBreakEvenEnabled] = useState(false);
  const [brokerChrome, setBrokerChrome] = useState(() => getBrokerChrome());

  useEffect(() => {
    const syncChrome = () => setBrokerChrome(getBrokerChrome());
    window.addEventListener(BROKER_CHROME_EVENT, syncChrome);
    return () => window.removeEventListener(BROKER_CHROME_EVENT, syncChrome);
  }, []);
  const dialogLogoUrl = getLogoUrl(brokerChrome);
  const dialogBrandName = brokerDisplayName(brokerChrome) || getWebTerminalTitle(brokerChrome);

  const liveMarketStatus = useSymbolMarketStatus(symbol, {
    enabled: isOpen && Boolean(symbol),
  });

  const tick = useAppStore((s) => s.ticks[symbol]);
  const account = useAppStore((s) => s.account);
  const tickSymbolsKey = useAppStore((s) => (accountSymbols ? '' : Object.keys(s.ticks).join('|')));
  const chartSettings = useChartSettingsStore((state) => (
    state.symbolProperties[symbol] || state.globalProperties
  ));
  const [isAdvancedUntitledLight, setIsAdvancedUntitledLight] = useState(() => {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    return root.classList.contains('rtx-advanced-view')
      && root.classList.contains('rtx-skin-untitled-light');
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    const syncSkinState = () => {
      setIsAdvancedUntitledLight(
        root.classList.contains('rtx-advanced-view')
        && root.classList.contains('rtx-skin-untitled-light'),
      );
    };
    const handleAdvancedViewChange = (event: Event) => {
      const detail = (event as CustomEvent<{ isAdvancedUntitledLight?: boolean }>).detail;
      if (typeof detail?.isAdvancedUntitledLight === 'boolean') {
        setIsAdvancedUntitledLight(detail.isAdvancedUntitledLight);
      } else {
        syncSkinState();
      }
    };

    syncSkinState();
    const observer = new MutationObserver(syncSkinState);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener(RTX_ADVANCED_VIEW_CHANGE_EVENT, handleAdvancedViewChange);
    return () => {
      observer.disconnect();
      window.removeEventListener(RTX_ADVANCED_VIEW_CHANGE_EVENT, handleAdvancedViewChange);
    };
  }, []);

  const symbolOptions = useMemo(() => buildOrderTicketSymbolOptions({
    accountSymbols,
    tickSymbols: tickSymbolsKey ? tickSymbolsKey.split('|') : [],
    currentSymbol: accountSymbols ? symbol : initialSymbol,
  }), [accountSymbols, initialSymbol, symbol, tickSymbolsKey]);

  // TERM-DIGITS-WL: every instrument property comes from broker data only
  // (registered catalog, catalog row prop, then tick digits). No name table,
  // no fallback constant. Unknown precision stays null -> raw String(value),
  // no rounding/point math; unknown contract size -> '—'.
  const catalogInstrument = useMemo(() => {
    const target = symbol.trim().toUpperCase();
    return instruments?.find((row) => String(row?.symbol ?? '').trim().toUpperCase() === target) ?? null;
  }, [instruments, symbol]);
  const {
    digits: specDigits,
    priceStep,
    contractSize,
  } = getInstrumentConfig(symbol, tick?.digits, catalogInstrument);
  const specStopsLevel = useMemo(
    () => resolveInstrumentStopsLevel(symbol, catalogInstrument, tick as { stops_level?: unknown; stopsLevel?: unknown } | undefined),
    [catalogInstrument, symbol, tick],
  );
  const chartColors = useMemo(
    () => getEffectiveChartColors(chartSettings, { isAdvancedUntitledLight }),
    [chartSettings, isAdvancedUntitledLight],
  );

  const bid = tick?.bid || currentPrice.bid || 0;
  const ask = tick?.ask || currentPrice.ask || 0;
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (isOpen) {
      setSymbol(initialSymbol);
      setError(null);
      // SUI-T8: re-seed ticket defaults from Options on every open so the
      // dialog follows settings edits made while it was closed. Drafts
      // edited while the dialog is open are intentionally left untouched.
      const latestTrade = useSettingsStore.getState().trade;
      setVolumeStr(String(resolveDefaultTradeVolume(latestTrade, { lastUsedVolume: readStoredLotSize() })));
      setDeviationStr(String(resolveDefaultTradeDeviation(latestTrade)));
    }
  }, [isOpen, initialSymbol]);

  // ITEM 2 (T10 side preselection): re-seed the default submit path on every
  // open so the dialog follows the latest chart entry point. Manual switches
  // made while open are left untouched until the next open/prop change.
  useEffect(() => {
    if (isOpen) {
      setSelectedSide(normalizeInitialDialogSide(initialSide) ?? resolveSideForOrderType(initialOrderType));
    }
  }, [isOpen, initialSide, initialOrderType]);

  useEffect(() => {
    if (isOpen && initialOrderType) {
      setOrderType(initialOrderType);
    }
  }, [isOpen, initialOrderType]);

  useEffect(() => {
    if (isOpen && initialPrice !== undefined && Number.isFinite(initialPrice) && initialPrice > 0) {
      setPriceStr(specDigits === null ? String(initialPrice) : initialPrice.toFixed(specDigits));
    }
  }, [isOpen, initialPrice, specDigits]);

  const spread = ask - bid;
  // Spread pips from the same catalog-first spec digits as the prices.
  const spreadDisplay = formatSpreadDisplayWithUnit(symbol, spread, bid, ask, specDigits);
  const propMarketStatus = marketStatus?.symbol === symbol.toUpperCase()
    ? marketStatus
    : null;
  const effectiveMarketStatus = liveMarketStatus.loading && propMarketStatus
    ? propMarketStatus
    : liveMarketStatus;
  const marketBlockedMessage = getMarketStatusTradeBlockMessage(effectiveMarketStatus, symbol);
  const isMarketExecutionBlocked = orderType === 'Market Execution'
    && shouldBlockSymbolTrading(effectiveMarketStatus, symbol);

  // Margin currency from the broker margin response, else the account
  // currency; omitted when neither is known (never derived from the symbol).
  const baseCurrency = marginCurrency || account?.currency || '';

  useEffect(() => {
    if (!isOpen) {
      setRequiredMargin(null);
      return;
    }
    const login = getStoredAccountLogin();
    const volume = parseFloat(volumeStr);
    if (!login || !symbol || !Number.isFinite(volume) || volume <= 0) {
      setRequiredMargin(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      tradeApi.market.calculateMargin({
        account_login: login,
        symbol,
        side: 'buy',
        volume,
      }).then((data) => {
        if (cancelled) return;
        const required = Number(data?.required_margin);
        setRequiredMargin(Number.isFinite(required) ? required : null);
        const currency = typeof data?.currency === 'string' && data.currency.trim() ? data.currency : '';
        setMarginCurrency(currency);
      }).catch(() => {
        if (!cancelled) setRequiredMargin(null);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, symbol, volumeStr]);

  const adjustVolume = (delta: number) => {
    const current = parseFloat(volumeStr) || 0;
    const next = Math.max(0.01, Math.round((current + delta) * 100) / 100);
    setVolumeStr(next.toString());
  };

  const stepPriceField = (
    currentValue: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    direction: 1 | -1,
    anchorPrice: number,
  ) => {
    // New-order price stepping uses catalog digits only (no heuristic pipSize,
    // no fallback). Unknown digits = raw value, no rounding/point math.
    const parsed = Number.parseFloat(currentValue);
    if (specDigits === null) {
      if (!Number.isFinite(parsed) || parsed <= 0) {
        const seed = anchorPrice > 0 ? anchorPrice : (bid || ask || 0);
        setter(seed > 0 ? String(seed) : '');
        return;
      }
      setter(String(parsed));
      return;
    }
    // Broker tick size when published, else one point (10^-digits).
    const step = priceStep ?? Math.pow(10, -specDigits);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      const seed = anchorPrice > 0 ? anchorPrice : (bid || ask || step);
      setter(seed.toFixed(specDigits));
      return;
    }
    const next = Math.max(0, parsed + direction * step);
    setter(next.toFixed(specDigits));
  };

  const parsedPrice = Number.parseFloat(priceStr);
  const parsedStopLimitPrice = Number.parseFloat(stopLimitPriceStr);
  const parsedStopLoss = Number.parseFloat(stopLossStr);
  const parsedTakeProfit = Number.parseFloat(takeProfitStr);
  const parsedDeviation = Number.parseInt(deviationStr, 10);
  const unitStep = specDigits !== null ? (priceStep ?? Math.pow(10, -specDigits)) : null;
  const parsedVol = Number.parseFloat(volumeStr);

  const isPendingSideValid = useCallback((side: 'buy' | 'sell'): boolean => {
    if (orderType === 'Market Execution') return true;
    const explicitSide = resolveSideForOrderType(orderType);
    if (explicitSide && explicitSide !== side) return false;
    if (!Number.isFinite(parsedVol) || parsedVol < 0.01) return false;
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return false;
    if (isStopLimitOrderType(orderType) && (!Number.isFinite(parsedStopLimitPrice) || parsedStopLimitPrice <= 0)) {
      return false;
    }

    const minDist = (specStopsLevel !== null && specStopsLevel > 0 && unitStep !== null)
      ? specStopsLevel * unitStep
      : 0;
    const eps = specDigits !== null ? Math.pow(10, -(specDigits + 3)) : 1e-9;

    if (isLimitOrderType(orderType)) {
      if (side === 'buy' && ask > 0 && parsedPrice >= ask - minDist - eps) {
        return false;
      }
      if (side === 'sell' && bid > 0 && parsedPrice <= bid + minDist + eps) {
        return false;
      }
    } else if (isStopOrderType(orderType) || isStopLimitOrderType(orderType)) {
      if (side === 'buy' && ask > 0 && parsedPrice <= ask + minDist + eps) {
        return false;
      }
      if (side === 'sell' && bid > 0 && parsedPrice >= bid - minDist - eps) {
        return false;
      }
    }

    const entryRef = isStopLimitOrderType(orderType) && Number.isFinite(parsedStopLimitPrice) && parsedStopLimitPrice > 0
      ? parsedStopLimitPrice
      : parsedPrice;
    if (Number.isFinite(parsedStopLoss) && parsedStopLoss > 0) {
      if (side === 'buy' && parsedStopLoss >= entryRef - minDist - eps) return false;
      if (side === 'sell' && parsedStopLoss <= entryRef + minDist + eps) return false;
    }
    if (Number.isFinite(parsedTakeProfit) && parsedTakeProfit > 0) {
      if (side === 'buy' && parsedTakeProfit <= entryRef + minDist + eps) return false;
      if (side === 'sell' && parsedTakeProfit >= entryRef - minDist - eps) return false;
    }

    if (expiration === 'Specified' || expiration === 'Specified day') {
      try {
        resolveDialogExpirationTimestamp(expiration, expirationDateStr);
      } catch {
        return false;
      }
    }

    return true;
  }, [
    ask,
    bid,
    expiration,
    expirationDateStr,
    orderType,
    parsedPrice,
    parsedStopLimitPrice,
    parsedStopLoss,
    parsedTakeProfit,
    parsedVol,
    specDigits,
    specStopsLevel,
    unitStep,
  ]);

  const handleOrderTypeChange = useCallback((nextType: OrderType) => {
    setOrderType(nextType);
    const impliedSide = resolveSideForOrderType(nextType);
    if (impliedSide) {
      setSelectedSide(impliedSide);
    }
    if (nextType !== 'Market Execution') {
      const refPrice = impliedSide === 'sell' ? (bid || ask) : (ask || bid);
      if (refPrice > 0) {
        const formattedRef = formatDialogPrice(refPrice, specDigits);
        setPriceStr((prev) => (prev.trim() === '' ? formattedRef : prev));
        if (isStopLimitOrderType(nextType)) {
          setStopLimitPriceStr((prev) => (prev.trim() === '' ? formattedRef : prev));
        }
      }
    }
  }, [ask, bid, specDigits]);

  const handleSubmit = useCallback(async (
    side: 'buy' | 'sell',
    overrideProtection?: { priceSl?: number; priceTp?: number; forceMarket?: boolean },
  ) => {
    if (isPlacing) return;
    const effectiveOrderType = overrideProtection?.forceMarket
      ? 'Market Execution'
      : alignOrderTypeToSide(orderType, side);
    const blocked = effectiveOrderType === 'Market Execution'
      && shouldBlockSymbolTrading(effectiveMarketStatus, symbol);
    if (blocked) {
      setError(marketBlockedMessage || tr('Market is closed for {{value0}}.', { value0: symbol }));
      return;
    }
    setIsPlacing(true);
    setError(null);

    try {
      const volume = parseFloat(volumeStr) || 0.01;
      localStorage.setItem('lastLotSize', volume.toString());

      const slVal = overrideProtection?.priceSl !== undefined
        ? overrideProtection.priceSl
        // TERM-DIGITS-WL: submit raw parsed SL/TP (no toFixed rounding here;
        // display rounding happens onBlur/step via catalog specDigits only).
        : (Number.isFinite(parsedStopLoss) && parsedStopLoss > 0 ? parsedStopLoss : undefined);
      const tpVal = overrideProtection?.priceTp !== undefined
        ? overrideProtection.priceTp
        : (Number.isFinite(parsedTakeProfit) && parsedTakeProfit > 0 ? parsedTakeProfit : undefined);

      if (specStopsLevel !== null && specStopsLevel > 0 && specDigits !== null) {
        const minDist = specStopsLevel * Math.pow(10, -specDigits);
        const eps = Math.pow(10, -(specDigits + 3));
        if (effectiveOrderType === 'Market Execution') {
          const refPrice = side === 'buy' ? bid : ask;
          const refLabel = side === 'buy' ? 'Bid' : 'Ask';
          if (refPrice > 0) {
            if (slVal !== undefined) {
              const bound = side === 'buy' ? refPrice - minDist : refPrice + minDist;
              const violated = side === 'buy' ? slVal > bound + eps : slVal < bound - eps;
              if (violated) {
                setError(`Stop loss must be ${side === 'buy' ? 'at most' : 'at least'} ${bound.toFixed(specDigits)} (minimum distance ${specStopsLevel} pts from ${refLabel} ${refPrice.toFixed(specDigits)})`);
                setIsPlacing(false);
                return;
              }
            }
            if (tpVal !== undefined) {
              const bound = side === 'buy' ? refPrice + minDist : refPrice - minDist;
              const violated = side === 'buy' ? tpVal < bound - eps : tpVal > bound + eps;
              if (violated) {
                setError(`Take profit must be ${side === 'buy' ? 'at least' : 'at most'} ${bound.toFixed(specDigits)} (minimum distance ${specStopsLevel} pts from ${refLabel} ${refPrice.toFixed(specDigits)})`);
                setIsPlacing(false);
                return;
              }
            }
          }
        } else if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          const entryRef = isStopLimitOrderType(effectiveOrderType) && Number.isFinite(parsedStopLimitPrice) && parsedStopLimitPrice > 0
            ? parsedStopLimitPrice
            : parsedPrice;
          if (slVal !== undefined) {
            const bound = side === 'buy' ? entryRef - minDist : entryRef + minDist;
            const violated = side === 'buy' ? slVal > bound + eps : slVal < bound - eps;
            if (violated) {
              setError(`Pending order SL must be ${side === 'buy' ? 'at most' : 'at least'} ${bound.toFixed(specDigits)} (minimum distance ${specStopsLevel} pts)`);
              setIsPlacing(false);
              return;
            }
          }
          if (tpVal !== undefined) {
            const bound = side === 'buy' ? entryRef + minDist : entryRef - minDist;
            const violated = side === 'buy' ? tpVal < bound - eps : tpVal > bound + eps;
            if (violated) {
              setError(`Pending order TP must be ${side === 'buy' ? 'at least' : 'at most'} ${bound.toFixed(specDigits)} (minimum distance ${specStopsLevel} pts)`);
              setIsPlacing(false);
              return;
            }
          }
        }
      }

      // SUI-T2: convert the expiration choice to epoch seconds here. GTC
      // omits expiry; Today/Specified resolve to a timestamp; invalid or past
      // dated values block submit fail-closed (never 0/NaN).
      let expirationTimestamp: number | undefined;
      if (effectiveOrderType !== 'Market Execution') {
        try {
          expirationTimestamp = resolveDialogExpirationTimestamp(expiration, expirationDateStr);
        } catch (expiryErr) {
          setError(expiryErr instanceof Error ? expiryErr.message : 'Invalid expiration');
          setIsPlacing(false);
          return;
        }
      }
      await onSubmitOrder({
        type: side,
        volume,
        symbol,
        ...(effectiveOrderType === 'Market Execution' && Number.isFinite(parsedDeviation) && parsedDeviation >= 0
          ? { deviation: parsedDeviation }
          : {}),
        ...(effectiveOrderType !== 'Market Execution' ? {
          orderType: effectiveOrderType,
          price: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined,
          stopLimitPrice: isStopLimitOrderType(effectiveOrderType) && Number.isFinite(parsedStopLimitPrice) && parsedStopLimitPrice > 0
            ? parsedStopLimitPrice
            : undefined,
          expiration,
          ...(expirationTimestamp !== undefined ? { expirationTimestamp } : {}),
        } : {}),
        ...(slVal ? { priceSl: slVal } : {}),
        ...(tpVal ? { priceTp: tpVal } : {}),
        comment: comment.trim() || undefined,
      });

      useLastSymbolStore.getState().setLastSymbol(symbol, side.toUpperCase() as 'BUY' | 'SELL');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Order failed');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsPlacing(false);
    }
  }, [
    comment,
    effectiveMarketStatus,
    expiration,
    expirationDateStr,
    isPlacing,
    marketBlockedMessage,
    onClose,
    onSubmitOrder,
    orderType,
    parsedDeviation,
    parsedPrice,
    parsedStopLimitPrice,
    parsedStopLoss,
    parsedTakeProfit,
    ask,
    bid,
    specDigits,
    specStopsLevel,
    symbol,
    tr,
    volumeStr,
  ]);

  const handleSelectDomPrice = useCallback((clickedPrice: number, side: 'buy' | 'sell') => {
    // New-order price display uses catalog digits only; unknown = raw value.
    setPriceStr(specDigits === null ? String(clickedPrice) : clickedPrice.toFixed(specDigits));
    setSelectedSide(side);
    const execKind = depthExecutionForLevel(side === 'buy' ? 'BUY' : 'SELL', clickedPrice, bid, ask);
    if (orderType === 'Market Execution' || orderType === 'Limit Order' || orderType === 'Stop Order') {
      setOrderType(execKind === 'stop' ? 'Stop Order' : 'Limit Order');
    } else if (
      orderType === 'Buy Limit' || orderType === 'Sell Limit'
      || orderType === 'Buy Stop' || orderType === 'Sell Stop'
    ) {
      if (execKind === 'stop') {
        setOrderType(side === 'buy' ? 'Buy Stop' : 'Sell Stop');
      } else {
        setOrderType(side === 'buy' ? 'Buy Limit' : 'Sell Limit');
      }
    }
  }, [specDigits, orderType, bid, ask]);

  if (!isOpen) return null;

  const fullSymbolDescription = resolveSymbolDescription(symbol, SYMBOL_NAMES[symbol]);
  const headerTitleText = fullSymbolDescription
    ? `${tr("Order")}: ${symbol} - ${fullSymbolDescription}`
    : `${tr("Order")}: ${symbol}`;

  const symbolFieldId = `new-order-${symbol}-symbol`;
  const orderTypeFieldId = `new-order-${symbol}-type`;
  const volumeFieldId = `new-order-${symbol}-volume`;
  const deviationFieldId = `new-order-${symbol}-deviation`;
  const priceFieldId = `new-order-${symbol}-price`;
  const stopLimitPriceFieldId = `new-order-${symbol}-stop-limit-price`;
  const stopLossFieldId = `new-order-${symbol}-stop-loss`;
  const takeProfitFieldId = `new-order-${symbol}-take-profit`;
  const fillPolicyFieldId = `new-order-${symbol}-fill-policy`;
  const expirationFieldId = `new-order-${symbol}-expiration`;
  const expirationDateFieldId = `new-order-${symbol}-expiration-date`;
  const commentFieldId = `new-order-${symbol}-comment`;

  const contractUnitsText = formatContractUnitsSummary(volumeStr, symbol, contractSize);

  const splitQuoteParts = (value: number): { prefix: string; emphasis: string } => {
    const formatted = formatMt5QuotePrice(value, specDigits);
    if (!formatted || formatted === '—' || specDigits === null || specDigits <= 0) {
      return { prefix: formatted, emphasis: '' };
    }
    const splitIdx = Math.max(0, formatted.length - Math.min(2, specDigits));
    return {
      prefix: formatted.slice(0, splitIdx),
      emphasis: formatted.slice(splitIdx),
    };
  };
  const bidQuoteParts = splitQuoteParts(bid);
  const askQuoteParts = splitQuoteParts(ask);

  const orderHeadingTitle = orderType === 'Market Execution'
    ? tr("New market order")
    : isLimitOrderType(orderType)
      ? tr("New limit order")
      : isStopOrderType(orderType)
        ? tr("New stop order")
        : tr("New stop-limit order");

  const refEntryPrice = orderType === 'Market Execution'
    ? (selectedSide === 'sell' ? (bid || ask) : (ask || bid))
    : (Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : (ask || bid));

  const computeProtectionStats = (targetPrice: number) => {
    if (!Number.isFinite(targetPrice) || targetPrice <= 0 || !(refEntryPrice > 0) || unitStep === null || unitStep <= 0) {
      return { pips: '—', estBalance: '—', estProfit: '—', isPositive: false };
    }
    const rawDiff = Math.abs(targetPrice - refEntryPrice);
    const pipsCount = Math.round((rawDiff / unitStep) * 10) / 10;
    if (contractSize === null || contractSize <= 0 || !Number.isFinite(parsedVol) || parsedVol <= 0) {
      return { pips: String(pipsCount), estBalance: '—', estProfit: '—', isPositive: false };
    }
    const signedDiff = selectedSide === 'sell'
      ? (refEntryPrice - targetPrice)
      : (targetPrice - refEntryPrice);
    const pnl = signedDiff * parsedVol * contractSize;
    const pnlPrefix = pnl > 0 ? '+' : '';
    const estProfit = baseCurrency
      ? `${pnlPrefix}${pnl.toFixed(2)} ${baseCurrency}`
      : `${pnlPrefix}${pnl.toFixed(2)}`;
    const balance = Number(account?.balance);
    const estBalance = Number.isFinite(balance) && balance > 0
      ? `${pnlPrefix}${((pnl / balance) * 100).toFixed(2)} %`
      : '—';
    return {
      pips: String(pipsCount),
      estBalance,
      estProfit,
      isPositive: pnl >= 0,
    };
  };

  const slStats = computeProtectionStats(parsedStopLoss);
  const tpStats = computeProtectionStats(parsedTakeProfit);
  const pipValueDisplay = (
    unitStep !== null && unitStep > 0 && contractSize !== null && contractSize > 0 && Number.isFinite(parsedVol) && parsedVol > 0
  )
    ? `${(unitStep * parsedVol * contractSize).toFixed(2)}${baseCurrency ? ` ${baseCurrency}` : ''}`
    : '—';

  const tickHighRaw = Number((tick as { high?: unknown } | undefined)?.high);
  const tickLowRaw = Number((tick as { low?: unknown } | undefined)?.low);
  const sessionHighDisplay = Number.isFinite(tickHighRaw) && tickHighRaw > 0
    ? formatDialogPrice(tickHighRaw, specDigits)
    : (ask > 0 ? formatDialogPrice(ask, specDigits) : '—');
  const sessionLowDisplay = Number.isFinite(tickLowRaw) && tickLowRaw > 0
    ? formatDialogPrice(tickLowRaw, specDigits)
    : (bid > 0 ? formatDialogPrice(bid, specDigits) : '—');
  const sentimentSplit = (() => {
    const recentBars = candleAggregationService.getCandles(symbol, 'M1', true, false).slice(-20);
    let bullScore = 0;
    let bearScore = 0;
    for (const bar of recentBars) {
      const vol = Math.max(1, Number(bar.volume) || 1);
      if (bar.close > bar.open) bullScore += vol;
      else if (bar.close < bar.open) bearScore += vol;
      else {
        bullScore += vol * 0.5;
        bearScore += vol * 0.5;
      }
    }
    const mid = bid > 0 && ask > 0 ? (bid + ask) * 0.5 : (bid || ask || 0);
    if (Number.isFinite(tickHighRaw) && Number.isFinite(tickLowRaw) && tickHighRaw > tickLowRaw && mid > 0) {
      const rangeRatio = Math.max(0, Math.min(1, (mid - tickLowRaw) / (tickHighRaw - tickLowRaw)));
      bullScore += rangeRatio * 10;
      bearScore += (1 - rangeRatio) * 10;
    }
    const total = bullScore + bearScore;
    if (total <= 0) return { sellPct: 50, buyPct: 50 };
    const buyPct = Math.min(90, Math.max(10, Math.round((bullScore / total) * 100)));
    return { sellPct: 100 - buyPct, buyPct };
  })();

  return (
    <div
      className="rtx-order-dialog-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onContextMenuCapture={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="rtx-order-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${tr("New Order · ")}${symbol}`}
        data-order-mode={orderType}
        data-side={selectedSide ?? undefined}
        data-sidebar-expanded={isSidebarExpanded ? 'true' : 'false'}
        data-show-tick-chart={showTickChart ? 'true' : 'false'}
        data-show-dom={showDom ? 'true' : 'false'}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: dragRef.current ? 'none' : 'transform 0.1s ease-out',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="rtx-order-dialog__header"
          onMouseDown={handleHeaderMouseDown}
        >
          <span className="rtx-order-dialog__title">{headerTitleText}</span>
          <button
            type="button"
            aria-label={tr("Close New Order dialog")}
            className="rtx-order-dialog__close"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="rtx-order-dialog__content">
          {/* Column 1: Left Mode & View Sidebar (cTrader-style emblem + vertical mode tabs) */}
          <div className="rtx-order-dialog__sidebar" role="navigation" aria-label={tr("Order execution modes and panels")}>
            <div className="rtx-order-dialog__sidebar-top">
              <div className="rtx-order-dialog__sidebar-brand" aria-hidden="true">
                <div className="rtx-order-dialog__sidebar-emblem">
                  <BrokerLogoImage
                    src={dialogLogoUrl}
                    alt=""
                    fallbackText={dialogBrandName}
                    size={38}
                    className="rtx-order-dialog__sidebar-logo-img"
                    fallbackClassName="rtx-order-dialog__sidebar-logo-fallback"
                  />
                </div>
              </div>

              <button
                type="button"
                data-testid="order-mode-market"
                className={`rtx-order-dialog__mode-btn ${orderType === 'Market Execution' ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Market Execution")}
                onClick={() => setOrderType('Market Execution')}
              >
                <span className="rtx-order-dialog__mode-text">{tr("Market order")}</span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Market Execution")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-mode-limit"
                className={`rtx-order-dialog__mode-btn ${isLimitOrderType(orderType) ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Limit Order")}
                onClick={() => setOrderType('Limit Order')}
              >
                <span className="rtx-order-dialog__mode-text">{tr("Limit order")}</span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Limit Order")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-mode-stop"
                className={`rtx-order-dialog__mode-btn ${isStopOrderType(orderType) ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Stop Order")}
                onClick={() => setOrderType('Stop Order')}
              >
                <span className="rtx-order-dialog__mode-text">{tr("Stop order")}</span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Stop Order")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-mode-stop-limit"
                className={`rtx-order-dialog__mode-btn ${isStopLimitOrderType(orderType) ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Stop Limit Order")}
                onClick={() => setOrderType('Stop Limit Order')}
              >
                <span className="rtx-order-dialog__mode-text">{tr("Stop-limit order")}</span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Stop Limit Order")}</span>}
              </button>
            </div>

            <div className="rtx-order-dialog__sidebar-bottom">
              <button
                type="button"
                data-testid="order-toggle-oct"
                className={`rtx-order-dialog__view-btn ${showOneClickTrading ? 'rtx-order-dialog__view-btn--active' : ''}`}
                title={tr("One Click Trading")}
                onClick={() => setShowOneClickTrading((v) => !v)}
              >
                <span className="rtx-order-dialog__view-icon-box">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3" width="4" height="10" fill="#f23645" />
                    <rect x="10" y="3" width="4" height="10" fill="#3687ff" />
                    <rect x="5" y="4.5" width="6" height="7" fill="#e5e7eb" />
                  </svg>
                </span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("One Click Trading")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-toggle-tick-chart"
                className={`rtx-order-dialog__view-btn ${showTickChart ? 'rtx-order-dialog__view-btn--active' : ''}`}
                title={tr("Tick Chart")}
                onClick={() => setShowTickChart((v) => !v)}
              >
                <span className="rtx-order-dialog__view-icon-box">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M1.5 6H5L6.8 3.5L9.2 8L11 6H14.5" stroke="#f23645" strokeWidth="1.3" />
                    <path d="M1.5 11.5H5.5L7.5 9.5L9.5 12.5L11.5 10.5H14.5" stroke="#3687ff" strokeWidth="1.3" />
                  </svg>
                </span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Tick Chart")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-toggle-dom"
                className={`rtx-order-dialog__view-btn ${showDom ? 'rtx-order-dialog__view-btn--active' : ''}`}
                title={tr("Depth of Market")}
                onClick={() => setShowDom((v) => !v)}
              >
                <span className="rtx-order-dialog__view-icon-box">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="3" cy="3.5" r="1" fill="#f23645" />
                    <circle cx="3" cy="6.5" r="1" fill="#f23645" />
                    <rect x="6" y="2.5" width="8" height="2" fill="#f23645" />
                    <rect x="8" y="5.5" width="6" height="2" fill="#f23645" />
                    <circle cx="3" cy="9.5" r="1" fill="#3687ff" />
                    <circle cx="3" cy="12.5" r="1" fill="#3687ff" />
                    <rect x="8" y="8.5" width="6" height="2" fill="#3687ff" />
                    <rect x="6" y="11.5" width="8" height="2" fill="#3687ff" />
                  </svg>
                </span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Depth of Market")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-toggle-sidebar"
                className="rtx-order-dialog__view-btn rtx-order-dialog__view-btn--minimize"
                title={tr("Minimize")}
                onClick={() => setIsSidebarExpanded((v) => !v)}
              >
                <span className="rtx-order-dialog__view-icon-box">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    {isSidebarExpanded ? (
                      <path d="M12.5 8H3.5M6.5 5L3.5 8L6.5 11" stroke="#3687ff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <path d="M3.5 8H12.5M9.5 5L12.5 8L9.5 11" stroke="#3687ff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </span>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Minimize")}</span>}
              </button>
            </div>
          </div>

          {/* Column 2: Main Order Form */}
          <div className="rtx-order-dialog__form">
            {/* Hero Title Bar */}
            <div className="rtx-order-dialog__hero-bar">
              <span className="rtx-order-dialog__hero-title">{orderHeadingTitle}</span>
              <div className="rtx-order-dialog__hero-actions">
                <button
                  type="button"
                  className="rtx-order-dialog__hero-icon-btn"
                  title={tr("Order Type")}
                  onClick={() => {
                    const el = document.getElementById(orderTypeFieldId);
                    el?.focus();
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <circle cx="12" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                    <circle cx="4" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                    <circle cx="12" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M5.6 7.1L10.4 4.4M5.6 8.9L10.4 11.6" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`rtx-order-dialog__hero-icon-btn ${showDom ? 'rtx-order-dialog__hero-icon-btn--active' : ''}`}
                  title={tr("Depth of Market")}
                  onClick={() => setShowDom((v) => !v)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2.5C5.8 2.5 4.2 4.1 4.2 6.3V9.5L3 11H13L11.8 9.5V6.3C11.8 4.1 10.2 2.5 8 2.5Z" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M6.6 12.2C6.9 12.8 7.4 13.2 8 13.2C8.6 13.2 9.1 12.8 9.4 12.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`rtx-order-dialog__hero-icon-btn ${showTickChart ? 'rtx-order-dialog__hero-icon-btn--active' : ''}`}
                  title={tr("Tick Chart")}
                  onClick={() => setShowTickChart((v) => !v)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d={showTickChart ? 'M9.5 4L5.5 8L9.5 12' : 'M6.5 4L10.5 8L6.5 12'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Instrument Status Subheader */}
            <div className="rtx-order-dialog__instrument-meta">
              <span className="rtx-order-dialog__instrument-desc">
                <span
                  className={`rtx-order-dialog__instrument-status-dot ${isMarketExecutionBlocked ? 'rtx-order-dialog__instrument-status-dot--closed' : ''}`}
                  aria-hidden="true"
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                    {isMarketExecutionBlocked ? (
                      <path d="M6 3.2V6.4M6 8.8H6.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    ) : (
                      <path d="M2.5 6.2L4.9 8.6L9.5 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </span>
                <span className="rtx-order-dialog__instrument-name">
                  {fullSymbolDescription ? tr(fullSymbolDescription) : symbol}
                </span>
                <span className="rtx-order-dialog__info-badge" aria-hidden="true" title={headerTitleText}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 7.2V11.2M8 4.9H8.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
              </span>
              <span className="rtx-order-dialog__instrument-change" title={`${tr("Spread: ")}${spreadDisplay}`}>
                <span className="rtx-order-dialog__spread-pill-label">{tr("Spread")}</span>
                <span className="rtx-order-dialog__spread-pill-val">{spreadDisplay}</span>
              </span>
            </div>

            {/* Symbol Selector + Order Type Row */}
            <div className="rtx-order-dialog__symbol-bar">
              <div className="rtx-order-dialog__field rtx-order-dialog__field--symbol">
                <label
                  className={`rtx-order-dialog__label ${isSidebarExpanded ? '' : 'rtx-order-dialog__label--compact-symbol'}`}
                  htmlFor={symbolFieldId}
                >
                  {tr("Symbol")}
                </label>
                <div className="rtx-order-dialog__symbol-select-wrap">
                  <select
                    id={symbolFieldId}
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="rtx-order-dialog__control rtx-order-dialog__symbol-select"
                  >
                    {symbolOptions.map(({ symbol: s, disabled }) => {
                      const desc = SYMBOL_NAMES[s] ? tr(SYMBOL_NAMES[s]) : resolveSymbolDescription(s);
                      return (
                        <option key={s} value={s} disabled={disabled}>
                          {desc ? `${s}, ${desc}` : s}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="rtx-order-dialog__field rtx-order-dialog__field--type-compact">
                <label className="rtx-order-dialog__label" htmlFor={orderTypeFieldId}>
                  {tr("Type")}
                </label>
                <select
                  id={orderTypeFieldId}
                  data-testid="order-type-select"
                  value={orderType}
                  onChange={(e) => handleOrderTypeChange(e.target.value as OrderType)}
                  className="rtx-order-dialog__control rtx-order-dialog__type-select"
                >
                  <option value="Market Execution">{tr("Market")}</option>
                  <option value="Buy Limit">{tr("Buy Limit")}</option>
                  <option value="Sell Limit">{tr("Sell Limit")}</option>
                  <option value="Buy Stop">{tr("Buy Stop")}</option>
                  <option value="Sell Stop">{tr("Sell Stop")}</option>
                  <option value="Buy Stop Limit">{tr("Buy Stop Limit")}</option>
                  <option value="Sell Stop Limit">{tr("Sell Stop Limit")}</option>
                  {orderType === 'Limit Order' && (
                    <option value="Limit Order">{tr("Limit")}</option>
                  )}
                  {orderType === 'Stop Order' && (
                    <option value="Stop Order">{tr("Stop")}</option>
                  )}
                  {orderType === 'Stop Limit Order' && (
                    <option value="Stop Limit Order">{tr("Stop Limit")}</option>
                  )}
                </select>
              </div>
            </div>

            {/* MT5 Order Fields (Volume, Deviation / Pending Price, Stop Loss, Take Profit, Fill Policy / Expiration, Comment) */}
            <div className="rtx-order-dialog__mt5-fields">
              <div className="rtx-order-dialog__field">
                <label className="rtx-order-dialog__label" htmlFor={volumeFieldId}>{tr("Volume")}</label>
                <div className="rtx-order-dialog__volume-row">
                  <div className="rtx-order-dialog__volume-control">
                    <input
                      id={volumeFieldId}
                      type="text"
                      inputMode="decimal"
                      value={volumeStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          setVolumeStr(val);
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(volumeStr);
                        if (isNaN(parsed) || parsed < 0.01) {
                          setVolumeStr('0.01');
                        } else {
                          setVolumeStr(parsed.toString());
                        }
                      }}
                      className="rtx-order-dialog__volume-input"
                    />
                    <div className="rtx-order-dialog__spinner">
                      <button
                        type="button"
                        aria-label={tr("Increase volume")}
                        onClick={() => adjustVolume(0.01)}
                        className="rtx-order-dialog__spinner-button"
                      >▲</button>
                      <button
                        type="button"
                        aria-label={tr("Decrease volume")}
                        onClick={() => adjustVolume(-0.01)}
                        className="rtx-order-dialog__spinner-button"
                      >▼</button>
                    </div>
                  </div>
                  {orderType === 'Market Execution' && (
                    <span className="rtx-order-dialog__contract-units">{contractUnitsText}</span>
                  )}
                  <span className="rtx-order-dialog__margin" data-testid="order-required-margin">
                    {formatRequiredMargin(requiredMargin, baseCurrency)}
                  </span>
                </div>
              </div>

              {orderType === 'Market Execution' && (
                <div className="rtx-order-dialog__field">
                  <label className="rtx-order-dialog__label" htmlFor={deviationFieldId}>{tr("Deviation")}</label>
                  <div className="rtx-order-dialog__volume-row">
                    <div className="rtx-order-dialog__volume-control">
                      <input
                        id={deviationFieldId}
                        type="text"
                        inputMode="numeric"
                        value={deviationStr}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^\d*$/.test(val)) {
                            setDeviationStr(val);
                          }
                        }}
                        onBlur={() => {
                          const parsed = Number.parseInt(deviationStr, 10);
                          setDeviationStr(
                            Number.isFinite(parsed) && parsed >= 0
                              ? String(parsed)
                              : String(resolveDefaultTradeDeviation(useSettingsStore.getState().trade)),
                          );
                        }}
                        className="rtx-order-dialog__volume-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              {orderType !== 'Market Execution' && (
                <>
                  <div className="rtx-order-dialog__field rtx-order-dialog__field--spaced-top">
                    <label className="rtx-order-dialog__label" htmlFor={priceFieldId}>{tr("Price")}</label>
                    <div className="rtx-order-dialog__volume-row">
                      <div className="rtx-order-dialog__volume-control">
                        <input
                          id={priceFieldId}
                          type="text"
                          inputMode="decimal"
                          value={priceStr}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || /^\d*\.?\d*$/.test(val)) setPriceStr(val);
                          }}
                          onBlur={() => {
                            const parsed = Number.parseFloat(priceStr);
                            setPriceStr(Number.isFinite(parsed) && parsed >= 0 ? (specDigits === null ? String(parsed) : parsed.toFixed(specDigits)) : '');
                          }}
                          className="rtx-order-dialog__volume-input"
                        />
                        <div className="rtx-order-dialog__spinner">
                          <button
                            type="button"
                            aria-label={tr("Increase price")}
                            onClick={() => stepPriceField(priceStr, setPriceStr, 1, ask || bid)}
                            className="rtx-order-dialog__spinner-button"
                          >▲</button>
                          <button
                            type="button"
                            aria-label={tr("Decrease price")}
                            onClick={() => stepPriceField(priceStr, setPriceStr, -1, bid || ask)}
                            className="rtx-order-dialog__spinner-button"
                          >▼</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rtx-order-dialog__field">
                    <label className="rtx-order-dialog__label" htmlFor={stopLimitPriceFieldId}>{tr("Stop Limit price")}</label>
                    <div className="rtx-order-dialog__volume-row">
                      <div
                        className={`rtx-order-dialog__volume-control ${!isStopLimitOrderType(orderType) ? 'rtx-order-dialog__volume-control--disabled' : ''}`}
                      >
                        <input
                          id={stopLimitPriceFieldId}
                          type="text"
                          inputMode="decimal"
                          disabled={!isStopLimitOrderType(orderType)}
                          value={stopLimitPriceStr}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || /^\d*\.?\d*$/.test(val)) setStopLimitPriceStr(val);
                          }}
                          onBlur={() => {
                            const parsed = Number.parseFloat(stopLimitPriceStr);
                            setStopLimitPriceStr(Number.isFinite(parsed) && parsed >= 0 ? (specDigits === null ? String(parsed) : parsed.toFixed(specDigits)) : '');
                          }}
                          className="rtx-order-dialog__volume-input"
                        />
                        <div className="rtx-order-dialog__spinner">
                          <button
                            type="button"
                            disabled={!isStopLimitOrderType(orderType)}
                            aria-label={tr("Increase stop limit price")}
                            onClick={() => stepPriceField(stopLimitPriceStr, setStopLimitPriceStr, 1, ask || bid)}
                            className="rtx-order-dialog__spinner-button"
                          >▲</button>
                          <button
                            type="button"
                            disabled={!isStopLimitOrderType(orderType)}
                            aria-label={tr("Decrease stop limit price")}
                            onClick={() => stepPriceField(stopLimitPriceStr, setStopLimitPriceStr, -1, bid || ask)}
                            className="rtx-order-dialog__spinner-button"
                          >▼</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="rtx-order-dialog__field">
                <label className="rtx-order-dialog__label" htmlFor={stopLossFieldId}>{tr("Stop Loss")}</label>
                <div className="rtx-order-dialog__volume-row">
                  <div className="rtx-order-dialog__volume-control">
                    <input
                      id={stopLossFieldId}
                      type="text"
                      inputMode="decimal"
                      value={stopLossStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) setStopLossStr(val);
                      }}
                      onBlur={() => {
                        const parsed = Number.parseFloat(stopLossStr);
                        setStopLossStr(Number.isFinite(parsed) && parsed >= 0 ? (specDigits === null ? String(parsed) : parsed.toFixed(specDigits)) : '');
                      }}
                      className="rtx-order-dialog__volume-input"
                    />
                    <div className="rtx-order-dialog__spinner">
                      <button
                        type="button"
                        aria-label={tr("Increase stop loss")}
                        onClick={() => stepPriceField(stopLossStr, setStopLossStr, 1, bid || ask)}
                        className="rtx-order-dialog__spinner-button"
                      >▲</button>
                      <button
                        type="button"
                        aria-label={tr("Decrease stop loss")}
                        onClick={() => stepPriceField(stopLossStr, setStopLossStr, -1, bid || ask)}
                        className="rtx-order-dialog__spinner-button"
                      >▼</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rtx-order-dialog__field">
                <label className="rtx-order-dialog__label" htmlFor={takeProfitFieldId}>{tr("Take Profit")}</label>
                <div className="rtx-order-dialog__volume-row">
                  <div className="rtx-order-dialog__volume-control">
                    <input
                      id={takeProfitFieldId}
                      type="text"
                      inputMode="decimal"
                      value={takeProfitStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) setTakeProfitStr(val);
                      }}
                      onBlur={() => {
                        const parsed = Number.parseFloat(takeProfitStr);
                        setTakeProfitStr(Number.isFinite(parsed) && parsed >= 0 ? (specDigits === null ? String(parsed) : parsed.toFixed(specDigits)) : '');
                      }}
                      className="rtx-order-dialog__volume-input"
                    />
                    <div className="rtx-order-dialog__spinner">
                      <button
                        type="button"
                        aria-label={tr("Increase take profit")}
                        onClick={() => stepPriceField(takeProfitStr, setTakeProfitStr, 1, ask || bid)}
                        className="rtx-order-dialog__spinner-button"
                      >▲</button>
                      <button
                        type="button"
                        aria-label={tr("Decrease take profit")}
                        onClick={() => stepPriceField(takeProfitStr, setTakeProfitStr, -1, ask || bid)}
                        className="rtx-order-dialog__spinner-button"
                      >▼</button>
                    </div>
                  </div>
                </div>
              </div>

              {orderType === 'Market Execution' ? (
                <div className="rtx-order-dialog__field">
                  <label className="rtx-order-dialog__label" htmlFor={fillPolicyFieldId}>{tr("Fill policy")}</label>
                  <div
                    className="rtx-order-dialog__fill-policy-wrap"
                    title={tr("Fill policy is not supported by the execution venue and is not sent")}
                  >
                    <div className="rtx-order-dialog__fill-tabs" role="tablist">
                      {(['Fill or Kill', 'Immediate or Cancel', 'Return'] as const).map((policy) => (
                        <button
                          key={policy}
                          type="button"
                          role="tab"
                          aria-selected={fillPolicy === policy}
                          className={`rtx-order-dialog__fill-tab ${fillPolicy === policy ? 'rtx-order-dialog__fill-tab--active' : ''}`}
                          onClick={() => setFillPolicy(policy)}
                          disabled
                          title={tr("Fill policy is not supported by the execution venue and is not sent")}
                          aria-describedby={`${fillPolicyFieldId}-unsupported-reason`}
                        >
                          {tr(policy)}
                        </button>
                      ))}
                    </div>
                    <select
                      id={fillPolicyFieldId}
                      value={fillPolicy}
                      onChange={(e) => setFillPolicy(e.target.value as FillPolicy)}
                      className="rtx-order-dialog__fill-select-sr"
                      disabled
                      title={tr("Fill policy is not supported by the execution venue and is not sent")}
                      aria-describedby={`${fillPolicyFieldId}-unsupported-reason`}
                    >
                      <option value="Fill or Kill">{tr("Fill or Kill")}</option>
                      <option value="Immediate or Cancel">{tr("Immediate or Cancel")}</option>
                      <option value="Return">{tr("Return")}</option>
                    </select>
                    <div
                      id={`${fillPolicyFieldId}-unsupported-reason`}
                      role="note"
                      className="rtx-order-dialog__margin"
                    >
                      {tr("Fill policy is not supported by the execution venue and is not sent")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rtx-order-dialog__field">
                  <label className="rtx-order-dialog__label" htmlFor={expirationFieldId}>{tr("Expiration")}</label>
                  <div className="rtx-order-dialog__expiration-row">
                    <select
                      id={expirationFieldId}
                      value={expiration}
                      onChange={(e) => setExpiration(e.target.value as ExpirationType)}
                      className="rtx-order-dialog__control rtx-order-dialog__expiration-select"
                    >
                      <option value="GTC">{tr("GTC")}</option>
                      <option value="Today">{tr("Today")}</option>
                      <option value="Specified">{tr("Specified")}</option>
                      <option value="Specified day">{tr("Specified day")}</option>
                    </select>
                    <label className="rtx-order-dialog__expiration-date-label" htmlFor={expirationDateFieldId}>
                      {tr("Expiration date")}:
                    </label>
                    <input
                      id={expirationDateFieldId}
                      type="text"
                      value={expirationDateStr}
                      disabled={expiration === 'GTC' || expiration === 'Today'}
                      onChange={(e) => setExpirationDateStr(e.target.value)}
                      className="rtx-order-dialog__control rtx-order-dialog__expiration-date-input"
                    />
                    {(expiration === 'Specified' || expiration === 'Specified day') && (
                      <input
                        aria-label={tr("Expiration date picker")}
                        data-testid="order-dialog-expiration-picker"
                        type={expiration === 'Specified day' ? 'date' : 'datetime-local'}
                        value={formatDisplayToDateTimeLocal(expirationDateStr, expiration === 'Specified day')}
                        onChange={(e) => {
                          const rawVal = e.target.value;
                          if (!rawVal) return;
                          const nextDisplay = expiration === 'Specified day'
                            ? parseDateTimeLocalToDisplay(`${rawVal}T23:59`)
                            : parseDateTimeLocalToDisplay(rawVal);
                          setExpirationDateStr(nextDisplay);
                        }}
                        className="rtx-order-dialog__control rtx-order-dialog__expiration-date-picker ml-1"
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="rtx-order-dialog__field">
                <label className="rtx-order-dialog__label" htmlFor={commentFieldId}>{tr("Comment")}</label>
                <div className="rtx-order-dialog__comment-wrap">
                  <input
                    id={commentFieldId}
                    type="text"
                    maxLength={64}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="rtx-order-dialog__control rtx-order-dialog__comment-input"
                  />
                  <span className="rtx-order-dialog__comment-chevron" aria-hidden="true">⌄</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--error" role="alert">{tr(error)}</div>
            )}
            {isMarketExecutionBlocked && !error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--warning" role="status">
                {marketBlockedMessage || tr('Market is closed for {{value0}}.', { value0: symbol })}
              </div>
            )}

            {/* Bottom Action Footer: Sell / Buy Buttons, Sentiment Bar & Spread Summary */}
            <div className="rtx-order-dialog__bottom-actions">
              {orderType === 'Market Execution' ? (
                <div className="rtx-order-dialog__actions">
                  <button
                    type="button"
                    onClick={() => { setSelectedSide('sell'); void handleSubmit('sell'); }}
                    disabled={isPlacing || bid <= 0 || isMarketExecutionBlocked}
                    className="rtx-order-dialog__action rtx-order-dialog__action--sell"
                    aria-pressed={selectedSide === 'sell'}
                  >
                    <span className="rtx-order-dialog__sr-only">
                      {isPlacing ? tr("Placing...") : tr("Sell by Market")}
                    </span>
                    <span className="rtx-order-dialog__action-card-top" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-label">{tr("Sell")}</span>
                      <span className="rtx-order-dialog__action-card-side-tag">BID</span>
                    </span>
                    <span className="rtx-order-dialog__action-card-price" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-prefix">{bidQuoteParts.prefix}</span>
                      {bidQuoteParts.emphasis && (
                        <span className="rtx-order-dialog__action-card-pips">{bidQuoteParts.emphasis}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedSide('buy'); void handleSubmit('buy'); }}
                    disabled={isPlacing || ask <= 0 || isMarketExecutionBlocked}
                    className="rtx-order-dialog__action rtx-order-dialog__action--buy"
                    aria-pressed={selectedSide === 'buy'}
                  >
                    <span className="rtx-order-dialog__sr-only">
                      {isPlacing ? tr("Placing...") : tr("Buy by Market")}
                    </span>
                    <span className="rtx-order-dialog__action-card-top" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-label">{tr("Buy")}</span>
                      <span className="rtx-order-dialog__action-card-side-tag">ASK</span>
                    </span>
                    <span className="rtx-order-dialog__action-card-price" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-prefix">{askQuoteParts.prefix}</span>
                      {askQuoteParts.emphasis && (
                        <span className="rtx-order-dialog__action-card-pips">{askQuoteParts.emphasis}</span>
                      )}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="rtx-order-dialog__actions">
                  <button
                    type="button"
                    onClick={() => { setSelectedSide('sell'); void handleSubmit('sell'); }}
                    disabled={isPlacing || !isPendingSideValid('sell')}
                    className="rtx-order-dialog__action rtx-order-dialog__action--sell"
                    aria-pressed={selectedSide === 'sell'}
                  >
                    <span className="rtx-order-dialog__sr-only">
                      {isPlacing ? tr("Placing...") : tr("Sell")}
                    </span>
                    <span className="rtx-order-dialog__action-card-top" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-label">{tr("Sell")}</span>
                      <span className="rtx-order-dialog__action-card-side-tag">BID</span>
                    </span>
                    <span className="rtx-order-dialog__action-card-price" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-prefix">{bidQuoteParts.prefix}</span>
                      {bidQuoteParts.emphasis && (
                        <span className="rtx-order-dialog__action-card-pips">{bidQuoteParts.emphasis}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedSide('buy'); void handleSubmit('buy'); }}
                    disabled={isPlacing || !isPendingSideValid('buy')}
                    className="rtx-order-dialog__action rtx-order-dialog__action--buy"
                    aria-pressed={selectedSide === 'buy'}
                  >
                    <span className="rtx-order-dialog__sr-only">
                      {isPlacing ? tr("Placing...") : tr("Buy")}
                    </span>
                    <span className="rtx-order-dialog__action-card-top" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-label">{tr("Buy")}</span>
                      <span className="rtx-order-dialog__action-card-side-tag">ASK</span>
                    </span>
                    <span className="rtx-order-dialog__action-card-price" aria-hidden="true">
                      <span className="rtx-order-dialog__action-card-prefix">{askQuoteParts.prefix}</span>
                      {askQuoteParts.emphasis && (
                        <span className="rtx-order-dialog__action-card-pips">{askQuoteParts.emphasis}</span>
                      )}
                    </span>
                  </button>
                </div>
              )}

              <div className="rtx-order-dialog__sentiment-strip" aria-hidden="true">
                <div className="rtx-order-dialog__sentiment-sell" style={{ width: `${sentimentSplit.sellPct}%` }}>
                  {sentimentSplit.sellPct}%
                </div>
                <div className="rtx-order-dialog__sentiment-buy" style={{ width: `${sentimentSplit.buyPct}%` }}>
                  {sentimentSplit.buyPct}%
                </div>
              </div>

              <div
                className="rtx-order-dialog__price-summary"
                aria-label={tr("Bid {{value0}}, Ask {{value1}}", { value0: formatDialogPrice(bid, specDigits), value1: formatDialogPrice(ask, specDigits) })}
              >
                <span className="rtx-order-dialog__spread-meta">
                  {tr("Spread: ")}{spreadDisplay} · H: {sessionHighDisplay} · L: {sessionLowDisplay}
                </span>
                <span className="rtx-order-dialog__mt5-quote">
                  {formatMt5QuotePrice(bid, specDigits)} / {formatMt5QuotePrice(ask, specDigits)}
                </span>
                <span className="rtx-order-dialog__spread-sr">{tr("Spread: ")}{spreadDisplay}</span>
                {specStopsLevel !== null && specStopsLevel > 0 && (
                  <span
                    className="rtx-order-dialog__margin ml-2"
                    data-testid="order-dialog-stops-level"
                  >
                    {tr("Min stop distance")}: {specStopsLevel} pts
                  </span>
                )}
              </div>
            </div>

            <div className="rtx-order-dialog__status-box" aria-live="polite">
              {isPlacing && <div className="rtx-order-dialog__progress-bar" />}
            </div>
          </div>

          {/* Column 3: Right Candlestick + Tick Chart Pane */}
          {showTickChart && (
            <div className="rtx-order-dialog__chart">
              <MiniTickChart
                symbol={symbol}
                bid={bid}
                ask={ask}
                digits={specDigits}
                priceStep={priceStep}
                chartColors={chartColors}
                orderPrice={orderType !== 'Market Execution' && Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined}
                stopLossPrice={Number.isFinite(parsedStopLoss) && parsedStopLoss > 0 ? parsedStopLoss : undefined}
                takeProfitPrice={Number.isFinite(parsedTakeProfit) && parsedTakeProfit > 0 ? parsedTakeProfit : undefined}
                volumeText={volumeStr}
                sideHint={selectedSide}
              />
            </div>
          )}

          {/* Column 4: Depth of Market Pane */}
          {showDom && (
            <OrderDialogDomPane
              symbol={symbol}
              bid={bid}
              ask={ask}
              digits={specDigits}
              priceStep={priceStep}
              onToggleTickChart={() => setShowTickChart((v) => !v)}
              onSelectDomPrice={handleSelectDomPrice}
            />
          )}
        </div>
      </div>
    </div>
  );
}

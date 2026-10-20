import { useUiTranslation } from '../hooks/useUiTranslation';
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { getEffectiveChartColors, useChartSettingsStore } from '../store/useChartSettingsStore';
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
import { api } from '../services/api';
import { buildOrderTicketSymbolOptions } from '../utils/accountSymbolUniverse';
import { resolveSymbolDescription } from '../utils/symbolDescription';
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
  | 'Stop Limit Order';

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
  marketStatus?: NormalizedMarketStatus;
  /**
   * Symbols the logged-in account may trade (its group catalogue). When
   * provided, the symbol dropdown offers only these instead of every quote
   * present in the tick store.
   */
  symbols?: readonly string[];
}

// Instrument config helper.
export function getInstrumentConfig(sym: string, liveDigits?: number) {
  const base = (() => {
    if (sym.startsWith('BTC')) return { digits: 2, pipSize: 1, contractSize: 1, currency: 'BTC' };
    if (sym.startsWith('ETH')) return { digits: 2, pipSize: 0.01, contractSize: 1, currency: 'ETH' };
    if (sym.startsWith('XAU')) return { digits: 2, pipSize: 0.01, contractSize: 100, currency: 'USD' };
    if (sym.startsWith('XAG')) return { digits: 3, pipSize: 0.001, contractSize: 5000, currency: 'USD' };
    if (sym.includes('JPY')) return { digits: 3, pipSize: 0.01, contractSize: 100000, currency: sym.slice(0, 3) };
    return { digits: 5, pipSize: 0.0001, contractSize: 100000, currency: sym.slice(0, 3) };
  })();

  if (typeof liveDigits === 'number' && Number.isInteger(liveDigits) && liveDigits >= 0 && liveDigits <= 10) {
    const pipExponent = liveDigits >= 1 && (liveDigits === 3 || liveDigits === 5) ? liveDigits - 1 : liveDigits;
    const pipSize = Number((1 / Math.pow(10, pipExponent)).toFixed(pipExponent));
    return { ...base, digits: liveDigits, pipSize };
  }

  return base;
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

function formatMt5QuotePrice(price: number, digits: number): string {
  if (!Number.isFinite(price) || price <= 0) return (0).toFixed(digits);
  const fixed = price.toFixed(digits);
  const [intPart, decPart] = fixed.split('.');
  const spacedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${spacedInt}.${decPart}` : spacedInt;
}

function formatContractUnitsSummary(volumeStr: string, symbol: string, contractSize: number): string {
  const vol = Number.parseFloat(volumeStr);
  if (!Number.isFinite(vol) || vol <= 0) return `0 ${symbol}`;
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

// Parse a dialog expiration date string `DD.MM.YY HH:mm` (local time) to a
// Date, or null when unparseable. Strict shape: rejects overflow dates
// (e.g. 31.02.26) by round-tripping the components.
const parseDialogExpirationDate = (value: string): Date | null => {
  const match = /^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
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

type TickChartColors = {
  background: string;
  foreground: string;
  grid: string;
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

// ─── Enterprise MT5 Tick Chart ───────────────────────────────────
function MiniTickChart({
  symbol,
  bid,
  ask,
  digits,
  chartColors,
  orderPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  chartColors: TickChartColors;
  orderPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}) {
  const tr = useUiTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tickHistoryRef = useRef<TickPoint[]>([]);
  const frameRef = useRef<number | null>(null);
  const [showPriceLines, setShowPriceLines] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showLineChart, setShowLineChart] = useState(true);
  const [showCrosshair, setShowCrosshair] = useState(false);
  const [chartShift, setChartShift] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);

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

      const palette = {
        background: chartColors.background || readCssValue('--bg-primary', '#1f1f1f'),
        foreground: chartColors.foreground || readCssValue('--text-secondary', '#b8b8c0'),
        grid: chartColors.grid || readCssValue('--border-primary', '#3a3a40'),
        axisSurface: readCssValue('--order-chart-axis-surface', '#2b2b2b'),
        axis: readCssValue('color', '#a1a1aa'),
        bid: readCssValue('--order-bid', '#ff4d4f'),
        ask: readCssValue('--order-ask', '#3687ff'),
        tagText: readCssValue('--order-tag-text', '#fff'),
        monoFont: readCssValue('--font-mono', 'Tahoma, Segoe UI, Consolas, monospace'),
      };

      const tokenSize = Number.parseFloat(readCssValue('--rtx-ui-font-size', '11'));
      const fontSize = Number.isFinite(tokenSize) && tokenSize > 0 ? Math.min(11, tokenSize) : 11;
      const fontFamily = document.documentElement.classList.contains('rtx-skin-untitled-light')
        ? readCssValue('--font-sans', palette.monoFont)
        : palette.monoFont;
      const bodyFont = `${readCssValue('--rtx-font-weight-body', '400')} ${fontSize}px ${fontFamily}`;
      const controlFont = `${readCssValue('--rtx-font-weight-control', '400')} ${fontSize}px ${fontFamily}`;
      ctx.font = controlFont;

      const width = cssWidth;
      const height = cssHeight;
      const left = 4;
      const samplePrice = Math.max(Math.abs(bid), Math.abs(ask), 100);
      const right = Math.max(54, Math.ceil(ctx.measureText(samplePrice.toFixed(digits)).width) + 12);
      const tagHeight = 16;
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

      // Outer plot border
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, plotWidth - 1, plotHeight - 1);

      // Dashed MT5 grid (8 rows x 7 columns)
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

      const fullHistory = tickHistoryRef.current;
      const visibleCount = Math.max(10, Math.round(90 / Math.max(0.5, zoomLevel)));
      const history = fullHistory.slice(-visibleCount);

      if (history.length === 0 && (bid <= 0 || ask <= 0)) {
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

      let minPrice = Number.POSITIVE_INFINITY;
      let maxPrice = Number.NEGATIVE_INFINITY;
      for (const tick of plotHistory) {
        minPrice = Math.min(minPrice, tick.bid, tick.ask);
        maxPrice = Math.max(maxPrice, tick.bid, tick.ask);
      }
      for (const extraPrice of [orderPrice, stopLossPrice, takeProfitPrice]) {
        if (typeof extraPrice === 'number' && Number.isFinite(extraPrice) && extraPrice > 0) {
          minPrice = Math.min(minPrice, extraPrice);
          maxPrice = Math.max(maxPrice, extraPrice);
        }
      }

      const priceStep = Math.pow(10, -digits);
      const observedRange = maxPrice - minPrice;
      const minimumRange = Math.max(priceStep * 16, Math.abs(ask - bid) * 4);
      if (observedRange < minimumRange) {
        const midpoint = (maxPrice + minPrice) / 2;
        minPrice = midpoint - minimumRange / 2;
        maxPrice = midpoint + minimumRange / 2;
      }
      const padding = Math.max((maxPrice - minPrice) * 0.12, priceStep * 2);
      minPrice -= padding;
      maxPrice += padding;
      const totalRange = Math.max(maxPrice - minPrice, priceStep);

      const timeStart = plotHistory[0].time;
      const timeEnd = plotHistory[plotHistory.length - 1].time;
      const timeRange = Math.max(timeEnd - timeStart, 1_000);
      const usablePlotWidth = chartShift ? plotWidth * 0.86 : plotWidth;
      const xOf = (time: number) => left + ((time - timeStart) / timeRange) * usablePlotWidth;
      const yOf = (price: number) => top + plotHeight - ((price - minPrice) / totalRange) * plotHeight;

      // Price axis labels (right column)
      ctx.fillStyle = palette.axis;
      ctx.font = bodyFont;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let r = 0; r <= gridRows; r += 1) {
        const price = maxPrice - (r / gridRows) * totalRange;
        const y = top + (r / gridRows) * plotHeight;
        ctx.fillText(price.toFixed(digits), plotRight + 5, y);
      }

      // Bottom time axis labels (MT5 style: YYYY.MM.DD on left, HH:MM across, HH:MM:SS on right)
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = palette.axis;
      ctx.textAlign = 'left';
      ctx.fillText(formatTickDate(timeStart), left, height - 5);
      for (let c = 2; c < gridCols; c += 1) {
        const t = timeStart + (c / gridCols) * timeRange;
        const x = left + (c / gridCols) * plotWidth;
        ctx.textAlign = 'center';
        ctx.fillText(formatTickTimeShort(t, false), x, height - 5);
      }
      ctx.textAlign = 'right';
      ctx.fillText(formatTickTimeShort(timeEnd, true), plotRight, height - 5);

      if (showLineChart) {
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
          ctx.lineWidth = 1.35;
          ctx.stroke();
        };

        traceLine('bid', palette.bid);
        traceLine('ask', palette.ask);
      }

      const lastTick = plotHistory[plotHistory.length - 1];
      if (showPriceLines) {
        ctx.lineWidth = 1;
        ([['bid', palette.bid], ['ask', palette.ask]] as const).forEach(([key, color]) => {
          const y = Math.max(top, Math.min(plotBottom, yOf(lastTick[key])));
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(plotRight, y);
          ctx.strokeStyle = color;
          ctx.stroke();
        });
      }

      // Draw custom order levels (Price, SL, TP) like MT5 desktop
      const drawLevelOverlay = (levelPrice: number | undefined, label: string, lineColor: string, tagBg: string) => {
        if (typeof levelPrice !== 'number' || !Number.isFinite(levelPrice) || levelPrice <= 0) return;
        const rawY = yOf(levelPrice);
        if (rawY < top - 4 || rawY > plotBottom + 4) return;
        const clampedY = Math.max(top + tagHeight / 2, Math.min(plotBottom - tagHeight / 2, rawY));

        ctx.beginPath();
        ctx.moveTo(left, clampedY);
        ctx.lineTo(plotRight, clampedY);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = lineColor;
        ctx.font = bodyFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, left + 4, clampedY - 2);

        ctx.fillStyle = tagBg;
        ctx.fillRect(plotRight + 1, clampedY - tagHeight / 2, right - 2, tagHeight);
        ctx.fillStyle = '#ffffff';
        ctx.font = controlFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(levelPrice.toFixed(digits), plotRight + 4, clampedY);
      };

      drawLevelOverlay(orderPrice, 'Price', '#9ca3af', '#6b7280');
      drawLevelOverlay(stopLossPrice, 'SL', '#f23645', '#b91c1c');
      drawLevelOverlay(takeProfitPrice, 'TP', '#3687ff', '#1d4ed8');
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
    orderPrice,
    showCrosshair,
    showLineChart,
    showPriceLines,
    stopLossPrice,
    symbol,
    takeProfitPrice,
    tr,
    zoomLevel,
  ]);

  return (
    <div className="rtx-order-dialog__chart-shell">
      <div className="rtx-order-dialog__chart-toolbar" role="toolbar" aria-label={tr("Tick chart toolbar")}>
        <button
          type="button"
          className={`rtx-order-dialog__toolbar-btn ${showPriceLines ? 'rtx-order-dialog__toolbar-btn--active' : ''}`}
          title={tr("Show price lines")}
          onClick={() => setShowPriceLines((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="1.5" width="13" height="13" stroke="#3687ff" strokeWidth="1.2" />
            <path d="M2.5 6.5L5.5 4.5L8.5 7.5L13.5 4.5" stroke="#3687ff" strokeWidth="1.2" />
            <path d="M2.5 11.5L6 9.5L9.5 11.5L13.5 9" stroke="#f23645" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className={`rtx-order-dialog__toolbar-btn ${autoScroll ? 'rtx-order-dialog__toolbar-btn--active' : ''}`}
          title={tr("Auto scroll")}
          onClick={() => setAutoScroll((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="10.5" cy="8" r="3.5" stroke="#7a7a85" strokeWidth="1.2" />
            <path d="M10.5 6V8.2L12 9" stroke="#7a7a85" strokeWidth="1.2" />
            <path d="M2 5H5.5M2 8H4.5M2 11H5.5" stroke="#7a7a85" strokeWidth="1.2" />
          </svg>
        </button>
        <span className="rtx-order-dialog__toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className={`rtx-order-dialog__toolbar-btn ${showLineChart ? 'rtx-order-dialog__toolbar-btn--active' : ''}`}
          title={tr("Tick lines")}
          onClick={() => setShowLineChart((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M1.5 6.5H5L6.8 3.5L9.2 8.5L11 6.5H14.5" stroke="#f23645" strokeWidth="1.2" />
            <path d="M1.5 11.5H5.5L7.5 9.5L9.5 12.5L11.5 10.5H14.5" stroke="#3687ff" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className={`rtx-order-dialog__toolbar-btn ${showCrosshair ? 'rtx-order-dialog__toolbar-btn--active' : ''}`}
          title={tr("Tick points")}
          onClick={() => setShowCrosshair((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="5" cy="5" r="2" stroke="#7a7a85" strokeWidth="1.2" />
            <circle cx="11" cy="6.5" r="1.5" stroke="#7a7a85" strokeWidth="1.2" />
            <circle cx="8" cy="11" r="2" stroke="#7a7a85" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className={`rtx-order-dialog__toolbar-btn ${chartShift ? 'rtx-order-dialog__toolbar-btn--boxed' : ''}`}
          title={tr("Shift end of the chart from the right border")}
          onClick={() => setChartShift((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="5" width="2" height="6" stroke="#22c55e" strokeWidth="1.1" />
            <rect x="5.5" y="4" width="2" height="8" stroke="#22c55e" strokeWidth="1.1" />
            <path d="M9 8H12.5M11 6.2L12.8 8L11 9.8" stroke="#3687ff" strokeWidth="1.2" />
            <path d="M14 3V13" stroke="#9ca3af" strokeWidth="1.2" />
          </svg>
        </button>
        <span className="rtx-order-dialog__toolbar-sep" aria-hidden="true" />
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

        <div className="rtx-order-dialog__chart-quotes-sr" aria-label={tr("{{value0}} live bid and ask", { value0: symbol })}>
          <span>{tr("Bid ")}<strong>{bid > 0 ? bid.toFixed(digits) : '—'}</strong></span>
          <span>{tr("Ask ")}<strong>{ask > 0 ? ask.toFixed(digits) : '—'}</strong></span>
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

// ─── MT5 Depth of Market + One Click Trading Pane ────────────────
const DEFAULT_DOM_VOLUMES = [500, 300, 200, 100, 50, 30];

function OrderDialogDomPane({
  symbol,
  bid,
  ask,
  digits,
  pipSize,
  volumeStr,
  onVolumeChange,
  showOneClickTrading,
  onToggleTickChart,
  onSelectDomPrice,
  onMarketAction,
  isMarketExecutionBlocked,
  isPlacing,
}: {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  pipSize: number;
  volumeStr: string;
  onVolumeChange: (val: string) => void;
  showOneClickTrading: boolean;
  onToggleTickChart: () => void;
  onSelectDomPrice: (price: number, side: 'buy' | 'sell') => void;
  onMarketAction: (side: 'buy' | 'sell', slPoints: number, tpPoints: number) => void;
  isMarketExecutionBlocked: boolean;
  isPlacing: boolean;
}) {
  const tr = useUiTranslation();
  const orderBookResult = useLiveOrderBook(symbol, 6);
  const rawOrderBook = (orderBookResult && 'orderBook' in orderBookResult ? orderBookResult.orderBook : orderBookResult) as {
    asks?: { price: number; volume: number }[];
    bids?: { price: number; volume: number }[];
  } | null;
  const positions = useAppStore((s) => s.positions);
  const [domSlPoints, setDomSlPoints] = useState(0);
  const [domTpPoints, setDomTpPoints] = useState(0);
  const [selectedPositionTicket, setSelectedPositionTicket] = useState<string>('');
  const [isClosingPosition, setIsClosingPosition] = useState(false);

  const symbolPositions = useMemo(() => {
    const target = symbol.trim().toUpperCase();
    return positions.filter((p) => {
      const record = p as unknown as Record<string, unknown>;
      const ticketId = Number(record.ticket ?? p.id);
      return String(p.symbol || '').trim().toUpperCase() === target && ticketId > 0;
    });
  }, [positions, symbol]);

  useEffect(() => {
    if (symbolPositions.length === 0) {
      setSelectedPositionTicket('');
      return;
    }
    const readId = (p: (typeof symbolPositions)[number]) => String((p as unknown as Record<string, unknown>).ticket ?? p.id);
    const exists = symbolPositions.some((p) => readId(p) === selectedPositionTicket);
    if (!exists) {
      setSelectedPositionTicket(readId(symbolPositions[0]));
    }
  }, [selectedPositionTicket, symbolPositions]);

  const stepUnit = useMemo(() => {
    const point = Math.pow(10, -Math.max(0, digits));
    return Math.max(point, pipSize || point);
  }, [digits, pipSize]);

  const { asks, bids, maxVolume } = useMemo(() => {
    const safeAsk = ask > 0 ? ask : (bid > 0 ? bid + stepUnit * 2 : 100);
    const safeBid = bid > 0 ? bid : Math.max(stepUnit, safeAsk - stepUnit * 2);

    const liveAsks = Array.isArray(rawOrderBook?.asks) ? rawOrderBook.asks.slice(0, 6) : [];
    const liveBids = Array.isArray(rawOrderBook?.bids) ? rawOrderBook.bids.slice(0, 6) : [];

    const resolvedAsks = liveAsks.length === 6
      ? [...liveAsks].sort((a, b) => b.price - a.price)
      : DEFAULT_DOM_VOLUMES.map((vol, idx) => {
          const levelOffset = (6 - 1 - idx) * stepUnit;
          return {
            price: Number((safeAsk + levelOffset).toFixed(digits)),
            volume: vol,
          };
        });

    const resolvedBids = liveBids.length === 6
      ? [...liveBids].sort((a, b) => b.price - a.price)
      : [...DEFAULT_DOM_VOLUMES].reverse().map((vol, idx) => {
          const levelOffset = idx * stepUnit;
          return {
            price: Number(Math.max(stepUnit, safeBid - levelOffset).toFixed(digits)),
            volume: vol,
          };
        });

    const allVols = [...resolvedAsks, ...resolvedBids].map((r) => r.volume);
    return {
      asks: resolvedAsks,
      bids: resolvedBids,
      maxVolume: Math.max(...allVols, 1),
    };
  }, [ask, bid, digits, rawOrderBook?.asks, rawOrderBook?.bids, stepUnit]);

  const adjustDomVol = (delta: number) => {
    const cur = Number.parseFloat(volumeStr) || 0.01;
    const next = Math.max(0.01, Math.round((cur + delta) * 100) / 100);
    onVolumeChange(next.toFixed(2));
  };

  const handleCloseSelectedPosition = async () => {
    if (!selectedPositionTicket || isClosingPosition) return;
    setIsClosingPosition(true);
    try {
      await api.positions.closePosition(selectedPositionTicket);
    } catch {
      // Handled by global trade feedback
    } finally {
      setIsClosingPosition(false);
    }
  };

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
          className="rtx-order-dialog__toolbar-btn"
          title={tr("Depth of Market mode")}
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
              const barPct = Math.min(100, Math.round((level.volume / maxVolume) * 100));
              return (
                <tr
                  key={`ask-${idx}`}
                  className={`rtx-order-dialog__dom-row rtx-order-dialog__dom-row--ask ${idx === asks.length - 1 ? 'rtx-order-dialog__dom-row--best-ask' : ''}`}
                >
                  <td className="rtx-order-dialog__dom-vol">
                    <span
                      className="rtx-order-dialog__dom-bar rtx-order-dialog__dom-bar--ask"
                      style={{ width: `${barPct}%` }}
                      aria-hidden="true"
                    />
                    <span className="rtx-order-dialog__dom-vol-text">{level.volume}</span>
                  </td>
                  <td
                    className="rtx-order-dialog__dom-price rtx-order-dialog__dom-price--ask"
                    onClick={() => onSelectDomPrice(level.price, 'sell')}
                  >
                    {level.price.toFixed(digits)}
                  </td>
                  <td className="rtx-order-dialog__dom-trade">
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--sell"
                      title={tr("Sell at {{value0}}", { value0: level.price.toFixed(digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'sell')}
                    >
                      ∨
                    </button>
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--buy"
                      title={tr("Buy at {{value0}}", { value0: level.price.toFixed(digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'buy')}
                    >
                      ∧
                    </button>
                  </td>
                </tr>
              );
            })}
            {bids.map((level, idx) => {
              const barPct = Math.min(100, Math.round((level.volume / maxVolume) * 100));
              return (
                <tr
                  key={`bid-${idx}`}
                  className={`rtx-order-dialog__dom-row rtx-order-dialog__dom-row--bid ${idx === 0 ? 'rtx-order-dialog__dom-row--best-bid' : ''}`}
                >
                  <td className="rtx-order-dialog__dom-vol">
                    <span
                      className="rtx-order-dialog__dom-bar rtx-order-dialog__dom-bar--bid"
                      style={{ width: `${barPct}%` }}
                      aria-hidden="true"
                    />
                    <span className="rtx-order-dialog__dom-vol-text">{level.volume}</span>
                  </td>
                  <td
                    className="rtx-order-dialog__dom-price rtx-order-dialog__dom-price--bid"
                    onClick={() => onSelectDomPrice(level.price, 'buy')}
                  >
                    {level.price.toFixed(digits)}
                  </td>
                  <td className="rtx-order-dialog__dom-trade">
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--sell"
                      title={tr("Sell at {{value0}}", { value0: level.price.toFixed(digits) })}
                      onClick={() => onSelectDomPrice(level.price, 'sell')}
                    >
                      ∨
                    </button>
                    <button
                      type="button"
                      className="rtx-order-dialog__dom-chevron rtx-order-dialog__dom-chevron--buy"
                      title={tr("Buy at {{value0}}", { value0: level.price.toFixed(digits) })}
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

      {showOneClickTrading && (
        <div className="rtx-order-dialog__dom-oct" data-testid="order-dom-oct">
          <div className="rtx-order-dialog__dom-oct-spinners">
            <div className="rtx-order-dialog__dom-oct-box">
              <button
                type="button"
                className="rtx-order-dialog__dom-oct-step"
                aria-label={tr("Decrease DOM stop loss")}
                onClick={() => setDomSlPoints((v) => Math.max(0, v - 10))}
              >▼</button>
              <div className="rtx-order-dialog__dom-oct-field">
                <span className="rtx-order-dialog__dom-oct-tag">sl</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={domSlPoints}
                  onChange={(e) => setDomSlPoints(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0))}
                  aria-label="DOM SL points"
                />
              </div>
              <button
                type="button"
                className="rtx-order-dialog__dom-oct-step"
                aria-label={tr("Increase DOM stop loss")}
                onClick={() => setDomSlPoints((v) => v + 10)}
              >▲</button>
            </div>

            <div className="rtx-order-dialog__dom-oct-box">
              <button
                type="button"
                className="rtx-order-dialog__dom-oct-step"
                aria-label={tr("Decrease DOM volume")}
                onClick={() => adjustDomVol(-0.01)}
              >▼</button>
              <div className="rtx-order-dialog__dom-oct-field">
                <span className="rtx-order-dialog__dom-oct-tag">vol</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={volumeStr}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) onVolumeChange(val);
                  }}
                  aria-label="DOM volume"
                />
              </div>
              <button
                type="button"
                className="rtx-order-dialog__dom-oct-step"
                aria-label={tr("Increase DOM volume")}
                onClick={() => adjustDomVol(0.01)}
              >▲</button>
            </div>

            <div className="rtx-order-dialog__dom-oct-box">
              <button
                type="button"
                className="rtx-order-dialog__dom-oct-step"
                aria-label={tr("Decrease DOM take profit")}
                onClick={() => setDomTpPoints((v) => Math.max(0, v - 10))}
              >▼</button>
              <div className="rtx-order-dialog__dom-oct-field">
                <span className="rtx-order-dialog__dom-oct-tag">tp</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={domTpPoints}
                  onChange={(e) => setDomTpPoints(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0))}
                  aria-label="DOM TP points"
                />
              </div>
              <button
                type="button"
                className="rtx-order-dialog__dom-oct-step"
                aria-label={tr("Increase DOM take profit")}
                onClick={() => setDomTpPoints((v) => v + 10)}
              >▲</button>
            </div>
          </div>

          <select
            className="rtx-order-dialog__dom-oct-positions"
            value={selectedPositionTicket}
            onChange={(e) => setSelectedPositionTicket(e.target.value)}
            aria-label={tr("Open positions for {{value0}}", { value0: symbol })}
          >
            {symbolPositions.length === 0 ? (
              <option value="">{symbol}</option>
            ) : (
              symbolPositions.map((pos) => {
                const raw = pos as unknown as Record<string, unknown>;
                const ticket = String(raw.ticket ?? pos.id);
                const side = String(pos.side || 'buy').toLowerCase();
                const vol = Number(pos.volume ?? raw.quantity ?? 0.01).toFixed(2);
                const openPrice = Number(raw.price_open ?? pos.open_price ?? 0).toFixed(digits);
                return (
                  <option key={ticket} value={ticket}>
                    {`#${ticket} ${side} ${vol} ${symbol} ${openPrice}`}
                  </option>
                );
              })
            )}
          </select>

          <div className="rtx-order-dialog__dom-oct-actions">
            <button
              type="button"
              className="rtx-order-dialog__dom-oct-btn rtx-order-dialog__dom-oct-btn--sell"
              disabled={isPlacing || bid <= 0 || isMarketExecutionBlocked}
              onClick={() => onMarketAction('sell', domSlPoints, domTpPoints)}
            >
              {tr("Sell")}
            </button>
            <button
              type="button"
              className="rtx-order-dialog__dom-oct-btn rtx-order-dialog__dom-oct-btn--close"
              disabled={!selectedPositionTicket || isClosingPosition}
              onClick={handleCloseSelectedPosition}
            >
              {tr("Close")}
            </button>
            <button
              type="button"
              className="rtx-order-dialog__dom-oct-btn rtx-order-dialog__dom-oct-btn--buy"
              disabled={isPlacing || ask <= 0 || isMarketExecutionBlocked}
              onClick={() => onMarketAction('buy', domSlPoints, domTpPoints)}
            >
              {tr("Buy")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
  marketStatus,
  symbols: accountSymbols,
}: OrderPanelProps) {
  const tr = useUiTranslation();
  const [symbol, setSymbol] = useState(initialSymbol);
  const [orderType, setOrderType] = useState<OrderType>(initialOrderType ?? 'Market Execution');
  const [volumeStr, setVolumeStr] = useState(() => localStorage.getItem('lastLotSize') || '0.01');
  const [priceStr, setPriceStr] = useState(() => (
    initialPrice !== undefined && Number.isFinite(initialPrice) && initialPrice > 0
      ? String(initialPrice)
      : '0.00'
  ));
  const [stopLimitPriceStr, setStopLimitPriceStr] = useState('0.00');
  const [stopLossStr, setStopLossStr] = useState('0.00');
  const [takeProfitStr, setTakeProfitStr] = useState('0.00');
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

  const config = getInstrumentConfig(symbol, tick?.digits);
  const { digits, pipSize, contractSize } = config;
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
    }
  }, [isOpen, initialSymbol]);

  const spread = ask - bid;
  const spreadDisplay = formatSpreadDisplayWithUnit(symbol, spread, bid, ask);
  const propMarketStatus = marketStatus?.symbol === symbol.toUpperCase()
    ? marketStatus
    : null;
  const effectiveMarketStatus = liveMarketStatus.loading && propMarketStatus
    ? propMarketStatus
    : liveMarketStatus;
  const marketBlockedMessage = getMarketStatusTradeBlockMessage(effectiveMarketStatus, symbol);
  const isMarketExecutionBlocked = orderType === 'Market Execution'
    && shouldBlockSymbolTrading(effectiveMarketStatus, symbol);

  const baseCurrency = marginCurrency || account?.currency || config.currency;

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
    const step = Math.max(Math.pow(10, -Math.max(0, digits)), pipSize || 0.01);
    const parsed = Number.parseFloat(currentValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      const seed = anchorPrice > 0 ? anchorPrice : (bid || ask || step);
      setter(seed.toFixed(digits));
      return;
    }
    const next = Math.max(0, parsed + direction * step);
    setter(next.toFixed(digits));
  };

  const parsedPrice = Number.parseFloat(priceStr);
  const parsedStopLimitPrice = Number.parseFloat(stopLimitPriceStr);
  const parsedStopLoss = Number.parseFloat(stopLossStr);
  const parsedTakeProfit = Number.parseFloat(takeProfitStr);

  const isPendingPriceReady = orderType === 'Market Execution'
    ? true
    : orderType === 'Stop Limit Order'
      ? (Number.isFinite(parsedPrice) && parsedPrice > 0 && Number.isFinite(parsedStopLimitPrice) && parsedStopLimitPrice > 0)
      : (Number.isFinite(parsedPrice) && parsedPrice > 0);

  const handleSubmit = useCallback(async (
    side: 'buy' | 'sell',
    overrideProtection?: { priceSl?: number; priceTp?: number; forceMarket?: boolean },
  ) => {
    if (isPlacing) return;
    const effectiveOrderType = overrideProtection?.forceMarket ? 'Market Execution' : orderType;
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
        : (Number.isFinite(parsedStopLoss) && parsedStopLoss > 0 ? parsedStopLoss : undefined);
      const tpVal = overrideProtection?.priceTp !== undefined
        ? overrideProtection.priceTp
        : (Number.isFinite(parsedTakeProfit) && parsedTakeProfit > 0 ? parsedTakeProfit : undefined);

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
        ...(effectiveOrderType !== 'Market Execution' ? {
          orderType: effectiveOrderType,
          price: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined,
          stopLimitPrice: effectiveOrderType === 'Stop Limit Order' && Number.isFinite(parsedStopLimitPrice) && parsedStopLimitPrice > 0
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
    parsedPrice,
    parsedStopLimitPrice,
    parsedStopLoss,
    parsedTakeProfit,
    symbol,
    tr,
    volumeStr,
  ]);

  const handleSelectDomPrice = useCallback((clickedPrice: number, side: 'buy' | 'sell') => {
    setPriceStr(clickedPrice.toFixed(digits));
    if (orderType === 'Market Execution') {
      setOrderType('Limit Order');
    }
    void side;
  }, [digits, orderType]);

  const handleDomMarketAction = useCallback((side: 'buy' | 'sell', slPoints: number, tpPoints: number) => {
    const point = Math.pow(10, -Math.max(0, digits));
    const refPrice = side === 'buy' ? ask : bid;
    const priceSl = slPoints > 0 && refPrice > 0
      ? Number((side === 'buy' ? refPrice - slPoints * point : refPrice + slPoints * point).toFixed(digits))
      : undefined;
    const priceTp = tpPoints > 0 && refPrice > 0
      ? Number((side === 'buy' ? refPrice + tpPoints * point : refPrice - tpPoints * point).toFixed(digits))
      : undefined;
    void handleSubmit(side, { priceSl, priceTp, forceMarket: true });
  }, [ask, bid, digits, handleSubmit]);

  if (!isOpen) return null;

  const fullSymbolDescription = resolveSymbolDescription(symbol, SYMBOL_NAMES[symbol]);
  const headerTitleText = fullSymbolDescription
    ? `${tr("Order")}: ${symbol} - ${fullSymbolDescription}`
    : `${tr("Order")}: ${symbol}`;

  const symbolFieldId = `new-order-${symbol}-symbol`;
  const volumeFieldId = `new-order-${symbol}-volume`;
  const priceFieldId = `new-order-${symbol}-price`;
  const stopLimitPriceFieldId = `new-order-${symbol}-stop-limit-price`;
  const stopLossFieldId = `new-order-${symbol}-stop-loss`;
  const takeProfitFieldId = `new-order-${symbol}-take-profit`;
  const fillPolicyFieldId = `new-order-${symbol}-fill-policy`;
  const expirationFieldId = `new-order-${symbol}-expiration`;
  const expirationDateFieldId = `new-order-${symbol}-expiration-date`;
  const commentFieldId = `new-order-${symbol}-comment`;

  const contractUnitsText = formatContractUnitsSummary(volumeStr, symbol, contractSize);

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
          {/* Column 1: Left Mode & View Sidebar */}
          <div className="rtx-order-dialog__sidebar" role="navigation" aria-label={tr("Order execution modes and panels")}>
            <div className="rtx-order-dialog__sidebar-top">
              <button
                type="button"
                data-testid="order-mode-market"
                className={`rtx-order-dialog__mode-btn ${orderType === 'Market Execution' ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Market Execution")}
                onClick={() => setOrderType('Market Execution')}
              >
                <svg className="rtx-order-dialog__mode-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3 14.5L7.5 9L10.5 11.5L16.5 4.5M16.5 4.5H12.8M16.5 4.5V8.2" stroke="#3687ff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Market Execution")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-mode-limit"
                className={`rtx-order-dialog__mode-btn ${orderType === 'Limit Order' ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Limit Order")}
                onClick={() => setOrderType('Limit Order')}
              >
                <svg className="rtx-order-dialog__mode-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3.5 6L8.5 13L12 8.5L16 4.5M16 4.5H12.8M16 4.5V7.7" stroke="#3687ff" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2.5 14H17.5" stroke="#f23645" strokeWidth="1.35" />
                  <circle cx="8.5" cy="14" r="1.3" fill="#f23645" />
                  <circle cx="13.5" cy="14" r="1.3" fill="#f23645" />
                </svg>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Limit Order")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-mode-stop"
                className={`rtx-order-dialog__mode-btn ${orderType === 'Stop Order' ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Stop Order")}
                onClick={() => setOrderType('Stop Order')}
              >
                <svg className="rtx-order-dialog__mode-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M4 15.5L9.5 10L15.5 4M15.5 4H12.2M15.5 4V7.3" stroke="#3687ff" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2.5 10H17.5" stroke="#f23645" strokeWidth="1.35" />
                  <circle cx="9.5" cy="10" r="1.3" fill="#f23645" />
                  <circle cx="14" cy="10" r="1.3" fill="#f23645" />
                </svg>
                {isSidebarExpanded && <span className="rtx-order-dialog__mode-label">{tr("Stop Order")}</span>}
              </button>

              <button
                type="button"
                data-testid="order-mode-stop-limit"
                className={`rtx-order-dialog__mode-btn ${orderType === 'Stop Limit Order' ? 'rtx-order-dialog__mode-btn--active' : ''}`}
                title={tr("Stop Limit Order")}
                onClick={() => setOrderType('Stop Limit Order')}
              >
                <svg className="rtx-order-dialog__mode-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M2.5 8H17.5M2.5 13H17.5" stroke="#9ca3af" strokeWidth="1.1" />
                  <path d="M3.5 15.5L8.5 6.5L11.5 13L16 5M16 5H13.2M16 5V7.8" stroke="#3687ff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="7.5" cy="8" r="1.3" fill="#f23645" />
                  <circle cx="11.5" cy="13" r="1.3" fill="#f23645" />
                </svg>
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
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
            <div className="rtx-order-dialog__field rtx-order-dialog__field--symbol">
              <label
                className={`rtx-order-dialog__label ${isSidebarExpanded ? '' : 'rtx-order-dialog__label--compact-symbol'}`}
                htmlFor={symbolFieldId}
              >
                {tr("Symbol")}
              </label>
              <select
                id={symbolFieldId}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="rtx-order-dialog__control"
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
                          setPriceStr(Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(digits) : '0.00');
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
                      className={`rtx-order-dialog__volume-control ${orderType !== 'Stop Limit Order' ? 'rtx-order-dialog__volume-control--disabled' : ''}`}
                    >
                      <input
                        id={stopLimitPriceFieldId}
                        type="text"
                        inputMode="decimal"
                        disabled={orderType !== 'Stop Limit Order'}
                        value={stopLimitPriceStr}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) setStopLimitPriceStr(val);
                        }}
                        onBlur={() => {
                          const parsed = Number.parseFloat(stopLimitPriceStr);
                          setStopLimitPriceStr(Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(digits) : '0.00');
                        }}
                        className="rtx-order-dialog__volume-input"
                      />
                      <div className="rtx-order-dialog__spinner">
                        <button
                          type="button"
                          disabled={orderType !== 'Stop Limit Order'}
                          aria-label={tr("Increase stop limit price")}
                          onClick={() => stepPriceField(stopLimitPriceStr, setStopLimitPriceStr, 1, ask || bid)}
                          className="rtx-order-dialog__spinner-button"
                        >▲</button>
                        <button
                          type="button"
                          disabled={orderType !== 'Stop Limit Order'}
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
                      setStopLossStr(Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(digits) : '0.00');
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
                      setTakeProfitStr(Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(digits) : '0.00');
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
                <div className="rtx-order-dialog__fill-policy-wrap">
                  <div className="rtx-order-dialog__fill-tabs" role="tablist">
                    {(['Fill or Kill', 'Immediate or Cancel', 'Return'] as const).map((policy) => (
                      <button
                        key={policy}
                        type="button"
                        role="tab"
                        aria-selected={fillPolicy === policy}
                        className={`rtx-order-dialog__fill-tab ${fillPolicy === policy ? 'rtx-order-dialog__fill-tab--active' : ''}`}
                        onClick={() => setFillPolicy(policy)}
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
                  >
                    <option value="Fill or Kill">{tr("Fill or Kill")}</option>
                    <option value="Immediate or Cancel">{tr("Immediate or Cancel")}</option>
                    <option value="Return">{tr("Return")}</option>
                  </select>
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

            {error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--error" role="alert">{tr(error)}</div>
            )}
            {isMarketExecutionBlocked && !error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--warning" role="status">
                {marketBlockedMessage || tr('Market is closed for {{value0}}.', { value0: symbol })}
              </div>
            )}

            <div
              className="rtx-order-dialog__price-summary"
              aria-label={tr("Bid {{value0}}, Ask {{value1}}", { value0: bid.toFixed(digits), value1: ask.toFixed(digits) })}
            >
              <span className="rtx-order-dialog__mt5-quote">
                {formatMt5QuotePrice(bid, digits)} / {formatMt5QuotePrice(ask, digits)}
              </span>
              <span className="rtx-order-dialog__spread-sr">{tr("Spread: ")}{spreadDisplay}</span>
            </div>

            {orderType === 'Market Execution' ? (
              <div className="rtx-order-dialog__actions">
                <button
                  type="button"
                  onClick={() => handleSubmit('sell')}
                  disabled={isPlacing || bid <= 0 || isMarketExecutionBlocked}
                  className="rtx-order-dialog__action rtx-order-dialog__action--sell"
                >
                  {isPlacing ? tr("Placing...") : tr("Sell by Market")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit('buy')}
                  disabled={isPlacing || ask <= 0 || isMarketExecutionBlocked}
                  className="rtx-order-dialog__action rtx-order-dialog__action--buy"
                >
                  {isPlacing ? tr("Placing...") : tr("Buy by Market")}
                </button>
              </div>
            ) : (
              <div className="rtx-order-dialog__actions">
                <button
                  type="button"
                  onClick={() => handleSubmit('sell')}
                  disabled={isPlacing || !isPendingPriceReady}
                  className="rtx-order-dialog__action rtx-order-dialog__action--sell"
                >
                  {isPlacing ? tr("Placing...") : tr("Sell")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit('buy')}
                  disabled={isPlacing || !isPendingPriceReady}
                  className="rtx-order-dialog__action rtx-order-dialog__action--buy"
                >
                  {isPlacing ? tr("Placing...") : tr("Buy")}
                </button>
              </div>
            )}

            <div className="rtx-order-dialog__status-box" aria-live="polite">
              {isPlacing && <div className="rtx-order-dialog__progress-bar" />}
            </div>
          </div>

          {/* Column 3: Middle Tick Chart Pane */}
          {showTickChart && (
            <div className="rtx-order-dialog__chart">
              <MiniTickChart
                symbol={symbol}
                bid={bid}
                ask={ask}
                digits={digits}
                chartColors={chartColors}
                orderPrice={orderType !== 'Market Execution' && Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined}
                stopLossPrice={Number.isFinite(parsedStopLoss) && parsedStopLoss > 0 ? parsedStopLoss : undefined}
                takeProfitPrice={Number.isFinite(parsedTakeProfit) && parsedTakeProfit > 0 ? parsedTakeProfit : undefined}
              />
            </div>
          )}

          {/* Column 4: Right Depth of Market + One Click Trading Pane */}
          {showDom && (
            <OrderDialogDomPane
              symbol={symbol}
              bid={bid}
              ask={ask}
              digits={digits}
              pipSize={pipSize}
              volumeStr={volumeStr}
              onVolumeChange={setVolumeStr}
              showOneClickTrading={showOneClickTrading}
              onToggleTickChart={() => setShowTickChart((v) => !v)}
              onSelectDomPrice={handleSelectDomPrice}
              onMarketAction={handleDomMarketAction}
              isMarketExecutionBlocked={isMarketExecutionBlocked}
              isPlacing={isPlacing}
            />
          )}
        </div>
      </div>
    </div>
  );
}

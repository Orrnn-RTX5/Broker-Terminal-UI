import { useUiTranslation } from '../hooks/useUiTranslation';
import { useTerminalQuoteFreshness } from '../hooks/useTerminalQuoteFreshness';
import { useQuoteSubscription } from '../hooks/useQuoteSubscription';
import { assertTerminalMarketOrderQuote, canSubmitTerminalMarketOrder, assertTerminalQuoteFresh, terminalMarketQuoteAdvisory, terminalQuoteBlockMessage, terminalQuoteFreshnessEnabled } from '../services/terminalQuoteFreshness';
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { getEffectiveChartColors, useChartSettingsStore } from '../store/useChartSettingsStore';
import { useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import {
  getMarketStatusTradeBlockMessage,
  shouldBlockSymbolTrading,
  type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { formatPriceParts } from './ui/PriceDisplay';
import { formatSpreadDisplayWithUnit } from '../utils/spread';
import { RTX_ADVANCED_VIEW_CHANGE_EVENT } from '../utils/advancedViewRootClasses';
import { tradeApi } from '../api/trade';
import { getStoredAccountLogin } from '../api/tradeGateway';
import { buildOrderTicketSymbolOptions } from '../utils/accountSymbolUniverse';
import { formatTradeVolume, isTradeVolumeValid, parseTradeVolumeDraft, resolveTradeVolumeConstraints, type TradeVolumeMetadata } from '../utils/tradeVolume';
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

type OrderType = 'Market Execution' | 'Buy Limit' | 'Sell Limit' | 'Buy Stop' | 'Sell Stop' | 'Buy Stop Limit' | 'Sell Stop Limit';
type FillPolicy = 'Fill or Kill' | 'Immediate or Cancel' | 'Return';

interface OrderPanelProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  currentPrice: { bid: number; ask: number };
  onSubmitOrder: (order: any) => Promise<void> | void;
  marketStatus?: NormalizedMarketStatus;
  /**
   * Symbols the logged-in account may trade (its group catalogue). When
   * provided, the symbol dropdown offers only these instead of every quote
   * present in the tick store.
   */
  symbols?: readonly string[];
  instruments?: ReadonlyArray<TradeVolumeMetadata & { symbol: string }>;
  authorizedSymbols?: readonly string[];
  authorizationSettled?: boolean;
}

// Instrument config helper.
// NOTE: contractSize/currency are still prefix heuristics (no per-symbol catalog
// is threaded into this dialog), but `digits` — and therefore `pipSize` — are
// taken from the live feed (`liveDigits`) whenever the feed provides them, so the
// price grid and spread match the broker's real precision instead of a guess.
export function getInstrumentConfig(sym: string, liveDigits?: number) {
  const base = (() => {
    if (sym.startsWith('BTC')) return { digits: 2, pipSize: 1, contractSize: 1, currency: 'BTC' };
    if (sym.startsWith('ETH')) return { digits: 2, pipSize: 0.01, contractSize: 1, currency: 'ETH' };
    if (sym.startsWith('XAU')) return { digits: 2, pipSize: 0.01, contractSize: 100, currency: 'USD' };
    if (sym.startsWith('XAG')) return { digits: 3, pipSize: 0.001, contractSize: 5000, currency: 'USD' };
    if (sym.includes('JPY')) return { digits: 3, pipSize: 0.01, contractSize: 100000, currency: sym.slice(0, 3) };
    return { digits: 5, pipSize: 0.0001, contractSize: 100000, currency: sym.slice(0, 3) };
  })();

  // Prefer the broker-reported precision when available. A pip is the last whole
  // price increment, i.e. 10^-(digits-1) for fractional-pip (5/3-digit) quotes and
  // 10^-digits otherwise — matching the heuristic defaults above.
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

type TickChartColors = {
  background: string;
  foreground: string;
  grid: string;
};

type TickPoint = { time: number; bid: number; ask: number };

const formatTickTime = (time: number): string => {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
};

// ─── Enterprise tick chart ───────────────────────────────────────
function MiniTickChart({
  symbol,
  bid,
  ask,
  digits,
  chartColors,
}: {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  chartColors: TickChartColors;
}) {
    const tr = useUiTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tickHistoryRef = useRef<TickPoint[]>([]);
  const frameRef = useRef<number | null>(null);

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
      const cssWidth = Math.max(320, Math.round(canvas.clientWidth || 420));
      const cssHeight = Math.max(240, Math.round(canvas.clientHeight || 314));
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
        background: chartColors.background || readCssValue('--bg-primary', '#0d0d11'),
        foreground: chartColors.foreground || readCssValue('--text-secondary', '#808088'),
        grid: chartColors.grid || readCssValue('--border-primary', '#28282e'),
        axisSurface: readCssValue('--order-chart-axis-surface', '#131316'),
        axis: readCssValue('color', '#a1a1aa'),
        bid: readCssValue('--order-bid', '#ff4d4f'),
        ask: readCssValue('--order-ask', '#7aacca'),
        tagText: readCssValue('--order-tag-text', '#fff'),
        monoFont: readCssValue('--font-mono', 'ui-monospace, Consolas, monospace'),
      };

      const tokenSize = Number.parseFloat(readCssValue('--rtx-ui-font-size', '14'));
      const fontSize = Number.isFinite(tokenSize) && tokenSize > 0 ? tokenSize : 14;
      const fontFamily = document.documentElement.classList.contains('rtx-skin-untitled-light')
        ? readCssValue('--font-sans', palette.monoFont)
        : palette.monoFont;
      const bodyFont = `${readCssValue('--rtx-font-weight-body', '400')} ${fontSize}px ${fontFamily}`;
      const controlFont = `${readCssValue('--rtx-font-weight-control', '400')} ${fontSize}px ${fontFamily}`;
      ctx.font = controlFont;

      const width = cssWidth;
      const height = cssHeight;
      const left = 12;
      const right = Math.max(72, Math.ceil(ctx.measureText(Math.max(Math.abs(bid), Math.abs(ask)).toFixed(digits)).width) + 20);
      const tagHeight = Math.ceil(fontSize * 1.5) + 2;
      const top = tagHeight / 2 + 4;
      const bottom = tagHeight + 7;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const plotRight = left + plotWidth;
      const plotBottom = top + plotHeight;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = palette.axisSurface;
      ctx.fillRect(plotRight, 0, right, height);

      ctx.strokeStyle = palette.grid;
      ctx.globalAlpha = 0.68;
      ctx.lineWidth = 0.75;
      for (let index = 0; index <= 4; index += 1) {
        const x = left + (index / 4) * plotWidth;
        const y = top + (index / 4) * plotHeight;

        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotRight, 0);
      ctx.lineTo(plotRight, height);
      ctx.stroke();

      const history = tickHistoryRef.current;
      if (history.length === 0) {
        ctx.fillStyle = palette.axis;
        ctx.font = bodyFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tr('Waiting for the first live quote from the broker.'), left + plotWidth / 2, top + plotHeight / 2, plotWidth - 20);
        return;
      }

      const plotHistory = history.length === 1
        ? [{ ...history[0], time: history[0].time - 1_000 }, history[0]]
        : history;

      let minPrice = Number.POSITIVE_INFINITY;
      let maxPrice = Number.NEGATIVE_INFINITY;
      for (const tick of plotHistory) {
        minPrice = Math.min(minPrice, tick.bid, tick.ask);
        maxPrice = Math.max(maxPrice, tick.bid, tick.ask);
      }

      const priceStep = Math.pow(10, -digits);
      const observedRange = maxPrice - minPrice;
      const minimumRange = Math.max(priceStep * 8, Math.abs(ask - bid) * 5);
      if (observedRange < minimumRange) {
        const midpoint = (maxPrice + minPrice) / 2;
        minPrice = midpoint - minimumRange / 2;
        maxPrice = midpoint + minimumRange / 2;
      }
      const padding = Math.max((maxPrice - minPrice) * 0.1, priceStep * 2);
      minPrice -= padding;
      maxPrice += padding;
      const totalRange = Math.max(maxPrice - minPrice, priceStep);

      const timeStart = plotHistory[0].time;
      const timeEnd = plotHistory[plotHistory.length - 1].time;
      const timeRange = Math.max(timeEnd - timeStart, 1_000);
      const xOf = (time: number) => left + ((time - timeStart) / timeRange) * plotWidth;
      const yOf = (price: number) => top + plotHeight - ((price - minPrice) / totalRange) * plotHeight;

      ctx.fillStyle = palette.axis;
      ctx.font = bodyFont;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let index = 0; index <= 4; index += 1) {
        const price = maxPrice - (index / 4) * totalRange;
        const y = top + (index / 4) * plotHeight;
        ctx.fillText(price.toFixed(digits), plotRight + 6, y);
      }

      ctx.textBaseline = 'alphabetic';
      for (let index = 0; index <= 2; index += 1) {
        const time = timeStart + (index / 2) * timeRange;
        const x = xOf(time);
        ctx.textAlign = index === 0 ? 'left' : index === 2 ? 'right' : 'center';
        ctx.fillText(formatTickTime(time), x, height - 7);
      }

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
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };

      // A restrained spread band gives the two live traces visual structure
      // without smoothing or inventing any market data.
      ctx.beginPath();
      plotHistory.forEach((tick, index) => {
        const x = xOf(tick.time);
        const y = yOf(tick.ask);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      [...plotHistory].reverse().forEach((tick) => ctx.lineTo(xOf(tick.time), yOf(tick.bid)));
      ctx.closePath();
      ctx.fillStyle = palette.ask;
      ctx.globalAlpha = 0.08;
      ctx.fill();
      ctx.globalAlpha = 1;

      const lastTick = plotHistory[plotHistory.length - 1];
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 4]);
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      ([['bid', palette.bid], ['ask', palette.ask]] as const).forEach(([key, color]) => {
        ctx.beginPath();
        ctx.moveTo(left, yOf(lastTick[key]));
        ctx.lineTo(plotRight, yOf(lastTick[key]));
        ctx.strokeStyle = color;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);

      traceLine('bid', palette.bid);
      traceLine('ask', palette.ask);

      ([['bid', palette.bid], ['ask', palette.ask]] as const).forEach(([key, color]) => {
        ctx.beginPath();
        ctx.arc(xOf(lastTick.time), yOf(lastTick[key]), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      let bidTagY = yOf(lastTick.bid);
      let askTagY = yOf(lastTick.ask);
      const minimumTagGap = tagHeight + 3;
      if (Math.abs(bidTagY - askTagY) < minimumTagGap) {
        const midpoint = (bidTagY + askTagY) / 2;
        bidTagY = midpoint + minimumTagGap / 2;
        askTagY = midpoint - minimumTagGap / 2;
      }
      const tagInset = tagHeight / 2 + 1;
      bidTagY = Math.max(top + tagInset, Math.min(plotBottom - tagInset, bidTagY));
      askTagY = Math.max(top + tagInset, Math.min(plotBottom - tagInset, askTagY));

      ctx.font = controlFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ([
        [lastTick.bid, bidTagY, palette.bid],
        [lastTick.ask, askTagY, palette.ask],
      ] as const).forEach(([price, y, color]) => {
        ctx.fillStyle = color;
        ctx.fillRect(plotRight, y - tagHeight / 2, right, tagHeight);
        ctx.fillStyle = palette.tagText;
        ctx.fillText(price.toFixed(digits), plotRight + 6, y);
      });
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
  }, [ask, bid, chartColors, digits, symbol, tr]);

  return (
    <div className="rtx-order-dialog__chart-shell">
      <div className="rtx-order-dialog__chart-header">
        <div className="rtx-order-dialog__chart-identity">
          <span className="rtx-order-dialog__chart-symbol">{symbol}</span>
          <span className="rtx-order-dialog__chart-meta">
            <span className="rtx-order-dialog__live-dot" aria-hidden="true" />
            {tr("Tick chart · 5 min")}</span>
        </div>
        <div className="rtx-order-dialog__chart-quotes" aria-label={tr("{{value0}} live bid and ask", { value0: symbol })}>
          <span className="rtx-order-dialog__chart-quote rtx-order-dialog__chart-quote--bid">
            {tr("Bid ")}<strong>{bid > 0 ? bid.toFixed(digits) : '—'}</strong>
          </span>
          <span className="rtx-order-dialog__chart-quote rtx-order-dialog__chart-quote--ask">
            {tr("Ask ")}<strong>{ask > 0 ? ask.toFixed(digits) : '—'}</strong>
          </span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={314}
        className="rtx-order-dialog__chart-canvas"
        data-testid="order-mini-tick-chart"
        role="img"
        aria-label={tr("Live {{value0}} bid and ask tick chart", { value0: symbol })}
      />
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
  marketStatus,
  symbols: accountSymbols,
  instruments,
  authorizedSymbols,
  authorizationSettled = true,
}: OrderPanelProps) {
    const tr = useUiTranslation();
  const [symbol, setSymbol] = useState(initialSymbol);
  const quoteDemandId = React.useId();
  useQuoteSubscription(isOpen && symbol ? [symbol] : [], `order-dialog:${quoteDemandId}`, {
    enabled: terminalQuoteFreshnessEnabled() && isOpen,
  });
  const [orderType] = useState<OrderType>('Market Execution');
  const specification = instruments?.find(instrument => instrument.symbol === symbol);
  const { minVolume, maxVolume, volumeStep } = specification ?? {};
  const volumeConstraints = useMemo(() => resolveTradeVolumeConstraints({ minVolume, maxVolume, volumeStep }),
    [minVolume, maxVolume, volumeStep]);
  const hasVolumeSpecifications = instruments === undefined || Boolean(specification
    && [specification.minVolume, specification.maxVolume, specification.volumeStep].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
    && specification.maxVolume! >= specification.minVolume!);
  const tradingAuthorized = authorizationSettled && hasVolumeSpecifications
    && (authorizedSymbols === undefined || authorizedSymbols.includes(symbol));
  // Catalogue refreshes update validation without replacing the user's text.
  const [volumeStr, setVolumeStr] = useState(() => localStorage.getItem('lastLotSize')
    || formatTradeVolume(volumeConstraints.min, volumeConstraints));
  const parsedVolume = parseTradeVolumeDraft(volumeStr);
  const volumeValid = parsedVolume !== null && isTradeVolumeValid(parsedVolume, volumeConstraints);
  const volumeMessage = !tradingAuthorized ? 'Trading configuration unavailable for this symbol.'
    : !volumeValid ? `Volume must be between ${volumeConstraints.min} and ${volumeConstraints.max ?? 'the permitted maximum'}, in steps of ${volumeConstraints.step}.` : '';
  const [fillPolicy, setFillPolicy] = useState<FillPolicy>('Fill or Kill');
  const [comment, setComment] = useState('');
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiredMargin, setRequiredMargin] = useState<number | null>(null);
  const [marginCurrency, setMarginCurrency] = useState('');
  const liveMarketStatus = useSymbolMarketStatus(symbol, {
    enabled: isOpen && Boolean(symbol),
  });

  const tick = useAppStore((s) => s.ticks[symbol]);
  const account = useAppStore((s) => s.account);
  // Only needed for callers without an account catalogue (legacy fallback).
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
  const { digits } = config;
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
  const quoteFreshness = useTerminalQuoteFreshness(symbol);
  const quoteAdvisory = terminalQuoteFreshnessEnabled() && orderType === 'Market Execution'
    ? terminalMarketQuoteAdvisory(quoteFreshness) : null;
  const quoteBlocked = terminalQuoteFreshnessEnabled() && !(orderType === 'Market Execution' ? canSubmitTerminalMarketOrder(quoteFreshness) : quoteFreshness.live);
  const marketBlockedMessage = quoteBlocked ? terminalQuoteBlockMessage(quoteFreshness.reason, symbol) : getMarketStatusTradeBlockMessage(effectiveMarketStatus, symbol);
  const isMarketExecutionBlocked = quoteBlocked || (orderType === 'Market Execution'
    && shouldBlockSymbolTrading(effectiveMarketStatus, symbol));

  const formatPrice = (price: number) => {
    return formatPriceParts(price, symbol, digits);
  };

  const baseCurrency = marginCurrency || account?.currency || config.currency;

  useEffect(() => {
    if (!isOpen) {
      setRequiredMargin(null);
      return;
    }
    const login = getStoredAccountLogin();
    const volume = parsedVolume;
    if (!login || !symbol || !tradingAuthorized || !volumeValid || volume === null) {
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
  }, [isOpen, symbol, parsedVolume, tradingAuthorized, volumeValid]);

  const adjustVolume = (delta: number) => {
    const current = parseTradeVolumeDraft(volumeStr) ?? volumeConstraints.min;
    setVolumeStr(formatTradeVolume(current + delta * volumeConstraints.step, volumeConstraints));
  };

  const handleSubmit = useCallback(async (side: 'buy' | 'sell') => {
    if (isPlacing) return;
    if (!tradingAuthorized || !volumeValid || parsedVolume === null) { setError(volumeMessage); return; }
    if (isMarketExecutionBlocked) {
      setError(marketBlockedMessage || tr('Market is closed for {{value0}}.', { value0: symbol }));
      return;
    }
    setIsPlacing(true);
    setError(null);

    try {
      if (orderType === 'Market Execution') assertTerminalMarketOrderQuote(symbol);
      else assertTerminalQuoteFresh(symbol);
      const volume = parsedVolume;
      localStorage.setItem('lastLotSize', volume.toString());

      await onSubmitOrder({
        type: side,
        volume,
        symbol,
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
  }, [orderType, isPlacing, isMarketExecutionBlocked, marketBlockedMessage, tradingAuthorized, volumeValid, parsedVolume, volumeMessage, comment, symbol, onSubmitOrder, onClose, tr]);

  if (!isOpen) return null;

  const bidF = formatPrice(bid);
  const askF = formatPrice(ask);

  const dialogTitleId = `new-order-${symbol}-title`;
  const symbolFieldId = `new-order-${symbol}-symbol`;
  const volumeFieldId = `new-order-${symbol}-volume`;
  const fillPolicyFieldId = `new-order-${symbol}-fill-policy`;
  const commentFieldId = `new-order-${symbol}-comment`;

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
        aria-labelledby={dialogTitleId}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: dragRef.current ? 'none' : 'transform 0.1s ease-out'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="rtx-order-dialog__header"
          onMouseDown={handleHeaderMouseDown}
        >
          <span id={dialogTitleId} className="rtx-order-dialog__title">{tr("New Order · ")}{symbol}</span>
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

          <div className="rtx-order-dialog__chart">
            <MiniTickChart
              symbol={symbol}
              bid={bid}
              ask={ask}
              digits={digits}
              chartColors={chartColors}
            />
          </div>

          <div className="rtx-order-dialog__form">

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={symbolFieldId}>{tr("Symbol")}</label>
              <select
                id={symbolFieldId}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="rtx-order-dialog__control"
              >
                {symbolOptions.map(({ symbol: s, disabled }) => (
                  <option key={s} value={s} disabled={disabled}>{SYMBOL_NAMES[s] ? `${s}, ${tr(SYMBOL_NAMES[s])}` : s}</option>
                ))}
              </select>
            </div>

            <div className="rtx-order-dialog__field">
              <span className="rtx-order-dialog__label">{tr("Type")}</span>
              <div className="rtx-order-dialog__control rtx-order-dialog__control--static">{tr("Market Execution")}</div>
            </div>

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={volumeFieldId}>{tr("Volume")}</label>
              <div className="rtx-order-dialog__volume-row">
                <div className="rtx-order-dialog__volume-control">
                  <input
                    id={volumeFieldId}
                    type="text"
                    inputMode="decimal"
                    aria-invalid={!volumeValid}
                    data-volume-min={volumeConstraints.min}
                    data-volume-max={volumeConstraints.max}
                    data-volume-step={volumeConstraints.step}
                    value={volumeStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow empty, digits, dots for free-form decimal entry
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setVolumeStr(val);
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseTradeVolumeDraft(volumeStr);
                      if (hasVolumeSpecifications && parsed !== null && isTradeVolumeValid(parsed, volumeConstraints)) {
                        setVolumeStr(formatTradeVolume(parsed, volumeConstraints));
                      }
                    }}
                    className="rtx-order-dialog__volume-input"
                  />
                  <div className="rtx-order-dialog__spinner">
                    <button
                      type="button"
                      aria-label={tr("Increase volume")}
                      onClick={() => adjustVolume(1)}
                      className="rtx-order-dialog__spinner-button"
                    >▲</button>
                    <button
                      type="button"
                      aria-label={tr("Decrease volume")}
                      onClick={() => adjustVolume(-1)}
                      className="rtx-order-dialog__spinner-button"
                    >▼</button>
                  </div>
                </div>
                <span className="rtx-order-dialog__margin" data-testid="order-required-margin">{formatRequiredMargin(requiredMargin, baseCurrency)}</span>
              </div>
            </div>

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={fillPolicyFieldId}>{tr("Fill policy")}</label>
              <select
                id={fillPolicyFieldId}
                value={fillPolicy}
                onChange={(e) => setFillPolicy(e.target.value as FillPolicy)}
                className="rtx-order-dialog__control"
              >
                <option value={"Fill or Kill"}>{tr("Fill or Kill")}</option>
                <option value={"Immediate or Cancel"}>{tr("Immediate or Cancel")}</option>
                <option value={"Return"}>{tr("Return")}</option>
              </select>
            </div>

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={commentFieldId}>{tr("Comment")}</label>
              <input
                id={commentFieldId}
                type="text"
                maxLength={64}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="rtx-order-dialog__control"
              />
            </div>

            {volumeMessage && !error && <div className="rtx-order-dialog__message rtx-order-dialog__message--warning" role="status">{volumeMessage}</div>}
            {quoteAdvisory && !error && !isMarketExecutionBlocked && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--warning" role="status">{tr(quoteAdvisory)}</div>
            )}
            {error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--error" role="alert">{tr(error)}</div>
            )}
            {isMarketExecutionBlocked && !error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--warning" role="status">
                {marketBlockedMessage || tr('Market is closed for {{value0}}.', { value0: symbol })}
              </div>
            )}

            <div className="rtx-order-dialog__price-summary" aria-label={tr("Bid {{value0}}, Ask {{value1}}", { value0: bid.toFixed(digits), value1: ask.toFixed(digits) })}>
              <div className="rtx-order-dialog__price-side">
                <span className="rtx-order-dialog__price-label">{tr("BID")}</span>
                <span className="rtx-order-dialog__price">
                  {bidF.small}<strong>{bidF.big}</strong>
                </span>
              </div>
              <span className="rtx-order-dialog__price-divider" aria-hidden="true" />
              <div className="rtx-order-dialog__price-side rtx-order-dialog__price-side--ask">
                <span className="rtx-order-dialog__price-label">{tr("ASK")}</span>
                <span className="rtx-order-dialog__price">
                  {askF.small}<strong>{askF.big}</strong>
                </span>
              </div>
            </div>

            <div className="rtx-order-dialog__spread">
              {tr("Spread: ")}{spreadDisplay}
            </div>

            {orderType === 'Market Execution' ? (
              <div className="rtx-order-dialog__actions">
                <button
                  type="button"
                  onClick={() => handleSubmit('sell')}
                  disabled={isPlacing || bid <= 0 || isMarketExecutionBlocked || !tradingAuthorized || !volumeValid}
                  className="rtx-order-dialog__action rtx-order-dialog__action--sell"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                  {isPlacing ? tr("Placing...") : tr("Sell by Market")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit('buy')}
                  disabled={isPlacing || ask <= 0 || isMarketExecutionBlocked || !tradingAuthorized || !volumeValid}
                  className="rtx-order-dialog__action rtx-order-dialog__action--buy"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                  {isPlacing ? tr("Placing...") : tr("Buy by Market")}
                </button>
              </div>
            ) : (
              <div className="rtx-order-dialog__actions rtx-order-dialog__actions--single">
                <button
                  type="button"
                  onClick={() => handleSubmit(orderType.includes('Buy') ? 'buy' : 'sell')}
                  disabled={isPlacing || quoteBlocked || !tradingAuthorized || !volumeValid}
                  className={`rtx-order-dialog__action ${orderType.includes('Buy')
                    ? 'rtx-order-dialog__action--buy'
                    : 'rtx-order-dialog__action--sell'}`}
                >
                  {isPlacing ? tr("Placing...") : tr("Place {{value0}}", { value0: tr(orderType) })}
                </button>
              </div>
            )}

            <div className="rtx-order-dialog__progress" aria-hidden="true">
              {isPlacing && <div className="rtx-order-dialog__progress-bar" />}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

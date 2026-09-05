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
import '../styles/order-panel-dialog.css';

// Symbol display names
const SYMBOL_NAMES: Record<string, string> = {
  EURUSD: 'EURUSD, Euro vs US Dollar',
  GBPUSD: 'GBPUSD, Great Britain Pound vs US Dollar',
  USDJPY: 'USDJPY, US Dollar vs Japanese Yen',
  XAUUSD: 'XAUUSD, Gold vs US Dollar',
  XAGUSD: 'XAGUSD, Silver vs US Dollar',
  BTCUSD: 'BTCUSD, Bitcoin vs US Dollar',
  ETHUSD: 'ETHUSD, Ethereum vs US Dollar',
  AUDUSD: 'AUDUSD, Australian Dollar vs US Dollar',
  USDCAD: 'USDCAD, US Dollar vs Canadian Dollar',
  USDCHF: 'USDCHF, US Dollar vs Swiss Franc',
  NZDUSD: 'NZDUSD, New Zealand Dollar vs US Dollar',
  EURJPY: 'EURJPY, Euro vs Japanese Yen',
  GBPJPY: 'GBPJPY, Great Britain Pound vs Japanese Yen',
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

      const width = cssWidth;
      const height = cssHeight;
      const left = 12;
      const right = 72;
      const top = 12;
      const bottom = 27;
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
        ctx.font = `11px ${palette.monoFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for live tick data', left + plotWidth / 2, top + plotHeight / 2);
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
      ctx.font = `10px ${palette.monoFont}`;
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
      const minimumTagGap = 19;
      if (Math.abs(bidTagY - askTagY) < minimumTagGap) {
        const midpoint = (bidTagY + askTagY) / 2;
        bidTagY = midpoint + minimumTagGap / 2;
        askTagY = midpoint - minimumTagGap / 2;
      }
      bidTagY = Math.max(top + 9, Math.min(plotBottom - 9, bidTagY));
      askTagY = Math.max(top + 9, Math.min(plotBottom - 9, askTagY));

      ctx.font = `600 10px ${palette.monoFont}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ([
        [lastTick.bid, bidTagY, palette.bid],
        [lastTick.ask, askTagY, palette.ask],
      ] as const).forEach(([price, y, color]) => {
        ctx.fillStyle = color;
        ctx.fillRect(plotRight, y - 8, right, 16);
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
  }, [ask, bid, chartColors, digits, symbol]);

  return (
    <div className="rtx-order-dialog__chart-shell">
      <div className="rtx-order-dialog__chart-header">
        <div className="rtx-order-dialog__chart-identity">
          <span className="rtx-order-dialog__chart-symbol">{symbol}</span>
          <span className="rtx-order-dialog__chart-meta">
            <span className="rtx-order-dialog__live-dot" aria-hidden="true" />
            Tick chart · 5 min
          </span>
        </div>
        <div className="rtx-order-dialog__chart-quotes" aria-label={`${symbol} live bid and ask`}>
          <span className="rtx-order-dialog__chart-quote rtx-order-dialog__chart-quote--bid">
            Bid <strong>{bid > 0 ? bid.toFixed(digits) : '—'}</strong>
          </span>
          <span className="rtx-order-dialog__chart-quote rtx-order-dialog__chart-quote--ask">
            Ask <strong>{ask > 0 ? ask.toFixed(digits) : '—'}</strong>
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
        aria-label={`Live ${symbol} bid and ask tick chart`}
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
}: OrderPanelProps) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [orderType, setOrderType] = useState<OrderType>('Market Execution');
  const [volumeStr, setVolumeStr] = useState(() => localStorage.getItem('lastLotSize') || '0.01');
  const [fillPolicy, setFillPolicy] = useState<FillPolicy>('Fill or Kill');
  const [comment, setComment] = useState('');
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveMarketStatus = useSymbolMarketStatus(symbol, {
    enabled: isOpen && Boolean(symbol),
  });

  const tick = useAppStore((s) => s.ticks[symbol]);
  const account = useAppStore((s) => s.account);
  const ticks = useAppStore((s) => s.ticks);
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

  const availableSymbols = Object.keys(ticks).length > 0 ? Object.keys(ticks) : [initialSymbol];

  const config = getInstrumentConfig(symbol, tick?.digits);
  const { digits, contractSize: instContractSize } = config;
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

  const formatPrice = (price: number) => {
    return formatPriceParts(price, symbol, digits);
  };

  const leverage = (account as any)?.leverage || 100;
  const volumeNum = parseFloat(volumeStr) || 0;
  const marginRequired = (volumeNum * instContractSize * (ask || 1)) / leverage;
  const baseCurrency = config.currency;

  const adjustVolume = (delta: number) => {
    const current = parseFloat(volumeStr) || 0;
    const next = Math.max(0.01, Math.round((current + delta) * 100) / 100);
    setVolumeStr(next.toString());
  };

  const handleSubmit = useCallback(async (side: 'buy' | 'sell') => {
    if (isPlacing) return;
    if (isMarketExecutionBlocked) {
      setError(marketBlockedMessage || `Market is closed for ${symbol}.`);
      return;
    }
    setIsPlacing(true);
    setError(null);

    try {
      const volume = parseFloat(volumeStr) || 0.01;
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
  }, [isPlacing, isMarketExecutionBlocked, marketBlockedMessage, volumeStr, comment, symbol, onSubmitOrder, onClose]);

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
          <span id={dialogTitleId} className="rtx-order-dialog__title">New Order · {symbol}</span>
          <button
            type="button"
            aria-label="Close New Order dialog"
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
              <label className="rtx-order-dialog__label" htmlFor={symbolFieldId}>Symbol</label>
              <select
                id={symbolFieldId}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="rtx-order-dialog__control"
              >
                {availableSymbols.map(s => (
                  <option key={s} value={s}>{SYMBOL_NAMES[s] || s}</option>
                ))}
              </select>
            </div>

            <div className="rtx-order-dialog__field">
              <span className="rtx-order-dialog__label">Type</span>
              <div className="rtx-order-dialog__control rtx-order-dialog__control--static">Market Execution</div>
            </div>

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={volumeFieldId}>Volume</label>
              <div className="rtx-order-dialog__volume-row">
                <div className="rtx-order-dialog__volume-control">
                  <input
                    id={volumeFieldId}
                    type="text"
                    inputMode="decimal"
                    value={volumeStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow empty, digits, dots for free-form decimal entry
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
                      aria-label="Increase volume"
                      onClick={() => adjustVolume(0.01)}
                      className="rtx-order-dialog__spinner-button"
                    >▲</button>
                    <button
                      type="button"
                      aria-label="Decrease volume"
                      onClick={() => adjustVolume(-0.01)}
                      className="rtx-order-dialog__spinner-button"
                    >▼</button>
                  </div>
                </div>
                <span className="rtx-order-dialog__margin">{formatMargin(marginRequired)} {baseCurrency}</span>
              </div>
            </div>

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={fillPolicyFieldId}>Fill policy</label>
              <select
                id={fillPolicyFieldId}
                value={fillPolicy}
                onChange={(e) => setFillPolicy(e.target.value as FillPolicy)}
                className="rtx-order-dialog__control"
              >
                <option>Fill or Kill</option>
                <option>Immediate or Cancel</option>
                <option>Return</option>
              </select>
            </div>

            <div className="rtx-order-dialog__field">
              <label className="rtx-order-dialog__label" htmlFor={commentFieldId}>Comment</label>
              <input
                id={commentFieldId}
                type="text"
                maxLength={64}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="rtx-order-dialog__control"
              />
            </div>

            {error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--error" role="alert">{error}</div>
            )}
            {isMarketExecutionBlocked && !error && (
              <div className="rtx-order-dialog__message rtx-order-dialog__message--warning" role="status">
                {marketBlockedMessage || `Market is closed for ${symbol}.`}
              </div>
            )}

            <div className="rtx-order-dialog__price-summary" aria-label={`Bid ${bid.toFixed(digits)}, Ask ${ask.toFixed(digits)}`}>
              <div className="rtx-order-dialog__price-side">
                <span className="rtx-order-dialog__price-label">BID</span>
                <span className="rtx-order-dialog__price">
                  {bidF.small}<strong>{bidF.big}</strong>
                </span>
              </div>
              <span className="rtx-order-dialog__price-divider" aria-hidden="true" />
              <div className="rtx-order-dialog__price-side rtx-order-dialog__price-side--ask">
                <span className="rtx-order-dialog__price-label">ASK</span>
                <span className="rtx-order-dialog__price">
                  {askF.small}<strong>{askF.big}</strong>
                </span>
              </div>
            </div>

            <div className="rtx-order-dialog__spread">
              Spread: {spreadDisplay}
            </div>

            {orderType === 'Market Execution' ? (
              <div className="rtx-order-dialog__actions">
                <button
                  type="button"
                  onClick={() => handleSubmit('sell')}
                  disabled={isPlacing || bid <= 0 || isMarketExecutionBlocked}
                  className="rtx-order-dialog__action rtx-order-dialog__action--sell"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                  {isPlacing ? 'Placing...' : 'Sell by Market'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit('buy')}
                  disabled={isPlacing || ask <= 0 || isMarketExecutionBlocked}
                  className="rtx-order-dialog__action rtx-order-dialog__action--buy"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                  {isPlacing ? 'Placing...' : 'Buy by Market'}
                </button>
              </div>
            ) : (
              <div className="rtx-order-dialog__actions rtx-order-dialog__actions--single">
                <button
                  type="button"
                  onClick={() => handleSubmit(orderType.includes('Buy') ? 'buy' : 'sell')}
                  disabled={isPlacing}
                  className={`rtx-order-dialog__action ${orderType.includes('Buy')
                    ? 'rtx-order-dialog__action--buy'
                    : 'rtx-order-dialog__action--sell'}`}
                >
                  {isPlacing ? 'Placing...' : `Place ${orderType}`}
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

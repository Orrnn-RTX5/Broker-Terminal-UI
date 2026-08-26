import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import {
  getMarketStatusTradeBlockMessage,
  shouldBlockSymbolTrading,
  type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { formatPriceParts } from './ui/PriceDisplay';
import { formatSpreadDisplayWithUnit } from '../utils/spread';

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

// ─── Mini Tick Chart (MT5 style) ──────────────────────────────────
function MiniTickChart({ symbol, bid, ask }: { symbol: string; bid: number; ask: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tickHistoryRef = useRef<{ time: number; bid: number; ask: number }[]>([]);
  const animFrameRef = useRef<number | undefined>(undefined);
  const cfg = getInstrumentConfig(symbol);

  // Clear when symbol changes
  useEffect(() => {
    tickHistoryRef.current = [];
  }, [symbol]);

  // Accumulate ticks
  useEffect(() => {
    if (!bid || !ask) return;
    const now = Date.now();
    tickHistoryRef.current.push({ time: now, bid, ask });
    // Keep last 5 minutes
    const cutoff = now - 300000;
    tickHistoryRef.current = tickHistoryRef.current.filter(t => t.time >= cutoff);
  }, [bid, ask]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const history = tickHistoryRef.current;
      const digits = cfg.digits;

      // Margins for labels
      const LEFT = 0;
      const RIGHT = 70;
      const TOP = 22;
      const BOTTOM = 18;
      const chartW = w - LEFT - RIGHT;
      const chartH = h - TOP - BOTTOM;

      const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');
      
      // Clear
      ctx.fillStyle = isLight ? '#f8fafc' : '#0d0d11';
      ctx.fillRect(0, 0, w, h);

      // Header: bid / ask at top
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = isLight ? '#64748b' : '#999';
      ctx.fillText(symbol, 4, 14);

      if (bid && ask) {
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        const bidStr = bid.toFixed(digits);
        const askStr = ask.toFixed(digits);
        const headerText = `${bidStr} / ${askStr}`;
        ctx.font = 'bold 11px sans-serif';
        const symbolW = ctx.measureText(symbol + ' ').width;
        ctx.font = '10px monospace';
        ctx.fillStyle = '#4fc3f7';
        ctx.fillText(headerText, symbolW + 8, 14);
      }

      if (history.length < 2) {
        ctx.fillStyle = '#555';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for ticks...', w / 2, h / 2);
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Price range
      let minP = Infinity, maxP = -Infinity;
      for (const t of history) {
        minP = Math.min(minP, t.bid, t.ask);
        maxP = Math.max(maxP, t.bid, t.ask);
      }
      const range = maxP - minP || Math.pow(10, -digits);
      const pad = range * 0.12;
      minP -= pad;
      maxP += pad;
      const totalRange = maxP - minP;

      // Time range
      const now = Date.now();
      const timeStart = history[0].time;
      const timeEnd = now;
      const timeRange = Math.max(timeEnd - timeStart, 1000);

      // Y mapping
      const yOf = (price: number) => TOP + chartH - ((price - minP) / totalRange) * chartH;
      const xOf = (time: number) => LEFT + ((time - timeStart) / timeRange) * chartW;

      // Grid lines (horizontal)
      ctx.strokeStyle = '#2a2e39';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 5; i++) {
        const y = TOP + (i / 5) * chartH;
        ctx.beginPath();
        ctx.moveTo(LEFT, y);
        ctx.lineTo(LEFT + chartW, y);
        ctx.stroke();
      }

      // Price labels on right
      ctx.fillStyle = '#555';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      for (let i = 0; i <= 5; i++) {
        const price = maxP - (i / 5) * totalRange;
        const y = TOP + (i / 5) * chartH;
        ctx.fillText(price.toFixed(digits), LEFT + chartW + 4, y + 3);
      }

      // Draw bid line (red/sell)
      ctx.strokeStyle = '#f44336';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      for (const t of history) {
        const x = xOf(t.time);
        const y = yOf(t.bid);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw ask line (blue/buy)
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      first = true;
      for (const t of history) {
        const x = xOf(t.time);
        const y = yOf(t.ask);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Current price tags on right edge
      const lastTick = history[history.length - 1];
      if (lastTick) {
        let bidTagY = yOf(lastTick.bid);
        let askTagY = yOf(lastTick.ask);

        // Anti-overlap
        const minGap = 16;
        const gap = Math.abs(bidTagY - askTagY);
        if (gap < minGap) {
          const mid = (bidTagY + askTagY) / 2;
          if (bidTagY >= askTagY) {
            bidTagY = mid + minGap / 2;
            askTagY = mid - minGap / 2;
          } else {
            bidTagY = mid - minGap / 2;
            askTagY = mid + minGap / 2;
          }
        }
        bidTagY = Math.max(TOP + 8, Math.min(TOP + chartH - 8, bidTagY));
        askTagY = Math.max(TOP + 8, Math.min(TOP + chartH - 8, askTagY));

        const tagW = RIGHT - 2;
        const tagX = LEFT + chartW;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';

        // Bid tag
        ctx.fillStyle = '#f44336';
        ctx.fillRect(tagX, bidTagY - 7, tagW, 14);
        ctx.fillStyle = '#fff';
        ctx.fillText(lastTick.bid.toFixed(digits), tagX + 3, bidTagY + 3);

        // Ask tag
        ctx.fillStyle = '#2196F3';
        ctx.fillRect(tagX, askTagY - 7, tagW, 14);
        ctx.fillStyle = '#fff';
        ctx.fillText(lastTick.ask.toFixed(digits), tagX + 3, askTagY + 3);

        // Horizontal dashed lines from last price
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 0.5;

        ctx.strokeStyle = '#f4433666';
        ctx.beginPath();
        ctx.moveTo(LEFT, yOf(lastTick.bid));
        ctx.lineTo(LEFT + chartW, yOf(lastTick.bid));
        ctx.stroke();

        ctx.strokeStyle = '#2196F366';
        ctx.beginPath();
        ctx.moveTo(LEFT, yOf(lastTick.ask));
        ctx.lineTo(LEFT + chartW, yOf(lastTick.ask));
        ctx.stroke();

        ctx.setLineDash([]);
      }

      // Time labels at bottom
      ctx.fillStyle = '#555';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      const labelCount = 3;
      for (let i = 0; i <= labelCount; i++) {
        const t = new Date(timeStart + (i / labelCount) * timeRange);
        const x = xOf(t.getTime());
        const dateStr = `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
        ctx.fillText(`${dateStr}`, x, h - 8);
        ctx.fillText(`${timeStr}`, x, h - 0);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [symbol, bid, ask, cfg.digits]);

  return (
    <canvas
      ref={canvasRef}
      width={380}
      height={300}
      className="block"
      style={{ imageRendering: 'auto' }}
    />
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

  const availableSymbols = Object.keys(ticks).length > 0 ? Object.keys(ticks) : [initialSymbol];

  const config = getInstrumentConfig(symbol, tick?.digits);
  const { digits, contractSize: instContractSize } = config;

  const bid = tick?.bid || currentPrice.bid || 0;
  const ask = tick?.ask || currentPrice.ask || 0;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
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

  // Form row styles
  const labelCls = "text-[14px] font-normal text-zinc-400 w-[75px] text-right flex-shrink-0 pr-1";
  const inputCls = "flex-1 bg-[#0d0d11] border border-zinc-600 rounded px-2 py-1.5 text-[14px] font-normal text-zinc-200 font-mono focus:outline-none focus:border-zinc-600";
  const spinnerInputCls = "w-full bg-transparent px-2 py-1.5 text-[14px] font-normal text-zinc-200 font-mono focus:outline-none";
  const spinBtnCls = "px-1.5 py-0 text-[9px] text-zinc-400 hover:bg-zinc-600 hover:text-white leading-tight";

  return (
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" 
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onContextMenuCapture={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div 
        className="rtx-order-dialog bg-[#1e222d] border border-zinc-600 rounded-sm shadow-2xl select-none flex flex-col" 
        style={{ 
          maxWidth: '90vw',
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: dragRef.current ? 'none' : 'transform 0.1s ease-out'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title Bar - Drag Handle */}
        <div 
          className="flex items-center justify-between px-3 py-1.5 bg-[#252a37] border-b border-zinc-600 relative z-10 cursor-move active:cursor-grabbing"
          onMouseDown={handleHeaderMouseDown}
        >
          <span className="text-[14px] text-zinc-300 font-semibold">Order</span>
          <div className="flex items-center gap-0.5">
            <button className="px-2 py-0.5 hover:bg-zinc-600 rounded text-zinc-400 text-xs">—</button>
            <button className="px-2 py-0.5 hover:bg-zinc-600 rounded text-zinc-400 text-xs">□</button>
            <button onClick={onClose} className="px-2 py-0.5 hover:bg-red-500 hover:text-white rounded text-zinc-400 text-xs transition-colors">✕</button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex">

          {/* Left: Chart Panel */}
          <div className="flex-shrink-0 border-r border-zinc-600 bg-[#0d0d11]">
            <MiniTickChart symbol={symbol} bid={bid} ask={ask} />
          </div>

          {/* Right: Order Form */}
          <div className="flex flex-col p-3" style={{ width: 350 }}>

            {/* Symbol */}
            <div className="flex items-center mb-2">
              <label className={labelCls}>Symbol:</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputCls} style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {availableSymbols.map(s => (
                  <option key={s} value={s}>{SYMBOL_NAMES[s] || s}</option>
                ))}
              </select>
            </div>

            {/* Type */}
            <div className="flex items-center mb-2">
              <label className={labelCls}>Type:</label>
              <div className={inputCls} style={{ cursor: 'default' }}>Market Execution</div>
            </div>

            {/* Volume */}
            <div className="flex items-center mb-2">
              <label className={labelCls}>Volume:</label>
              <div className="flex items-center gap-2 flex-1">
                <div className="flex items-center bg-[#0d0d11] border border-zinc-600 rounded overflow-hidden" style={{ width: 100 }}>
                  <input
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
                    className={spinnerInputCls}
                    style={{ width: 70 }}
                  />
                  <div className="flex flex-col border-l border-zinc-600">
                    <button onClick={() => adjustVolume(0.01)} className={spinBtnCls}>▲</button>
                    <button onClick={() => adjustVolume(-0.01)} className={spinBtnCls}>▼</button>
                  </div>
                </div>
                <span className="text-[12px] font-normal text-zinc-400">{formatMargin(marginRequired)} {baseCurrency}</span>
              </div>
            </div>

            {/* Fill Policy */}
            <div className="flex items-center mb-2">
              <label className={labelCls}>Fill policy:</label>
              <select value={fillPolicy} onChange={(e) => setFillPolicy(e.target.value as FillPolicy)} className={inputCls}>
                <option>Fill or Kill</option>
                <option>Immediate or Cancel</option>
                <option>Return</option>
              </select>
            </div>

            {/* Comment */}
            <div className="flex items-center mb-2">
              <label className={labelCls}>Comment:</label>
              <input type="text" maxLength={64} value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
            </div>

            {/* Error */}
            {error && (
              <div className="text-[12px] font-normal text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1 mb-2">{error}</div>
            )}
            {isMarketExecutionBlocked && !error && (
              <div className="text-[12px] font-normal text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-1 mb-2">
                {marketBlockedMessage || `Market is closed for ${symbol}.`}
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1 min-h-[8px]" />

            {/* Large Price Display (MT5 style) */}
            <div className="flex items-baseline justify-center gap-3 mb-0.5">
              <span className="text-zinc-300 font-mono tracking-tight" style={{ fontSize: 28, fontWeight: 300 }}>
                {bidF.small}
                <span style={{ fontSize: 34, fontWeight: 700 }}>{bidF.big}</span>
              </span>
              <span className="text-zinc-500" style={{ fontSize: 22 }}>/</span>
              <span className="text-zinc-300 font-mono tracking-tight" style={{ fontSize: 28, fontWeight: 300 }}>
                {askF.small}
                <span style={{ fontSize: 34, fontWeight: 700 }}>{askF.big}</span>
              </span>
            </div>

            {/* Spread */}
            <div className="text-center text-[12px] font-normal text-zinc-500 mb-2">
              Spread: {spreadDisplay}
            </div>

            {/* Buttons */}
            {orderType === 'Market Execution' ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleSubmit('sell')}
                  disabled={isPlacing || bid <= 0 || isMarketExecutionBlocked}
                  className="py-3 rounded text-white font-bold text-[14px] transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 active:from-red-600 active:to-red-800
                    border border-red-400/30 shadow-lg flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                  {isPlacing ? 'Placing...' : 'Sell by Market'}
                </button>
                <button
                  onClick={() => handleSubmit('buy')}
                  disabled={isPlacing || ask <= 0 || isMarketExecutionBlocked}
                  className="py-3 rounded text-white font-bold text-[14px] transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 active:from-blue-600 active:to-blue-800
                    border border-blue-400/30 shadow-lg flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                  {isPlacing ? 'Placing...' : 'Buy by Market'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleSubmit(orderType.includes('Buy') ? 'buy' : 'sell')}
                disabled={isPlacing}
                className={`w-full py-3 rounded text-white font-bold text-[14px] transition-all disabled:opacity-40
                  ${orderType.includes('Buy')
                    ? 'bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 border border-blue-400/30'
                    : 'bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 border border-red-400/30'
                  } shadow-lg`}
              >
                {isPlacing ? 'Placing...' : `Place ${orderType}`}
              </button>
            )}

            {/* Progress bar placeholder (like MT5) */}
            <div className="h-1 bg-zinc-700 rounded-full mt-2 overflow-hidden">
              {isPlacing && <div className="h-full bg-zinc-8000 animate-pulse w-full" />}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

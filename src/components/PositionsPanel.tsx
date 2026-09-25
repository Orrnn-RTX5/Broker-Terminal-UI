/**
 * PositionsPanel — Toolbox → Trade Tab
 *
 * Data flow (as per RTX5 Gateway spec):
 *  1. REST  GET /api/v2/positions/{login}   — initial load on mount
 *  2. WS    positions.{login}               — applies versioned position lifecycle snapshots and quote deltas
 *  3. WS    metrics.{login}                 — single source of truth for equity/margin/pnl summary bar
 *  4. WS    ticks.{SYMBOL}                  — live bid/ask display per open symbol
 *  5. REST  POST /api/v2/positions/{ticket}/close  — close position
 *
 * Rules enforced:
 *  - REST first; never wait for WS for initial list
 *  - WS closes remove rows immediately; tombstones reject delayed snapshots
 *  - metrics WS is the sole source of equity/free-margin/margin-level
 *  - ticks subscribed only for symbols with open positions
 *  - Reconnect after 3 s; re-subscribe all channels on reconnect
 *  - margin_level === 0 → show ∞
 *  - time_create is Unix seconds → convert to local time
 *  - side "buy" → blue, "sell" → red
 *  - URLs resolved from .env via config/api.ts (dynamic, not hardcoded)
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { Icon } from './ui/Icon';
import { PriceDisplay } from './ui/PriceDisplay';
import { useConfirmStore } from '../store/useConfirmStore';
import { ModifyPositionDialog } from './ModifyPositionDialog';
import { tradingV2Api } from '../api/trade';
import { API_V2_BASE_URL } from '../config/api';
import { buildBrokerWsV2Uri } from '../services/brokerSession';
import type { Position as AppPosition } from '../store/useAppStore';
import { reconcilePanelPositions, reconcilePanelSnapshot } from '../services/positionsPanelStream';
import { extractAccountMetrics } from '../services/accountMetrics';
import {
  normalizeExactBrokerSymbol,
  parseExactTickChannelSymbol,
} from '../utils/exactBrokerSymbol';

// ─────────────────────────────────────────────
// Types matching the RTX5 Gateway REST response
// ─────────────────────────────────────────────

interface GatewayPosition {
  pnl_available?: boolean;
  ticket: number;
  account_login: number;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  price_open: number;
  price_current: number;
  price_sl: number;
  price_tp: number;
  profit: number;
  swap: number;
  time_create: number;
  comment: string;
}

interface MetricsData {
  login: number;
  balance: number;
  credit: number;
  equity: number;
  used_margin: number;
  free_margin: number;
  margin_level: number;
  floating_pnl: number;
  total_swap: number;
}

interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  time: number;
}

// Per-symbol live tick
interface SymbolTick {
  bid: number;
  ask: number;
}

// Pending order (unchanged from existing normalisation)
interface PendingOrder {
  id: string;
  symbol: string;
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  side: 'BUY' | 'SELL';
  volume: number;
  price: number;
  sl?: number;
  tp?: number;
  status: 'PENDING' | 'TRIGGERED' | 'FILLED' | 'CANCELLED';
  createdAt: string;
}

type InnerTab = 'Positions' | 'Orders';

interface PositionsPanelProps {
  accountId: string;
  wsConnection?: WebSocket | null;
}

interface EditingState {
  ticket: number;
  field: 'sl' | 'tp';
  value: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const toNum = (v: unknown, fb = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const getDigits = (symbol: string): number => {
  if (symbol.includes('JPY')) return 3;
  if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
  if (symbol.startsWith('XAU')) return 2;
  if (symbol.startsWith('XAG')) return 3;
  return 5;
};

// FIX: Position rows resolve the same exact, punctuation-preserving key that
// the authoritative ticks.{SYMBOL} channel handler writes.
export const resolvePositionsPanelTick = (
  ticks: Readonly<Record<string, SymbolTick>>,
  symbol: unknown,
): SymbolTick | undefined => ticks[normalizeExactBrokerSymbol(symbol)];

// FIX: Apply a quote under the complete channel-owned symbol. The payload may
// omit its symbol or report an unsuffixed alias, but it cannot rename a channel.
export const mergePositionsPanelChannelTick = (
  ticks: Record<string, SymbolTick>,
  channel: unknown,
  payload: { symbol?: unknown; bid?: unknown; ask?: unknown },
): Record<string, SymbolTick> => {
  const symbol = parseExactTickChannelSymbol(channel);
  if (
    !symbol
    || typeof payload?.bid !== 'number'
    || !Number.isFinite(payload.bid)
    || typeof payload?.ask !== 'number'
    || !Number.isFinite(payload.ask)
  ) {
    return ticks;
  }

  return {
    ...ticks,
    [symbol]: { bid: payload.bid, ask: payload.ask },
  };
};

/** Format Unix seconds → local date-time string (MT5 style) */
const fmtUnixTime = (ts?: number): string => {
  if (!ts || ts === 0) return '—';
  try {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '—';
  }
};

/** Format money with optional sign prefix */
const fmtMoney = (v: number | undefined | null, showSign = false): string => {
  const n = v ?? 0;
  if (!Number.isFinite(n)) return '0.00';
  const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (showSign) return (n >= 0 ? '+' : '-') + abs;
  return (n < 0 ? '-' : '') + abs;
};

/** Normalise a raw API order into our PendingOrder shape */
const normalizeOrder = (raw: Record<string, any>, index: number): PendingOrder => {
  const rawType = String(raw.type ?? '').toUpperCase();
  const side = String(raw.side ?? '').toUpperCase() === 'SELL' || rawType.includes('SELL') ? 'SELL' : 'BUY';
  const normalizedType: PendingOrder['type'] =
    rawType === 'STOP_LIMIT' ? 'STOP_LIMIT' :
      rawType === 'STOP' ? 'STOP' :
        rawType === 'LIMIT' ? 'LIMIT' : 'MARKET';
  const rawStatus = String(raw.status ?? '').toUpperCase();
  const status: PendingOrder['status'] =
    rawStatus === 'PENDING' || rawStatus === 'TRIGGERED' || rawStatus === 'FILLED' || rawStatus === 'CANCELLED'
      ? rawStatus : 'PENDING';

  return {
    id: String(raw.ticket ?? raw.id ?? index + 1),
    symbol: String(raw.symbol ?? ''),
    type: normalizedType,
    side,
    volume: toNum(raw.quantity ?? raw.volume, 0),
    price: toNum(raw.price, 0),
    sl: toNum(raw.price_sl ?? raw.sl, 0),
    tp: toNum(raw.price_tp ?? raw.tp, 0),
    status,
    createdAt: String(
      raw.created_at ?? raw.createdAt ??
      (raw.time_create ? new Date(toNum(raw.time_create) * 1000).toISOString() : new Date().toISOString())
    ),
  };
};

// ─────────────────────────────────────────────
// WebSocket manager — self-contained, owned by PositionsPanel
// Follows the spec: reconnect after 3 s, re-subscribe on reconnect
// ─────────────────────────────────────────────

type WsMessageHandler = (msg: { channel: string; data: unknown }) => void;

class TradeWsManager {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private channels: string[] = [];
  private handler: WsMessageHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private openedOnce = false;
  private connectionChanged: (connected: boolean, reconnect: boolean) => void;

  constructor(url: string, token: string, channels: string[], handler: WsMessageHandler, connectionChanged: (connected: boolean, reconnect: boolean) => void) {
    this.url = url;
    this.token = token;
    this.channels = channels;
    this.handler = handler;
    this.connectionChanged = connectionChanged;
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    const sep = this.url.includes('?') ? '&' : '?';
    const fullUrl = this.token ? `${this.url}${sep}token=${encodeURIComponent(this.token)}` : this.url;

    try {
      this.ws = new WebSocket(fullUrl);

      this.ws.onopen = () => {
        if (this.destroyed) return;
        console.log('[TradeWS] Connected');
        this.connectionChanged(true, this.openedOnce);
        this.openedOnce = true;
        this.channels.forEach(ch => this.sendSubscribe(ch));
      };

      this.ws.onmessage = (evt) => {
        if (this.destroyed) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg && typeof msg.channel === 'string') {
            this.handler({ channel: msg.channel, data: msg.data });
          }
        } catch { /* ignore parse errors */ }
      };

      this.ws.onerror = () => {
        console.warn('[TradeWS] Error — will reconnect');
      };

      this.ws.onclose = () => {
        if (this.destroyed) return;
        this.connectionChanged(false, false);
        console.log('[TradeWS] Closed — reconnecting in 3 s');
        this.scheduleReconnect();
      };
    } catch (err) {
      console.error('[TradeWS] Could not open WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  private sendSubscribe(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'subscribe', channel }));
    }
  }

  /** Update the subscribed channel list and subscribe new ones */
  updateChannels(newChannels: string[]) {
    const added = newChannels.filter(ch => !this.channels.includes(ch));
    this.channels = newChannels;
    added.forEach(ch => this.sendSubscribe(ch));
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.ws?.close(1000, 'component unmount'); } catch { /* ignore */ }
    this.ws = null;
  }
}

// ─────────────────────────────────────────────
// Position row (memo'd to avoid redundant re-renders)
// ─────────────────────────────────────────────

interface PositionRowProps {
  pos: GatewayPosition;
  i: number;
  editing: EditingState | null;
  setEditing: (s: EditingState | null) => void;
  onModifySLTP: (ticket: number, field: 'sl' | 'tp', value: string) => void;
  onClose: (ticket: number) => void;
  onDoubleClick: (pos: GatewayPosition) => void;
  tick?: SymbolTick;
  loading: boolean;
}

const PositionRow = React.memo(({
  pos, i, editing, setEditing, onModifySLTP, onClose, onDoubleClick, tick, loading,
}: PositionRowProps) => {
  const isBuy = pos.side === 'buy';
  const digits = getDigits(pos.symbol);

  return (
    <tr
      className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#1c1d22] transition-colors cursor-pointer group`}
      onDoubleClick={() => onDoubleClick(pos)}
    >
      {/* account_login */}
      <td className="px-2 py-[3px] text-zinc-500 tabular-nums text-[11px]">{pos.account_login}</td>

      {/* ticket */}
      <td className="px-2 py-[3px] text-zinc-300 font-medium tabular-nums text-[11px]">{pos.ticket}</td>

      {/* symbol */}
      <td className="px-1.5 py-[3px] font-semibold text-zinc-100 text-[11px]">{pos.symbol}</td>

      {/* side */}
      <td className={`px-1.5 py-[3px] font-bold text-[11px] ${isBuy ? 'text-[#4fc3f7]' : 'text-[#f87171]'}`}>
        <span className="flex items-center gap-[3px]">
          {isBuy
            ? <svg width="8" height="8" viewBox="0 0 10 10"><path d="M5 1L9 5H6.5V9H3.5V5H1Z" fill="currentColor" /></svg>
            : <svg width="8" height="8" viewBox="0 0 10 10"><path d="M5 9L1 5H3.5V1H6.5V5H9Z" fill="currentColor" /></svg>
          }
          {pos.side}
        </span>
      </td>

      {/* volume */}
      <td className="px-1.5 py-[3px] text-right text-zinc-200 text-[11px] tabular-nums">
        {pos.volume.toFixed(2)}
      </td>

      {/* price_open */}
      <td className="px-1.5 py-[3px] text-right text-zinc-300 text-[11px] tabular-nums">
        <PriceDisplay price={pos.price_open} symbol={pos.symbol} />
      </td>

      {/* price_current (WS patched) */}
      <td className="px-1.5 py-[3px] text-right text-zinc-200 text-[11px] tabular-nums font-medium">
        <PriceDisplay price={pos.price_current} symbol={pos.symbol} />
      </td>

      {/* live bid/ask from ticks channel */}
      <td className="px-1.5 py-[3px] text-right text-[11px] tabular-nums">
        {tick ? (
          <span className="text-zinc-400">
            {tick.bid.toFixed(digits)}<span className="text-zinc-600 mx-0.5">/</span>{tick.ask.toFixed(digits)}
          </span>
        ) : <span className="text-zinc-700">—</span>}
      </td>

      {/* S/L */}
      <td className="px-1.5 py-[3px] text-right text-[11px]">
        {editing?.ticket === pos.ticket && editing.field === 'sl' ? (
          <input
            type="number" step="0.00001"
            value={editing.value}
            onChange={e => setEditing({ ...editing, value: e.target.value })}
            onBlur={() => onModifySLTP(pos.ticket, 'sl', editing.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onModifySLTP(pos.ticket, 'sl', editing.value);
              if (e.key === 'Escape') setEditing(null);
            }}
            autoFocus
            className="w-20 bg-zinc-800 text-zinc-100 px-1 py-0 rounded text-[11px] font-mono border border-zinc-600"
          />
        ) : (
          <span
            onClick={() => setEditing({ ticket: pos.ticket, field: 'sl', value: String(pos.price_sl) })}
            className={`cursor-pointer px-1 rounded hover:bg-zinc-700/50 tabular-nums ${pos.price_sl > 0 ? 'text-[#f87171]' : 'text-zinc-600'}`}
          >
            {pos.price_sl > 0 ? <PriceDisplay price={pos.price_sl} symbol={pos.symbol} /> : '—'}
          </span>
        )}
      </td>

      {/* T/P */}
      <td className="px-1.5 py-[3px] text-right text-[11px]">
        {editing?.ticket === pos.ticket && editing.field === 'tp' ? (
          <input
            type="number" step="0.00001"
            value={editing.value}
            onChange={e => setEditing({ ...editing, value: e.target.value })}
            onBlur={() => onModifySLTP(pos.ticket, 'tp', editing.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onModifySLTP(pos.ticket, 'tp', editing.value);
              if (e.key === 'Escape') setEditing(null);
            }}
            autoFocus
            className="w-20 bg-zinc-800 text-zinc-100 px-1 py-0 rounded text-[11px] font-mono border border-zinc-600"
          />
        ) : (
          <span
            onClick={() => setEditing({ ticket: pos.ticket, field: 'tp', value: String(pos.price_tp) })}
            className={`cursor-pointer px-1 rounded hover:bg-zinc-700/50 tabular-nums ${pos.price_tp > 0 ? 'text-[#4ade80]' : 'text-zinc-600'}`}
          >
            {pos.price_tp > 0 ? <PriceDisplay price={pos.price_tp} symbol={pos.symbol} /> : '—'}
          </span>
        )}
      </td>

      {/* swap */}
      <td className="px-1.5 py-[3px] text-right text-zinc-500 text-[11px] tabular-nums">
        {fmtMoney(pos.swap)}
      </td>

      {/* profit (WS patched) */}
      <td className={`px-1.5 py-[3px] text-right font-semibold text-[11px] tabular-nums ${pos.profit >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
        {pos.pnl_available === false ? '\u2014' : fmtMoney(pos.profit, true)}
      </td>

      {/* time_create converted from Unix seconds */}
      <td className="px-2 py-[3px] text-zinc-500 whitespace-nowrap text-[10px] tabular-nums font-mono">
        {fmtUnixTime(pos.time_create)}
      </td>

      {/* comment */}
      <td className="px-2 py-[3px] text-zinc-500 text-[10px] max-w-[120px] truncate" title={pos.comment}>
        {pos.comment || '—'}
      </td>

      {/* close button */}
      <td className="px-2 py-[3px] text-right">
        <button
          onClick={() => onClose(pos.ticket)}
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white hover:bg-red-600/30 w-4 h-4 rounded flex items-center justify-center transition-all text-[10px] font-bold"
          title="Close Position"
          disabled={loading}
        >✕</button>
      </td>
    </tr>
  );
});
PositionRow.displayName = 'PositionRow';

// ─────────────────────────────────────────────
// Pending order row
// ─────────────────────────────────────────────

const PendingOrderRow = React.memo(({ order, i, onCancel, onModify, loading }: {
  order: PendingOrder; i: number;
  onCancel: (id: string) => void;
  onModify: (order: PendingOrder) => void;
  loading: boolean;
}) => {
  const isBuy = order.side === 'BUY';
  const fmtDate = (s: string) => {
    try {
      return new Date(s).toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).replace(',', '');
    } catch { return s; }
  };

  return (
    <tr className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group`}>
      <td className="px-1 py-[2px] pl-2 text-zinc-500">{order.id}</td>
      <td className="px-1 py-[2px] font-semibold text-zinc-100">{order.symbol}</td>
      <td className="px-1 py-[2px] text-zinc-400 text-[10px]">{order.type}</td>
      <td className={`px-1 py-[2px] font-bold text-[10px] ${isBuy ? 'text-[#4fc3f7]' : 'text-[#f87171]'}`}>{order.side}</td>
      <td className="px-1 py-[2px] text-right font-semibold text-zinc-200">{order.volume.toFixed(2)}</td>
      <td className="px-1 py-[2px] text-right text-zinc-400">
        <PriceDisplay price={order.price} symbol={order.symbol} />
      </td>
      <td className="px-1 py-[2px] text-right">
        <span className={order.sl && order.sl > 0 ? 'text-[#f87171]' : 'text-zinc-600'}>
          {order.sl && order.sl > 0 ? <PriceDisplay price={order.sl} symbol={order.symbol} /> : '—'}
        </span>
      </td>
      <td className="px-1 py-[2px] text-right">
        <span className={order.tp && order.tp > 0 ? 'text-[#4ade80]' : 'text-zinc-600'}>
          {order.tp && order.tp > 0 ? <PriceDisplay price={order.tp} symbol={order.symbol} /> : '—'}
        </span>
      </td>
      <td className="px-1 py-[2px]">
        <span className="bg-yellow-900/20 text-yellow-300 px-1 rounded-sm text-[10px]">{order.status}</span>
      </td>
      <td className="px-1 py-[2px] text-zinc-500 text-[10px]">{fmtDate(order.createdAt)}</td>
      <td className="px-1 py-[2px] pr-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onModify(order)}
            className="text-zinc-600 hover:text-blue-400 hover:bg-zinc-700 w-5 h-5 rounded flex items-center justify-center transition-colors"
            title="Modify" disabled={loading}
          ><Icon name="edit" size="xs" /></button>
          <button
            onClick={() => onCancel(order.id)}
            className="text-zinc-600 hover:text-white hover:bg-zinc-700 w-5 h-5 rounded flex items-center justify-center transition-colors"
            title="Cancel" disabled={loading}
          ><Icon name="x-close" size="xs" /></button>
        </div>
      </td>
    </tr>
  );
});
PendingOrderRow.displayName = 'PendingOrderRow';

// ─────────────────────────────────────────────
// Account summary bar — driven solely by metrics WS
// ─────────────────────────────────────────────

const MetricsBar = ({ metrics }: { metrics: MetricsData | null }) => {
  if (!metrics) return null;

  const fmt = (v: number) => fmtMoney(v);
  const marginLevelDisplay =
    metrics.margin_level === 0 ? '∞' : `${metrics.margin_level.toFixed(2)}%`;

  return (
    <div className="bg-[#191a1e] border-t border-zinc-800/60 px-3 py-[3px] flex items-center gap-4 text-[11px] tabular-nums flex-shrink-0 flex-wrap">
      <span className="text-zinc-500">
        Balance: <span className="text-zinc-200 font-semibold">{fmt(metrics.balance)}</span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500">
        Equity: <span className="text-zinc-200 font-semibold">{fmt(metrics.equity)}</span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500">
        Margin:{' '}
        <span className="text-zinc-300">{fmt(metrics.used_margin)}</span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500">
        Free Margin:{' '}
        <span className="text-zinc-300">{fmt(metrics.free_margin)}</span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500">
        Margin Level:{' '}
        <span className={metrics.margin_level > 0 && metrics.margin_level < 100 ? 'text-[#f87171]' : 'text-zinc-300'}>
          {marginLevelDisplay}
        </span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500">
        Floating P/L:{' '}
        <span className={`font-semibold ${metrics.floating_pnl >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
          {fmtMoney(metrics.floating_pnl, true)}
        </span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500">
        Swap: <span className="text-zinc-400">{fmt(metrics.total_swap)}</span>
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function PositionsPanel({ accountId, wsConnection }: PositionsPanelProps) {
  const [activeTab, setActiveTab] = useState<InnerTab>('Positions');
  const [positions, setPositions] = useState<GatewayPosition[]>([]);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [ticks, setTicks] = useState<Record<string, SymbolTick>>({});
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modifyPosition, setModifyPosition] = useState<GatewayPosition | null>(null);
  const [modifyOrder, setModifyOrder] = useState<PendingOrder | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  const wsManagerRef = useRef<TradeWsManager | null>(null);
  const ordersInFlightRef = useRef(false);
  const closingRef = useRef<Set<number>>(new Set());
  const accountLoginRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const closedTicketsRef = useRef(new Set<number>());
  const positionRevisionRef = useRef(0);
  const positionRequestRef = useRef(0);
  const metricsTokenRef = useRef('');

  // Resolve account_login number
  const accountLogin = useMemo(() => {
    const n = Number.parseInt(String(accountId || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [accountId]);

  // Keep ref current for use in callbacks that close over it
  accountLoginRef.current = accountLogin;

  // Unique symbols with open positions (for ticks subscription)
  const openSymbols = useMemo(() => {
    // FIX: Normalize case/whitespace for subscription keys while retaining the
    // complete broker suffix and punctuation for each distinct contract.
    return [...new Set(positions
      .map((position) => normalizeExactBrokerSymbol(position.symbol))
      .filter(Boolean))];
  }, [positions]);

  // ─────────────────────────────────────────────
  // Task 1 — Load open positions via REST on mount
  // ─────────────────────────────────────────────

  const fetchPositions = useCallback(async () => {
    const login = accountLoginRef.current;
    if (!login) { setPositions([]); return; }
    const revision = positionRevisionRef.current;
    const requestId = ++positionRequestRef.current;
    const isCurrent = () => mountedRef.current && accountLoginRef.current === login && requestId === positionRequestRef.current;

    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token') || '';
      const baseUrl = API_V2_BASE_URL.replace(/\/$/, '');
      const url = `${baseUrl}/positions/${login}`;

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const list: GatewayPosition[] = Array.isArray(data) ? data : (data?.positions ?? []);

      if (isCurrent()) {
        setPositions(previous => reconcilePanelSnapshot(previous, list, login, closedTicketsRef.current, revision !== positionRevisionRef.current));
        console.log(`[TradeTab] Loaded ${list.length} open position(s) via REST`);
      }
    } catch (err) {
      console.error('[TradeTab] REST positions failed:', err);
      if (isCurrent()) {
        setError((err as Error)?.message || 'Failed to load positions');
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────
  // Task 1 — also load orders (pending)
  // ─────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    const login = accountLoginRef.current;
    if (!login || ordersInFlightRef.current) return;
    ordersInFlightRef.current = true;
    try {
      const token = localStorage.getItem('auth_token') || '';
      const baseUrl = API_V2_BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/orders/pending/${login}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.orders ?? []);
      if (mountedRef.current) {
        setOrders(list.map((item: Record<string, any>, idx: number) => normalizeOrder(item, idx)));
      }
    } catch (err) {
      console.error('[TradeTab] REST orders failed:', err);
    } finally {
      ordersInFlightRef.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    closedTicketsRef.current = new Set();
    positionRevisionRef.current++;
    positionRequestRef.current++;
    metricsTokenRef.current = '';
    setPositions([]);
    setMetrics(null);
    fetchPositions();
    fetchOrders();

    // Poll orders every 15 s (they change infrequently)
    const ordPoll = setInterval(fetchOrders, 15_000);

    // Listen for external force-refresh events
    const onForceRefresh = () => fetchPositions();
    window.addEventListener('rtx:force-refresh-positions', onForceRefresh);

    return () => {
      mountedRef.current = false;
      clearInterval(ordPoll);
      window.removeEventListener('rtx:force-refresh-positions', onForceRefresh);
    };
  }, [accountLogin, fetchPositions, fetchOrders]);

  // ─────────────────────────────────────────────
  // Tasks 2 & 3 — own WebSocket with subscribe/patch/reconnect
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!accountLogin) return;

    const token = localStorage.getItem('auth_token') || '';

    // ── WS URL: driven by broker session (same source as every other WS in the app) ──
    // buildBrokerWsV2Uri() reads server_url from localStorage (set after broker login)
    // and converts:  https://broker.example.com  →  wss://broker.example.com/ws/v2?token=…
    // Fallback chain (inside buildBrokerWsV2Uri): VITE_RTX5_WS_URL → env default
    const wsUrl = buildBrokerWsV2Uri(token);
    console.log('[TradeWS] Connecting to:', wsUrl.split('?')[0]); // log host only, hide token

    const baseChannels = [
      `positions.${accountLogin}`,
      `metrics.${accountLogin}`,
    ];

    const handleMsg: WsMessageHandler = ({ channel, data }) => {
      if (!mountedRef.current || accountLoginRef.current !== accountLogin) return;

      // ─── positions.{login} — patch profit + price_current per ticket ───
      if (channel === `positions.${accountLogin}`) {
        positionRevisionRef.current++;
        setPositions(previous => reconcilePanelPositions(previous, { channel, data }, accountLogin, closedTicketsRef.current));
        return;
      }

      // ─── metrics.{login} — account summary bar ───
      if (channel === `metrics.${accountLogin}`) {
        // Spec shape: { channel, data: { type: "metrics_update", data: { balance, equity, ... } } }
        // So 'data' here = { type: "metrics_update", data: { ... } }
        const metricsPayload = extractAccountMetrics({ channel, data });
        const rawToken = metricsPayload?.publication_token;
        const token = typeof rawToken === 'string' && /^[0-9]{20}$/.test(rawToken) && rawToken !== '00000000000000000000' ? rawToken : '';
        if (rawToken !== undefined && !token) return;
        if (metricsTokenRef.current && (!token || token <= metricsTokenRef.current)) return;
        if (token) metricsTokenRef.current = token;
        if (metricsPayload && typeof metricsPayload.balance === 'number') {
          setMetrics({
            login: toNum(metricsPayload.login ?? accountLogin),
            balance: toNum(metricsPayload.balance),
            credit: toNum(metricsPayload.credit),
            equity: toNum(metricsPayload.equity),
            used_margin: toNum(metricsPayload.used_margin),
            free_margin: toNum(metricsPayload.free_margin),
            margin_level: toNum(metricsPayload.margin_level),
            floating_pnl: toNum(metricsPayload.floating_pnl),
            total_swap: toNum(metricsPayload.total_swap),
          });
        }
        return;
      }

      // ─── ticks.{SYMBOL} — live bid/ask ───
      if (channel.startsWith('ticks.')) {
        const tickPayload = data as TickData;
        if (tickPayload && typeof tickPayload.bid === 'number') {
          setTicks((previous) => mergePositionsPanelChannelTick(previous, channel, tickPayload));
        }
        return;
      }
    };

    setWsStatus('connecting');
    // Token is already embedded in wsUrl by buildBrokerWsV2Uri — pass '' to avoid double-encoding
    const manager = new TradeWsManager(wsUrl, '', baseChannels, handleMsg, (connected) => {
      if (!mountedRef.current || accountLoginRef.current !== accountLogin) return;
      setWsStatus(connected ? 'connected' : 'disconnected');
      if (connected) { fetchPositions(); fetchOrders(); }
    });

    // Patch status based on WS open/close
    // (TradeWsManager logs but doesn't expose state — we mirror via a lightweight wrapper)
    wsManagerRef.current = manager;


    return () => {
      manager.destroy();
      wsManagerRef.current = null;
      setWsStatus('disconnected');
    };
  }, [accountLogin]);

  // Subscribe ticks for open symbols as they change
  useEffect(() => {
    if (!wsManagerRef.current || !accountLogin) return;
    const channels = [
      `positions.${accountLogin}`,
      `metrics.${accountLogin}`,
      ...openSymbols.map(s => `ticks.${s}`),
    ];
    wsManagerRef.current.updateChannels(channels);
  }, [openSymbols, accountLogin]);

  // ─────────────────────────────────────────────
  // Task 4 — Close position
  // ─────────────────────────────────────────────

  const handleClosePosition = useCallback(async (ticket: number) => {
    if (!(await useConfirmStore.getState().showConfirm('Close Position', `Close position #${ticket}?`))) return;
    if (closingRef.current.has(ticket)) return;
    closingRef.current.add(ticket);

    // Optimistic removal
    setPositions(prev => prev.filter(p => p.ticket !== ticket));

    try {
      setLoading(true);
      setError(null);
      await tradingV2Api.closePosition(ticket);
      // metrics WS will fire automatically with updated balance/equity
      window.dispatchEvent(new Event('rtx:force-refresh-positions'));
    } catch (err) {
      console.error('[TradeTab] Close position failed:', err);
      if (mountedRef.current) {
        setError((err as Error)?.message || 'Failed to close position');
        // Re-sync on error
        fetchPositions();
      }
    } finally {
      closingRef.current.delete(ticket);
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchPositions]);

  // Close all positions
  const handleCloseAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const snapshot = [...positions];
      setPositions([]);
      await Promise.all(snapshot.map(p => handleClosePosition(p.ticket)));
      setShowCloseAllConfirm(false);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to close all positions');
      fetchPositions();
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [positions, handleClosePosition, fetchPositions]);

  // ─────────────────────────────────────────────
  // Modify SL/TP
  // ─────────────────────────────────────────────

  const handleModifySLTP = useCallback(async (ticket: number, field: 'sl' | 'tp', value: string) => {
    const numVal = parseFloat(value);
    if (!Number.isFinite(numVal) || numVal < 0) { alert('Invalid price'); return; }
    const pos = positions.find(p => p.ticket === ticket);
    if (!pos) return;

    const newSl = field === 'sl' ? numVal : pos.price_sl;
    const newTp = field === 'tp' ? numVal : pos.price_tp;

    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token') || '';
      const baseUrl = API_V2_BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/positions/${ticket}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price_sl: newSl, price_tp: newTp }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Optimistic update
      setPositions(prev => prev.map(p => p.ticket === ticket
        ? { ...p, price_sl: newSl, price_tp: newTp }
        : p
      ));
      setEditing(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to modify SL/TP');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [positions]);

  // ─────────────────────────────────────────────
  // Cancel pending order
  // ─────────────────────────────────────────────

  const handleCancelOrder = useCallback(async (orderId: string) => {
    if (!(await useConfirmStore.getState().showConfirm('Cancel Order', `Cancel order #${orderId}?`))) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('auth_token') || '';
      const baseUrl = API_V2_BASE_URL.replace(/\/$/, '');
      await fetch(`${baseUrl}/orders/pending/${orderId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      await fetchOrders();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to cancel order');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchOrders]);

  // ─────────────────────────────────────────────
  // Summary totals (from the displayed positions, not metrics)
  // Used only for the "Swap / Commission" line when metrics is missing
  // ─────────────────────────────────────────────

  const totalSwap = useMemo(
    () => positions.reduce((s, p) => s + (p.swap ?? 0), 0),
    [positions]
  );

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-[#131316]">

      {/* ── Inner Tab Bar ── */}
      <div className="flex items-center bg-[#131316] border-b border-zinc-800/50 flex-shrink-0">
        <div className="flex items-center flex-1">
          {(['Positions', 'Orders'] as InnerTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap relative
                ${activeTab === tab
                  ? 'text-white bg-[#191a1e] shadow-[inset_0_2px_0_0_#8a8a8f] font-semibold'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#191a1e]/50'}`}
            >
              {tab}
              {tab === 'Positions' && positions.length > 0 && ` (${positions.length})`}
              {tab === 'Orders' && orders.length > 0 && ` (${orders.length})`}
            </button>
          ))}
        </div>

        {/* WS status indicator */}
        <span className="px-2 flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-400' :
              wsStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                'bg-zinc-600'
            }`} title={`WS: ${wsStatus}`} />
        </span>

        {activeTab === 'Positions' && positions.length > 0 && (
          <button
            onClick={() => setShowCloseAllConfirm(true)}
            className="px-3 py-1 mr-2 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
            disabled={loading}
          >
            Close All
          </button>
        )}

        <button
          onClick={fetchPositions}
          className="px-2 py-1 mr-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Refresh positions"
          disabled={loading}
        >
          <Icon name="refresh" size="xs" />
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden relative">
        {error && (
          <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 bg-red-950/90 border-b border-red-800 text-xs text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 ml-2">×</button>
          </div>
        )}

        {/* ── Positions Tab ── */}
        {activeTab === 'Positions' && (
          <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
            <table className="text-left border-collapse" style={{ minWidth: 1050, width: '100%' }}>
              <thead className="sticky top-0 bg-[#191a1e] text-zinc-500 z-10 text-[10px] uppercase tracking-wider border-b border-zinc-800/60 select-none">
                <tr>
                  <th className="px-2 py-[4px] font-semibold text-left whitespace-nowrap" style={{ minWidth: 90 }}>Login</th>
                  <th className="px-2 py-[4px] font-semibold text-left whitespace-nowrap" style={{ minWidth: 80 }}>Ticket</th>
                  <th className="px-1.5 py-[4px] font-semibold text-left" style={{ minWidth: 70 }}>Symbol</th>
                  <th className="px-1.5 py-[4px] font-semibold text-left" style={{ minWidth: 50 }}>Side</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 55 }}>Volume</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 90 }}>Open</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 90 }}>Current</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 100 }}>Bid / Ask</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 80 }}>S/L</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 80 }}>T/P</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 65 }}>Swap</th>
                  <th className="px-1.5 py-[4px] font-semibold text-right" style={{ minWidth: 85 }}>Profit</th>
                  <th className="px-2 py-[4px] font-semibold text-left whitespace-nowrap" style={{ minWidth: 140 }}>Time</th>
                  <th className="px-2 py-[4px] font-semibold text-left" style={{ minWidth: 100 }}>Comment</th>
                  <th className="px-2 py-[4px]" style={{ minWidth: 24 }}></th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {loading && positions.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-zinc-600 text-xs">
                      <span className="animate-pulse">Loading positions…</span>
                    </td>
                  </tr>
                ) : positions.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-zinc-600 text-xs italic">
                      No open positions
                    </td>
                  </tr>
                ) : (
                  positions.map((pos, i) => (
                    <PositionRow
                      key={pos.ticket}
                      pos={pos}
                      i={i}
                      editing={editing}
                      setEditing={setEditing}
                      onModifySLTP={handleModifySLTP}
                      onClose={handleClosePosition}
                      onDoubleClick={p => setModifyPosition(p)}
                      tick={resolvePositionsPanelTick(ticks, pos.symbol)}
                      loading={loading}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Orders Tab ── */}
        {activeTab === 'Orders' && (
          <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-800/50">
                <tr>
                  <th className="px-1 py-[3px] pl-2">Ticket</th>
                  <th className="px-1 py-[3px]">Symbol</th>
                  <th className="px-1 py-[3px]">Type</th>
                  <th className="px-1 py-[3px]">Side</th>
                  <th className="px-1 py-[3px] text-right">Volume</th>
                  <th className="px-1 py-[3px] text-right">Price</th>
                  <th className="px-1 py-[3px] text-right">S/L</th>
                  <th className="px-1 py-[3px] text-right">T/P</th>
                  <th className="px-1 py-[3px]">Status</th>
                  <th className="px-1 py-[3px]">Created</th>
                  <th className="px-1 py-[3px] pr-2">Actions</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300 font-mono text-[11px]">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-zinc-600 text-xs italic">
                      No pending orders
                    </td>
                  </tr>
                ) : (
                  orders.map((order, i) => (
                    <PendingOrderRow
                      key={order.id}
                      order={order}
                      i={i}
                      onCancel={handleCancelOrder}
                      onModify={o => setModifyOrder(o)}
                      loading={loading}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Metrics / Account Summary Bar (from WS metrics channel) ── */}
      {activeTab === 'Positions' && (
        metrics ? (
          <MetricsBar metrics={metrics} />
        ) : positions.length > 0 ? (
          // Fallback summary from REST position data (before first metrics WS message)
          <div className="bg-[#191a1e] border-t border-zinc-800/60 px-3 py-[3px] flex items-center gap-4 text-[11px] tabular-nums flex-shrink-0 flex-wrap">
            <span className="text-zinc-500">
              Positions: <span className="text-zinc-300">{positions.length}</span>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-500">
              Floating P/L:{' '}
              <span className={`font-semibold ${positions.reduce((s, p) => s + p.profit, 0) >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                {fmtMoney(positions.reduce((s, p) => s + p.profit, 0), true)}
              </span>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-500">
              Swap: <span className="text-zinc-400">{fmtMoney(totalSwap)}</span>
            </span>
          </div>
        ) : null
      )}

      {/* ── Close All Confirmation ── */}
      {showCloseAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl p-6 max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <Icon name="alert-triangle" size="sm" className="w-6 h-6 text-yellow-400" />
              <h3 className="text-lg font-semibold text-zinc-100">Close All Positions?</h3>
            </div>
            <p className="text-sm text-zinc-400 mb-6">
              This will close all {positions.length} open positions. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseAllConfirm(false)}
                className="flex-1 px-4 py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
              >Cancel</button>
              <button
                onClick={handleCloseAll}
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
              >{loading ? 'Closing…' : 'Close All'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modify Position Dialog ── */}
      <ModifyPositionDialog
        isOpen={modifyPosition !== null}
        onClose={() => {
          setModifyPosition(null);
          fetchPositions();
        }}
        position={modifyPosition ? {
          id: modifyPosition.ticket,
          symbol: modifyPosition.symbol,
          side: modifyPosition.side.toUpperCase() as 'BUY' | 'SELL',
          volume: modifyPosition.volume,
          openPrice: modifyPosition.price_open,
          currentPrice: modifyPosition.price_current,
          openTime: fmtUnixTime(modifyPosition.time_create),
          sl: modifyPosition.price_sl,
          tp: modifyPosition.price_tp,
          swap: modifyPosition.swap,
          commission: 0,
          unrealizedPnL: modifyPosition.profit,
        } as AppPosition : null}
      />

      {/* ── Modify Pending Order Dialog ── */}
      <ModifyPositionDialog
        isOpen={modifyOrder !== null}
        kind="pending-order"
        onClose={() => {
          setModifyOrder(null);
          fetchOrders();
        }}
        position={modifyOrder ? {
          id: parseInt(modifyOrder.id, 10),
          symbol: modifyOrder.symbol,
          side: modifyOrder.side,
          volume: modifyOrder.volume,
          openPrice: modifyOrder.price,
          currentPrice: modifyOrder.price,
          openTime: modifyOrder.createdAt,
          sl: modifyOrder.sl || 0,
          tp: modifyOrder.tp || 0,
          swap: 0,
          commission: 0,
          unrealizedPnL: 0,
        } as AppPosition : null}
      />
    </div>
  );
}

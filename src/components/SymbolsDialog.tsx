import './SymbolsDialog.css';
import { useUiTranslation } from '../hooks/useUiTranslation';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Search, ChevronRight, ChevronDown, FolderOpen, Folder, X, Minus, Square } from 'lucide-react';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { API_ENDPOINTS, API_V2_BASE_URL, MARKET_WS_URL } from '../config/api';
import { normalizeExactBrokerSymbol } from '../utils/exactBrokerSymbol';
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../services/keyboardShortcutManager';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SymbolSpec {
  id: string;
  name: string;
  description: string;
  category: string;
  digits: number;
  tickSize: number;
  contractSize: number;
  marginRate: number;
  tradingEnabled: boolean;
  bid?: number;
  ask?: number;
  symbol?: string;
  // Extended spec fields
  sector?: string;
  industry?: string;
  spread?: string | number;
  stopsLevel?: number;
  marginCurrency?: string;
  currency?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  swapLong?: number;
  swapShort?: number;
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
  expiration?: string;
}

interface TreeNode {
  name: string;
  symbols?: SymbolSpec[];
  children?: Record<string, TreeNode>;
  expanded?: boolean;
}

interface BarRow {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickRow {
  time: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  flags: string;
}

type Tab = 'Specification' | 'Bars' | 'Ticks';

// ─── Safe time formatter ────────────────────────────────────────────────────
const safeTime = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  // Already a valid date string (ISO 8601 or similar)
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return '—';
  // Unix seconds → ms
  const ms = n < 1e10 ? n * 1000 : n;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

// ─── Constants ───────────────────────────────────────────────────────────────

const SYMBOL_SECTOR_MAP: Record<string, { sector: string; industry: string }> = {
  XAU: { sector: 'Commodities', industry: 'Precious Metals' },
  XAG: { sector: 'Commodities', industry: 'Precious Metals' },
  BTC: { sector: 'Crypto', industry: 'Digital Assets' },
  ETH: { sector: 'Crypto', industry: 'Digital Assets' },
  EUR: { sector: 'Forex', industry: 'Major Pairs' },
  GBP: { sector: 'Forex', industry: 'Major Pairs' },
  USD: { sector: 'Forex', industry: 'Major Pairs' },
  OIL: { sector: 'Commodities', industry: 'Energy' },
  NAS: { sector: 'Indices', industry: 'US Indices' },
  SPX: { sector: 'Indices', industry: 'US Indices' },
};

const getSymbolSector = (sym: string) => {
  for (const prefix of Object.keys(SYMBOL_SECTOR_MAP)) {
    if (sym.startsWith(prefix)) return SYMBOL_SECTOR_MAP[prefix];
  }
  return { sector: 'Forex', industry: 'Currency Pairs' };
};

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fetchJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

const asArray = <T,>(payload: unknown, keys: string[] = []): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
};

const getApiRootBaseUrl = (): string => API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');

const buildSymbolEndpointUrl = (endpoint: string): string =>
  endpoint.startsWith('/api/v2')
    ? `${API_V2_BASE_URL}${endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/'}`
    : `${getApiRootBaseUrl()}${endpoint}`;

const SYMBOL_ENDPOINTS = ['/api/v2/instruments', '/api/v1/market/symbols', '/api/v1/market/symbol-list'];
// A logged-in account may only browse its own group catalogue; never fall back
// to the public broker list.
const ACCOUNT_SYMBOL_ENDPOINTS = ['/api/v2/instruments'];

const extractInstrumentRows = (payload: unknown): any[] =>
  asArray<any>(payload, ['symbols', 'instruments', 'data', 'result']);

const normalizeInstrument = (raw: any): SymbolSpec | null => {
  const name = String(raw?.symbol ?? raw?.name ?? raw?.id ?? '').trim();
  if (!name) return null;
  const sector = getSymbolSector(name);
  const digits = Number(raw?.digits ?? 5);
  const tickSize = Number(raw?.tick_size ?? raw?.tickSize ?? (digits > 0 ? 1 / Math.pow(10, digits) : 0.00001));
  const contractSize = Number(raw?.contract_size ?? raw?.contractSize ?? 0);
  const bid = Number(raw?.bid);
  const ask = Number(raw?.ask);

  return {
    id: String(raw?.id ?? name),
    name,
    symbol: name,
    description: String(raw?.description ?? name),
    category: String(raw?.category ?? 'Forex'),
    digits: Number.isFinite(digits) ? digits : 5,
    tickSize: Number.isFinite(tickSize) ? tickSize : 0.00001,
    contractSize: Number.isFinite(contractSize) ? contractSize : 0,
    marginRate: Number(raw?.margin_rate ?? raw?.marginRate ?? 0),
    tradingEnabled: Boolean(raw?.enabled ?? raw?.trading_enabled ?? raw?.tradingEnabled ?? true),
    bid: Number.isFinite(bid) ? bid : undefined,
    ask: Number.isFinite(ask) ? ask : undefined,
    ...sector,
    spread: raw?.spread ?? 'floating',
    stopsLevel: Number(raw?.stops_level ?? raw?.stopsLevel ?? 0),
    marginCurrency: raw?.margin_currency ?? raw?.marginCurrency ?? name.slice(0, 3),
    swapLong: Number(raw?.swap_long ?? raw?.swapLong ?? 0),
    swapShort: Number(raw?.swap_short ?? raw?.swapShort ?? 0),
    minVolume: Number(raw?.min_volume ?? raw?.minVolume ?? 0),
    maxVolume: Number(raw?.max_volume ?? raw?.maxVolume ?? 0),
    volumeStep: Number(raw?.volume_step ?? raw?.volumeStep ?? 0),
    expiration: raw?.expiration,
  };
};

const normalizeBar = (raw: any): BarRow | null => {
  const rawTime = raw?.time ?? raw?.Time ?? raw?.timestamp ?? raw?.t ?? raw?.date;
  const open = Number(raw?.open ?? raw?.Open ?? raw?.o);
  const high = Number(raw?.high ?? raw?.High ?? raw?.h);
  const low = Number(raw?.low ?? raw?.Low ?? raw?.l);
  const close = Number(raw?.close ?? raw?.Close ?? raw?.c);
  const volume = Number(raw?.volume ?? raw?.Volume ?? raw?.v ?? raw?.tick_count ?? raw?.tickCount ?? 0);
  if (rawTime == null || ![open, high, low, close].every(Number.isFinite)) return null;
  if (open <= 0 && close <= 0) return null;
  return {
    time: safeTime(rawTime),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
};

const normalizeTick = (raw: any): TickRow | null => {
  const rawTime = raw?.time ?? raw?.timestamp ?? raw?.ts ?? raw?.created_at;
  const bid = Number(raw?.bid);
  const ask = Number(raw?.ask);
  const last = Number(raw?.last ?? raw?.close ?? raw?.bid);
  const volume = Number(raw?.volume ?? 0);
  if (rawTime == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (bid <= 0 && ask <= 0) return null;
  return {
    time: safeTime(rawTime),
    bid,
    ask,
    last: Number.isFinite(last) ? last : bid,
    volume: Number.isFinite(volume) ? volume : 0,
    flags: String(raw?.flags ?? ''),
  };
};

// Build tree from flat symbol list
const buildTree = (symbols: SymbolSpec[]): TreeNode => {
  const root: TreeNode = { name: 'root', children: {} };

  symbols.forEach(sym => {
    const cat = sym.category?.trim() || 'Forex';
    const parts = cat.split('.');
    let node = root;

    parts.forEach((part, i) => {
      if (!node.children) node.children = {};
      if (!node.children[part]) {
        node.children[part] = { name: part, children: {}, symbols: [] };
      }
      if (i === parts.length - 1) {
        node.children[part].symbols = node.children[part].symbols || [];
        node.children[part].symbols!.push(sym);
      }
      node = node.children[part];
    });
  });

  return root;
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const DollarIcon = ({ className = '', shown = true }: { className?: string, shown?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" className={`rtx-symbols-dialog__symbol-icon ${className}`} data-shown={shown} fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill={shown ? "#f59e0b" : "#555555"} stroke="none" />
    <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="bold" fill={shown ? "#1a1a1a" : "#b0b0b0"} fontFamily="monospace">$</text>
  </svg>
);

interface TreeItemProps {
  name: string;
  node: TreeNode;
  depth?: number;
  selectedSymbol: SymbolSpec | null;
  onSelectSymbol: (s: SymbolSpec) => void;
  searchQuery: string;
  watchlistSymbols: string[];
}

const TreeItem: React.FC<TreeItemProps> = ({ name, node, depth = 0, selectedSymbol, onSelectSymbol, searchQuery, watchlistSymbols }) => {
    useUiTranslation();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && Object.keys(node.children).length > 0;
  const hasSymbols = node.symbols && node.symbols.length > 0;

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery) setExpanded(true);
  }, [searchQuery]);

  return (
    <div>
      {/* Folder row */}
      <div
        className="rtx-symbols-dialog__folder flex items-center gap-1 px-1 py-[2px] cursor-pointer hover:bg-[var(--bg-quaternary)] rounded-sm select-none"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => setExpanded(e => !e)}
      >
        {(hasChildren || hasSymbols) ? (
          expanded
            ? <ChevronDown size={12} className="text-[var(--text-secondary)] flex-shrink-0" />
            : <ChevronRight size={12} className="text-[var(--text-secondary)] flex-shrink-0" />
        ) : (
          <span className="w-3" />
        )}
        {expanded ? <FolderOpen size={13} className="text-yellow-400 flex-shrink-0" /> : <Folder size={13} className="text-yellow-600 flex-shrink-0" />}
        <span className="ml-1 text-[13px] font-normal text-[var(--text-primary)]">{name}</span>
      </div>

      {/* Children */}
      {expanded && (
        <>
          {/* Sub-folders */}
          {hasChildren && Object.entries(node.children!).map(([childName, childNode]) => (
            <TreeItem
              key={childName}
              name={childName}
              node={childNode}
              depth={depth + 1}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={onSelectSymbol}
              searchQuery={searchQuery}
              watchlistSymbols={watchlistSymbols}
            />
          ))}

          {/* Symbol leaves */}
          {hasSymbols && node.symbols!.map(sym => (
            <div
              key={sym.id || sym.name}
              data-selected={selectedSymbol?.name === sym.name}
              className={`rtx-symbols-dialog__tree-symbol flex items-center gap-1 px-1 py-[2px] cursor-pointer rounded-sm select-none ${
                selectedSymbol?.name === sym.name
                  ? 'bg-[var(--color-info-dim)] text-[var(--text-primary)]'
                  : 'hover:bg-[var(--bg-quaternary)] text-[var(--text-primary)]'
              }`}
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
              onClick={() => onSelectSymbol(sym)}
            >
              <DollarIcon className="flex-shrink-0" shown={watchlistSymbols.includes(sym.symbol || sym.name)} />
              <span className="ml-1 text-[13px] font-normal" title={sym.name}>{sym.name}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

// ─── Main Dialog ─────────────────────────────────────────────────────────────

interface SymbolsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onShowSymbol?: (symbol: string) => void;
  onOpenChart?: (symbol: string) => void;
  instruments?: readonly unknown[];
  initialSymbol?: string;
  title?: string;
  chartActionLabel?: string;
}

export const SymbolsDialog: React.FC<SymbolsDialogProps> = ({
  isOpen,
  onClose,
  onShowSymbol,
  onOpenChart,
  instruments,
  initialSymbol,
  title = 'Symbols',
  chartActionLabel = 'Open Chart',
}) => {
    const tr = useUiTranslation();
  const isDesktopShell = Boolean(window.electron?.window);
  const [activeTab, setActiveTab] = useState<Tab>('Specification');
  const [searchQuery, setSearchQuery] = useState('');
  const [showExpired, setShowExpired] = useState(false);
  const [allSymbols, setAllSymbols] = useState<SymbolSpec[]>([]);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolSpec | null>(null);
  const [bars, setBars] = useState<BarRow[]>([]);
  const [ticks, setTicks] = useState<TickRow[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [ticksLoading, setTicksLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [ticksError, setTicksError] = useState<string | null>(null);
  const [barsProgress, setBarsProgress] = useState(0);
  const [ticksProgress, setTicksProgress] = useState(0);
  const [barsVisibleCount, setBarsVisibleCount] = useState(100);
  const [ticksVisibleCount, setTicksVisibleCount] = useState(100);

  // Bars tab specific state
  const TIMEFRAMES = useMemo(() => ['M1','M5','M15','M30','H1','H4','D1','W1','MN'], []);
  const [barsSymbolInput, setBarsSymbolInput] = useState('');
  const [barsTimeframe, setBarsTimeframe] = useState('M15');
  
  const formatDateForInput = (d: Date) => d.toISOString().slice(0, 16);
  const [barsStartTime, setBarsStartTime] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return formatDateForInput(d);
  });
  const [barsEndTime, setBarsEndTime] = useState(() => formatDateForInput(new Date()));
  const [barsFetchTrigger, setBarsFetchTrigger] = useState(0);
  const [symbolsFetchTrigger, setSymbolsFetchTrigger] = useState(0);

  useEffect(() => {
    if (selectedSymbol && !barsSymbolInput) {
      setBarsSymbolInput(selectedSymbol.symbol || selectedSymbol.name);
    }
  }, [selectedSymbol, barsSymbolInput]);

  // Watchlist integration
  const watchlists = useWatchlistStore(s => s.watchlists);
  const activeWatchlistId = useWatchlistStore(s => s.activeWatchlistId);
  const addSymbolToWatchlist = useWatchlistStore(s => s.addSymbolToWatchlist);
  const removeSymbolFromWatchlist = useWatchlistStore(s => s.removeSymbolFromWatchlist);

  const activeWatchlist = watchlists.find(w => w.id === activeWatchlistId);
  const watchlistSymbols = activeWatchlist?.symbols || [];
  
  const isSelectedSymbolShown = selectedSymbol ? watchlistSymbols.includes(selectedSymbol.symbol || selectedSymbol.name) : false;

  const openChartForSymbol = useCallback((instrument: SymbolSpec | null) => {
    const brokerSymbol = instrument?.symbol?.trim();
    if (!brokerSymbol || !onOpenChart) return;

    onOpenChart(brokerSymbol);
    onClose();
  }, [onClose, onOpenChart]);

  // Drag state — centered on screen when first rendered
  const [size, setSize] = useState(() => ({
    w: isDesktopShell ? Math.min(860, window.innerWidth - 32) : 620,
    h: isDesktopShell ? Math.min(640, window.innerHeight - 64) : 460,
  }));
  const [pos, setPos] = useState(() => ({
    x: isDesktopShell ? Math.max(16, (window.innerWidth - size.w) / 2) : Math.max(20, Math.round((window.innerWidth - size.w) / 2)) + 120,
    y: isDesktopShell ? Math.max(16, (window.innerHeight - size.h) / 2) : Math.max(40, Math.round((window.innerHeight - size.h) / 3)),
  }));
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── Reset position to center every time the dialog opens ──────────────────
  useEffect(() => {
    if (!isOpen) return;
    setPos({
      x: isDesktopShell ? Math.max(16, (window.innerWidth - size.w) / 2) : Math.max(20, Math.round((window.innerWidth - size.w) / 2)) + 120,
      y: isDesktopShell ? Math.max(16, (window.innerHeight - size.h) / 2) : Math.max(40, Math.round((window.innerHeight - size.h) / 3)),
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isDesktopShell) return;
    const fitToViewport = () => {
      const w = Math.min(Math.max(680, size.w), window.innerWidth - 32);
      const h = Math.min(Math.max(440, size.h), window.innerHeight - 32);
      setSize(current => current.w === w && current.h === h ? current : { w, h });
      setPos(current => ({
        x: Math.max(16, Math.min(current.x, window.innerWidth - w - 16)),
        y: Math.max(16, Math.min(current.y, window.innerHeight - h - 16)),
      }));
    };
    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    return () => window.removeEventListener('resize', fitToViewport);
  }, [isOpen, isDesktopShell, size.w, size.h]);

  // ── Load symbols on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    if (instruments) {
      const normalized = instruments.map(normalizeInstrument).filter((symbol): symbol is SymbolSpec => Boolean(symbol));
      setAllSymbols(normalized);
      setSelectedSymbol(normalized.find(symbol => normalizeExactBrokerSymbol(symbol.symbol) === normalizeExactBrokerSymbol(initialSymbol)) || normalized[0] || null);
      setLoading(false); setSymbolsError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSymbolsError(null);

    const loadSymbols = async () => {
      let lastError: unknown = null;

      for (const endpoint of isAuthenticated ? ACCOUNT_SYMBOL_ENDPOINTS : SYMBOL_ENDPOINTS) {
        try {
          const payload = await fetchJson<unknown>(buildSymbolEndpointUrl(endpoint));
          const instruments = extractInstrumentRows(payload);
          const normalized = instruments
            .map(normalizeInstrument)
            .filter((symbol): symbol is SymbolSpec => Boolean(symbol));

          if (normalized.length === 0) {
            lastError = new Error(`No symbols returned by ${endpoint}.`);
            continue;
          }

          return { endpoint, normalized };
        } catch (err) {
          lastError = err;
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Failed to load symbols.');
    };

    loadSymbols()
      .then(({ endpoint, normalized }) => {
        if (cancelled) return;
        setAllSymbols(normalized);
        setSelectedSymbol(current => {
          if (current && normalized.some(sym => (sym.symbol || sym.name) === (current.symbol || current.name))) return current;
          return normalized[0] || null;
        });
        if (normalized.length === 0) {
          setSymbolsError(`No symbols returned by ${endpoint}.`);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setAllSymbols([]);
        setSelectedSymbol(null);
        setSymbolsError(err instanceof Error ? err.message : 'Failed to load symbols.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, symbolsFetchTrigger, instruments, initialSymbol, isAuthenticated]);

  // ── Filter symbols by search (memoized) ───────────────────────────────────
  const filteredSymbols = useMemo(() => {
    if (!searchQuery.trim()) {
      return allSymbols;
    }
    const q = searchQuery.toLowerCase();
    return allSymbols.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }, [searchQuery, allSymbols]);

  // Load bar data from swagger v2/history APIs. Empty/error responses stay visible instead of fabricating candles.
  useEffect(() => {
    if (activeTab !== 'Bars' || !barsSymbolInput) return;
    setBarsLoading(true);
    setBarsProgress(0);
    setBarsError(null);
    setBars([]);
    setBarsVisibleCount(100);
    const symName = barsSymbolInput;

    const fetchBars = async () => {
      try {
        const fromTs = Math.floor(new Date(barsStartTime).getTime() / 1000);
        const toTs = Math.floor(new Date(barsEndTime).getTime() / 1000);
        const historyParams = new URLSearchParams({
          tf: barsTimeframe,
          from: String(fromTs),
          to: String(toTs),
          count: '5000',
        });
        const v2Params = new URLSearchParams({
          timeframe: barsTimeframe,
          from: String(fromTs),
          to: String(toTs),
          limit: '5000',
        });

        setBarsProgress(35);
        let payload: unknown;
        try {
          payload = await fetchJson<unknown>(`${API_ENDPOINTS.v2.history.candles(symName)}?${historyParams.toString()}`);
        } catch {
          setBarsProgress(65);
          payload = await fetchJson<unknown>(`${API_ENDPOINTS.v2.market.candles(symName)}?${v2Params.toString()}`);
        }

        const parsed = asArray<any>(payload, ['candles', 'data'])
          .map(normalizeBar)
          .filter((bar): bar is BarRow => Boolean(bar));
        setBars(parsed);
        if (parsed.length === 0) {
          setBarsError(`No bars returned for ${symName} ${barsTimeframe}.`);
        }
      } catch (err) {
        setBars([]);
        setBarsError(err instanceof Error ? err.message : `Failed to load bars for ${symName}.`);
      } finally {
        setBarsProgress(100);
        setTimeout(() => setBarsLoading(false), 200);
      }
    };

    fetchBars();
  }, [activeTab, barsFetchTrigger, barsSymbolInput, barsTimeframe, barsStartTime, barsEndTime]);

  // Ticks tab specific state
  const TICK_TYPES = useMemo(() => ['Bid/Ask ticks', 'Info ticks'], []);
  const [ticksSymbolInput, setTicksSymbolInput] = useState('');
  const [ticksType, setTicksType] = useState('Bid/Ask ticks');
  const [ticksStartTime, setTicksStartTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    return formatDateForInput(d);
  });
  const [ticksEndTime, setTicksEndTime] = useState(() => formatDateForInput(new Date()));
  const [ticksFetchTrigger, setTicksFetchTrigger] = useState(0);

  useEffect(() => {
    if (selectedSymbol && !ticksSymbolInput) {
      setTicksSymbolInput(selectedSymbol.symbol || selectedSymbol.name);
    }
  }, [selectedSymbol, ticksSymbolInput]);

  // ── Load tick data ────────────────────────────────────────────────────────
  // Load tick data from swagger v2/history APIs. Empty/error responses stay visible instead of fabricating ticks.
  useEffect(() => {
    if (activeTab !== 'Ticks' || !ticksSymbolInput) return;
    setTicksLoading(true);
    setTicksProgress(0);
    setTicksError(null);
    setTicks([]);
    setTicksVisibleCount(100);
    const symName = ticksSymbolInput;

    const fetchTicks = async () => {
      try {
        const fromTs = Math.floor(new Date(ticksStartTime).getTime() / 1000);
        const toTs = Math.floor(new Date(ticksEndTime).getTime() / 1000);
        const historyParams = new URLSearchParams({
          from: String(fromTs),
          to: String(toTs),
          limit: '10000',
        });
        const v2Params = new URLSearchParams({ limit: '1000' });

        setTicksProgress(35);
        let payload: unknown;
        try {
          payload = await fetchJson<unknown>(`${API_ENDPOINTS.v2.history.ticks(symName)}?${historyParams.toString()}`);
        } catch {
          setTicksProgress(65);
          payload = await fetchJson<unknown>(`${API_ENDPOINTS.v2.market.ticks(symName)}?${v2Params.toString()}`);
        }

        const parsed = asArray<any>(payload, ['ticks', 'data'])
          .map(normalizeTick)
          .filter((tick): tick is TickRow => Boolean(tick));
        setTicks(parsed);
        if (parsed.length === 0) {
          setTicksError(`No ticks returned for ${symName}.`);
        }
      } catch (err) {
        setTicks([]);
        setTicksError(err instanceof Error ? err.message : `Failed to load ticks for ${symName}.`);
      } finally {
        setTicksProgress(100);
        setTimeout(() => setTicksLoading(false), 200);
      }
    };

    fetchTicks();
  }, [activeTab, ticksFetchTrigger, ticksSymbolInput, ticksStartTime, ticksEndTime]);

  const handleBarsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 300) {
      setBarsVisibleCount(v => v + 100);
    }
  }, []);

  const handleTicksScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 300) {
      setTicksVisibleCount(v => v + 100);
    }
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const x = dragRef.current.ox + ev.clientX - dragRef.current.sx;
      const y = dragRef.current.oy + ev.clientY - dragRef.current.sy;
      setPos(isDesktopShell ? {
        x: Math.max(16, Math.min(x, window.innerWidth - size.w - 16)),
        y: Math.max(16, Math.min(y, window.innerHeight - size.h - 16)),
      } : { x, y });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos, isDesktopShell, size]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const w = resizeRef.current.ow + ev.clientX - resizeRef.current.sx;
      const h = resizeRef.current.oh + ev.clientY - resizeRef.current.sy;
      setSize(isDesktopShell ? {
        w: Math.min(Math.max(680, w), window.innerWidth - pos.x - 16),
        h: Math.min(Math.max(440, h), window.innerHeight - pos.y - 16),
      } : { w: Math.max(500, w), h: Math.max(360, h) });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size, isDesktopShell, pos]);

  // ── Keyboard shortcut ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (document.activeElement === document.body || dialogRef.current?.contains(document.activeElement)) previousFocus?.focus(); };
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isOpen || shouldIgnoreShortcutEvent(e) || !isShortcutOwnedBy(e, dialogRef.current)) return;
      const closeShortcut = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key.toLowerCase() === 'u' || e.code === 'KeyU');
      if (closeShortcut || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (first && last && (document.activeElement === dialogRef.current || (!e.shiftKey && document.activeElement === last) || (e.shiftKey && document.activeElement === first))) {
          e.preventDefault(); (e.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // ── Build tree ────────────────────────────────────────────────────────────
  const tree = buildTree(searchQuery ? filteredSymbols : allSymbols);

  if (!isOpen) return null;

  // ── Spec fields ───────────────────────────────────────────────────────────
  const specFields = selectedSymbol ? [
    { label: 'Sector', value: selectedSymbol.sector || 'Forex', color: 'text-[var(--text-primary)]' },
    { label: 'Industry', value: selectedSymbol.industry || 'Currency Pairs', color: 'text-[var(--text-primary)]', alignRight: true },
    { label: 'Digits', value: selectedSymbol.digits, prefix: '01', color: 'text-[var(--text-primary)]' },
    { label: 'Contract size', value: `${selectedSymbol.contractSize} ${selectedSymbol.marginCurrency || ''}`, prefix: '½', color: 'text-[var(--text-primary)]' },
    { label: 'Spread', value: selectedSymbol.spread || 'floating', prefix: '01', color: 'text-[var(--text-primary)]' },
    { label: 'Stops level', value: selectedSymbol.stopsLevel || 20, prefix: '01', color: 'text-[var(--text-primary)]' },
    { label: 'Margin currency', value: selectedSymbol.marginCurrency || selectedSymbol.name.slice(0, 3), prefix: 'ab', color: 'text-[var(--color-profit)]' },
    { label: 'Tick size', value: selectedSymbol.tickSize, prefix: '01', color: 'text-[var(--text-primary)]' },
    { label: 'Trading enabled', value: selectedSymbol.tradingEnabled ? 'Yes' : 'No', prefix: '', color: 'text-[var(--text-primary)]' },
  ] : [];

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9990] pointer-events-none">
      {/* Backdrop — just for click-outside detection */}
      <div className="rtx-symbols-dialog-backdrop absolute inset-0 pointer-events-auto" data-desktop={isDesktopShell} onClick={onClose} style={{ background: isDesktopShell ? 'rgba(15, 23, 42, 0.16)' : 'transparent' }} />

      {/* Dialog Window */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={tr(title)}
        data-desktop={isDesktopShell}
        data-shortcut-scope="local"
        tabIndex={-1}
        className="rtx-symbols-dialog absolute pointer-events-auto flex flex-col bg-[var(--bg-tertiary)] border border-[var(--border-primary)] shadow-2xl select-none"
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, minWidth: isDesktopShell ? Math.min(680, window.innerWidth - 32) : 500, minHeight: isDesktopShell ? Math.min(440, window.innerHeight - 32) : 360 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Title bar ────────────────────────────────────────────────────── */}
        <div
          className="flex min-h-[44px] items-center justify-between rtx-symbols-dialog__titlebar bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)] px-2 flex-shrink-0 cursor-move"
          onMouseDown={onDragStart}
        >
          <div className="rtx-symbols-dialog__heading flex items-center gap-2">
            {isDesktopShell ? <span className="rtx-symbols-dialog__title-icon"><Search size={18} /></span> : <DollarIcon />}
            <div>
              <span className="rtx-dialog-title text-[20px] leading-7 font-semibold text-[var(--text-primary)]">{tr(title)}</span>
              {isDesktopShell && <p className="rtx-symbols-dialog__subtitle">{tr('Browse instruments and contract specifications')}</p>}
            </div>
          </div>
          <div className="rtx-symbols-dialog__window-actions flex items-center gap-0 h-full" onMouseDown={e => e.stopPropagation()}>
            {!isDesktopShell && <>
            <button className="h-full px-3 hover:bg-white/10 flex items-center justify-center" title={tr("Minimize")}>
              <Minus size={10} className="text-[var(--text-secondary)]" strokeWidth={1.8} />
            </button>
            <button className="h-full px-3 hover:bg-white/10 flex items-center justify-center" title={tr("Maximize")}>
              <Square size={10} className="text-[var(--text-secondary)]" strokeWidth={1.8} />
            </button>
            </>}
            <button
              className="h-full px-3 hover:bg-red-500 flex items-center justify-center group"
              onClick={onClose}
              title={tr("Close")}
            >
              <X size={11} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="rtx-symbols-dialog__tabs flex items-end h-8 bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)] px-2 gap-0 flex-shrink-0">
          {(['Specification', 'Bars', 'Ticks'] as Tab[]).map(tab => (
            <button
              key={tab}
              aria-pressed={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-[13px] border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-[var(--color-info)] text-[var(--text-primary)] bg-[var(--color-info-dim)] font-medium'
                  : 'border-transparent text-[var(--text-secondary)] font-normal hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              {tr(tab)}
            </button>
          ))}
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="rtx-symbols-dialog__body flex flex-1 min-h-0 bg-[var(--bg-secondary)]">
          {activeTab === 'Bars' ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Bars Top Controls */}
              <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <select 
                  className="w-[120px] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none"
                  value={barsSymbolInput}
                  onChange={e => setBarsSymbolInput(e.target.value)}
                >
                  {allSymbols.map(s => <option key={s.symbol || s.name} value={s.symbol || s.name}>{s.name || s.symbol}</option>)}
                </select>
                <select 
                  className="w-[70px] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none"
                  value={barsTimeframe}
                  onChange={e => setBarsTimeframe(e.target.value)}
                >
                  {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
                <input 
                  type="datetime-local" 
                  className="border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none [color-scheme:dark]"
                  value={barsStartTime}
                  onChange={e => setBarsStartTime(e.target.value)}
                />
                <input 
                  type="datetime-local" 
                  className="border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none [color-scheme:dark]"
                  value={barsEndTime}
                  onChange={e => setBarsEndTime(e.target.value)}
                />
                <button 
                  className="ml-auto rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-6 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                  onClick={() => setBarsFetchTrigger(v => v + 1)}
                >
                  {tr("Request")}</button>
              </div>
              
              {/* Bars Meta Info */}
              {barsLoading ? (
                <div className="h-[20px] bg-[var(--bg-quaternary)] relative border-b border-[var(--border-primary)] flex-shrink-0 text-[var(--text-primary)] font-sans">
                  <div className="absolute top-0 left-0 h-full bg-[var(--color-profit)]" style={{ width: `${barsProgress}%` }} />
                  <div className="absolute inset-0 z-10 flex w-full items-center overflow-hidden text-ellipsis whitespace-nowrap px-2 text-[12px] font-normal">
                    {barsSymbolInput}: '{new Date(barsStartTime).toLocaleString('default', { month: 'short', year: 'numeric' })}{tr("' downloaded (")}{barsProgress.toFixed(1)}%)
                  </div>
                </div>
              ) : (
                <div className="flex-shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-1 text-[12px] font-normal text-[var(--text-primary)]">
                  {barsSymbolInput},{barsTimeframe}: {bars.length} {tr(" bars")}</div>
              )}
              
              {/* Bars Table */}
              <div className="flex-1 overflow-y-auto custom-scrollbar" onScroll={handleBarsScroll}>
                <table className="w-full border-collapse text-[13px] font-normal">
                    <thead>
                      <tr className="bg-[var(--bg-tertiary)] sticky top-0 z-10">
                        {['Date', 'Open', 'High', 'Low', 'Close', 'Tick Volume', 'Volume', 'Spread'].map((h, i) => (
                          <th key={h} className={`border-b border-[var(--border-primary)] px-3 py-1.5 text-[12px] font-normal text-[var(--text-secondary)] ${i === 0 ? 'text-left' : 'text-right'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bars.slice(0, barsVisibleCount).map((bar, i) => {
                        const isUp = bar.close >= bar.open;
                        const candleColor = isUp ? 'var(--color-profit)' : 'var(--color-loss)';
                        return (
                          <tr key={i} className={`border-b border-[var(--border-primary)] hover:bg-[var(--bg-quaternary)] ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-tertiary)]'}`}>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] text-left whitespace-nowrap">
                              <svg width="10" height="14" viewBox="0 0 10 14" fill="none" className="mr-2 inline-block align-middle">
                                <rect x="2" y="3" width="6" height="8" stroke={candleColor} fill={isUp ? 'none' : candleColor} strokeWidth="1" />
                                <line x1="5" y1="1" x2="5" y2="3" stroke={candleColor} strokeWidth="1" />
                                <line x1="5" y1="11" x2="5" y2="13" stroke={candleColor} strokeWidth="1" />
                              </svg>
                              {bar.time.replace(/,/g, '')}
                            </td>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{bar.open.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{bar.high.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{bar.low.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className={`px-3 py-[4px] font-mono text-right ${isUp ? 'text-[var(--color-profit)]' : 'text-blue-400'}`}>{bar.close.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{bar.volume.toLocaleString()}</td>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">0</td>
                            <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{Math.round((bar.high - bar.low) * Math.pow(10, selectedSymbol?.digits || 5) * 0.1) || 10}</td>
                          </tr>
                        );
                      })}
                      {bars.length === 0 && !barsLoading && (
                        <tr>
                          <td colSpan={8} className="text-center py-6 text-[var(--text-tertiary)]">
                            <div>{barsError || 'No bar data available'}</div>
                            <button
                              className="mt-2 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-3 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                              onClick={() => setBarsFetchTrigger(v => v + 1)}
                            >
                              {tr("Retry")}</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
              </div>
            </div>
          ) : activeTab === 'Ticks' ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Ticks Top Controls */}
              <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <select 
                  className="w-[120px] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none"
                  value={ticksSymbolInput}
                  onChange={e => setTicksSymbolInput(e.target.value)}
                >
                  {allSymbols.map(s => <option key={s.symbol || s.name} value={s.symbol || s.name}>{s.name || s.symbol}</option>)}
                </select>
                <select 
                  className="w-[110px] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none"
                  value={ticksType}
                  onChange={e => setTicksType(e.target.value)}
                >
                  {TICK_TYPES.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                </select>
                <input 
                  type="datetime-local" 
                  className="border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none [color-scheme:dark]"
                  value={ticksStartTime}
                  onChange={e => setTicksStartTime(e.target.value)}
                />
                <input 
                  type="datetime-local" 
                  className="border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[13px] font-normal text-[var(--text-primary)] outline-none [color-scheme:dark]"
                  value={ticksEndTime}
                  onChange={e => setTicksEndTime(e.target.value)}
                />
                <button 
                  className="ml-auto rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-6 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                  onClick={() => setTicksFetchTrigger(v => v + 1)}
                >
                  {tr("Request")}</button>
              </div>
              
              {/* Ticks Meta Info */}
              {ticksLoading ? (
                <div className="h-[20px] bg-[var(--bg-quaternary)] relative border-b border-[var(--border-primary)] flex-shrink-0 text-[var(--text-primary)] font-sans">
                  <div className="absolute top-0 left-0 h-full bg-[var(--color-profit)]" style={{ width: `${ticksProgress}%` }} />
                  <div className="absolute inset-0 z-10 flex w-full items-center overflow-hidden text-ellipsis whitespace-nowrap px-2 text-[12px] font-normal">
                    {ticksSymbolInput}: '{new Date(ticksStartTime).toLocaleString('default', { month: 'short', year: 'numeric' })}{tr("' downloaded (")}{ticksProgress.toFixed(1)}%)
                  </div>
                </div>
              ) : (
                <div className="flex-shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-1 text-[12px] font-normal text-[var(--text-primary)]">
                  {ticksSymbolInput}: {ticks.length} {tr(" ticks")}</div>
              )}
              
              {/* Ticks Table */}
              <div className="flex-1 overflow-y-auto custom-scrollbar" onScroll={handleTicksScroll}>
                <table className="w-full border-collapse text-[13px] font-normal">
                    <thead>
                      <tr className="bg-[var(--bg-tertiary)] sticky top-0 z-10">
                        {['Date', 'Bid', 'Ask', 'Last', 'Volume', 'Flags'].map((h, i) => (
                          <th key={h} className={`border-b border-[var(--border-primary)] px-3 py-1.5 text-[12px] font-normal text-[var(--text-secondary)] ${i === 0 ? 'text-left' : 'text-right'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ticks.slice(0, ticksVisibleCount).map((tick, i) => (
                        <tr key={i} className={`border-b border-[var(--border-primary)] hover:bg-[var(--bg-quaternary)] ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-tertiary)]'}`}>
                          <td className="px-3 py-[4px] text-[var(--text-primary)] text-left whitespace-nowrap">
                            {tick.time.replace(/,/g, '')}
                          </td>
                          <td className="px-3 py-[4px] text-red-400 font-mono text-right">{tick.bid.toFixed(selectedSymbol?.digits || 5)}</td>
                          <td className="px-3 py-[4px] text-[var(--color-profit)] font-mono text-right">{tick.ask.toFixed(selectedSymbol?.digits || 5)}</td>
                          <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{tick.last.toFixed(selectedSymbol?.digits || 5)}</td>
                          <td className="px-3 py-[4px] text-[var(--text-primary)] font-mono text-right">{tick.volume.toLocaleString()}</td>
                          <td className="px-3 py-[4px] text-[var(--text-secondary)] font-mono text-right">{tick.flags}</td>
                        </tr>
                      ))}
                      {ticks.length === 0 && !ticksLoading && (
                        <tr>
                          <td colSpan={6} className="text-center py-6 text-[var(--text-tertiary)]">
                            <div>{ticksError || 'No tick data available'}</div>
                            <button
                              className="mt-2 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-3 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                              onClick={() => setTicksFetchTrigger(v => v + 1)}
                            >
                              {tr("Retry")}</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
              </div>
            </div>
          ) : (
            <>
              {/* Left panel — Tree */}
              <div className="rtx-symbols-dialog__sidebar w-[180px] flex-shrink-0 border-r border-[var(--border-primary)] flex flex-col bg-[var(--bg-secondary)]">
            {/* Tree header */}
            <div className="rtx-symbols-dialog__sidebar-heading flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-primary)]">
              <FolderOpen size={14} className="text-yellow-400" />
              <span className="text-[12px] font-normal text-[var(--text-secondary)]">{tr(isDesktopShell ? 'Instruments' : 'RTX 5 Web Terminal')}</span>
              {isDesktopShell && <span className="rtx-symbols-dialog__count">{allSymbols.length}</span>}
            </div>
            <div className="rtx-symbols-dialog__tree flex-1 overflow-y-auto no-scrollbar py-1">
              {loading ? (
                <div className="px-3 py-2 text-[12px] font-normal text-[var(--text-secondary)]">{tr("Loading...")}</div>
              ) : symbolsError ? (
                <div className="px-3 py-2 text-[12px] font-normal text-[var(--text-secondary)]">
                  <div>{symbolsError}</div>
                  <button
                    className="mt-2 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-3 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                    onClick={() => setSymbolsFetchTrigger(v => v + 1)}
                  >
                    {tr("Retry")}</button>
                </div>
              ) : (
                Object.entries(tree.children || {}).map(([n, node]) => (
                  <TreeItem
                    key={n}
                    name={n}
                    node={node}
                    depth={0}
                    selectedSymbol={selectedSymbol}
                    onSelectSymbol={setSelectedSymbol}
                    searchQuery={searchQuery}
                    watchlistSymbols={watchlistSymbols}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="rtx-symbols-dialog__workspace flex-1 flex flex-col min-w-0">

            {/* Search + checkbox */}
            <div className="rtx-symbols-dialog__filters flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <div className="rtx-symbols-dialog__search flex items-center flex-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-sm h-6 px-1.5 gap-1">
                <Search size={11} className="text-[var(--text-secondary)] flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={tr("Search symbols...")}
                  aria-label={tr('Search symbols')}
                  className="flex-1 bg-transparent text-[13px] font-normal text-[var(--text-primary)] outline-none placeholder-[var(--text-tertiary)]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} aria-label={tr('Clear search')}>
                    <X size={10} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" />
                  </button>
                )}
              </div>
              <label className="rtx-symbols-dialog__expired flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExpired}
                  onChange={e => setShowExpired(e.target.checked)}
                  className="w-3 h-3 accent-[var(--color-info)]"
                />
                <span className="text-[13px] font-normal text-[var(--text-secondary)]">{tr("Show expired contracts")}</span>
              </label>
            </div>

            {/* Symbol list table */}
            <div className="rtx-symbols-dialog__catalog h-[120px] flex-shrink-0 overflow-y-auto border-b border-[var(--border-primary)]">
              <table className="w-full border-collapse text-[13px] font-normal" aria-label={tr('Available symbols')}>
                <thead>
                  <tr className="bg-[var(--bg-tertiary)] sticky top-0">
                    <th className="w-[140px] border-b border-[var(--border-primary)] px-3 py-1.5 text-left text-[12px] font-normal text-[var(--text-secondary)]">{tr("Symbol")}</th>
                    <th className="border-b border-[var(--border-primary)] px-3 py-1.5 text-left text-[12px] font-normal text-[var(--text-secondary)]">{tr("Description")}</th>
                    <th className="w-[100px] border-b border-[var(--border-primary)] px-3 py-1.5 text-right text-[12px] font-normal text-[var(--text-secondary)]">{tr("Expiration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSymbols.length === 0 && !loading && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[12px] font-normal text-[var(--text-tertiary)]">
                        <div>{symbolsError || 'No symbols found'}</div>
                        {symbolsError && (
                          <button
                            className="mt-2 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-3 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                            onClick={() => setSymbolsFetchTrigger(v => v + 1)}
                          >
                            {tr("Retry")}</button>
                        )}
                      </td>
                    </tr>
                  )}
                  {filteredSymbols.map(sym => (
                    <tr
                      key={sym.id || sym.name}
                      data-selected={selectedSymbol?.name === sym.name}
                      onClick={() => setSelectedSymbol(sym)}
                      onDoubleClick={() => openChartForSymbol(sym)}
                      className={`cursor-pointer transition-colors ${
                        selectedSymbol?.name === sym.name
                          ? 'bg-[var(--color-info-dim)] text-[var(--text-primary)]'
                          : 'hover:bg-[var(--bg-quaternary)] text-[var(--text-primary)]'
                      }`}
                    >
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-1.5">
                          <DollarIcon shown={watchlistSymbols.includes(sym.symbol || sym.name)} />
                          <span className={selectedSymbol?.name === sym.name ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'}>{sym.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1 text-[var(--text-secondary)]" title={sym.description}>{sym.description}</td>
                      <td className="px-3 py-1 text-[var(--text-secondary)] text-right">{sym.expiration || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Tab content area ─────────────────────────────────────────── */}
            <div className="rtx-symbols-dialog__details flex-1 overflow-y-auto min-h-0 no-scrollbar">

              {/* SPECIFICATION TAB */}
              {activeTab === 'Specification' && selectedSymbol && (
                <div>
                  {/* Symbol title */}
                  <div className="rtx-symbols-dialog__selection px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
                    {isDesktopShell ? <>
                      <span className="rtx-symbols-dialog__selected-name">{selectedSymbol.name}</span>
                      {selectedSymbol.description !== selectedSymbol.name && <span className="rtx-symbols-dialog__selected-description">{selectedSymbol.description}</span>}
                    </> : <span className="text-[13px] font-medium text-[var(--color-info)]">
                      {selectedSymbol.name}, {selectedSymbol.description}
                    </span>}
                  </div>

                  {/* Spec rows */}
                  <table className="rtx-symbols-dialog__specification w-full border-collapse text-[13px] font-normal" aria-label={tr('Contract specification')}>
                    <tbody>
                      {specFields.map((field, i) => (
                        <tr key={i} className={`border-b border-[var(--border-primary)] ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-tertiary)]'}`}>
                          <td className="px-3 py-[5px] w-[160px]">
                            <div className="flex items-center gap-1.5">
                              {!isDesktopShell && field.prefix && (
                                <span className={`text-[9px] font-mono font-bold ${
                                  field.prefix === 'ab' ? 'text-[var(--color-profit)]' :
                                  field.prefix === '½' ? 'text-[var(--text-primary)]' :
                                  field.prefix === '01' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                                }`}>{field.prefix}</span>
                              )}
                              <span className="text-[var(--text-secondary)]">{tr(field.label)}</span>
                            </div>
                          </td>
                          <td className={`px-3 py-[5px] text-right ${field.alignRight ? 'text-right' : ''} ${field.color}`}>
                            {String(field.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'Specification' && !selectedSymbol && (
                <div className="flex h-full items-center justify-center text-[12px] font-normal text-[var(--text-tertiary)]">
                  {tr("Select a symbol to view specification")}</div>
              )}

            </div>
          </div>
            </>
          )}
        </div>

        {/* ── Bottom buttons ────────────────────────────────────────────────── */}
        <div className="rtx-symbols-dialog__footer flex items-center justify-between px-3 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-primary)] flex-shrink-0">
          <div className="rtx-symbols-dialog__actions flex items-center gap-2">
            {activeTab === 'Bars' || activeTab === 'Ticks' ? (
              <>
                <button className="flex items-center gap-1.5 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-4 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]">
                  {tr("Export ")}{activeTab}
                </button>
                <button className="flex items-center gap-1.5 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-4 py-1 text-[13px] font-normal text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-quaternary)]">
                  {tr("Import ")}{activeTab}
                </button>
                <button className="cursor-not-allowed rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-4 py-1 text-[13px] font-normal text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-quaternary)]">
                  {tr("Create Custom Symbol")}</button>
              </>
            ) : (
              <>
                <button
                  className={`rounded-sm border px-3 py-0.5 text-[13px] font-normal transition-colors ${
                    !selectedSymbol || isSelectedSymbolShown
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-primary)] cursor-not-allowed'
                      : 'text-[var(--text-primary)] bg-[var(--bg-quaternary)] border-[var(--border-primary)] hover:bg-[var(--bg-quaternary)] hover:border-[var(--color-info)]'
                  }`}
                  disabled={!selectedSymbol || isSelectedSymbolShown}
                  onClick={() => {
                    if (selectedSymbol && activeWatchlist) {
                      const symName = selectedSymbol.symbol || selectedSymbol.name;
                      addSymbolToWatchlist(activeWatchlist.id, symName);
                      try {
                        const wsService = getEnhancedWebSocketService(MARKET_WS_URL);
                        wsService.sendMessage({ action: 'subscribe', channel: `ticks.${symName}` });
                        useMarketDataStore.getState().subscribeSymbol(symName);
                      } catch {}
                      onShowSymbol?.(symName);
                    }
                  }}
                >
                  {tr("Show Symbol")}</button>
                <button
                  className={`rounded-sm border px-4 py-1 text-[13px] font-normal transition-colors ${
                    !selectedSymbol || !isSelectedSymbolShown
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-primary)] cursor-not-allowed'
                      : 'text-[var(--text-secondary)] bg-[var(--bg-quaternary)] border-[var(--border-primary)] hover:bg-[var(--bg-quaternary)]'
                  }`}
                  disabled={!selectedSymbol || !isSelectedSymbolShown}
                  onClick={() => {
                    if (selectedSymbol && activeWatchlist) {
                      const symName = selectedSymbol.symbol || selectedSymbol.name;
                      removeSymbolFromWatchlist(activeWatchlist.id, symName);
                    }
                  }}
                >
                  {tr("Hide Symbol")}</button>
                <button
                  data-action="open-chart"
                  className={`rounded-sm border px-4 py-1 text-[13px] font-normal transition-colors ${
                    !selectedSymbol || !onOpenChart
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-primary)] cursor-not-allowed'
                      : 'border-[var(--color-info)] bg-[var(--color-info-dim)] text-[var(--text-primary)] hover:bg-[var(--color-info-dim)]'
                  }`}
                  disabled={!selectedSymbol || !onOpenChart}
                  onClick={() => openChartForSymbol(selectedSymbol)}
                >
                  {tr(chartActionLabel)}</button>
                <button
                  className="cursor-not-allowed rounded-sm border border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-4 py-1 text-[13px] font-normal text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-quaternary)]"
                  disabled={isDesktopShell}
                >
                  {tr("Create Custom Symbol")}</button>
              </>
            )}
          </div>
          <button
            data-action="close"
            className="rounded-sm border border-[var(--color-info)] bg-[var(--color-info-dim)] px-5 py-0.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--color-info-dim)]"
            onClick={onClose}
          >
            {tr("OK")}</button>
        </div>

        {/* Resize handle */}
        <div
          className="rtx-symbols-dialog__resize absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={onResizeStart}
          style={{ background: 'linear-gradient(135deg, transparent 50%, var(--border-secondary) 50%)' }}
        />
      </div>
    </div>,
    document.body
  );
};

export default SymbolsDialog;

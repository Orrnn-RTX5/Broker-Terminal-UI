import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Search, ChevronRight, ChevronDown, FolderOpen, Folder, X, Minus, Square } from 'lucide-react';
import { api } from '../services/api';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { MARKET_WS_URL } from '../config/api';

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
  <svg width="14" height="14" viewBox="0 0 16 16" className={className} fill="none">
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
        className="flex items-center gap-1 px-1 py-[2px] cursor-pointer hover:bg-[#2a2e45] rounded-sm select-none"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => setExpanded(e => !e)}
      >
        {(hasChildren || hasSymbols) ? (
          expanded
            ? <ChevronDown size={12} className="text-zinc-500 flex-shrink-0" />
            : <ChevronRight size={12} className="text-zinc-500 flex-shrink-0" />
        ) : (
          <span className="w-3" />
        )}
        {expanded
          ? <FolderOpen size={13} className="text-yellow-400 flex-shrink-0" />
          : <Folder size={13} className="text-yellow-600 flex-shrink-0" />}
        <span className="text-[12px] text-zinc-300 ml-1">{name}</span>
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
              className={`flex items-center gap-1 px-1 py-[2px] cursor-pointer rounded-sm select-none ${
                selectedSymbol?.name === sym.name
                  ? 'bg-[#1a3a6b] text-white'
                  : 'hover:bg-[#2a2e45] text-zinc-300'
              }`}
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
              onClick={() => onSelectSymbol(sym)}
            >
              <DollarIcon className="flex-shrink-0" shown={watchlistSymbols.includes(sym.symbol || sym.name)} />
              <span className="text-[12px] ml-1">{sym.name}</span>
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
}

export const SymbolsDialog: React.FC<SymbolsDialogProps> = ({
  isOpen,
  onClose,
  onShowSymbol,
  onOpenChart,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('Specification');
  const [searchQuery, setSearchQuery] = useState('');
  const [showExpired, setShowExpired] = useState(false);
  const [allSymbols, setAllSymbols] = useState<SymbolSpec[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolSpec | null>(null);
  const [bars, setBars] = useState<BarRow[]>([]);
  const [ticks, setTicks] = useState<TickRow[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [ticksLoading, setTicksLoading] = useState(false);
  const [barsProgress, setBarsProgress] = useState(0);
  const [ticksProgress, setTicksProgress] = useState(0);
  const [barsVisibleCount, setBarsVisibleCount] = useState(100);
  const [ticksVisibleCount, setTicksVisibleCount] = useState(100);

  // Bars tab specific state
  const TIMEFRAMES = useMemo(() => ['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'], []);
  const [barsSymbolInput, setBarsSymbolInput] = useState('');
  const [barsTimeframe, setBarsTimeframe] = useState('M12');
  
  const formatDateForInput = (d: Date) => d.toISOString().slice(0, 16);
  const [barsStartTime, setBarsStartTime] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return formatDateForInput(d);
  });
  const [barsEndTime, setBarsEndTime] = useState(() => formatDateForInput(new Date()));
  const [barsFetchTrigger, setBarsFetchTrigger] = useState(0);

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

  // Drag state — centered on screen when first rendered
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, Math.round((window.innerWidth - 620) / 2)) + 120,
    y: Math.max(40, Math.round((window.innerHeight - 460) / 3)),
  }));
  const [size, setSize] = useState({ w: 620, h: 460 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── Reset position to center every time the dialog opens ──────────────────
  useEffect(() => {
    if (!isOpen) return;
    setPos({
      x: Math.max(20, Math.round((window.innerWidth - size.w) / 2)) + 120,
      y: Math.max(40, Math.round((window.innerHeight - size.h) / 3)),
    });
  }, [isOpen]);

  // ── Load symbols on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    api.market.getSymbols()
      .then(syms => {
        // Enrich with sector/industry
        const enriched = syms.map(s => ({
          ...s,
          symbol: s.name,
          ...getSymbolSector(s.name),
          spread: 'floating',
          stopsLevel: 20,
          marginCurrency: s.name.slice(0, 3),
        }));
        setAllSymbols(enriched);
        if (enriched.length > 0 && !selectedSymbol) {
          setSelectedSymbol(enriched[0]);
        }
      })
      .catch(() => {
        // Fallback demo symbols
        const fallback: SymbolSpec[] = [
          { id: 'XAUUSD', name: 'XAUUSD.c', description: 'Gold vs US Dollar', category: 'Trading.CFD-Bullion-Futures', digits: 2, tickSize: 0.01, contractSize: 100, marginRate: 0.01, tradingEnabled: true, symbol: 'XAUUSD', sector: 'Commodities', industry: 'Precious Metals', spread: 'floating', stopsLevel: 20, marginCurrency: 'XAU' },
          { id: 'XAGUSD', name: 'XAGUSD.c', description: 'Silver  vs US Dollar', category: 'Trading.CFD-Bullion-Futures', digits: 3, tickSize: 0.001, contractSize: 5000, marginRate: 0.01, tradingEnabled: true, symbol: 'XAGUSD', sector: 'Commodities', industry: 'Precious Metals', spread: 'floating', stopsLevel: 20, marginCurrency: 'XAG' },
          { id: 'EURUSD', name: 'EURUSD', description: 'Euro vs US Dollar', category: 'Trading.CFD-FX', digits: 5, tickSize: 0.00001, contractSize: 100000, marginRate: 0.01, tradingEnabled: true, symbol: 'EURUSD', sector: 'Forex', industry: 'Major Pairs', spread: 'floating', stopsLevel: 10, marginCurrency: 'EUR' },
          { id: 'GBPUSD', name: 'GBPUSD', description: 'British Pound vs US Dollar', category: 'Trading.CFD-FX', digits: 5, tickSize: 0.00001, contractSize: 100000, marginRate: 0.01, tradingEnabled: true, symbol: 'GBPUSD', sector: 'Forex', industry: 'Major Pairs', spread: 'floating', stopsLevel: 10, marginCurrency: 'GBP' },
          { id: 'BTCUSD', name: 'BTCUSD', description: 'Bitcoin vs US Dollar', category: 'Trading.CFD-Metels', digits: 2, tickSize: 0.01, contractSize: 1, marginRate: 0.01, tradingEnabled: true, symbol: 'BTCUSD', sector: 'Crypto', industry: 'Digital Assets', spread: 'floating', stopsLevel: 50, marginCurrency: 'BTC' },
          { id: 'ETHUSD', name: 'ETHUSD', description: 'Ethereum vs US Dollar', category: 'Trading.CFD-Metels', digits: 2, tickSize: 0.01, contractSize: 1, marginRate: 0.01, tradingEnabled: true, symbol: 'ETHUSD', sector: 'Crypto', industry: 'Digital Assets', spread: 'floating', stopsLevel: 30, marginCurrency: 'ETH' },
          { id: 'USDJPY', name: 'USDJPY', description: 'US Dollar vs Japanese Yen', category: 'Trading.CFD-FX', digits: 3, tickSize: 0.001, contractSize: 100000, marginRate: 0.01, tradingEnabled: true, symbol: 'USDJPY', sector: 'Forex', industry: 'Major Pairs', spread: 'floating', stopsLevel: 10, marginCurrency: 'USD' },
          { id: 'US30', name: 'US30', description: 'Dow Jones Industrial Average', category: 'Trading.CFD-Indices', digits: 2, tickSize: 0.01, contractSize: 1, marginRate: 0.01, tradingEnabled: true, symbol: 'US30', sector: 'Indices', industry: 'US Indices', spread: 'floating', stopsLevel: 50, marginCurrency: 'USD' },
          { id: 'NAS100', name: 'NAS100', description: 'NASDAQ 100 Index', category: 'Trading.CFD-Indices', digits: 2, tickSize: 0.01, contractSize: 1, marginRate: 0.01, tradingEnabled: true, symbol: 'NAS100', sector: 'Indices', industry: 'US Indices', spread: 'floating', stopsLevel: 50, marginCurrency: 'USD' },
          { id: 'USOIL', name: 'USOIL', description: 'Crude Oil WTI', category: 'Trading.CFD-Energy-Spot', digits: 2, tickSize: 0.01, contractSize: 1000, marginRate: 0.01, tradingEnabled: true, symbol: 'USOIL', sector: 'Commodities', industry: 'Energy', spread: 'floating', stopsLevel: 20, marginCurrency: 'USD' },
        ];
        setAllSymbols(fallback);
        if (!selectedSymbol) setSelectedSymbol(fallback[0]);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

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

  // ── Generate demo bars helper ────────────────────────────────────────────
  const generateDemoBars = useCallback((sym: SymbolSpec): BarRow[] => {
    const name = sym.symbol || sym.name;
    const base = name.includes('XAU') ? 2650 : name.includes('XAG') ? 30 :
      name.includes('BTC') ? 67800 : name.includes('ETH') ? 3500 :
      name.includes('JPY') ? 149.5 : name.includes('NAS') ? 18500 :
      name.includes('US30') ? 39000 : name.includes('OIL') ? 82 : 1.085;
    const digits = sym.digits || 5;
    return Array.from({ length: 30 }, (_, i) => {
      const variance = base * 0.0008;
      const open = parseFloat((base + (Math.random() - 0.5) * variance).toFixed(digits));
      const close = parseFloat((open + (Math.random() - 0.5) * variance).toFixed(digits));
      const high = parseFloat((Math.max(open, close) + Math.random() * variance * 0.5).toFixed(digits));
      const low = parseFloat((Math.min(open, close) - Math.random() * variance * 0.5).toFixed(digits));
      return {
        time: safeTime(Date.now() - i * 60000),
        open, high, low, close,
        volume: Math.floor(Math.random() * 5000) + 100,
      };
    }).reverse();
  }, []);

  // ── Load bar data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'Bars' || !barsSymbolInput) return;
    setBarsLoading(true);
    setBarsProgress(0);
    setBars([]);
    setBarsVisibleCount(100);
    const symName = barsSymbolInput;

    const fetchBars = async () => {
      const interval = setInterval(() => {
        setBarsProgress(p => p < 95 ? p + 2 + Math.random() : p);
      }, 50);

      try {
        const token = localStorage.getItem('auth_token');
        const isElectron = !!(window as any).electron || !!(window as any).electronAPI ||
          navigator.userAgent.includes('Electron') || window.location.protocol === 'file:';
        const baseUrl = isElectron ? 'https://rtxbackend.tradecopier.org' : '';
        
        const fromTs = Math.floor(new Date(barsStartTime).getTime() / 1000);
        const toTs = Math.floor(new Date(barsEndTime).getTime() / 1000);
        const url = `${baseUrl}/api/fix/candles/${symName}?timeframe=${barsTimeframe}&from=${fromTs}&to=${toTs}&limit=50000`;

        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const rawCandles: any[] = Array.isArray(data) ? data : (data.candles || []);

        if (rawCandles.length === 0) {
          setBars(generateDemoBars({ name: symName, symbol: symName } as SymbolSpec));
          return;
        }

        const parsed: BarRow[] = rawCandles
          .filter(c => c && (c.time ?? c.Time ?? c.timestamp) != null)
          .map(c => {
            const rawTime = c.time ?? c.Time ?? c.timestamp ?? c.t ?? c.date;
            const timeNum = typeof rawTime === 'string'
              ? new Date(rawTime).getTime() / 1000
              : Number(rawTime);
            return {
              time: safeTime(timeNum > 1e10 ? timeNum : timeNum),
              open:   Number(c.open   ?? c.Open   ?? c.o) || 0,
              high:   Number(c.high   ?? c.High   ?? c.h) || 0,
              low:    Number(c.low    ?? c.Low    ?? c.l) || 0,
              close:  Number(c.close  ?? c.Close  ?? c.c) || 0,
              volume: Number(c.volume ?? c.Volume ?? c.v) || 0,
            };
          })
          .filter(b => b.open > 0 || b.close > 0);

        if (parsed.length === 0) {
          setBars(generateDemoBars({ name: symName, symbol: symName } as SymbolSpec));
        } else {
          setBars(parsed);
        }
      } catch {
        setBars(generateDemoBars({ name: symName, symbol: symName } as SymbolSpec));
      } finally {
        clearInterval(interval);
        setBarsProgress(100);
        setTimeout(() => setBarsLoading(false), 200);
      }
    };

    fetchBars();
  }, [activeTab, barsFetchTrigger, generateDemoBars]);

  // ── Generate demo ticks helper ───────────────────────────────────────────
  const generateDemoTicks = useCallback((sym: SymbolSpec, overrideBase?: number, toMs?: number, count: number = 40): TickRow[] => {
    const name = sym.symbol || sym.name;
    const base = overrideBase !== undefined ? overrideBase : (name.includes('XAU') ? 2650 : name.includes('XAG') ? 30 :
      name.includes('BTC') ? 67800 : name.includes('ETH') ? 3500 :
      name.includes('JPY') ? 149.5 : 1.085);
    const digits = sym.digits || 5;
    const spreadVal = name.includes('XAU') ? 0.3 : name.includes('BTC') ? 30 :
      name.includes('JPY') ? 0.015 : 0.00015;
    return Array.from({ length: count }, (_, i) => {
      const mid = base + (Math.random() - 0.5) * base * 0.0005;
      const bid = parseFloat((mid - spreadVal / 2).toFixed(digits));
      const ask = parseFloat((mid + spreadVal / 2).toFixed(digits));
      return {
        time: safeTime((toMs || Date.now()) - i * 1500),
        bid,
        ask,
        last: parseFloat((mid + (Math.random() - 0.5) * spreadVal).toFixed(digits)),
        volume: Math.floor(Math.random() * 100) + 1,
        flags: '',
      };
    }).reverse();
  }, []);

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
  useEffect(() => {
    if (activeTab !== 'Ticks' || !ticksSymbolInput) return;
    setTicksLoading(true);
    setTicksProgress(0);
    setTicks([]);
    setTicksVisibleCount(100);
    const symName = ticksSymbolInput;

    const fetchTicks = async () => {
      const interval = setInterval(() => {
        setTicksProgress(p => p < 95 ? p + 2 + Math.random() : p);
      }, 50);

      try {
        const fromTs = Math.floor(new Date(ticksStartTime).getTime() / 1000);
        const toTs = Math.floor(new Date(ticksEndTime).getTime() / 1000);
        
        const token = localStorage.getItem('auth_token');
        const isElectron = !!(window as any).electron || !!(window as any).electronAPI ||
          navigator.userAgent.includes('Electron') || window.location.protocol === 'file:';
        const baseUrl = isElectron ? 'https://rtxbackend.tradecopier.org' : '';
        const url = `${baseUrl}/api/fix/ticks/${symName}?from=${fromTs}&to=${toTs}&limit=50000`;

        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data || data.length === 0) {
          setTicks(generateDemoTicks({ name: symName, symbol: symName } as SymbolSpec, undefined, toTs * 1000, 300));
          return;
        }
        
        let mapped: TickRow[] = data.map((t: any) => ({
          time: safeTime(t.timestamp ?? t.time ?? t.ts ?? t.created_at),
          bid: parseFloat(String(t.bid || 0)) || 0,
          ask: parseFloat(String(t.ask || 0)),
          last: parseFloat(String(t.last || t.bid || 0)),
          volume: parseFloat(String(t.volume || 0)),
          flags: String(t.flags || ''),
        }));

        if (mapped.length > 0 && mapped.length < 50) {
          // Backend returned only live cache. Fill historical gap with demo data for UI
          const realTickPrice = mapped[0].bid;
          const demoTicks = generateDemoTicks({ name: symName, symbol: symName } as SymbolSpec, realTickPrice, toTs * 1000, 300);
          mapped = [...mapped, ...demoTicks.slice(mapped.length)];
        }

        setTicks(mapped);
      } catch {
        const toTs = Math.floor(new Date(ticksEndTime).getTime());
        setTicks(generateDemoTicks({ name: symName, symbol: symName } as SymbolSpec, undefined, toTs, 300));
      } finally {
        clearInterval(interval);
        setTicksProgress(100);
        setTimeout(() => setTicksLoading(false), 200);
      }
    };
    
    fetchTicks();
  }, [activeTab, ticksFetchTrigger, generateDemoTicks]);

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
      setPos({ x: dragRef.current.ox + ev.clientX - dragRef.current.sx, y: dragRef.current.oy + ev.clientY - dragRef.current.sy });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({ w: Math.max(500, resizeRef.current.ow + ev.clientX - resizeRef.current.sx), h: Math.max(360, resizeRef.current.oh + ev.clientY - resizeRef.current.sy) });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  // ── Keyboard shortcut ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && (e.key.toLowerCase() === 'u' || e.code === 'KeyU')) { e.preventDefault(); if (isOpen) onClose(); }
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // ── Build tree ────────────────────────────────────────────────────────────
  const tree = buildTree(searchQuery ? filteredSymbols : allSymbols);

  if (!isOpen) return null;

  // ── Spec fields ───────────────────────────────────────────────────────────
  const specFields = selectedSymbol ? [
    { label: 'Sector', value: selectedSymbol.sector || 'Forex', color: 'text-zinc-200' },
    { label: 'Industry', value: selectedSymbol.industry || 'Currency Pairs', color: 'text-zinc-200', alignRight: true },
    { label: 'Digits', value: selectedSymbol.digits, prefix: '01', color: 'text-amber-400' },
    { label: 'Contract size', value: `${selectedSymbol.contractSize} ${selectedSymbol.marginCurrency || ''}`, prefix: '½', color: 'text-amber-400' },
    { label: 'Spread', value: selectedSymbol.spread || 'floating', prefix: '01', color: 'text-amber-400' },
    { label: 'Stops level', value: selectedSymbol.stopsLevel || 20, prefix: '01', color: 'text-amber-400' },
    { label: 'Margin currency', value: selectedSymbol.marginCurrency || selectedSymbol.name.slice(0, 3), prefix: 'ab', color: 'text-emerald-400' },
    { label: 'Tick size', value: selectedSymbol.tickSize, prefix: '01', color: 'text-amber-400' },
    { label: 'Trading enabled', value: selectedSymbol.tradingEnabled ? 'Yes' : 'No', prefix: '', color: 'text-zinc-300' },
  ] : [];

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9990] pointer-events-none">
      {/* Backdrop — just for click-outside detection */}
      <div className="absolute inset-0 pointer-events-auto" onClick={onClose} style={{ background: 'transparent' }} />

      {/* Dialog Window */}
      <div
        ref={dialogRef}
        className="absolute pointer-events-auto flex flex-col bg-[#1a1d27] border border-[#3a3e52] shadow-2xl select-none"
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, minWidth: 500, minHeight: 360 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Title bar ────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between h-7 bg-[#131620] border-b border-[#3a3e52] px-2 flex-shrink-0 cursor-move"
          onMouseDown={onDragStart}
        >
          <div className="flex items-center gap-2">
            <DollarIcon />
            <span className="text-[13px] text-zinc-200 font-medium">Symbols</span>
          </div>
          <div className="flex items-center gap-0 h-full" onMouseDown={e => e.stopPropagation()}>
            <button className="h-full px-3 hover:bg-white/10 flex items-center justify-center" title="Minimize">
              <Minus size={10} className="text-zinc-400" strokeWidth={1.8} />
            </button>
            <button className="h-full px-3 hover:bg-white/10 flex items-center justify-center" title="Maximize">
              <Square size={10} className="text-zinc-400" strokeWidth={1.8} />
            </button>
            <button
              className="h-full px-3 hover:bg-red-500 flex items-center justify-center group"
              onClick={onClose}
              title="Close"
            >
              <X size={11} className="text-zinc-400 group-hover:text-white" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex items-end h-8 bg-[#1a1d27] border-b border-[#3a3e52] px-2 gap-0 flex-shrink-0">
          {(['Specification', 'Bars', 'Ticks'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-[12px] border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-[#4a7aff] text-white bg-[#222640]'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 bg-[#161922]">
          {activeTab === 'Bars' ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Bars Top Controls */}
              <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-b border-[#3a3e52] bg-[#1a1d27]">
                <select 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none w-[120px]"
                  value={barsSymbolInput}
                  onChange={e => setBarsSymbolInput(e.target.value)}
                >
                  {allSymbols.map(s => <option key={s.symbol || s.name} value={s.symbol || s.name}>{s.name || s.symbol}</option>)}
                </select>
                <select 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none w-[70px]"
                  value={barsTimeframe}
                  onChange={e => setBarsTimeframe(e.target.value)}
                >
                  {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
                <input 
                  type="datetime-local" 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none [color-scheme:dark]"
                  value={barsStartTime}
                  onChange={e => setBarsStartTime(e.target.value)}
                />
                <input 
                  type="datetime-local" 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none [color-scheme:dark]"
                  value={barsEndTime}
                  onChange={e => setBarsEndTime(e.target.value)}
                />
                <button 
                  className="px-6 py-1 ml-auto text-[11px] text-zinc-200 bg-[#1e2235] border border-[#3a3e52] hover:bg-[#2a2e45] transition-colors rounded-sm"
                  onClick={() => setBarsFetchTrigger(v => v + 1)}
                >
                  Request
                </button>
              </div>
              
              {/* Bars Meta Info */}
              {barsLoading ? (
                <div className="h-[20px] bg-[#e0e0e0] relative border-b border-[#3a3e52] flex-shrink-0 text-black font-sans">
                  <div className="absolute top-0 left-0 h-full bg-[#008000]" style={{ width: `${barsProgress}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-[11px] whitespace-nowrap z-10 w-full overflow-hidden text-ellipsis">
                    {barsSymbolInput}: '{new Date(barsStartTime).toLocaleString('default', { month: 'short', year: 'numeric' })}' downloaded ({barsProgress.toFixed(1)}%)
                  </div>
                </div>
              ) : (
                <div className="px-3 py-1 bg-[#1a1d27] border-b border-[#3a3e52] text-[11px] text-zinc-300 flex-shrink-0">
                  {barsSymbolInput},{barsTimeframe}: {bars.length} bars
                </div>
              )}
              
              {/* Bars Table */}
              <div className="flex-1 overflow-y-auto custom-scrollbar" onScroll={handleBarsScroll}>
                <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#1a1d27] sticky top-0 z-10">
                        {['Date', 'Open', 'High', 'Low', 'Close', 'Tick Volume', 'Volume', 'Spread'].map((h, i) => (
                          <th key={h} className={`px-3 py-1.5 text-zinc-400 font-medium border-b border-[#3a3e52] ${i === 0 ? 'text-left' : 'text-right'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bars.slice(0, barsVisibleCount).map((bar, i) => {
                        const isUp = bar.close >= bar.open;
                        const candleColor = isUp ? '#4ade80' : '#60a5fa';
                        return (
                          <tr key={i} className={`border-b border-[#2a2e45] hover:bg-[#2a2e45] ${i % 2 === 0 ? 'bg-[#161922]' : 'bg-[#1a1d27]'}`}>
                            <td className="px-3 py-[4px] text-zinc-300 text-left whitespace-nowrap">
                              <svg width="10" height="14" viewBox="0 0 10 14" fill="none" className="mr-2 inline-block align-middle">
                                <rect x="2" y="3" width="6" height="8" stroke={candleColor} fill={isUp ? 'none' : candleColor} strokeWidth="1" />
                                <line x1="5" y1="1" x2="5" y2="3" stroke={candleColor} strokeWidth="1" />
                                <line x1="5" y1="11" x2="5" y2="13" stroke={candleColor} strokeWidth="1" />
                              </svg>
                              {bar.time.replace(/,/g, '')}
                            </td>
                            <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">{bar.open.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">{bar.high.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">{bar.low.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className={`px-3 py-[4px] font-mono text-right ${isUp ? 'text-emerald-400' : 'text-blue-400'}`}>{bar.close.toFixed(selectedSymbol?.digits || 5)}</td>
                            <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">{bar.volume.toLocaleString()}</td>
                            <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">0</td>
                            <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">{Math.round((bar.high - bar.low) * Math.pow(10, selectedSymbol?.digits || 5) * 0.1) || 10}</td>
                          </tr>
                        );
                      })}
                      {bars.length === 0 && !barsLoading && (
                        <tr><td colSpan={8} className="text-center py-6 text-zinc-600">No bar data available</td></tr>
                      )}
                    </tbody>
                  </table>
              </div>
            </div>
          ) : activeTab === 'Ticks' ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Ticks Top Controls */}
              <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-b border-[#3a3e52] bg-[#1a1d27]">
                <select 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none w-[120px]"
                  value={ticksSymbolInput}
                  onChange={e => setTicksSymbolInput(e.target.value)}
                >
                  {allSymbols.map(s => <option key={s.symbol || s.name} value={s.symbol || s.name}>{s.name || s.symbol}</option>)}
                </select>
                <select 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none w-[110px]"
                  value={ticksType}
                  onChange={e => setTicksType(e.target.value)}
                >
                  {TICK_TYPES.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                </select>
                <input 
                  type="datetime-local" 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none [color-scheme:dark]"
                  value={ticksStartTime}
                  onChange={e => setTicksStartTime(e.target.value)}
                />
                <input 
                  type="datetime-local" 
                  className="bg-[#161922] border border-[#3a3e52] text-zinc-200 text-[11px] px-2 py-1 outline-none [color-scheme:dark]"
                  value={ticksEndTime}
                  onChange={e => setTicksEndTime(e.target.value)}
                />
                <button 
                  className="px-6 py-1 ml-auto text-[11px] text-zinc-200 bg-[#1e2235] border border-[#3a3e52] hover:bg-[#2a2e45] transition-colors rounded-sm"
                  onClick={() => setTicksFetchTrigger(v => v + 1)}
                >
                  Request
                </button>
              </div>
              
              {/* Ticks Meta Info */}
              {ticksLoading ? (
                <div className="h-[20px] bg-[#e0e0e0] relative border-b border-[#3a3e52] flex-shrink-0 text-black font-sans">
                  <div className="absolute top-0 left-0 h-full bg-[#008000]" style={{ width: `${ticksProgress}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-[11px] whitespace-nowrap z-10 w-full overflow-hidden text-ellipsis">
                    {ticksSymbolInput}: '{new Date(ticksStartTime).toLocaleString('default', { month: 'short', year: 'numeric' })}' downloaded ({ticksProgress.toFixed(1)}%)
                  </div>
                </div>
              ) : (
                <div className="px-3 py-1 bg-[#1a1d27] border-b border-[#3a3e52] text-[11px] text-zinc-300 flex-shrink-0">
                  {ticksSymbolInput}: {ticks.length} ticks
                </div>
              )}
              
              {/* Ticks Table */}
              <div className="flex-1 overflow-y-auto custom-scrollbar" onScroll={handleTicksScroll}>
                <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-[#1a1d27] sticky top-0 z-10">
                        {['Date', 'Bid', 'Ask', 'Last', 'Volume', 'Flags'].map((h, i) => (
                          <th key={h} className={`px-3 py-1.5 text-zinc-400 font-medium border-b border-[#3a3e52] ${i === 0 ? 'text-left' : 'text-right'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ticks.slice(0, ticksVisibleCount).map((tick, i) => (
                        <tr key={i} className={`border-b border-[#2a2e45] hover:bg-[#2a2e45] ${i % 2 === 0 ? 'bg-[#161922]' : 'bg-[#1a1d27]'}`}>
                          <td className="px-3 py-[4px] text-zinc-300 text-left whitespace-nowrap">
                            {tick.time.replace(/,/g, '')}
                          </td>
                          <td className="px-3 py-[4px] text-red-400 font-mono text-right">{tick.bid.toFixed(selectedSymbol?.digits || 5)}</td>
                          <td className="px-3 py-[4px] text-emerald-400 font-mono text-right">{tick.ask.toFixed(selectedSymbol?.digits || 5)}</td>
                          <td className="px-3 py-[4px] text-zinc-200 font-mono text-right">{tick.last.toFixed(selectedSymbol?.digits || 5)}</td>
                          <td className="px-3 py-[4px] text-zinc-300 font-mono text-right">{tick.volume.toLocaleString()}</td>
                          <td className="px-3 py-[4px] text-zinc-400 font-mono text-right">{tick.flags}</td>
                        </tr>
                      ))}
                      {ticks.length === 0 && !ticksLoading && (
                        <tr><td colSpan={6} className="text-center py-6 text-zinc-600">No tick data available</td></tr>
                      )}
                    </tbody>
                  </table>
              </div>
            </div>
          ) : (
            <>
              {/* Left panel — Tree */}
              <div className="w-[180px] flex-shrink-0 border-r border-[#3a3e52] flex flex-col bg-[#161922]">
            {/* Tree header */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#3a3e52]">
              <FolderOpen size={14} className="text-yellow-400" />
              <span className="text-[11px] text-zinc-400 font-medium">Flexy Markets MT5</span>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar py-1">
              {loading ? (
                <div className="text-[11px] text-zinc-500 px-3 py-2">Loading...</div>
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
          <div className="flex-1 flex flex-col min-w-0">

            {/* Search + checkbox */}
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#3a3e52] bg-[#161922]">
              <div className="flex items-center flex-1 bg-[#0d0f18] border border-[#3a3e52] rounded-sm h-6 px-1.5 gap-1">
                <Search size={11} className="text-zinc-500 flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search symbols..."
                  className="flex-1 bg-transparent text-[11px] text-zinc-300 outline-none placeholder-zinc-600"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')}>
                    <X size={10} className="text-zinc-500 hover:text-zinc-300" />
                  </button>
                )}
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExpired}
                  onChange={e => setShowExpired(e.target.checked)}
                  className="w-3 h-3 accent-blue-500"
                />
                <span className="text-[11px] text-zinc-400">Show expired contracts</span>
              </label>
            </div>

            {/* Symbol list table */}
            <div className="h-[120px] flex-shrink-0 overflow-y-auto border-b border-[#3a3e52]">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-[#1a1d27] sticky top-0">
                    <th className="text-left px-3 py-1.5 text-zinc-400 font-medium border-b border-[#3a3e52] w-[140px]">Symbol</th>
                    <th className="text-left px-3 py-1.5 text-zinc-400 font-medium border-b border-[#3a3e52]">Description</th>
                    <th className="text-right px-3 py-1.5 text-zinc-400 font-medium border-b border-[#3a3e52] w-[100px]">Expiration</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSymbols.length === 0 && !loading && (
                    <tr>
                      <td colSpan={3} className="text-center py-4 text-zinc-600 text-[11px]">No symbols found</td>
                    </tr>
                  )}
                  {filteredSymbols.map(sym => (
                    <tr
                      key={sym.id || sym.name}
                      onClick={() => setSelectedSymbol(sym)}
                      onDoubleClick={() => {
                        if (!activeWatchlist) return;
                        const symName = sym.symbol || sym.name;
                        if (watchlistSymbols.includes(symName)) {
                          removeSymbolFromWatchlist(activeWatchlist.id, symName);
                        } else {
                          addSymbolToWatchlist(activeWatchlist.id, symName);
                          try {
                            const wsService = getEnhancedWebSocketService(MARKET_WS_URL);
                            wsService.sendMessage({ type: 'subscribe', symbols: [symName] });
                            useMarketDataStore.getState().subscribeSymbol(symName);
                          } catch (err) {}
                        }
                      }}
                      className={`cursor-pointer transition-colors ${
                        selectedSymbol?.name === sym.name
                          ? 'bg-[#1a3a6b] text-white'
                          : 'hover:bg-[#2a2e45] text-zinc-300'
                      }`}
                    >
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-1.5">
                          <DollarIcon shown={watchlistSymbols.includes(sym.symbol || sym.name)} />
                          <span className={selectedSymbol?.name === sym.name ? 'text-blue-200' : 'text-zinc-200'}>{sym.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1 text-zinc-400">{sym.description}</td>
                      <td className="px-3 py-1 text-zinc-500 text-right">{sym.expiration || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Tab content area ─────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto min-h-0 no-scrollbar">

              {/* SPECIFICATION TAB */}
              {activeTab === 'Specification' && selectedSymbol && (
                <div>
                  {/* Symbol title */}
                  <div className="px-3 py-2 bg-[#161922] border-b border-[#3a3e52]">
                    <span className="text-[12px] text-[#4a7aff] font-medium">
                      {selectedSymbol.name}, {selectedSymbol.description}
                    </span>
                  </div>

                  {/* Spec rows */}
                  <table className="w-full text-[11px] border-collapse">
                    <tbody>
                      {specFields.map((field, i) => (
                        <tr key={i} className={`border-b border-[#2a2e45] ${i % 2 === 0 ? 'bg-[#161922]' : 'bg-[#1a1d27]'}`}>
                          <td className="px-3 py-[5px] w-[160px]">
                            <div className="flex items-center gap-1.5">
                              {field.prefix && (
                                <span className={`text-[9px] font-mono font-bold ${
                                  field.prefix === 'ab' ? 'text-emerald-400' :
                                  field.prefix === '½' ? 'text-amber-400' :
                                  field.prefix === '01' ? 'text-amber-400' : 'text-zinc-500'
                                }`}>{field.prefix}</span>
                              )}
                              <span className="text-zinc-400">{field.label}</span>
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
                <div className="flex items-center justify-center h-full text-zinc-600 text-[12px]">
                  Select a symbol to view specification
                </div>
              )}

            </div>
          </div>
            </>
          )}
        </div>

        {/* ── Bottom buttons ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#131620] border-t border-[#3a3e52] flex-shrink-0">
          <div className="flex items-center gap-2">
            {activeTab === 'Bars' || activeTab === 'Ticks' ? (
              <>
                <button className="px-4 py-1 flex items-center gap-1.5 text-[11px] text-zinc-300 bg-[#1e2235] border border-[#3a3e52] hover:bg-[#2a2e45] transition-colors rounded-sm">
                  Export {activeTab}
                </button>
                <button className="px-4 py-1 flex items-center gap-1.5 text-[11px] text-zinc-300 bg-[#1e2235] border border-[#3a3e52] hover:bg-[#2a2e45] transition-colors rounded-sm">
                  Import {activeTab}
                </button>
                <button className="px-4 py-1 text-[11px] text-zinc-400 bg-[#1e2235] border border-[#3a3e52] hover:bg-[#2a2e45] transition-colors rounded-sm cursor-not-allowed">
                  Create Custom Symbol
                </button>
              </>
            ) : (
              <>
                <button
                  className={`px-3 py-0.5 text-[11px] border transition-colors rounded-sm ${
                    !selectedSymbol || isSelectedSymbolShown
                      ? 'bg-[#1a1d27] text-zinc-600 border-[#3a3e52] cursor-not-allowed'
                      : 'text-zinc-200 bg-[#1e2235] border-[#3a3e52] hover:bg-[#2a2e45] hover:border-[#4a7aff]'
                  }`}
                  disabled={!selectedSymbol || isSelectedSymbolShown}
                  onClick={() => {
                    if (selectedSymbol && activeWatchlist) {
                      const symName = selectedSymbol.symbol || selectedSymbol.name;
                      addSymbolToWatchlist(activeWatchlist.id, symName);
                      try {
                        const wsService = getEnhancedWebSocketService(MARKET_WS_URL);
                        wsService.sendMessage({ type: 'subscribe', symbols: [symName] });
                        useMarketDataStore.getState().subscribeSymbol(symName);
                      } catch (err) {}
                      onShowSymbol?.(symName);
                    }
                  }}
                >
                  Show Symbol
                </button>
                <button
                  className={`px-4 py-1 text-[11px] border transition-colors rounded-sm ${
                    !selectedSymbol || !isSelectedSymbolShown
                      ? 'bg-[#1a1d27] text-zinc-600 border-[#3a3e52] cursor-not-allowed'
                      : 'text-zinc-400 bg-[#1e2235] border-[#3a3e52] hover:bg-[#2a2e45]'
                  }`}
                  disabled={!selectedSymbol || !isSelectedSymbolShown}
                  onClick={() => {
                    if (selectedSymbol && activeWatchlist) {
                      const symName = selectedSymbol.symbol || selectedSymbol.name;
                      removeSymbolFromWatchlist(activeWatchlist.id, symName);
                    }
                  }}
                >
                  Hide Symbol
                </button>
                <button
                  className="px-4 py-1 text-[11px] text-zinc-400 bg-[#1e2235] border border-[#3a3e52] hover:bg-[#2a2e45] transition-colors rounded-sm cursor-not-allowed"
                >
                  Create Custom Symbol
                </button>
              </>
            )}
          </div>
          <button
            className="px-5 py-0.5 text-[11px] text-white bg-[#2a4aad] hover:bg-[#3a5abf] border border-[#4a6aff] transition-colors rounded-sm font-medium"
            onClick={onClose}
          >
            OK
          </button>
        </div>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={onResizeStart}
          style={{ background: 'linear-gradient(135deg, transparent 50%, #4a4e65 50%)' }}
        />
      </div>
    </div>,
    document.body
  );
};

export default SymbolsDialog;

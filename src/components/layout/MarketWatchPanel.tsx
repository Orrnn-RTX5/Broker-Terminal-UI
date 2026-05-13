import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useMarketDataStore } from '../../store/useMarketDataStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import { PriceDisplay } from '../ui/PriceDisplay';
import { useLiveQuotes, useMarketInstruments, useRemoteWatchlistSync } from '../../hooks/useLiveMarketData';

interface MarketWatchPanelProps {
  allSymbols: any[];
  selectedSymbol: string;
  onSymbolSelect: (symbol: string) => void;
  className?: string;
}

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

// Price flash hook — returns 'up' | 'down' | null briefly when price changes
function usePriceFlash(value: number): 'up' | 'down' | null {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === 0 && value === 0) return;
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 600);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return flash;
}

// Category helper
const getCategory = (sym: string): { label: string; color: string } => {
  if (['BTCUSD','ETHUSD','LTCUSD','XRPUSD','BCHUSD','ADAUSD','SOLUSD','DOTUSD','LINKUSD','MATICUSD','UNIUSD','AAVEUSD','SUSHIUSD'].includes(sym))
    return { label: 'Crypto', color: '#f59e0b' };
  if (['XAUUSD','XAGUSD','XPTUSD','XPDUSD'].includes(sym))
    return { label: 'Metal', color: '#eab308' };
  if (['US30','US500','USTEC','GER40','UK100','FRA40','ESP35','ITA40','AUS200','JPN225','HK50','CHN50','EUSTX50'].includes(sym))
    return { label: 'Index', color: '#9fa0b0' };
  if (['USOIL','UKOIL','NATGAS','COPPER','CORN','WHEAT','SOYBEAN','COCOA','COFFEE','SUGAR'].includes(sym))
    return { label: 'Comm', color: '#34d399' };
  return { label: 'Forex', color: '#7aacca' };
};

// ─── Market Watch Row ─────────────────────────────────────────────────────────
const MarketWatchRow: React.FC<{
  symbol: string;
  tick: any;
  isSelected: boolean;
  onClick: () => void;
  contextMenuItems: ContextMenuItemConfig[];
  showAsk: boolean;
  showSpread: boolean;
  showDaily: boolean;
}> = ({ symbol, tick, isSelected, onClick, contextMenuItems, showAsk, showSpread, showDaily }) => {

  const bidDirection = tick?.bidDirection ?? 'none';
  const bid = tick?.bid ?? 0;
  const ask = tick?.ask ?? 0;
  const spread = tick?.spread ?? (ask - bid);

  const stats = useMarketDataStore(state => state.symbolData[symbol]?.stats);
  const rawDaily = tick?.dailyChange;
  const dailyPct: number | null =
    rawDaily !== undefined && rawDaily !== null
      ? Number(rawDaily)
      : stats?.changePercent24h ?? null;

  const spreadPips = symbol.includes('JPY')
    ? Math.round(spread * 100)
    : Math.round(spread * 10000);

  const hasData = tick && (tick.bid > 0 || tick.ask > 0);
  const hasDailyData = dailyPct !== null;

  const bidFlash = usePriceFlash(bid);
  const askFlash = usePriceFlash(ask);

  const dailyPositive = hasDailyData && dailyPct! > 0;
  const dailyNegative = hasDailyData && dailyPct! < 0;

  return (
    <ContextMenu items={contextMenuItems}>
      <tr
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', symbol);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={onClick}
        style={{
          cursor: 'pointer',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: isSelected
            ? 'linear-gradient(90deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)'
            : 'transparent',
          transition: 'background 0.15s ease',
          opacity: hasData ? 1 : 0.45,
          boxShadow: isSelected ? 'inset 2px 0 0 rgba(200,200,210,0.5)' : 'none',
        }}
        className={!isSelected ? 'mw-row' : ''}
      >
        {/* Symbol */}
        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', maxWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {/* Direction arrow */}
            {hasData && bidDirection === 'up' && (
              <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0 }}>
                <path d="M3.5 1L6.5 6H0.5L3.5 1Z" fill="#4ade80" />
              </svg>
            )}
            {hasData && bidDirection === 'down' && (
              <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0 }}>
                <path d="M3.5 6L0.5 1H6.5L3.5 6Z" fill="#f87171" />
              </svg>
            )}
            {(!hasData || bidDirection === 'none') && (
              <span style={{ width: 7, flexShrink: 0, display: 'inline-block' }} />
            )}
            <span style={{
              fontSize: 11,
              fontWeight: isSelected ? 600 : 500,
              color: isSelected ? '#e2e2e8' : '#b8b8c0',
              letterSpacing: '0.015em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {symbol}
            </span>
          </div>
        </td>

        {/* Bid — most important: bright, large, tabular */}
        <td style={{ padding: '3px 5px', textAlign: 'right' }}>
          <span style={{
            display: 'inline-block',
            fontFamily: '"JetBrains Mono", "Fira Code", "Roboto Mono", monospace',
            fontSize: 12,
            fontWeight: 600,
            color: hasData
              ? bidFlash === 'up' ? '#4ade80'
              : bidFlash === 'down' ? '#f87171'
              : '#d0d0d8'
              : '#36363e',
            padding: '1px 4px',
            borderRadius: 3,
            background: 'transparent',
            transition: 'color 0.25s',
            letterSpacing: '0.01em',
            tabularNums: true,
          } as React.CSSProperties}>
            {hasData ? <PriceDisplay price={bid} symbol={symbol} /> : '—'}
          </span>
        </td>

        {/* Ask — secondary, slightly softer */}
        {showAsk && (
          <td style={{ padding: '3px 5px', textAlign: 'right' }}>
            <span style={{
              display: 'inline-block',
              fontFamily: '"JetBrains Mono", "Fira Code", "Roboto Mono", monospace',
              fontSize: 12,
              fontWeight: 500,
              color: hasData
                ? askFlash === 'up' ? '#4ade80'
                : askFlash === 'down' ? '#f87171'
                : '#a0a0a8'
                : '#36363e',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'transparent',
              transition: 'color 0.25s',
              letterSpacing: '0.01em',
            }}>
              {hasData ? <PriceDisplay price={ask} symbol={symbol} /> : '—'}
            </span>
          </td>
        )}

        {/* Spread — pill badge style, easy to scan */}
        {showSpread && (
          <td style={{ padding: '3px 5px', textAlign: 'right' }}>
            <span style={{
              fontSize: 10,
              fontFamily: '"JetBrains Mono", "Fira Code", "Roboto Mono", monospace',
              fontWeight: 500,
              color: hasData ? '#888890' : '#36363e',
              letterSpacing: '0.01em',
            }}>
              {hasData ? spreadPips : '—'}
            </span>
          </td>
        )}

        {/* Daily Change — bold, clear positive/negative */}
        {showDaily && (
          <td style={{ padding: '3px 8px', textAlign: 'right' }}>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: '"JetBrains Mono", "Fira Code", "Roboto Mono", monospace',
              color: !hasData ? '#36363e'
                : !hasDailyData ? '#50505a'
                : dailyPositive ? '#4ade80'
                : dailyNegative ? '#f87171'
                : '#606068',
              letterSpacing: '0.01em',
            }}>
              {!hasData ? '—'
                : hasDailyData
                  ? `${dailyPct! > 0 ? '+' : ''}${dailyPct!.toFixed(2)}%`
                  : <span style={{ color: '#50505a' }}>—</span>
              }
            </span>
          </td>
        )}
      </tr>
    </ContextMenu>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────
export const MarketWatchPanel: React.FC<MarketWatchPanelProps> = ({
  allSymbols,
  selectedSymbol,
  onSymbolSelect,
  className,
}) => {
  const liveTicks = useAppStore((state) => state.ticks);
  const {
    symbols: marketInstruments,
    loading: isLoadingSymbols,
    error: symbolsError,
  } = useMarketInstruments();

  const activeWatchlist = useWatchlistStore((s) => {
    return s.watchlists.find((w) => w.id === s.activeWatchlistId);
  });
  const {
    loading: watchlistLoading,
    error: watchlistError,
  } = useRemoteWatchlistSync(activeWatchlist?.id);
  const watchlistSymbols = activeWatchlist?.symbols || [];

  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showGrid, setShowGrid] = useState(true);
  const [showSymbolsPanel, setShowSymbolsPanel] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(999);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPanelWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setPanelWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  const showAsk    = panelWidth >= 220;
  const showSpread = panelWidth >= 300;
  const showDaily  = panelWidth >= 380;

  const availableSymbols = useMemo(() => {
    const fromProps = (Array.isArray(allSymbols) ? allSymbols : [])
      .map((item) => normalizeSymbol(String(item?.symbol ?? item?.name ?? item?.id ?? item)))
      .filter(Boolean);
    const fromApi = marketInstruments.map((item) => item.symbol);
    return Array.from(new Set([...fromApi, ...fromProps])).sort((a, b) => a.localeCompare(b));
  }, [allSymbols, marketInstruments]);

  const filteredSymbols = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toUpperCase();
    return availableSymbols
      .filter((s) => s.includes(q) && !watchlistSymbols.includes(s))
      .slice(0, 15);
  }, [search, availableSymbols, watchlistSymbols]);

  const handleSelectSymbol = useCallback((symbol: string) => {
    const next = normalizeSymbol(symbol);
    if (!next || !activeWatchlist) return;
    if (!watchlistSymbols.includes(next)) {
      useWatchlistStore.getState().addSymbolToWatchlist(activeWatchlist.id, next);
      useMarketDataStore.getState().subscribeSymbol(next);
    }
    setSearch('');
    setShowDropdown(false);
    setHighlightIndex(-1);
    
    // Automatically open chart for the newly searched/selected pair as a NEW TAB
    window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: next, newTab: true } }));
  }, [onSymbolSelect, activeWatchlist, watchlistSymbols]);

  const handleHideSymbol = useCallback((symbol: string) => {
    if (!activeWatchlist) return;
    useWatchlistStore.getState().removeSymbolFromWatchlist(activeWatchlist.id, symbol);
  }, [activeWatchlist]);

  const handleHideAll = useCallback(() => {
    if (!activeWatchlist) return;
    useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, []);
  }, [activeWatchlist]);

  const handleShowAll = useCallback(() => {
    if (!activeWatchlist || availableSymbols.length === 0) return;
    useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, availableSymbols);
  }, [activeWatchlist, availableSymbols]);

  const handleSort = useCallback((method: 'name' | 'name-desc') => {
    if (!activeWatchlist) return;
    const sorted = [...watchlistSymbols].sort((a, b) => {
      if (method === 'name') return a.localeCompare(b);
      return b.localeCompare(a);
    });
    useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, sorted);
  }, [activeWatchlist, watchlistSymbols]);

  const handleExport = useCallback(() => {
    const data = watchlistSymbols.map(sym => {
      const tick = liveTicks[sym];
      return `${sym}\t${tick?.bid ?? '-'}\t${tick?.ask ?? '-'}\t${tick?.spread ?? '-'}`;
    }).join('\n');
    navigator.clipboard.writeText(`Symbol\tBid\tAsk\tSpread\n${data}`);
  }, [watchlistSymbols, liveTicks]);

  const getContextMenuItems = useCallback((symbol: string): ContextMenuItemConfig[] => {
    return [
      {
        label: 'New Order',
        icon: <Icon name="plus" size="xs" />,
        shortcut: 'F9',
        action: () => {
          window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
        },
      },
      {
        label: 'Chart Window',
        icon: <Icon name="bar-chart" size="xs" />,
        action: () => {
          window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } }));
        },
      },
      {
        label: 'Depth Of Market',
        icon: <Icon name="layers" size="xs" />,
        shortcut: 'Alt+B',
        action: () => {
          window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
        },
      },
      {
        label: 'Specification',
        icon: <Icon name="file-text" size="xs" />,
        action: () => {
          const tick = liveTicks[symbol];
          const info = [
            `Symbol: ${symbol}`,
            `Bid: ${tick?.bid ?? 'N/A'}`,
            `Ask: ${tick?.ask ?? 'N/A'}`,
            `Spread: ${tick?.spread ?? 'N/A'}`,
            `Daily Change: ${tick?.dailyChange !== undefined ? tick.dailyChange.toFixed(2) + '%' : 'N/A'}`,
          ].join('\n');
          alert(info);
        },
      },
      { divider: true },
      {
        label: 'Hide',
        shortcut: 'Delete',
        action: () => handleHideSymbol(symbol),
      },
      {
        label: 'Hide All',
        action: handleHideAll,
      },
      {
        label: 'Show All',
        action: handleShowAll,
      },
      { divider: true },
      {
        label: 'Symbols',
        icon: <Icon name="search" size="xs" />,
        shortcut: 'Ctrl+U',
        action: () => {
          setShowSymbolsPanel(true);
          inputRef.current?.focus();
        },
      },
      {
        label: 'Sort',
        icon: <Icon name="sort" size="xs" />,
        submenu: [
          { label: 'Sort by Name (A→Z)', action: () => handleSort('name') },
          { label: 'Sort by Name (Z→A)', action: () => handleSort('name-desc') },
        ],
      },
      {
        label: 'Export',
        icon: <Icon name="download" size="xs" />,
        action: handleExport,
      },
      { divider: true },
      {
        label: 'Grid',
        checked: showGrid,
        action: () => setShowGrid(!showGrid),
        autoClose: false,
      },
    ];
  }, [liveTicks, handleHideSymbol, handleHideAll, handleShowAll, handleSort, handleExport, showGrid]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedSymbol) {
        handleHideSymbol(normalizeSymbol(selectedSymbol));
      }
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        inputRef.current?.focus();
        setShowSymbolsPanel(true);
      }
      if (e.key === 'F9') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('openNewOrder'));
      }
      if (e.altKey && e.key === 'b') {
        e.preventDefault();
        if (selectedSymbol) {
          window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol: selectedSymbol } }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSymbol, handleHideSymbol]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, filteredSymbols.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filteredSymbols.length) {
        handleSelectSymbol(filteredSymbols[highlightIndex]);
      } else if (search.trim()) {
        handleSelectSymbol(search);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSearch('');
      setHighlightIndex(-1);
    }
  }, [filteredSymbols, highlightIndex, search, handleSelectSymbol]);

  useEffect(() => {
    if (search.trim().length > 0) {
      setShowDropdown(true);
      setHighlightIndex(-1);
    } else {
      setShowDropdown(false);
    }
  }, [search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const rows = useMemo(() => {
    return watchlistSymbols.map(normalizeSymbol).filter(Boolean);
  }, [watchlistSymbols]);
  const { loading: quotesLoading, error: quotesError } = useLiveQuotes(rows);

  const timeStr = currentTime.toLocaleTimeString('en-US', { hour12: false });

  return (
    <>
      {/* Inline style for hover row and flash animation */}
      <style>{`
        .mw-row { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .mw-row:hover {
          background: linear-gradient(90deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%) !important;
          box-shadow: inset 2px 0 0 rgba(96,165,250,0.8);
        }
        .mw-input { transition: all 0.3s ease; }
        .mw-input::placeholder { color: #64748b; }
        .mw-input:focus { border-color: rgba(59,130,246,0.5) !important; box-shadow: 0 0 15px rgba(59,130,246,0.25), inset 0 0 0 1px rgba(59,130,246,0.5) !important; background: rgba(15,23,42,0.6) !important; }
        .mw-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .mw-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .mw-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .mw-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>

      <div
        ref={containerRef}
        className={`rtx-market-watch ${className ?? ''}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'transparent',
          color: '#e2e2e8',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 12,
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="rtx-market-watch__header" style={{
          padding: '8px 12px 7px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(25,26,30,0.95) 0%, rgba(19,19,22,0) 100%)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* Subtle accent dot */}
            <span style={{ fontSize: 11, fontWeight: 500, color: '#808088', letterSpacing: '0.04em' }}>
              MARKET WATCH
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10,
              fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
              color: '#8a8a8f',
              letterSpacing: '0.04em',
            }}>
              {timeStr}
            </span>
            <span style={{
              fontSize: 9,
              color: '#50505a',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '1px 6px',
              letterSpacing: '0.03em',
            }}>
              {rows.length}
            </span>
          </div>
        </div>

        {/* ── Search / Add Symbol ──────────────────────────────── */}
        <div className="rtx-market-watch__search" style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'relative', flexShrink: 0 }} ref={dropdownRef}>
          <div style={{ position: 'relative' }}>
            {/* Search icon */}
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#50505a', pointerEvents: 'none' }}
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              className="mw-input"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6,
                padding: '5px 8px 5px 26px',
                fontSize: 11,
                color: '#e2e2e8',
                outline: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              placeholder="Add symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => search.trim() && setShowDropdown(true)}
            />
          </div>

          {/* Dropdown */}
          {showDropdown && (
            <div className="rtx-market-watch__dropdown mw-scrollbar" style={{
              position: 'absolute',
              left: 10, right: 10,
              top: '100%',
              marginTop: 2,
              background: '#191a1e',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 7,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              zIndex: 50,
              maxHeight: 220,
              overflowY: 'auto',
            }}>
              {isLoadingSymbols ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: '#50505a' }}>Loading…</div>
              ) : filteredSymbols.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: '#50505a' }}>
                  {search.trim() ? 'No matches found' : 'Type to search…'}
                </div>
              ) : filteredSymbols.map((sym, idx) => {
                const cat = getCategory(sym);
                return (
                  <div
                    key={sym}
                    onClick={() => handleSelectSymbol(sym)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    style={{
                      padding: '6px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: 11,
                      background: idx === highlightIndex ? 'rgba(255,255,255,0.06)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <span style={{ color: idx === highlightIndex ? '#e2e2e8' : '#808088', fontWeight: 500 }}>{sym}</span>
                    <span style={{
                      fontSize: 9,
                      color: cat.color,
                      background: `${cat.color}18`,
                      border: `1px solid ${cat.color}30`,
                      borderRadius: 4,
                      padding: '1px 5px',
                      letterSpacing: '0.03em',
                    }}>
                      {cat.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Symbols Panel (Ctrl+U) ───────────────────────────── */}
        {showSymbolsPanel && (
          <div className="rtx-market-watch__symbols-panel mw-scrollbar" style={{
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: '#0d0f18',
            maxHeight: 140,
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontSize: 9, color: '#50505a', letterSpacing: '0.05em' }}>ALL SYMBOLS ({availableSymbols.length})</span>
              <button
                onClick={() => setShowSymbolsPanel(false)}
                style={{ background: 'none', border: 'none', color: '#50505a', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
              >✕</button>
            </div>
            {availableSymbols.filter(s => !watchlistSymbols.includes(s)).map((sym) => {
              const cat = getCategory(sym);
              return (
                <div
                  key={sym}
                  onClick={() => handleSelectSymbol(sym)}
                  style={{
                    padding: '5px 10px', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', cursor: 'pointer', fontSize: 11, color: '#606068',
                  }}
                  className="mw-row"
                >
                  <span>{sym}</span>
                  <span style={{ fontSize: 9, color: cat.color }}>{cat.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Table & Column Headers ───────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }} className="rtx-market-watch__table mw-scrollbar">
          {rows.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 8, color: '#222226',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span style={{ fontSize: 11, color: '#50505a' }}>No symbols — type above to add</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              {/* Column sizing */}
              <colgroup>
                <col />
                <col style={{ width: panelWidth < 300 ? '45%' : '22%' }} />
                {showAsk    && <col style={{ width: '22%' }} />}
                {showSpread && <col style={{ width: '14%' }} />}
                {showDaily  && <col style={{ width: '20%' }} />}
              </colgroup>

              {/* Sticky header */}
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ textAlign: 'left',  padding: '4px 8px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Symbol</th>
                  <th style={{ textAlign: 'right', padding: '4px 5px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Bid</th>
                  {showAsk    && <th style={{ textAlign: 'right', padding: '4px 5px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Ask</th>}
                  {showSpread && <th style={{ textAlign: 'right', padding: '4px 5px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Sprd</th>}
                  {showDaily  && <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Daily</th>}
                </tr>
              </thead>

              <tbody>
                {rows.map((symbol) => {
                  let tick = liveTicks[symbol];
                  if (!tick) {
                    const caseMatch = Object.keys(liveTicks).find(k => k.toUpperCase() === symbol.toUpperCase());
                    if (caseMatch) tick = liveTicks[caseMatch];
                  }
                  if (!tick) {
                    const baseSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                    const baseMatch = Object.keys(liveTicks).find(k => {
                      return k.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === baseSymbol;
                    });
                    if (baseMatch) tick = liveTicks[baseMatch];
                  }

                  return (
                    <MarketWatchRow
                      key={symbol}
                      symbol={symbol}
                      tick={tick}
                      isSelected={symbol === normalizeSymbol(selectedSymbol)}
                      onClick={() => onSymbolSelect(symbol)}
                      contextMenuItems={getContextMenuItems(symbol)}
                      showAsk={showAsk}
                      showSpread={showSpread}
                      showDaily={showDaily}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer: add symbol hint ──────────────────────────── */}
        <div className="rtx-market-watch__footer" style={{
          padding: '5px 10px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span
            onClick={() => inputRef.current?.focus()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#50505a', fontSize: 10 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add symbol
          </span>
          <span style={{ fontSize: 9, color: '#36363e' }}>{rows.length} symbols</span>
        </div>

        {(symbolsError || quotesError || watchlistError) && (
          <div style={{
            padding: '5px 10px',
            borderTop: '1px solid rgba(248,113,113,0.16)',
            color: '#f87171',
            background: 'rgba(248,113,113,0.06)',
            fontSize: 10,
            lineHeight: 1.3,
          }}>
            {symbolsError || quotesError || watchlistError}
          </div>
        )}
        {(quotesLoading || watchlistLoading) && rows.length > 0 && Object.keys(liveTicks).length === 0 && (
          <div style={{ padding: '4px 10px', color: '#606068', fontSize: 10 }}>
            Loading quotes...
          </div>
        )}
      </div>
    </>
  );
};

export default MarketWatchPanel;

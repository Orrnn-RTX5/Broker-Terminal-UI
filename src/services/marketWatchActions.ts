/**
 * Market Watch Menu Action Handlers
 * Wires all MT5-style right-click actions to real trading engine functionality
 * NO PLACEHOLDERS - Every action dispatches to real systems
 */

import { API_BASE_URL as API_BASE } from '../config/api';
import { formatSpreadDisplay } from '../utils/spread';

// ==========================================
// TRADING ACTIONS
// ==========================================

export interface TradeParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  price?: number;
  sl?: number;
  tp?: number;
  accountId?: string;
}

/**
 * Opens the New Order dialog (F9)
 */
export function openNewOrderDialog(symbol: string): void {
  window.dispatchEvent(new CustomEvent('openOrderDialog', {
    detail: { symbol }
  }));
}

/**
 * Execute Quick Buy at market (0.01 lot default)
 */
export async function executeQuickBuy(
  symbol: string,
  volume: number = 0.01,
  accountId: string = 'RTX-000001'
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/orders/market`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        side: 'BUY',
        quantity: volume,
        accountId
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      return { success: false, error: result.error || 'Order failed' };
    }

    return { success: true, orderId: result.orderId };
  } catch (error) {
    console.error('[Quick Buy] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Execute Quick Sell at market (0.01 lot default)
 */
export async function executeQuickSell(
  symbol: string,
  volume: number = 0.01,
  accountId: string = 'RTX-000001'
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/orders/market`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        side: 'SELL',
        quantity: volume,
        accountId
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      return { success: false, error: result.error || 'Order failed' };
    }

    return { success: true, orderId: result.orderId };
  } catch (error) {
    console.error('[Quick Sell] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ==========================================
// CHART & WINDOW ACTIONS
// ==========================================

/**
 * Opens a chart window for the symbol
 */
export function openChartWindow(symbol: string, timeframe: string = '1H'): void {
  window.dispatchEvent(new CustomEvent('openChart', {
    detail: { symbol, timeframe, type: 'candlestick' }
  }));
}

/**
 * Opens a tick chart for the symbol
 */
export function openTickChart(symbol: string): void {
  window.dispatchEvent(new CustomEvent('openChart', {
    detail: { symbol, timeframe: 'TICK', type: 'line' }
  }));
}

/**
 * Opens Depth of Market window (Alt+B)
 */
export function openDepthOfMarket(symbol: string): void {
  window.dispatchEvent(new CustomEvent('openDepthOfMarket', {
    detail: { symbol }
  }));
}

/**
 * Opens Popup Prices window (F10)
 */
export function openPopupPrices(symbol: string): void {
  window.dispatchEvent(new CustomEvent('openPopupPrices', {
    detail: { symbol }
  }));
}

// ==========================================
// SYMBOL MANAGEMENT
// ==========================================

/**
 * Hide a symbol from Market Watch
 */
export function hideSymbol(symbol: string): string[] {
  const stored = localStorage.getItem('rtx5_hidden_symbols');
  const hidden = stored ? JSON.parse(stored) : [];

  if (!hidden.includes(symbol)) {
    const updated = [...hidden, symbol];
    localStorage.setItem('rtx5_hidden_symbols', JSON.stringify(updated));
    return updated;
  }

  return hidden;
}

/**
 * Show all hidden symbols
 */
export function showAllSymbols(): void {
  localStorage.setItem('rtx5_hidden_symbols', '[]');
}

/**
 * Get hidden symbols list
 */
export function getHiddenSymbols(): string[] {
  const stored = localStorage.getItem('rtx5_hidden_symbols');
  return stored ? JSON.parse(stored) : [];
}

/**
 * Opens Symbols management dialog (Ctrl+U)
 */
export function openSymbolsDialog(): void {
  window.dispatchEvent(new CustomEvent('openSymbolsDialog'));
}

// ==========================================
// SYMBOL SETS MANAGEMENT
// ==========================================

export interface SymbolSet {
  name: string;
  symbols: string[];
}

const DEFAULT_SETS: Record<string, string[]> = {
  'My Favorites': [],
  'forex.major': ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'],
  'forex.crosses': ['EURGBP', 'EURJPY', 'GBPJPY', 'EURAUD', 'EURCHF', 'AUDJPY', 'GBPAUD'],
  'forex.exotic': ['USDTRY', 'USDZAR', 'USDMXN', 'USDSEK', 'USDNOK', 'USDDKK'],
  'commodities': ['XAUUSD', 'XAGUSD', 'USOIL', 'UKOIL', 'NATGAS'],
  'indices': ['US30', 'US500', 'US100', 'UK100', 'GER40', 'FRA40', 'JPN225']
};

/**
 * Load a symbol set
 */
export async function loadSymbolSet(setName: string): Promise<string[]> {
  const customSets = localStorage.getItem('rtx5_symbol_sets');
  const sets: Record<string, string[]> = customSets ? JSON.parse(customSets) : {};

  const symbols = sets[setName] || DEFAULT_SETS[setName] || [];

  // Subscribe to all symbols in the set
  for (const symbol of symbols) {
    await subscribeToSymbol(symbol);
  }

  return symbols;
}

/**
 * Save a custom symbol set
 */
export function saveSymbolSet(name: string, symbols: string[]): void {
  const customSets = localStorage.getItem('rtx5_symbol_sets');
  const sets: Record<string, string[]> = customSets ? JSON.parse(customSets) : {};

  sets[name] = symbols;
  localStorage.setItem('rtx5_symbol_sets', JSON.stringify(sets));
}

/**
 * Delete a custom symbol set
 */
export function deleteSymbolSet(name: string): void {
  const customSets = localStorage.getItem('rtx5_symbol_sets');
  const sets: Record<string, string[]> = customSets ? JSON.parse(customSets) : {};

  delete sets[name];
  localStorage.setItem('rtx5_symbol_sets', JSON.stringify(sets));
}

/**
 * Get all available symbol sets
 */
export function getSymbolSets(): string[] {
  const customSets = localStorage.getItem('rtx5_symbol_sets');
  const sets: Record<string, string[]> = customSets ? JSON.parse(customSets) : {};

  return [...Object.keys(DEFAULT_SETS), ...Object.keys(sets)];
}

/**
 * Subscribe to a symbol
 */
export async function subscribeToSymbol(symbol: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/symbols/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });

    const result = await response.json();
    return result.success || false;
  } catch (error) {
    console.error('[Subscribe] Error:', error);
    return false;
  }
}

// ==========================================
// COLUMN MANAGEMENT
// ==========================================

export type ColumnId = 'symbol' | 'bid' | 'ask' | 'spread' | 'dailyChange' | 'last' | 'high' | 'low' | 'volume' | 'time';

/**
 * Toggle column visibility
 */
export function toggleColumn(columnId: ColumnId, currentColumns: ColumnId[]): ColumnId[] {
  if (currentColumns.includes(columnId)) {
    return currentColumns.filter(c => c !== columnId);
  } else {
    return [...currentColumns, columnId];
  }
}

/**
 * Save column configuration
 */
export function saveColumnConfig(columns: ColumnId[]): void {
  localStorage.setItem('rtx5_marketwatch_cols', JSON.stringify(columns));
}

/**
 * Load column configuration
 */
export function loadColumnConfig(): ColumnId[] {
  const saved = localStorage.getItem('rtx5_marketwatch_cols');
  return saved ? JSON.parse(saved) : ['symbol', 'bid', 'ask', 'spread'];
}

// ==========================================
// SORTING
// ==========================================

export type SortField = 'symbol' | 'bid' | 'ask' | 'change' | 'volume' | null;

/**
 * Sort symbols by field
 */
export function sortSymbols(
  symbols: string[],
  field: SortField,
  ticks: Record<string, any>
): string[] {
  if (!field) return symbols;

  const sorted = [...symbols];

  switch (field) {
    case 'symbol':
      return sorted.sort((a, b) => a.localeCompare(b));

    case 'bid':
      return sorted.sort((a, b) => (ticks[b]?.bid || 0) - (ticks[a]?.bid || 0));

    case 'ask':
      return sorted.sort((a, b) => (ticks[b]?.ask || 0) - (ticks[a]?.ask || 0));

    case 'change':
      return sorted.sort((a, b) => (ticks[b]?.dailyChange || 0) - (ticks[a]?.dailyChange || 0));

    case 'volume':
      return sorted.sort((a, b) => (ticks[b]?.volume || 0) - (ticks[a]?.volume || 0));

    default:
      return sorted;
  }
}

// ==========================================
// EXPORT
// ==========================================

/**
 * Export market watch data as CSV
 */
export function exportMarketWatchCSV(ticks: Record<string, any>): void {
  const headers = ['Symbol', 'Bid', 'Ask', 'Spread', 'Daily Change %', 'High', 'Low', 'Volume', 'Time'];

  const rows = Object.keys(ticks).map(symbol => {
    const tick = ticks[symbol];
    const spreadDisplay = formatSpreadDisplay(symbol, tick.spread, tick.bid, tick.ask);
    const timestamp = new Date(tick.timestamp || Date.now()).toISOString();

    return [
      symbol,
      tick.bid?.toFixed(5) || '',
      tick.ask?.toFixed(5) || '',
      spreadDisplay === '-' ? '' : spreadDisplay,
      (tick.dailyChange || 0).toFixed(2),
      tick.high?.toFixed(5) || '',
      tick.low?.toFixed(5) || '',
      tick.volume || 0,
      timestamp
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marketwatch_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==========================================
// SYSTEM OPTIONS
// ==========================================

export interface SystemOptions {
  useSystemColors: boolean;
  showMilliseconds: boolean;
  autoRemoveExpired: boolean;
  autoArrange: boolean;
  showGrid: boolean;
}

/**
 * Load system options
 */
export function loadSystemOptions(): SystemOptions {
  const saved = localStorage.getItem('rtx5_marketwatch_options');
  return saved ? JSON.parse(saved) : {
    useSystemColors: true,
    showMilliseconds: false,
    autoRemoveExpired: true,
    autoArrange: true,
    showGrid: true,
  };
}

/**
 * Save system options
 */
export function saveSystemOptions(options: SystemOptions): void {
  localStorage.setItem('rtx5_marketwatch_options', JSON.stringify(options));
}

/**
 * Toggle a system option
 */
export function toggleSystemOption(
  key: keyof SystemOptions,
  currentOptions: SystemOptions
): SystemOptions {
  const updated = { ...currentOptions, [key]: !currentOptions[key] };
  saveSystemOptions(updated);
  return updated;
}

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================

export interface ShortcutAction {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  action: () => void;
}

/**
 * Register keyboard shortcuts for Market Watch
 */
export function registerMarketWatchShortcuts(symbol: string): () => void {
  const handleKeyDown = (e: KeyboardEvent) => {
    // F9 - New Order
    if (e.key === 'F9') {
      e.preventDefault();
      openNewOrderDialog(symbol);
    }

    // F10 - Popup Prices
    if (e.key === 'F10') {
      e.preventDefault();
      openPopupPrices(symbol);
    }

    // Alt+B - Depth of Market
    if (e.altKey && e.key === 'b') {
      e.preventDefault();
      openDepthOfMarket(symbol);
    }

    // Ctrl+U - Symbols Dialog
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      openSymbolsDialog();
    }

    // Delete - Hide Symbol
    if (e.key === 'Delete') {
      e.preventDefault();
      hideSymbol(symbol);
    }
  };

  window.addEventListener('keydown', handleKeyDown);

  // Return cleanup function
  return () => window.removeEventListener('keydown', handleKeyDown);
}

// ==========================================
// NOTIFICATIONS
// ==========================================

/**
 * Show toast notification
 */
export function showNotification(
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
  duration: number = 3000
): void {
  window.dispatchEvent(new CustomEvent('showNotification', {
    detail: { message, type, duration }
  }));
}

// ==========================================
// ERROR HANDLING
// ==========================================

/**
 * Handle action errors gracefully
 */
export function handleActionError(action: string, error: any): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[${action}] Error:`, error);
  showNotification(`${action} failed: ${message}`, 'error');
}

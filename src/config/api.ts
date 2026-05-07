/**
 * Centralized API Configuration
 * All API endpoints and WebSocket URLs are defined here
 * Environment variables (VITE_*) are REQUIRED - no fallback defaults
 */

// Always use the backend directly — never the local Vite proxy
const BACKEND = 'https://rtxbackend.tradecopier.org';

const API_BASE_URL = import.meta.env.VITE_API_URL || BACKEND;
const FIX_API_URL = import.meta.env.VITE_FIX_API_URL || BACKEND;
const FIX_WS_URL = import.meta.env.VITE_FIX_WS_URL || 'wss://fixapibackend.tradecopier.org/ws';
const MT5_SYNC_URL = import.meta.env.VITE_MT5_SYNC_URL || BACKEND;
const WS_URL = import.meta.env.VITE_WS_URL || 'wss://fixapibackend.tradecopier.org/ws';

// Optional with undefined default
const ADMIN_API_URL = import.meta.env.VITE_ADMIN_URL || API_BASE_URL;
const MARKET_WS_URL = import.meta.env.VITE_MARKET_WS_URL || FIX_WS_URL;
const ADMIN_WS_URL = import.meta.env.VITE_ADMIN_WS_URL;

// API Endpoints
export const API_ENDPOINTS = {
  // Auth
  login: `${API_BASE_URL}/api/login`,
  logout: `${API_BASE_URL}/api/logout`,
  refresh: `${API_BASE_URL}/api/refresh`,

  // MT5 Account
  mt5: {
    status: `${API_BASE_URL}/api/mt5/status`,
    groups: `${API_BASE_URL}/api/mt5/groups`,
    create: `${API_BASE_URL}/api/mt5/account/create`,
  },

  // Market Data (Protected)
  symbols: `${API_BASE_URL}/api/symbols`,
  quotes: `${API_BASE_URL}/api/quotes`,
  candles: `${API_BASE_URL}/api/candles`,
  ticks: `${API_BASE_URL}/api/ticks`,

  // Account Info
  account: {
    summary: `${API_BASE_URL}/api/account/summary`,
    transactions: `${API_BASE_URL}/api/account/transactions`,
    equityHistory: `${API_BASE_URL}/api/account/equity-history`,
    settings: `${API_BASE_URL}/api/account/settings`,
    password: `${API_BASE_URL}/api/account/password`,
  },

  payments: {
    history: `${API_BASE_URL}/api/payments/history`,
    deposit: `${API_BASE_URL}/api/payments/deposit`,
    withdrawal: `${API_BASE_URL}/api/payments/withdrawal`,
  },

  admin: {
    users: `${API_BASE_URL}/api/admin/users`,
    settings: `${API_BASE_URL}/api/admin/settings`,
    config: `${API_BASE_URL}/api/admin/config`,
    lp: `${API_BASE_URL}/api/admin/lp`,
    symbols: `${API_BASE_URL}/api/admin/symbols`,
    routingRules: `${API_BASE_URL}/api/admin/routing-rules`,
  },

  alertRules: {
    list: `${API_BASE_URL}/api/alerts/rules`,
  },

  chartAnalysis: {
    upload: `${API_BASE_URL}/api/chart/upload`,
  },

  // Trading
  trading: {
    orders: `${API_BASE_URL}/api/orders`,
    positions: `${API_BASE_URL}/api/positions`,
    closePosition: (id: string) => `${API_BASE_URL}/api/positions/${id}/close`,
    modifyOrder: (id: string) => `${MT5_SYNC_URL}/api/v1/trades/modify`,
    cancelOrder: (id: string) => `${API_BASE_URL}/api/orders/${id}`,
  },

  // MT5 Sync Direct (Port 8088)
  mt5Sync: {
    execute: `${MT5_SYNC_URL}/api/v1/trades/execute`,
    createAccount: `${MT5_SYNC_URL}/api/v1/mt5/account/create`,
    groups: `${MT5_SYNC_URL}/api/v1/mt5/groups`,
    status: `${MT5_SYNC_URL}/api/v1/mt5/status`,
  },

  // FIX API Direct (Port 8081) - Legacy references
  workspace: {
    layouts: `${FIX_API_URL}/workspace/layouts`,
    drawings: `${FIX_API_URL}/api/drawings`,
    preferences: `${FIX_API_URL}/workspace/preferences`,
  },
};

// WebSocket Endpoints
export const WS_ENDPOINTS = {
  market: MARKET_WS_URL,
  admin: ADMIN_WS_URL,
  general: WS_URL,
};

// Helper functions
export function buildApiUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildAdminUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${ADMIN_API_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildMt5SyncUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${MT5_SYNC_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildWsUrl(endpoint: string): string {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
    return endpoint;
  }
  const wsBase = WS_URL.replace(/\/(fix-)?ws$/, '');
  return `${wsBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

// Export base URLs for backward compatibility
export { API_BASE_URL, ADMIN_API_URL, FIX_API_URL, FIX_WS_URL, MT5_SYNC_URL, WS_URL, MARKET_WS_URL, ADMIN_WS_URL };

// Optional exports with undefined default
export const ENABLE_DEBUG = import.meta.env.VITE_ENABLE_DEBUG === 'true';

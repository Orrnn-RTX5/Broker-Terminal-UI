const BACKEND = import.meta.env.VITE_BACKEND_URL as string;

const API_BASE_URL = import.meta.env.VITE_API_URL as string || BACKEND;
const RTX5_API_URL = import.meta.env.VITE_RTX5_API_URL as string || import.meta.env.VITE_API_V2_URL as string;
const API_V2_BASE_URL = RTX5_API_URL ? `${RTX5_API_URL.replace(/\/$/, '')}/api/v2` : '';
const API_HISTORY_BASE_URL = RTX5_API_URL ? `${RTX5_API_URL.replace(/\/$/, '')}/history` : '';
const FIX_API_URL = import.meta.env.VITE_FIX_API_URL as string || BACKEND;
const FIX_WS_URL = import.meta.env.VITE_FIX_WS_URL as string;
const WS_URL = import.meta.env.VITE_WS_URL as string;
const RTX5_WS_URL = import.meta.env.VITE_RTX5_WS_URL as string || (RTX5_API_URL ? RTX5_API_URL.replace(/^http/i, 'ws').replace(/\/$/, '') + '/ws/v2' : '');

// Optional with undefined default
const ADMIN_API_URL = import.meta.env.VITE_ADMIN_URL || API_BASE_URL;
const MARKET_WS_URL = import.meta.env.VITE_MARKET_WS_URL || RTX5_WS_URL;
const ADMIN_WS_URL = import.meta.env.VITE_ADMIN_WS_URL;

// API Endpoints
export const API_ENDPOINTS = {

  login: `${API_BASE_URL}/api/login`,
  logout: `${API_BASE_URL}/api/logout`,
  refresh: `${API_BASE_URL}/api/refresh`,
  v2: {
    auth: {
      login: `${API_V2_BASE_URL}/auth/login`,
      me: `${API_V2_BASE_URL}/auth/me`,
      refresh: `${API_V2_BASE_URL}/auth/refresh`,
      changePassword: `${API_V2_BASE_URL}/auth/change-password`,
    },
    trading: {
      placeOrder: `${API_V2_BASE_URL}/orders`,
      positions: (login: number | string) => `${API_V2_BASE_URL}/positions/${login}`,
      positionHistory: (login: number | string) => `${API_V2_BASE_URL}/positions/${login}/history`,
      closePosition: (id: number | string) => `${API_V2_BASE_URL}/positions/${id}/close`,
      modifyPosition: (id: number | string) => `${API_V2_BASE_URL}/positions/${id}`,
      orders: (login: number | string) => `${API_V2_BASE_URL}/orders/${login}`,
      userOrders: `${API_V2_BASE_URL}/account/orders`,
      deals: (login: number | string) => `${API_V2_BASE_URL}/deals/${login}`,
      userDeals: `${API_V2_BASE_URL}/account/deals`,
      pendingOrders: `${API_V2_BASE_URL}/orders/pending`,
      pendingOrdersForAccount: (login: number | string) => `${API_V2_BASE_URL}/orders/pending/${login}`,
      pendingOrder: (ticket: number | string) => `${API_V2_BASE_URL}/orders/pending/${ticket}`,
      ocoOrders: `${API_V2_BASE_URL}/orders/oco`,
      ocoOrdersForAccount: (login: number | string) => `${API_V2_BASE_URL}/orders/oco/${login}`,
      ocoOrder: (id: number | string) => `${API_V2_BASE_URL}/orders/oco/${id}`,
    },
    market: {
      status: `${API_V2_BASE_URL}/market/status`,
      symbolStatus: (symbol: string) => `${API_V2_BASE_URL}/market/status/${encodeURIComponent(symbol)}`,
      instruments: `${API_V2_BASE_URL}/instruments`,
      quotes: `${API_V2_BASE_URL}/quotes`,
      quote: (symbol: string) => `${API_V2_BASE_URL}/quotes/${encodeURIComponent(symbol)}`,
      candles: (symbol: string) => `${API_V2_BASE_URL}/candles/${encodeURIComponent(symbol)}`,
      ticks: (symbol: string) => `${API_V2_BASE_URL}/ticks/${encodeURIComponent(symbol)}`,
      depth: (symbol: string) => `${API_V2_BASE_URL}/depth/${encodeURIComponent(symbol)}`,
      calculateMargin: `${API_V2_BASE_URL}/calculate/margin`,
      calculateProfit: `${API_V2_BASE_URL}/calculate/profit`,
    },
    broker: {
      servers: `${API_V2_BASE_URL}/broker/servers`,
      config: `${API_V2_BASE_URL}/broker/config`,
    },
    history: {
      candles: (symbol: string) => `${API_HISTORY_BASE_URL}/candles/${encodeURIComponent(symbol)}`,
      latestCandle: (symbol: string) => `${API_HISTORY_BASE_URL}/candles/${encodeURIComponent(symbol)}/latest`,
      ticks: (symbol: string) => `${API_HISTORY_BASE_URL}/ticks/${encodeURIComponent(symbol)}`,
    },
    watchlist: {
      list: `${API_V2_BASE_URL}/watchlist`,
      update: `${API_V2_BASE_URL}/watchlist`,
      item: (symbol: string) => `${API_V2_BASE_URL}/watchlist/${encodeURIComponent(symbol)}`,
    },
    account: {
      list: `${API_V2_BASE_URL}/accounts`,
      create: `${API_V2_BASE_URL}/accounts`,
      byLogin: (login: number | string) => `${API_V2_BASE_URL}/account/${login}`,
      metrics: (login: number | string) => `${API_V2_BASE_URL}/account/${login}/metrics`,
      equity: (login: number | string) => `${API_V2_BASE_URL}/account/${login}/equity`,
      history: (login: number | string) => `${API_V2_BASE_URL}/accounts/${login}/history`,
      closeAll: (login: number | string) => `${API_V2_BASE_URL}/accounts/${login}/close-all`,
      investorPassword: (login: number | string) => `${API_V2_BASE_URL}/accounts/${login}/investor-password`,
    },
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

  chartAnalysis: {
    upload: `${API_BASE_URL}/api/chart/upload`,
  },

  // Trading
  trading: {
    orders: `${API_BASE_URL}/api/orders`,
    positions: (login: number | string) => API_ENDPOINTS.v2.trading.positions(login),
    closePosition: (id: string) => API_ENDPOINTS.v2.trading.closePosition(id),
    cancelOrder: (id: string) => `${API_BASE_URL}/api/orders/${id}`,
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
  rtx5: RTX5_WS_URL,
  v2: RTX5_WS_URL,
};

// Helper functions
export function buildApiUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildApiV2Url(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${API_V2_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildHistoryUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${API_HISTORY_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildAdminUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${ADMIN_API_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildWsUrl(endpoint: string): string {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
    return endpoint;
  }
  const wsBase = WS_URL.replace(/\/(fix-)?ws$/, '');
  return `${wsBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function buildApiV2WsUrl(token?: string): string {
  if (!token) return RTX5_WS_URL;
  const separator = RTX5_WS_URL.includes('?') ? '&' : '?';
  return `${RTX5_WS_URL}${separator}token=${encodeURIComponent(token)}`;
}

// Export base URLs for backward compatibility
export { API_BASE_URL, API_V2_BASE_URL, API_HISTORY_BASE_URL, RTX5_API_URL, RTX5_WS_URL, ADMIN_API_URL, FIX_API_URL, FIX_WS_URL, WS_URL, MARKET_WS_URL, ADMIN_WS_URL };

// Optional exports with undefined default
export const ENABLE_DEBUG = import.meta.env.VITE_ENABLE_DEBUG === 'true';

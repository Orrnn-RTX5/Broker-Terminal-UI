export type TradeSortColumn = 'symbol' | 'ticket' | 'time_create' | 'profit';
export type TradeSortDirection = 'asc' | 'desc';
export type TradeSortState = { column: TradeSortColumn; direction: TradeSortDirection } | null;
export type TradeProfitMode = 'money' | 'points';
export type TradeVolumeMode = 'lots' | 'amounts';

export const METRIC_UNAVAILABLE = '—';

export type TradeColumnKey =
  | 'ticket'
  | 'time'
  | 'side'
  | 'volume'
  | 'priceOpen'
  | 'sl'
  | 'tp'
  | 'priceCurrent'
  | 'swap'
  | 'accountLogin'
  | 'timeUpdate'
  | 'comment'
  | 'profit';

export type TradeColumnVisibility = Record<TradeColumnKey, boolean>;
export type TradeColumnWidthKey = TradeColumnKey | 'symbol' | 'close';
export type TradeColumnWidths = Record<TradeColumnWidthKey, number>;

export type TradeColumnDef = {
  key: TradeColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
};

export type TradeFooterMetricKey =
  | 'positions'
  | 'balance'
  | 'equity'
  | 'margin'
  | 'freeMargin'
  | 'marginLevel'
  | 'swap'
  | 'commission';

export type TradeFooterMetricVisibility = Record<TradeFooterMetricKey, boolean>;
export type TradeFooterMetricDef = {
  key: TradeFooterMetricKey;
  label: string;
};

export const TRADE_COLUMN_STORAGE_KEY = 'rtx5_trade_columns_v3';
export const TRADE_COLUMN_WIDTH_STORAGE_KEY = 'rtx5_trade_column_widths_v1';
export const TRADE_PROFIT_MODE_STORAGE_KEY = 'rtx5_trade_profit_mode';
export const TRADE_VOLUME_MODE_STORAGE_KEY = 'rtx5_trade_volume_mode';
export const TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY = 'rtx5_trade_show_on_charts_auto_update';
export const TRADE_FOOTER_METRIC_STORAGE_KEY = 'rtx5_trade_footer_metrics_v1';

export const TRADE_COLUMN_DEFS: TradeColumnDef[] = [
  { key: 'ticket', label: 'Ticket', defaultWidth: 96, minWidth: 70, maxWidth: 180 },
  { key: 'time', label: 'Time', defaultWidth: 150, minWidth: 120, maxWidth: 220 },
  { key: 'side', label: 'Type', defaultWidth: 76, minWidth: 64, maxWidth: 130 },
  { key: 'volume', label: 'Volume', defaultWidth: 74, minWidth: 62, maxWidth: 120 },
  { key: 'priceOpen', label: 'Price Open', defaultWidth: 98, minWidth: 82, maxWidth: 150 },
  { key: 'sl', label: 'S / L', defaultWidth: 92, minWidth: 80, maxWidth: 150 },
  { key: 'tp', label: 'T / P', defaultWidth: 92, minWidth: 80, maxWidth: 150 },
  { key: 'priceCurrent', label: 'Current Price', defaultWidth: 108, minWidth: 90, maxWidth: 160 },
  { key: 'swap', label: 'Swap', defaultWidth: 72, minWidth: 62, maxWidth: 120 },
  { key: 'accountLogin', label: 'Account Login', defaultWidth: 108, minWidth: 88, maxWidth: 160 },
  { key: 'timeUpdate', label: 'Time Update', defaultWidth: 150, minWidth: 120, maxWidth: 220 },
  { key: 'comment', label: 'Comment', defaultWidth: 130, minWidth: 90, maxWidth: 260 },
  { key: 'profit', label: 'Profit', defaultWidth: 92, minWidth: 72, maxWidth: 140 },
];

export const TRADE_COLUMN_DEF_BY_KEY = TRADE_COLUMN_DEFS.reduce((acc, column) => {
  acc[column.key] = column;
  return acc;
}, {} as Record<TradeColumnKey, TradeColumnDef>);

export const ALL_TRADE_COLUMNS: TradeColumnVisibility = TRADE_COLUMN_DEFS.reduce((acc, column) => {
  acc[column.key] = true;
  return acc;
}, {} as TradeColumnVisibility);

export const DEFAULT_TRADE_COLUMNS: TradeColumnVisibility = {
  ...ALL_TRADE_COLUMNS,
  swap: false,
  accountLogin: false,
  timeUpdate: false,
  comment: false,
};

export const TRADE_FOOTER_METRIC_DEFS: TradeFooterMetricDef[] = [
  { key: 'positions', label: 'Positions' },
  { key: 'balance', label: 'Balance' },
  { key: 'equity', label: 'Equity' },
  { key: 'margin', label: 'Margin' },
  { key: 'freeMargin', label: 'Free margin' },
  { key: 'marginLevel', label: 'Level' },
  { key: 'swap', label: 'Swap' },
  { key: 'commission', label: 'Commission' },
];

export const DEFAULT_TRADE_FOOTER_METRICS: TradeFooterMetricVisibility = {
  positions: false,
  balance: true,
  equity: true,
  margin: true,
  freeMargin: true,
  marginLevel: true,
  swap: false,
  commission: false,
};

export const TRADE_FIXED_COLUMN_DEFS: Record<
  'symbol' | 'close',
  Omit<TradeColumnDef, 'key'> & { key: 'symbol' | 'close' }
> = {
  symbol: { key: 'symbol', label: 'Symbol', defaultWidth: 92, minWidth: 74, maxWidth: 180 },
  close: { key: 'close', label: 'Close', defaultWidth: 22, minWidth: 22, maxWidth: 36 },
};

export const DEFAULT_TRADE_COLUMN_WIDTHS: TradeColumnWidths = TRADE_COLUMN_DEFS.reduce((acc, column) => {
  acc[column.key] = column.defaultWidth;
  return acc;
}, {
  symbol: TRADE_FIXED_COLUMN_DEFS.symbol.defaultWidth,
  close: TRADE_FIXED_COLUMN_DEFS.close.defaultWidth,
} as TradeColumnWidths);

export const TRADE_DEFAULT_SORT_DIRECTION: Record<TradeSortColumn, TradeSortDirection> = {
  symbol: 'asc',
  ticket: 'desc',
  time_create: 'desc',
  profit: 'desc',
};

export const TRADE_COLUMN_HOVER_COMMENTS: Record<TradeColumnWidthKey, string> = {
  symbol: 'Instrument for the open position',
  ticket: 'Unique order or position ticket',
  time: 'Position open time',
  side: 'Order type: buy or sell',
  volume: 'Position volume in lots',
  priceOpen: 'Price at which the position was opened',
  sl: 'Stop Loss:',
  tp: 'Take Profit:',
  priceCurrent: 'Current market price used for live P/L',
  swap: 'Accumulated overnight swap',
  accountLogin: 'Trading account login',
  timeUpdate: 'Last position update time',
  comment: 'Position comment',
  profit: 'Floating profit or loss for the position',
  close: 'Close this position',
};

export const TRADE_FOOTER_METRIC_COMMENTS: Record<TradeFooterMetricKey, string> = {
  positions: 'Number of open positions',
  balance: 'Account balance excluding floating P/L',
  equity: 'Balance plus current floating P/L',
  margin: 'Margin currently used by open positions',
  freeMargin: 'Available margin after used margin',
  marginLevel: 'Equity divided by margin, shown as a percent',
  swap: 'Total swap for open positions',
  commission: 'Total commission for open positions',
};

export const getTradeColumnDef = (key: TradeColumnWidthKey) => (
  key === 'symbol' || key === 'close'
    ? TRADE_FIXED_COLUMN_DEFS[key]
    : TRADE_COLUMN_DEF_BY_KEY[key]
);

export const clampTradeColumnWidth = (key: TradeColumnWidthKey, width: number): number => {
  const column = getTradeColumnDef(key);
  const safeWidth = Number.isFinite(width) ? width : column.defaultWidth;
  return Math.min(column.maxWidth, Math.max(column.minWidth, Math.round(safeWidth)));
};

export const normalizeTradeColumnWidths = (
  value: Partial<Record<TradeColumnWidthKey, unknown>>,
): TradeColumnWidths => {
  const widths = { ...DEFAULT_TRADE_COLUMN_WIDTHS };
  (Object.keys(widths) as TradeColumnWidthKey[]).forEach((key) => {
    widths[key] = clampTradeColumnWidth(key, Number(value[key] ?? widths[key]));
  });
  return widths;
};

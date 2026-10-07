export type ApiRole = 'user' | 'manager' | 'admin' | 'trader';
export type TradeSide = 'buy' | 'sell';
export type PendingOrderType = 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

export interface ApiErrorResponse {
  error?: string;
  message?: string;
}

export interface AuthLoginRequest {
  login_type?: 'master' | 'investor';
  username?: string | number;
  login?: number;
  email?: string;
  password: string;
  broker_id?: string;
}

export interface AuthRegisterRequest {
  email: string;
  password: string;
  name: string;
  broker_id: string;
  group?: string;
  leverage?: number;
  currency?: string;
  referral_code?: string;
}

export interface ApiUser {
  id?: number | string;
  user_id?: number;
  username?: string;
  email?: string;
  name?: string;
  role?: ApiRole;
  enabled?: boolean;
  api_key?: string;
  created_at?: number;
  updated_at?: number;
}

export interface AuthTokenResponse {
  name?: string;
  logo_url?: string | null;
  investor?: boolean;
  login_type?: 'master' | 'investor';
  token?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  user?: ApiUser;
  user_id?: number;
  username?: string;
  role?: ApiRole;
  account_login?: number;
  broker_id?: string;
  broker_name?: string;
  broker_server?: string;
  backend_url?: string;
  market_api_url?: string;
  server_url?: string;
  ws_url?: string;
  feed_url?: string;
  feed_ws_url?: string;
  feed_status_url?: string;
  expires_at?: number | string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface SetInvestorPasswordRequest {
  password: string;
}

export interface PasswordChangeResponse {
  message?: string;
}

export interface BrokerServer {
  id: number | string;
  broker_id: string;
  broker_name: string;
  server: string;
  server_url?: string;
  backend_url?: string;
  market_api_url?: string;
  server_ip?: string;
  server_port?: number;
  ws_url?: string;
  feed_url?: string;
  feed_ws_url?: string;
  feed_status_url?: string;
  protocol?: string;
  region?: string;
  enabled?: boolean;
  logo_url?: string;
  created_at?: number;
}

export interface BrokerConfig {
  name: string;
  logo_url?: string;
  support_email?: string;
  theme_color?: string;
  timezone?: string;
  domain?: string;
  terms_url?: string;
  privacy_url?: string;
}

export interface Broker {
  broker_id: string;
  license_plan: string;
  logo_url: string;
  modules_enabled: string[];
  name: string;
  status: string;
  valid_from: number;
  valid_until: number;
}

export interface ApiKey {
  id: number;
  name: string;
  key?: string;
  scopes?: string[];
  created_at?: number;
  last_used_at?: number | null;
}

export interface Session {
  id: number | string;
  user_agent?: string;
  ip_address?: string;
  created_at?: number;
  last_seen_at?: number;
}

export type SymbolSpecificationWeekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export interface SymbolSpecificationSessionRange {
  start: string | number;
  end: string | number;
}

export interface SymbolSpecificationDaySessions {
  quotes?: SymbolSpecificationSessionRange[];
  trade?: SymbolSpecificationSessionRange[];
}

export interface SymbolSpecificationMarginTier {
  order_type: string;
  range_label?: string;
  notional_from?: number;
  notional_to?: number;
  initial_rate?: number;
  initial_per_lot?: number;
  maintenance_rate?: number;
  maintenance_per_lot?: number;
  initial_per_lot_approximate?: boolean;
  maintenance_per_lot_approximate?: boolean;
  currency?: string;
}

export interface SymbolSpecificationCommissionTier {
  label?: string;
  range_label?: string;
  volume_from?: number;
  volume_to?: number;
  turnover_from?: number;
  turnover_to?: number;
  value?: number;
  value_display?: string;
  currency?: string;
  unit?: string;
}

export interface SymbolSpecificationCommissionSchedule {
  title?: string;
  description?: string;
  charge_mode?: string;
  basis?: string;
  direction?: string;
  tiers: SymbolSpecificationCommissionTier[];
}

export interface SymbolSpecificationMarginSpread {
  name: string;
  leg_a: string | string[];
  leg_b: string | string[];
  margin_type?: string;
  margin_display?: string;
  initial_margin?: number;
  maintenance_margin?: number;
  currency?: string;
}

/**
 * Account-scoped symbol snapshot returned by the broker. Every property is
 * optional because MT5 conditionally exposes fields by instrument class.
 * Consumers must not synthesize missing broker values.
 */
export interface SymbolSpecificationPayload {
  description?: string;
  page_url?: string;
  page?: string;
  isin?: string;
  category?: string;
  exchange?: string;
  cfi?: string;
  sector?: string;
  sector_name?: string;
  industry?: string;
  industry_name?: string;
  country?: string;
  digits?: number;
  contract_size?: number;
  contract_size_unit?: string;
  contract_size_display?: string;
  spread?: number;
  spread_float?: boolean;
  stops_level?: number;
  trade_stops_level?: number;
  freeze_level?: number;
  trade_freeze_level?: number;
  currency_base?: string;
  currency_margin?: string;
  currency_profit?: string;
  currency_deposit?: string;
  trade_calc_mode?: number | string;
  calc_mode?: number | string;
  tick_size?: number;
  tick_value?: number;
  tick_value_profit?: number;
  tick_value_loss?: number;
  margin_initial?: number;
  margin_maintenance?: number;
  margin_hedged?: number;
  margin_hedged_use_leg?: boolean;
  chart_mode?: number | string;
  trade_mode?: number | string;
  trade_exemode?: number | string;
  order_gtc_mode?: number | string;
  filling_mode?: number | string | string[];
  trade_fill_flags?: number | string[];
  expiration_mode?: number | string | string[];
  order_expiration_flags?: number | string[];
  order_mode?: number | string | string[];
  order_flags?: number | string[];
  volume_min?: number;
  volume_max?: number;
  volume_step?: number;
  volume_limit?: number;
  swap_mode?: number | string;
  swap_type_display?: string;
  swap_long?: number;
  swap_short?: number;
  swap_rollover3days?: number | string;
  swap_rates?: Partial<Record<SymbolSpecificationWeekday, number>>;
  sessions?: Partial<Record<SymbolSpecificationWeekday, SymbolSpecificationDaySessions>>;
  session_time_zone?: string;
  margin_rate_mode?: string;
  margin_rate_basis?: string;
  margin_rate_currency?: string;
  margin_rates?: SymbolSpecificationMarginTier[];
  margin_rates_as_of?: string | number;
  subscription?: string;
  ticks_history?: string;
  trade_liquidity_rate?: number;
  liquidity_rate?: number;
  start_time?: string | number;
  expiration_time?: string | number;
  trade_face_value?: number;
  face_value?: number;
  trade_accrued_interest?: number;
  accrued_interest?: number;
  option_mode?: number | string;
  option_right?: number | string;
  basis?: string;
  underlying?: string;
  option_strike?: number;
  commission?: number | string;
  commission_schedules?: SymbolSpecificationCommissionSchedule[];
  margin_spreads?: SymbolSpecificationMarginSpread[];
}

export interface Instrument {
  symbol?: string;
  name?: string;
  id?: string | number;
  description?: string;
  category?: string;
  digits?: number;
  contract_size?: number;
  calc_mode?: number | string;
  tick_size?: number;
  tick_value?: number;
  margin_currency?: string;
  profit_currency?: string;
  currency_profit?: string;
  min_volume?: number;
  max_volume?: number;
  volume_step?: number;
  spread?: number;
  bid?: number;
  ask?: number;
  swap_long?: number;
  swap_short?: number;
  commission?: number;
  enabled?: boolean;
  trading_enabled?: boolean;
  tradingEnabled?: boolean;
  specification?: SymbolSpecificationPayload;
}

export type InstrumentSpecification = Instrument & SymbolSpecificationPayload;

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  daily_change?: number;
  daily_change_pct?: number;
  daily_open?: number;
  previous_close?: number;
  session?: {
    high_bid?: number;
    low_bid?: number;
    high_ask?: number;
    low_ask?: number;
  };
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  time: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_count?: number;
}

export interface HistoryTick {
  symbol: string;
  bid: number;
  ask: number;
  time: number;
}

export interface DepthLevel {
  price: number;
  volume: number;
}

export interface OrderBook {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  time: number;
}

export interface MarketStatus {
  symbol?: string;
  status?: 'open' | 'closed' | 'pre_market' | 'after_hours';
  session_open?: number;
  session_close?: number;
  message?: string;
  quote_open?: boolean | number;
  trade_open?: boolean | number;
  server_time?: number;
}

export interface MarginCalcRequest {
  account_login: number;
  symbol: string;
  side: TradeSide;
  volume: number;
}

export interface MarginCalcResponse {
  symbol: string;
  volume: number;
  leverage?: number;
  required_margin: number;
  free_margin?: number;
  max_lots?: number;
  pip_value?: number;
  currency?: string;
}

export interface ProfitCalcRequest {
  symbol: string;
  volume: number;
  side: TradeSide;
  open_price: number;
  close_price: number;
}

export interface ProfitCalcResponse {
  symbol: string;
  volume: number;
  side: TradeSide;
  open_price: number;
  close_price: number;
  profit: number;
  pips?: number;
}

export interface Account {
  login: number;
  name?: string;
  currency?: string;
  leverage?: number;
  group?: string;
  balance?: number;
  credit?: number;
  equity?: number;
  margin?: number;
  margin_free?: number;
  margin_level?: number;
  floating?: number;
  status?: 'active' | 'suspended' | 'readonly' | 'deleted';
  created_at?: number;
}

export interface AccountMetrics {
  login: number;
  total_deals?: number;
  winning_deals?: number;
  losing_deals?: number;
  win_rate?: number;
  profit_factor?: number;
  total_profit?: number;
  total_loss?: number;
  net_profit?: number;
  avg_profit?: number;
  avg_loss?: number;
  max_drawdown?: number;
  total_volume?: number;
  total_commission?: number;
  total_swap?: number;
}

export interface BalanceOp {
  id: number;
  account_login: number;
  type: 'deposit' | 'withdrawal' | 'credit';
  amount: number;
  balance_after?: number;
  comment?: string;
  time: number;
}

export interface AuditEntry {
  id: number;
  account_login: number;
  action: string;
  details?: string;
  user_id?: number;
  ip_address?: string;
  time: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  balance?: number;
  margin?: number;
}

export interface Position {
  ticket: number;
  account_login: number;
  symbol: string;
  side: TradeSide;
  volume: number;
  price_open: number;
  price_current?: number;
  price_sl?: number | null;
  price_tp?: number | null;
  profit?: number;
  swap?: number;
  commission?: number;
  comment?: string;
  time_create?: number;
  time_update?: number;
  trailing_stop?: number;
  trailing_step?: number;
  magic?: number;
}

export interface ClosedPosition extends Omit<Position, 'price_current' | 'time_update'> {
  price_close?: number;
  reason?: 'manual' | 'sl_hit' | 'tp_hit' | 'stop_out' | 'close_by' | 'expired';
  duration_seconds?: number;
  time_close?: number;
}

export interface Deal {
  ticket: number;
  order_ticket?: number;
  position_ticket?: number;
  account_login: number;
  symbol?: string;
  action?: 'deal_buy' | 'deal_sell' | 'deal_balance' | 'deal_credit' | 'deal_commission' | 'deal_correction';
  entry?: 'entry_in' | 'entry_out' | 'entry_inout';
  volume?: number;
  price?: number;
  profit?: number;
  swap?: number;
  commission?: number;
  fee?: number;
  magic?: number;
  comment?: string;
  time?: number;
}

export interface Order {
  ticket: number;
  account_login: number;
  symbol: string;
  type: 'market' | PendingOrderType;
  side: TradeSide;
  volume: number;
  price?: number;
  status?: 'filled' | 'cancelled' | 'pending' | 'rejected';
  comment?: string;
  time_create?: number;
  magic?: number;
}

export interface PlaceOrderRequest {
  login: number;
  account_login?: number;
  client_order_id?: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  price_sl?: number;
  price_tp?: number;
  sl?: number;
  tp?: number;
  comment?: string;
  trailing_stop?: number;
  trailing_step?: number;
  magic?: number;
}

export interface ModifyPositionRequest {
  price_sl?: number;
  price_tp?: number;
  comment?: string;
  trailing_stop?: number;
  trailing_step?: number;
}

export interface PendingOrder extends Omit<Order, 'type' | 'status'> {
  type: PendingOrderType;
  price: number;
  price_sl?: number | null;
  price_tp?: number | null;
  expiration?: number | null;
  status?: 'active' | 'triggered' | 'cancelled' | 'expired';
}

export interface PlacePendingOrderRequest extends PlaceOrderRequest {
  type: PendingOrderType;
  price: number;
  expiration?: number;
  expiry?: number;
}

export interface ModifyPendingOrderRequest {
  price?: number;
  price_sl?: number;
  price_tp?: number;
  comment?: string;
  expiration?: number;
  sl?: number;
  tp?: number;
  expiry?: number;
  trailing_stop?: number;
  trailing_step?: number;
}

export interface PlaceOcoRequest {
  account_login: number;
  symbol: string;
  side?: TradeSide;
  volume: number;
  order1: Pick<PlacePendingOrderRequest, 'type' | 'price'>;
  order2: Pick<PlacePendingOrderRequest, 'type' | 'price'>;
  comment?: string;
}

export interface OcoPair {
  id: number;
  account_login: number;
  symbol: string;
  volume: number;
  order_a: PendingOrder;
  order_b: PendingOrder;
  status: 'active' | 'triggered' | 'cancelled';
  triggered_ticket?: number | null;
  time_create?: number;
}

export interface WatchlistItem {
  symbol: string;
  added_at?: number;
  sort_order?: number;
}

export interface WatchlistReplaceItem {
  symbol: string;
  sort_order: number;
}

export interface ListParams {
  limit?: number;
  offset?: number;
}

export interface DateRangeParams extends ListParams {
  from?: number;
  to?: number;
}

export interface CandleParams {
  timeframe?: Timeframe;
  from?: number;
  to?: number;
  limit?: number;
}

export interface HistoryCandleParams {
  timeframe?: Timeframe;
  from?: number;
  to?: number;
  limit?: number;
}

export interface HistoryTickParams {
  from: number;
  to: number;
  limit?: number;
}

export interface TradeSocketChannelPayloads {
  [channel: `ticks.${string}`]: Tick;
  'ticks.all': Tick;
  [channel: `candles.${string}.${Timeframe}`]: Candle | { snapshot?: Candle[]; candles?: Candle[]; candle?: Candle };
  [channel: `depth.${string}`]: OrderBook;
  [channel: `positions.${number}`]: Position | Position[] | { positions?: Position[]; event?: string };
  [channel: `account.${number}`]: Account | AccountMetrics;
  [channel: `orders.${number}`]: Order | PendingOrder | { orders?: Order[]; event?: string };
  [channel: `deals.${number}`]: Deal | { deals?: Deal[]; event?: string };
}

export type TradeSocketChannel = keyof TradeSocketChannelPayloads | `candles.${string}.${string}`;

export interface TradeSocketMessage<T = unknown> {
  action?: 'auth' | 'subscribe' | 'unsubscribe' | 'subscribed' | 'unsubscribed' | 'error' | string;
  channel?: string;
  type?: string;
  token?: string;
  data?: T;
  payload?: T;
  error?: string;
  message?: string;
  time?: number;
  [key: string]: unknown;
}

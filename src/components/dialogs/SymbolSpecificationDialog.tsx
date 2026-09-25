import { translateUi, useUiTranslation } from '../../hooks/useUiTranslation';
import i18n from '../../i18n';
import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useTick } from '../../store/useAppStore';
import { formatSpreadDisplayWithUnit } from '../../utils/spread';
import { getSymbolDigits } from '../../utils/symbolUtils';
import { Icon } from '../ui/Icon';

interface SymbolSpecificationDialogProps {
  isOpen: boolean;
  symbol: string;
  instrument?: unknown;
  fallbackInstrument?: unknown;
  onClose: () => void;
}

export interface SymbolSpecificationSnapshot {
  description: string | null;
  category: string | null;
  digits: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  contractSize: number | null;
  tickSize: number | null;
  tickValue: number | null;
  minVolume: number | null;
  maxVolume: number | null;
  volumeStep: number | null;
  marginRate: number | null;
  swapLong: number | null;
  swapShort: number | null;
  commission: number | null;
  tradingEnabled: boolean | null;
  baseCurrency: string | null;
  profitCurrency: string | null;
  marginCurrency: string | null;
  last: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  dailyChange: number | null;
  liquidityProvider: string | null;
  timestamp: number | null;
}

interface DisplayRow {
  label: string;
  value: string | null;
}

const NESTED_SPECIFICATION_KEYS = [
  'instrument',
  'specification',
  'spec',
  'contract',
  'trading_conditions',
  'tradingConditions',
  'volume',
  'costs',
  'metadata',
  'details',
] as const;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const collectSpecificationRecords = (value: unknown): Record<string, unknown>[] => {
  const root = asRecord(value);
  if (!root) return [];

  const records: Record<string, unknown>[] = [root];
  const seen = new Set<Record<string, unknown>>([root]);
  let frontier = [root];

  // Broker adapters commonly wrap the specification once or twice. Keep this
  // deliberately bounded so arbitrary response objects are not searched.
  for (let depth = 0; depth < 2; depth += 1) {
    const next: Record<string, unknown>[] = [];
    frontier.forEach((record) => {
      NESTED_SPECIFICATION_KEYS.forEach((key) => {
        const nested = asRecord(record[key]);
        if (!nested || seen.has(nested)) return;
        seen.add(nested);
        records.push(nested);
        next.push(nested);
      });
    });
    frontier = next;
  }

  return records;
};

const readRaw = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
): unknown => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
};

const readString = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
): string | null => {
  const value = readRaw(records, keys);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const readNumber = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
): number | null => {
  const value = readRaw(records, keys);
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
): boolean | null => {
  const value = readRaw(records, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['true', 'enabled', 'active', 'open', '1'].includes(normalized)) return true;
  if (['false', 'disabled', 'inactive', 'closed', '0'].includes(normalized)) return false;
  return null;
};

const normalizeTimestamp = (value: number | null): number | null => {
  if (value === null || value <= 0) return null;
  return value > 1_000_000_000_000 ? value : value * 1000;
};

export const buildSymbolSpecificationSnapshot = (
  instrument?: unknown,
  fallbackInstrument?: unknown,
): SymbolSpecificationSnapshot => {
  const records = [
    ...collectSpecificationRecords(instrument),
    ...collectSpecificationRecords(fallbackInstrument),
  ];
  const digits = readNumber(records, ['digits', 'precision', 'pip_position', 'pipPosition']);

  return {
    description: readString(records, ['description', 'display_name', 'displayName']),
    category: readString(records, ['category', 'asset_class', 'assetClass', 'type']),
    digits: digits === null ? null : Math.max(0, Math.min(10, Math.trunc(digits))),
    bid: readNumber(records, ['bid', 'best_bid', 'bestBid']),
    ask: readNumber(records, ['ask', 'best_ask', 'bestAsk']),
    spread: readNumber(records, ['spread']),
    contractSize: readNumber(records, ['contract_size', 'contractSize', 'trade_contract_size', 'tradeContractSize']),
    tickSize: readNumber(records, ['tick_size', 'tickSize', 'trade_tick_size', 'tradeTickSize']),
    tickValue: readNumber(records, ['tick_value', 'tickValue', 'trade_tick_value', 'tradeTickValue']),
    minVolume: readNumber(records, [
      'volume_min', 'min_volume', 'minVolume', 'min_lot', 'minLot', 'lot_min', 'lotMin', 'lots_min', 'lotsMin',
    ]),
    maxVolume: readNumber(records, [
      'volume_max', 'max_volume', 'maxVolume', 'max_lot', 'maxLot', 'lot_max', 'lotMax', 'lots_max', 'lotsMax',
    ]),
    volumeStep: readNumber(records, [
      'volume_step', 'volumeStep', 'lot_step', 'lotStep', 'lots_step', 'lotsStep',
    ]),
    marginRate: readNumber(records, [
      'margin_rate', 'marginRate', 'initial_margin', 'initialMargin', 'margin_initial', 'marginInitial',
    ]),
    swapLong: readNumber(records, ['swap_long', 'swapLong']),
    swapShort: readNumber(records, ['swap_short', 'swapShort']),
    commission: readNumber(records, ['commission', 'commission_per_lot', 'commissionPerLot']),
    tradingEnabled: readBoolean(records, [
      'trading_enabled',
      'tradingEnabled',
      'enabled',
      'is_enabled',
      'isEnabled',
      'status',
    ]),
    baseCurrency: readString(records, ['currency_base', 'currencyBase', 'base_currency', 'baseCurrency']),
    profitCurrency: readString(records, ['currency_profit', 'currencyProfit', 'profit_currency', 'profitCurrency']),
    marginCurrency: readString(records, ['currency_margin', 'currencyMargin', 'margin_currency', 'marginCurrency']),
    last: readNumber(records, ['last', 'last_price', 'lastPrice']),
    high: readNumber(records, ['high', 'session_high', 'sessionHigh', 'high24h', 'high_24h']),
    low: readNumber(records, ['low', 'session_low', 'sessionLow', 'low24h', 'low_24h']),
    volume: readNumber(records, ['tick_volume', 'tickVolume', 'volume_24h', 'volume24h', 'quote_volume', 'quoteVolume']),
    dailyChange: readNumber(records, ['daily_change', 'dailyChange', 'change_percent', 'changePercent']),
    liquidityProvider: readString(records, ['lp', 'liquidity_provider', 'liquidityProvider', 'provider']),
    timestamp: normalizeTimestamp(readNumber(records, ['timestamp', 'time', 'quote_time', 'quoteTime'])),
  };
};

const formatNumber = (value: number | null, maximumFractionDigits = 8): string | null => (
  value === null
    ? null
    : new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, { maximumFractionDigits }).format(value)
);

const formatPrice = (value: number | null, digits: number): string | null => (
  value === null ? null : value.toFixed(digits)
);

const formatTimestamp = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) return null;
  return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
};

const formatLots = (value: number | null): string | null => {
  const formatted = formatNumber(value);
  return formatted === null ? null : translateUi('{{value0}} lots', { value0: formatted });
};

const QuoteMetric = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) => { const tr = useUiTranslation(); return ((
  <div className="min-w-[132px] flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2.5">
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{tr(label)}</div>
    <div className={`mt-1 truncate font-mono text-[14px] font-semibold tabular-nums ${
      tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-[var(--text-primary)]'
    }`}>
      {value}
    </div>
  </div>
)); };

const SpecificationSection = ({
  title,
  icon,
  rows,
  emptyMessage,
  grid = false,
}: {
  title: string;
  icon: React.ReactNode;
  rows: DisplayRow[];
  emptyMessage: string;
  grid?: boolean;
}) => {
    const tr = useUiTranslation();
  const availableRows = rows.filter((row): row is { label: string; value: string } => row.value !== null);

  return (
    <section className="self-start overflow-hidden rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
      <div className="flex h-9 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-quaternary)] px-3">
        <span className="text-[var(--color-info)]" aria-hidden="true">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-primary)]">{tr(title)}</h3>
        <span className="ml-auto text-[10px] font-medium tabular-nums text-[var(--text-secondary)]">
          {availableRows.length > 0 ? tr("{{value0}} fields", { value0: availableRows.length }) : tr("Unavailable")}
        </span>
      </div>
      {availableRows.length > 0 ? (
        <dl className={grid ? 'grid grid-cols-1 gap-px bg-[var(--border-primary)] sm:grid-cols-2' : 'divide-y divide-[var(--border-primary)]'}>
          {availableRows.map((row) => (
            <div
              key={row.label}
              className={`bg-[var(--bg-tertiary)] px-3 py-2 ${grid
                ? 'min-h-[52px]'
                : 'grid min-h-9 grid-cols-[minmax(0,1fr)_minmax(112px,1fr)] items-center gap-3'
              }`}
            >
              <dt className="text-[12px] text-[var(--text-secondary)]">{tr(row.label)}</dt>
              <dd
                className={`${grid ? 'mt-1 text-left text-[12px]' : 'truncate text-right text-[12px]'} font-mono font-medium tabular-nums text-[var(--text-primary)]`}
                title={row.value}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex min-h-[64px] items-center gap-2.5 px-3 py-3 text-[12px] text-[var(--text-secondary)]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-quaternary)] text-[var(--text-muted)]" aria-hidden="true">
            <Icon name="info" size="xs" />
          </span>
          <span>{tr(emptyMessage)}</span>
        </div>
      )}
    </section>
  );
};

export const SymbolSpecificationDialog: React.FC<SymbolSpecificationDialogProps> = ({
  isOpen,
  symbol,
  instrument,
  fallbackInstrument,
  onClose,
}) => {
    const tr = useUiTranslation();
  const tick = useTick(symbol);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const snapshot = useMemo(
    () => buildSymbolSpecificationSnapshot(instrument, fallbackInstrument),
    [fallbackInstrument, instrument],
  );

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const digits = tick?.digits ?? snapshot.digits ?? getSymbolDigits(symbol);
  const bid = Number.isFinite(tick?.bid) ? tick!.bid : snapshot.bid;
  const ask = Number.isFinite(tick?.ask) ? tick!.ask : snapshot.ask;
  const tickSpread = Number.isFinite(tick?.spread) ? tick!.spread : null;
  const derivedSpread = bid !== null && ask !== null ? Math.max(0, ask - bid) : null;
  const rawSpread = tickSpread ?? derivedSpread;
  const spread = rawSpread !== null
    ? formatSpreadDisplayWithUnit(symbol, rawSpread, bid ?? undefined, ask ?? undefined)
    : formatNumber(snapshot.spread);
  const dailyChange = Number.isFinite(tick?.dailyChange) ? tick!.dailyChange! : snapshot.dailyChange;
  const high = Number.isFinite(tick?.high)
    ? tick!.high!
    : Number.isFinite(tick?.high24h)
      ? tick!.high24h!
      : snapshot.high;
  const low = Number.isFinite(tick?.low)
    ? tick!.low!
    : Number.isFinite(tick?.low24h)
      ? tick!.low24h!
      : snapshot.low;
  const explicitLast = Number.isFinite(tick?.last) ? tick!.last! : snapshot.last;
  const midpoint = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const quotePrice = explicitLast ?? midpoint;
  const quotePriceLabel = explicitLast === null && midpoint !== null ? 'Mid price' : 'Last price';
  const quoteTimestamp = Number.isFinite(tick?.timestamp) ? tick!.timestamp : snapshot.timestamp;
  const quoteVolume = Number.isFinite(tick?.volume) ? tick!.volume! : snapshot.volume;
  const liquidityProvider = tick?.lp?.trim() || snapshot.liquidityProvider;
  const pointSize = snapshot.tickSize ?? (snapshot.digits === null ? null : 10 ** -snapshot.digits);
  const pointSizeLabel = snapshot.tickSize === null ? 'Point size' : 'Tick size';

  const quoteMetrics = [
    { label: 'Bid', value: formatPrice(bid, digits), tone: 'positive' as const },
    { label: 'Ask', value: formatPrice(ask, digits), tone: 'negative' as const },
    { label: 'Spread', value: spread, tone: 'neutral' as const },
    {
      label: 'Daily change',
      value: dailyChange === null ? null : `${dailyChange.toFixed(2)}%`,
      tone: dailyChange === null || dailyChange === 0 ? 'neutral' as const : dailyChange > 0 ? 'positive' as const : 'negative' as const,
    },
  ].filter((metric): metric is { label: string; value: string; tone: 'positive' | 'negative' | 'neutral' } => metric.value !== null);

  const contractRows: DisplayRow[] = [
    { label: 'Price precision', value: snapshot.digits === null ? null : tr('{{value0}} digits', { value0: snapshot.digits }) },
    { label: 'Contract size', value: formatNumber(snapshot.contractSize) },
    { label: pointSizeLabel, value: formatNumber(pointSize, 10) },
    { label: 'Tick value', value: formatNumber(snapshot.tickValue) },
    { label: 'Base currency', value: snapshot.baseCurrency },
    { label: 'Profit currency', value: snapshot.profitCurrency },
    { label: 'Margin currency', value: snapshot.marginCurrency },
  ];
  const volumeRows: DisplayRow[] = [
    { label: 'Minimum volume', value: formatLots(snapshot.minVolume) },
    { label: 'Maximum volume', value: formatLots(snapshot.maxVolume) },
    { label: 'Volume step', value: formatLots(snapshot.volumeStep) },
    { label: 'Margin rate', value: formatNumber(snapshot.marginRate) },
    { label: 'Swap long', value: formatNumber(snapshot.swapLong) },
    { label: 'Swap short', value: formatNumber(snapshot.swapShort) },
    { label: 'Commission', value: formatNumber(snapshot.commission) },
  ];
  const quoteRows: DisplayRow[] = [
    { label: 'Session high', value: formatPrice(high, digits) },
    { label: 'Session low', value: formatPrice(low, digits) },
    { label: quotePriceLabel, value: formatPrice(quotePrice, digits) },
    { label: 'Tick volume', value: formatNumber(quoteVolume) },
    { label: 'Last received', value: formatTimestamp(quoteTimestamp) },
    { label: 'Liquidity provider', value: liquidityProvider },
  ];
  const hasBrokerSpecification = contractRows.some((row) => row.value !== null)
    || volumeRows.some((row) => row.value !== null);

  return createPortal(
    <div
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rtx-symbol-specification-title"
        data-testid="symbol-specification-dialog"
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[720px] flex-col overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--color-info-dim)] bg-[var(--color-info-dim)] text-[var(--color-info)]">
              <Icon name="file-text" size="sm" />
            </div>
            <div className="min-w-0">
              <h2 id="rtx-symbol-specification-title" className="truncate text-[14px] font-semibold leading-5">
                {symbol} {tr(" Specification")}</h2>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                {snapshot.description ?? tr('Broker contract details and current market data')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {snapshot.category && (
                  <span className="rounded border border-[var(--border-secondary)] bg-[var(--bg-quaternary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                    {snapshot.category}
                  </span>
                )}
                {snapshot.tradingEnabled !== null && (
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${snapshot.tradingEnabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                  }`}>
                    {snapshot.tradingEnabled ? tr("Trading enabled") : tr("Trading disabled")}
                  </span>
                )}
                {hasBrokerSpecification && (
                  <span className="rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                    {tr("Broker specification")}</span>
                )}
              </div>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={tr("Close symbol specification")}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-quaternary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            <Icon name="x-close" size="sm" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {quoteMetrics.length > 0 ? (
            <div className="flex flex-wrap gap-2" aria-label={tr("Current quote summary")}>
              {quoteMetrics.map((metric) => <QuoteMetric key={metric.label} {...metric} />)}
            </div>
          ) : (
            <div className="flex min-h-[64px] items-center gap-3 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-4 text-[12px] text-[var(--text-secondary)]">
              <Icon name="activity" size="sm" />
              {tr("Waiting for the first live quote from the broker.")}</div>
          )}

          <div className="mt-4 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            <SpecificationSection
              title={tr("Contract details")}
              icon={<Icon name="info" size="xs" />}
              rows={contractRows}
              emptyMessage={tr("Contract details were not provided by this broker.")}
            />
            <SpecificationSection
              title={tr("Volume & costs")}
              icon={<Icon name="layers" size="xs" />}
              rows={volumeRows}
              emptyMessage={tr("Volume and cost terms were not provided by this broker.")}
            />
            <div className="md:col-span-2">
              <SpecificationSection
                title={tr("Latest quote")}
                icon={<Icon name="activity" size="xs" />}
                rows={quoteRows}
                emptyMessage={tr("Waiting for detailed quote data from the broker feed.")}
                grid
              />
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-5 py-3">
          <p className="text-[11px] text-[var(--text-secondary)]">
            {tr("Only values supplied by your broker or live feed are shown.")}</p>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded border border-[var(--border-secondary)] bg-[var(--bg-quaternary)] px-4 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--color-info)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            {tr("Close")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};

export default SymbolSpecificationDialog;

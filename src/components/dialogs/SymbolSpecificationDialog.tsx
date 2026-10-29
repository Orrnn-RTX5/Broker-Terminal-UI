import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useFloatingPanelDrag } from '../../hooks/useFloatingPanelDrag';
import i18n from '../../i18n';
import { normalizeSymbolDescriptionText, resolveSymbolDescription } from '../../utils/symbolDescription';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../ui/Icon';


interface SymbolSpecificationDialogProps {
  isOpen: boolean;
  symbol: string;
  instrument?: unknown;
  fallbackInstrument?: unknown;
  requestStatus?: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  onClose: () => void;
}

interface DialogRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeGesture {
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startY: number;
  rect: DialogRect;
}

const VIEWPORT_GAP = 16;
const DEFAULT_DIALOG_WIDTH = 444;
const DEFAULT_DIALOG_HEIGHT = 438;
const MINIMUM_DIALOG_WIDTH = 360;
const MINIMUM_DIALOG_HEIGHT = 300;

const viewportSize = () => ({
  width: typeof window === 'undefined' ? 1_280 : window.innerWidth,
  height: typeof window === 'undefined' ? 720 : window.innerHeight,
});

const clampDialogRect = (rect: DialogRect): DialogRect => {
  const viewport = viewportSize();
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_GAP * 2);
  const availableHeight = Math.max(0, viewport.height - VIEWPORT_GAP * 2);
  const minimumWidth = Math.min(MINIMUM_DIALOG_WIDTH, availableWidth);
  const minimumHeight = Math.min(MINIMUM_DIALOG_HEIGHT, availableHeight);
  const width = Math.min(Math.max(minimumWidth, rect.width), availableWidth);
  const height = Math.min(Math.max(minimumHeight, rect.height), availableHeight);
  const maximumX = Math.max(VIEWPORT_GAP, viewport.width - width - VIEWPORT_GAP);
  const maximumY = Math.max(VIEWPORT_GAP, viewport.height - height - VIEWPORT_GAP);

  return {
    x: Math.max(VIEWPORT_GAP, Math.min(rect.x, maximumX)),
    y: Math.max(VIEWPORT_GAP, Math.min(rect.y, maximumY)),
    width,
    height,
  };
};

const centeredDialogRect = (): DialogRect => {
  const viewport = viewportSize();
  const width = Math.min(DEFAULT_DIALOG_WIDTH, Math.max(0, viewport.width - VIEWPORT_GAP * 2));
  const height = Math.min(DEFAULT_DIALOG_HEIGHT, Math.max(0, viewport.height - VIEWPORT_GAP * 2));
  return clampDialogRect({
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  });
};

const WEEKDAYS = [
  { key: 'sunday', label: 'Sunday', aliases: ['sun'] },
  { key: 'monday', label: 'Monday', aliases: ['mon'] },
  { key: 'tuesday', label: 'Tuesday', aliases: ['tue', 'tues'] },
  { key: 'wednesday', label: 'Wednesday', aliases: ['wed'] },
  { key: 'thursday', label: 'Thursday', aliases: ['thu', 'thur', 'thurs'] },
  { key: 'friday', label: 'Friday', aliases: ['fri'] },
  { key: 'saturday', label: 'Saturday', aliases: ['sat'] },
] as const;

type WeekdayKey = typeof WEEKDAYS[number]['key'];

export interface SymbolSpecificationSession {
  day: WeekdayKey;
  label: string;
  quotes: string[];
  trade: string[];
}

export interface SymbolSpecificationMarginRate {
  label: string;
  range: string | null;
  initial: number | null;
  maintenance: number | null;
  initialPerLot: number | null;
  maintenancePerLot: number | null;
  initialPerLotApproximate: boolean;
  maintenancePerLotApproximate: boolean;
  currency: string | null;
}

export interface SymbolSpecificationCommissionTier {
  label: string | null;
  range: string | null;
  value: string;
}

export interface SymbolSpecificationCommissionSchedule {
  title: string;
  description: string | null;
  tiers: SymbolSpecificationCommissionTier[];
}

export interface SymbolSpecificationMarginSpread {
  name: string;
  legA: string;
  legB: string;
  margin: string | null;
}

interface SymbolSpecificationMarginRateSection {
  rates: SymbolSpecificationMarginRate[];
  mode: string | null;
  basis: string | null;
  currency: string | null;
  asOf: number | string | null;
}

export interface SymbolSpecificationSnapshot {
  description: string | null;
  pageUrl: string | null;
  isin: string | null;
  category: string | null;
  exchange: string | null;
  cfi: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  digits: number | null;
  spread: number | null;
  spreadFloating: boolean | null;
  spreadMode: string | null;
  contractSize: number | null;
  contractSizeUnit: string | null;
  contractSizeDisplay: string | null;
  stopsLevel: number | null;
  freezeLevel: number | null;
  tickSize: number | null;
  tickValue: number | null;
  tickValueProfit: number | null;
  tickValueLoss: number | null;
  minVolume: number | null;
  maxVolume: number | null;
  volumeStep: number | null;
  volumeLimit: number | null;
  marginRate: number | null;
  marginInitial: number | null;
  marginMaintenance: number | null;
  marginHedged: number | null;
  marginHedgedUseLeg: boolean | null;
  swapLong: number | null;
  swapShort: number | null;
  swapMode: string | null;
  swapRolloverDay: string | null;
  swapRates: Partial<Record<WeekdayKey, number | string>>;
  commission: number | null;
  tradingEnabled: boolean | null;
  chartMode: string | null;
  tradeMode: string | null;
  calculationMode: string | null;
  executionMode: string | null;
  gtcMode: string | null;
  fillingMode: string | null;
  expirationMode: string | null;
  orderMode: string | null;
  baseCurrency: string | null;
  profitCurrency: string | null;
  marginCurrency: string | null;
  depositCurrency: string | null;
  subscription: string | null;
  ticksHistory: string | null;
  liquidityRate: number | null;
  sessions: SymbolSpecificationSession[];
  sessionTimeZone: string | null;
  marginRates: SymbolSpecificationMarginRate[];
  marginRatesMode: string | null;
  marginRatesBasis: string | null;
  marginRatesCurrency: string | null;
  marginRatesAsOf: number | string | null;
  startTime: number | string | null;
  expirationTime: number | string | null;
  faceValue: number | null;
  accruedInterest: number | null;
  optionMode: string | null;
  optionRight: string | null;
  underlying: string | null;
  optionStrike: number | null;
  commissionSchedules: SymbolSpecificationCommissionSchedule[];
  marginSpreads: SymbolSpecificationMarginSpread[];
}

interface DisplayRow {
  label: string;
  value: string | null;
  tone?: 'default' | 'positive' | 'negative';
  kind?: 'text' | 'integer' | 'decimal' | 'enum' | 'calendar';
}

const NESTED_SPECIFICATION_KEYS = [
  'brokerSpecification',
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

const normalizeSpecificationKey = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/^symbol[_-]?/, '')
  .replace(/[^a-z0-9]/g, '');

const collectSpecificationRecords = (value: unknown): Record<string, unknown>[] => {
  const root = asRecord(value);
  if (!root) return [];

  const records: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>([root]);
  const visit = (record: Record<string, unknown>, depth: number) => {
    // Rich nested broker snapshots are authoritative over normalized catalog
    // fields on their wrapper. Traverse them first and keep the walk bounded.
    if (depth < 3) {
      NESTED_SPECIFICATION_KEYS.forEach((key) => {
        const nested = asRecord(record[key]);
        if (!nested || seen.has(nested)) return;
        seen.add(nested);
        visit(nested, depth + 1);
      });
    }
    records.push(record);
  };
  visit(root, 0);

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

    // Some MT5 adapters expose the native SYMBOL_* property names while the
    // HTTP catalog uses snake_case or camelCase. Match those spellings without
    // making the rest of the parser depend on a particular adapter.
    const normalizedKeys = new Set(keys.map(normalizeSpecificationKey));
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined || value === null || value === '') continue;
      if (normalizedKeys.has(normalizeSpecificationKey(key))) return value;
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

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['true', 'yes', 'enabled', 'active', 'open', 'floating', '1'].includes(normalized)) return true;
  if (['false', 'no', 'disabled', 'inactive', 'closed', 'fixed', '0'].includes(normalized)) return false;
  return null;
};

const readBoolean = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
): boolean | null => parseBoolean(readRaw(records, keys));

const titleCase = (value: string): string => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/^SYMBOL_/i, '')
  .replace(/^(?:TRADE_CALC_MODE|CALC_MODE|TRADE_MODE|TRADE_EXECUTION|TRADE_EXEMODE|ORDER_GTC_MODE|ORDER_MODE|ORDERS|ORDER|FILLING|EXPIRATION|SWAP_MODE|CHART_MODE|OPTION_MODE|OPTION_RIGHT)_/i, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()
  .replace(/\b\w/g, (character) => character.toUpperCase())
  .replace(/\bCfd\b/g, 'CFD')
  .replace(/\bExch\b/g, 'Exchange')
  .replace(/\bForts\b/g, 'FORTS')
  .replace(/\bMoex\b/g, 'MOEX')
  .replace(/\bGtc\b/g, 'GTC')
  .replace(/\bFok\b/g, 'FOK')
  .replace(/\bIoc\b/g, 'IOC')
  .replace(/\bBoc\b/g, 'BOC')
  .replace(/\bCloseby\b/g, 'Close By');

const readMode = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
  numericLabels: Readonly<Record<number, string>>,
): string | null => {
  const value = readRaw(records, keys);
  if (value === undefined) return null;
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim())
      ? Number(value)
      : null;
  if (numeric !== null && Number.isFinite(numeric)) return numericLabels[numeric] ?? String(numeric);
  if (typeof value === 'string') return titleCase(value) || null;
  return null;
};

const decodeFlags = (
  value: unknown,
  labels: ReadonlyArray<readonly [number, string]>,
  options: { allMask?: number; zeroLabel?: string | null } = {},
): string | null => {
  if (Array.isArray(value)) {
    const values = value
      .map((item) => typeof item === 'string' ? titleCase(item) : String(item ?? '').trim())
      .filter(Boolean);
    return values.length > 0 ? values.join(', ') : null;
  }
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const values = value.split(/[,|]/).map((item) => titleCase(item)).filter(Boolean);
    return values.length > 0 ? values.join(', ') : null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (options.allMask !== undefined && (numeric & options.allMask) === options.allMask) return 'All';
  if (numeric === 0) return options.zeroLabel === undefined ? 'None' : options.zeroLabel;
  const values = labels.filter(([flag]) => (numeric & flag) === flag).map(([, label]) => label);
  return values.length > 0 ? values.join(', ') : String(numeric);
};

const findRecordValue = (record: Record<string, unknown>, aliases: readonly string[]): unknown => {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(record)) {
    if (normalizedAliases.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return value;
  }
  return undefined;
};

const normalizeWeekday = (value: unknown): WeekdayKey | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < WEEKDAYS.length) {
    return WEEKDAYS[value].key;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (/^[0-6]$/.test(normalized)) return WEEKDAYS[Number(normalized)].key;
  return WEEKDAYS.find((day) => day.key === normalized || day.label.toLowerCase() === normalized
    || day.aliases.some((alias) => alias === normalized))?.key ?? null;
};

const readDayValue = (record: Record<string, unknown>, day: typeof WEEKDAYS[number]): unknown => (
  findRecordValue(record, [day.key, day.label, ...day.aliases])
);

const buildSwapRates = (records: readonly Record<string, unknown>[]): Partial<Record<WeekdayKey, number | string>> => {
  const rates: Partial<Record<WeekdayKey, number | string>> = {};
  const candidate = readRaw(records, ['swap_rates', 'swapRates', 'swap_multipliers', 'swapMultipliers']);
  const candidateRecord = asRecord(candidate);

  if (candidateRecord) {
    WEEKDAYS.forEach((day) => {
      const value = readDayValue(candidateRecord, day);
      const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
      if (Number.isFinite(numeric)) rates[day.key] = numeric;
      else if (typeof value === 'string' && value.trim()) rates[day.key] = value.trim();
    });
  } else if (Array.isArray(candidate)) {
    candidate.forEach((entry) => {
      const record = asRecord(entry);
      if (!record) return;
      const day = normalizeWeekday(record.day ?? record.weekday ?? record.name);
      const value = record.rate ?? record.multiplier ?? record.value;
      if (!day) return;
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(numeric)) rates[day] = numeric;
      else if (typeof value === 'string' && value.trim()) rates[day] = value.trim();
    });
  }

  WEEKDAYS.forEach((day) => {
    if (rates[day.key] !== undefined) return;
    const value = readRaw(records, [
      `swap_rate_${day.key}`,
      `swapRate${day.label}`,
      `swap_${day.key}`,
      `${day.key}_swap_multiplier`,
    ]);
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) rates[day.key] = numeric;
    else if (typeof value === 'string' && value.trim()) rates[day.key] = value.trim();
  });

  if (Object.keys(rates).length === 0) {
    const rawRollover = readRaw(records, [
      'swap_rollover3days', 'swapRollover3Days', 'swap_rollover_day', 'swapRolloverDay',
      'swap_rollover_3days', 'swapRollover_3Days', 'swap_rollover3_days',
      'swap_3day', 'swap3Day', 'swap_3days', 'swap3Days',
      'triple_swap_day', 'tripleSwapDay', 'three_day_swap_day', 'threeDaySwapDay',
    ]);
    const rolloverDay = normalizeWeekday(rawRollover);
    if (rolloverDay) {
      (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const).forEach((dayKey) => {
        rates[dayKey] = dayKey === rolloverDay ? 3 : 1;
      });
      if (rolloverDay === 'sunday' || rolloverDay === 'saturday') {
        rates[rolloverDay] = 3;
      }
    }
  }

  return rates;
};

const formatClockValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) return formatClockValue(Number(trimmed));
    return trimmed || null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 86_400) {
    if (value === 86_400) return '24:00';
    const minutes = Math.floor(value / 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return String(value);
};

const formatSessionRanges = (value: unknown): string[] => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    if (
      value.length === 2
      && value.every((entry) => typeof entry === 'string' || typeof entry === 'number')
      && value.every((entry) => !String(entry).includes('-'))
    ) {
      const start = formatClockValue(value[0]);
      const end = formatClockValue(value[1]);
      if (start && end) return [`${start}-${end}`];
    }
    return value.flatMap(formatSessionRanges);
  }
  const record = asRecord(value);
  if (!record) {
    const formatted = formatClockValue(value);
    return formatted ? [formatted] : [];
  }

  const nested = record.sessions ?? record.ranges ?? record.periods;
  if (nested !== undefined) return formatSessionRanges(nested);
  const start = formatClockValue(
    record.start ?? record.from ?? record.open ?? record.start_time ?? record.startTime
      ?? record.start_seconds ?? record.startSeconds ?? record.open_seconds ?? record.openSeconds,
  );
  const end = formatClockValue(
    record.end ?? record.to ?? record.close ?? record.end_time ?? record.endTime
      ?? record.end_seconds ?? record.endSeconds ?? record.close_seconds ?? record.closeSeconds,
  );
  if (start && end) return [`${start}-${end}`];
  const valueText = formatClockValue(record.value ?? record.time);
  return valueText ? [valueText] : [];
};

const populateSessionsByDay = (
  target: Map<WeekdayKey, { quotes: string[]; trade: string[] }>,
  value: unknown,
  kind?: 'quotes' | 'trade',
): void => {
  const record = asRecord(value);
  if (record) {
    WEEKDAYS.forEach((day) => {
      const dayValue = readDayValue(record, day);
      if (dayValue === undefined) return;
      const row = target.get(day.key)!;
      const dayRecord = asRecord(dayValue);
      if (kind) {
        row[kind] = formatSessionRanges(dayValue);
      } else {
        const quotesValue = dayRecord
          ? findRecordValue(dayRecord, ['quotes', 'quote', 'quote_sessions', 'quoteSessions'])
          : undefined;
        const tradeValue = dayRecord
          ? findRecordValue(dayRecord, ['trade', 'trading', 'trade_sessions', 'tradeSessions'])
          : undefined;
        if (quotesValue !== undefined || tradeValue !== undefined) {
          row.quotes = formatSessionRanges(quotesValue);
          row.trade = formatSessionRanges(tradeValue);
        } else {
          // Some broker adapters expose one generic session range per day.
          // MT5 applies that range to both quote and trading sessions.
          const ranges = formatSessionRanges(dayValue);
          row.quotes = ranges;
          row.trade = ranges;
        }
      }
    });
    return;
  }

  if (!Array.isArray(value)) return;
  value.forEach((entry) => {
    const entryRecord = asRecord(entry);
    if (!entryRecord) return;
    const day = normalizeWeekday(
      entryRecord.day ?? entryRecord.weekday ?? entryRecord.day_of_week ?? entryRecord.dayOfWeek ?? entryRecord.name,
    );
    if (!day) return;
    const row = target.get(day)!;
    if (kind) {
      row[kind] = formatSessionRanges(
        entryRecord.sessions ?? entryRecord.ranges ?? entryRecord.periods ?? entryRecord.value ?? entryRecord,
      );
    } else {
      const quotesValue = entryRecord.quotes ?? entryRecord.quote ?? entryRecord.quote_sessions ?? entryRecord.quoteSessions;
      const tradeValue = entryRecord.trade ?? entryRecord.trading ?? entryRecord.trade_sessions ?? entryRecord.tradeSessions;
      if (quotesValue !== undefined || tradeValue !== undefined) {
        row.quotes = formatSessionRanges(quotesValue);
        row.trade = formatSessionRanges(tradeValue);
      } else {
        const ranges = formatSessionRanges(entryRecord);
        row.quotes = ranges;
        row.trade = ranges;
      }
    }
  });
};

const buildSessions = (records: readonly Record<string, unknown>[]): SymbolSpecificationSession[] => {
  const byDay = new Map<WeekdayKey, { quotes: string[]; trade: string[] }>(
    WEEKDAYS.map((day) => [day.key, { quotes: [], trade: [] }]),
  );
  populateSessionsByDay(byDay, readRaw(records, ['sessions', 'market_sessions', 'marketSessions']));
  populateSessionsByDay(byDay, readRaw(records, ['quote_sessions', 'quoteSessions', 'sessions_quotes', 'sessionsQuotes']), 'quotes');
  populateSessionsByDay(byDay, readRaw(records, ['trade_sessions', 'tradeSessions', 'sessions_trade', 'sessionsTrade']), 'trade');

  return WEEKDAYS.map((day) => ({ day: day.key, label: day.label, ...byDay.get(day.key)! }));
};

const readNullableNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatMarginRangeBound = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const raw = String(value);
    const [integer, fraction] = raw.split('.');
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const readMarginRange = (record: Record<string, unknown>): string | null => {
  const explicit = record.range_label ?? record.rangeLabel ?? record.notional_range
    ?? record.notionalRange ?? record.volume_range ?? record.volumeRange ?? record.range;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  if (Array.isArray(explicit) && explicit.length >= 2) {
    const from = formatMarginRangeBound(explicit[0]);
    const to = formatMarginRangeBound(explicit[1]);
    if (from && to) return `${from} - ${to}`;
  }

  const rangeRecord = asRecord(explicit);
  const from = formatMarginRangeBound(
    record.notional_from ?? record.notionalFrom ?? record.notional_value_from ?? record.notionalValueFrom
      ?? record.volume_from ?? record.volumeFrom ?? record.range_from ?? record.rangeFrom
      ?? record.turnover_from ?? record.turnoverFrom
      ?? record.minimum ?? record.min ?? record.from
      ?? rangeRecord?.from ?? rangeRecord?.minimum ?? rangeRecord?.min,
  );
  const to = formatMarginRangeBound(
    record.notional_to ?? record.notionalTo ?? record.notional_value_to ?? record.notionalValueTo
      ?? record.volume_to ?? record.volumeTo ?? record.range_to ?? record.rangeTo
      ?? record.turnover_to ?? record.turnoverTo
      ?? record.maximum ?? record.max ?? record.to
      ?? rangeRecord?.to ?? rangeRecord?.maximum ?? rangeRecord?.max,
  );
  if (from && to) return `${from} - ${to}`;
  if (from) return `>= ${from}`;
  if (to) return `<= ${to}`;
  return null;
};

const buildMarginRate = (
  value: unknown,
  fallbackLabel: string,
  inheritedCurrency: string | null,
): SymbolSpecificationMarginRate | null => {
  const record = asRecord(value);
  if (!record) return null;
  const labelValue = record.label ?? record.name ?? record.order_type ?? record.orderType ?? record.type;
  const label = typeof labelValue === 'string' && labelValue.trim() ? titleCase(labelValue) : titleCase(fallbackLabel);
  const initial = readNullableNumber(
    record.initial ?? record.initial_rate ?? record.initialRate
      ?? record.initial_margin_rate ?? record.initialMarginRate ?? record.rate,
  );
  const maintenance = readNullableNumber(
    record.maintenance ?? record.maintenance_rate ?? record.maintenanceRate
      ?? record.maintenance_margin_rate ?? record.maintenanceMarginRate,
  );
  const initialPerLot = readNullableNumber(
    record.initial_per_lot ?? record.initialPerLot ?? record.initial_value ?? record.initialValue
      ?? record.initial_margin_per_lot ?? record.initialMarginPerLot,
  );
  const maintenancePerLot = readNullableNumber(
    record.maintenance_per_lot ?? record.maintenancePerLot ?? record.maintenance_value ?? record.maintenanceValue
      ?? record.maintenance_margin_per_lot ?? record.maintenanceMarginPerLot,
  );
  const currencyValue = record.currency ?? record.margin_currency ?? record.marginCurrency;
  const currency = typeof currencyValue === 'string' && currencyValue.trim()
    ? currencyValue.trim()
    : inheritedCurrency;
  if ([initial, maintenance, initialPerLot, maintenancePerLot].every((entry) => entry === null)) return null;
  const sharedApproximate = parseBoolean(record.per_lot_approximate ?? record.perLotApproximate) ?? false;
  return {
    label,
    range: readMarginRange(record),
    initial,
    maintenance,
    initialPerLot,
    maintenancePerLot,
    initialPerLotApproximate: parseBoolean(
      record.initial_per_lot_approximate ?? record.initialPerLotApproximate,
    ) ?? sharedApproximate,
    maintenancePerLotApproximate: parseBoolean(
      record.maintenance_per_lot_approximate ?? record.maintenancePerLotApproximate,
    ) ?? sharedApproximate,
    currency,
  };
};

const MARGIN_RATE_METADATA_KEYS = new Set([
  'mode', 'marginmode', 'ratemode', 'schedulemode', 'floating', 'isfloating',
  'basis', 'marginbasis', 'ratebasis', 'notionalbasis', 'calculationbasis',
  'currency', 'currencycode', 'margincurrency',
  'asof', 'effectiveat', 'publishedat', 'calculatedat', 'timestamp',
].map(normalizeSpecificationKey));

const collectMarginRates = (
  value: unknown,
  fallbackLabel: string,
  inheritedCurrency: string | null,
): SymbolSpecificationMarginRate[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectMarginRates(entry, fallbackLabel, inheritedCurrency));
  }

  const record = asRecord(value);
  if (!record) return [];
  const recordCurrencyValue = record.currency ?? record.currency_code ?? record.currencyCode
    ?? record.margin_currency ?? record.marginCurrency;
  const recordCurrency = typeof recordCurrencyValue === 'string' && recordCurrencyValue.trim()
    ? recordCurrencyValue.trim()
    : inheritedCurrency;
  const direct = buildMarginRate(value, fallbackLabel, recordCurrency);
  if (direct) return [direct];

  const explicitLabel = record.label ?? record.name ?? record.order_type ?? record.orderType ?? record.type;
  const nestedLabel = typeof explicitLabel === 'string' && explicitLabel.trim()
    ? explicitLabel
    : fallbackLabel;
  const nestedRates = record.tiers ?? record.ranges ?? record.rates ?? record.values
    ?? record.groups ?? record.rows ?? record.entries;
  if (nestedRates !== undefined) return collectMarginRates(nestedRates, nestedLabel, recordCurrency);

  return Object.entries(record).flatMap(([key, entry]) => (
    MARGIN_RATE_METADATA_KEYS.has(normalizeSpecificationKey(key))
      ? []
      : collectMarginRates(entry, key, recordCurrency)
  ));
};

const readMarginRateDescriptor = (
  container: Record<string, unknown> | null,
  containerKeys: readonly string[],
  records: readonly Record<string, unknown>[],
  rootKeys: readonly string[],
): string | null => (
  (container ? readString([container], containerKeys) : null) ?? readString(records, rootKeys)
);

const buildMarginRateSection = (
  records: readonly Record<string, unknown>[],
): SymbolSpecificationMarginRateSection => {
  const value = readRaw(records, ['margin_rates', 'marginRates', 'order_margin_rates', 'orderMarginRates']);
  const container = asRecord(value);
  const explicitMode = readMarginRateDescriptor(
    container,
    ['mode', 'margin_mode', 'marginMode', 'rate_mode', 'rateMode', 'schedule_mode', 'scheduleMode'],
    records,
    ['margin_rates_mode', 'marginRatesMode', 'margin_rate_mode', 'marginRateMode'],
  );
  const floating = container
    ? readBoolean([container], ['floating', 'is_floating', 'isFloating'])
    : readBoolean(records, ['margin_rates_floating', 'marginRatesFloating']);
  const mode = explicitMode ?? (floating === null ? null : floating ? 'floating' : 'fixed');
  const basis = readMarginRateDescriptor(
    container,
    ['basis', 'margin_basis', 'marginBasis', 'rate_basis', 'rateBasis', 'notional_basis', 'notionalBasis', 'calculation_basis', 'calculationBasis'],
    records,
    ['margin_rates_basis', 'marginRatesBasis', 'margin_rate_basis', 'marginRateBasis'],
  );
  const currency = readMarginRateDescriptor(
    container,
    ['currency', 'currency_code', 'currencyCode', 'margin_currency', 'marginCurrency'],
    records,
    ['margin_rates_currency', 'marginRatesCurrency', 'margin_rate_currency', 'marginRateCurrency'],
  );
  const rawAsOf = (container
    ? readRaw([container], ['as_of', 'asOf', 'effective_at', 'effectiveAt', 'published_at', 'publishedAt', 'calculated_at', 'calculatedAt', 'timestamp'])
    : undefined) ?? readRaw(records, [
    'margin_rates_as_of', 'marginRatesAsOf', 'margin_rate_as_of', 'marginRateAsOf',
    'margin_rates_effective_at', 'marginRatesEffectiveAt',
  ]);
  const rates = collectMarginRates(value, 'Rate', currency);
  const rowCurrencies = [...new Set(rates.map((rate) => rate.currency).filter((entry): entry is string => Boolean(entry)))];
  const resolvedCurrency = currency ?? (rowCurrencies.length === 1 ? rowCurrencies[0] : null);

  return {
    rates: resolvedCurrency === currency
      ? rates
      : rates.map((rate) => ({ ...rate, currency: rate.currency ?? resolvedCurrency })),
    mode,
    basis,
    currency: resolvedCurrency,
    asOf: typeof rawAsOf === 'number' || typeof rawAsOf === 'string' ? rawAsOf : null,
  };
};

const displayScalar = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

const displayList = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const entries = value.map(displayScalar).filter((entry): entry is string => Boolean(entry));
    return entries.length > 0 ? entries.join(', ') : null;
  }
  return displayScalar(value);
};

const buildCommissionTier = (value: unknown): SymbolSpecificationCommissionTier | null => {
  const record = asRecord(value);
  if (!record) {
    const scalar = displayScalar(value);
    return scalar ? { label: null, range: null, value: scalar } : null;
  }

  const explicitDisplay = displayScalar(
    record.value_display ?? record.valueDisplay ?? record.display ?? record.description,
  );
  const amount = displayScalar(record.value ?? record.amount ?? record.rate ?? record.commission);
  const currency = displayScalar(record.currency ?? record.currency_code ?? record.currencyCode);
  const unit = displayScalar(record.unit ?? record.per ?? record.measure);
  const renderedValue = explicitDisplay ?? [amount, currency, unit].filter(Boolean).join(' ');
  if (!renderedValue) return null;
  return {
    label: displayScalar(record.label ?? record.name ?? record.type),
    range: readMarginRange(record),
    value: renderedValue,
  };
};

const buildCommissionSchedules = (
  records: readonly Record<string, unknown>[],
): SymbolSpecificationCommissionSchedule[] => {
  const raw = readRaw(records, [
    'commission_schedules', 'commissionSchedules', 'commissions', 'commission_schedule', 'commissionSchedule',
  ]);
  const scheduleValues = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const schedules = scheduleValues.flatMap((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      const tier = buildCommissionTier(entry);
      return tier ? [{ title: 'Commission', description: null, tiers: [tier] }] : [];
    }
    const nested = record.tiers ?? record.ranges ?? record.rows ?? record.entries;
    const tierValues = Array.isArray(nested) ? nested : nested === undefined ? [record] : [nested];
    const tiers = tierValues.flatMap((tierValue) => {
      if (Array.isArray(tierValue)) return tierValue.map(buildCommissionTier).filter((tier): tier is SymbolSpecificationCommissionTier => Boolean(tier));
      const tier = buildCommissionTier(tierValue);
      return tier ? [tier] : [];
    });
    if (tiers.length === 0) return [];
    const title = displayScalar(record.title ?? record.name ?? record.label) ?? (index === 0 ? 'Commission' : `Commission ${index + 1}`);
    const explicitDescription = displayScalar(record.description ?? record.summary);
    const descriptor = [
      displayScalar(record.charge_mode ?? record.chargeMode ?? record.timing),
      displayScalar(record.basis ?? record.calculation_basis ?? record.calculationBasis),
      displayScalar(record.direction ?? record.deal_direction ?? record.dealDirection),
    ].filter((part): part is string => Boolean(part)).map((part) => titleCase(part).toLowerCase()).join(', ');
    return [{ title, description: explicitDescription ?? (descriptor || null), tiers }];
  });

  if (schedules.length > 0) return schedules;
  const scalar = readRaw(records, ['commission', 'commission_per_lot', 'commissionPerLot']);
  const tier = buildCommissionTier(scalar);
  return tier ? [{ title: 'Commission', description: null, tiers: [tier] }] : [];
};

const buildMarginSpreads = (
  records: readonly Record<string, unknown>[],
): SymbolSpecificationMarginSpread[] => {
  const raw = readRaw(records, ['margin_spreads', 'marginSpreads', 'spread_definitions', 'spreadDefinitions', 'spreads']);
  const container = asRecord(raw);
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(container?.rows)
      ? container.rows
      : Array.isArray(container?.entries)
        ? container.entries
        : [];

  return values.flatMap((entry, index) => {
    const record = asRecord(entry);
    if (!record) return [];
    const legA = displayList(record.leg_a ?? record.legA ?? record.a ?? record.first_leg ?? record.firstLeg);
    const legB = displayList(record.leg_b ?? record.legB ?? record.b ?? record.second_leg ?? record.secondLeg);
    if (!legA || !legB) return [];
    const explicitMargin = displayScalar(record.margin_display ?? record.marginDisplay ?? record.margin);
    const marginType = displayScalar(record.margin_type ?? record.marginType ?? record.type);
    const initial = displayScalar(record.initial_margin ?? record.initialMargin ?? record.initial);
    const maintenance = displayScalar(record.maintenance_margin ?? record.maintenanceMargin ?? record.maintenance);
    const currency = displayScalar(record.currency);
    const valuesText = initial || maintenance
      ? [initial ?? '', maintenance ?? '', currency].filter(Boolean).join(' / ')
      : null;
    return [{
      name: displayScalar(record.name ?? record.label ?? record.title) ?? `Spread ${index + 1}`,
      legA,
      legB,
      margin: explicitMargin ?? ([marginType ? titleCase(marginType) : null, valuesText].filter(Boolean).join(': ') || null),
    }];
  });
};

const CALCULATION_MODES: Readonly<Record<number, string>> = {
  0: 'Forex',
  1: 'Futures',
  2: 'CFD',
  3: 'CFD Index',
  4: 'CFD Leverage',
  5: 'Forex no leverage',
  32: 'Exchange stocks',
  33: 'Exchange futures',
  34: 'Exchange options',
  35: 'Exchange futures FORTS',
  36: 'Exchange options margin',
  37: 'Exchange bonds',
  38: 'Exchange stocks MOEX',
  39: 'Exchange bonds MOEX',
  64: 'Collateral',
};

const SWAP_MODES: Readonly<Record<number, string>> = {
  0: 'Disabled',
  1: 'In points',
  2: 'Base currency',
  3: 'Margin currency',
  4: 'Deposit currency',
  5: 'Interest current price',
  6: 'Interest open price',
  7: 'Reopen close price',
  8: 'Reopen Bid price',
  9: 'Profit currency',
};

const readSwapMode = (
  records: readonly Record<string, unknown>[],
  currencies: { base: string | null; margin: string | null; profit: string | null; deposit: string | null },
): string | null => {
  const resolved = readString(records, ['swap_type_display', 'swapTypeDisplay', 'swap_display', 'swapDisplay']);
  if (resolved) return resolved;
  const raw = readRaw(records, ['swap_mode', 'swapMode', 'swap_type', 'swapType']);
  const numeric = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^-?\d+$/.test(raw.trim())
      ? Number(raw)
      : null;
  const enumName = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (enumName === 'POINTS' || enumName === 'IN_POINTS' || enumName === 'IN POINTS' || enumName.endsWith('_POINTS')) return 'In points';
  if (enumName.includes('CURRENCY_SYMBOL') && currencies.base) return currencies.base;
  if (enumName.includes('CURRENCY_MARGIN') && currencies.margin) return currencies.margin;
  if (enumName.includes('CURRENCY_DEPOSIT') && currencies.deposit) return currencies.deposit;
  if (enumName.includes('CURRENCY_PROFIT') && currencies.profit) return currencies.profit;
  if (numeric === 2 && currencies.base) return currencies.base;
  if (numeric === 3 && currencies.margin) return currencies.margin;
  if (numeric === 4 && currencies.deposit) return currencies.deposit;
  if (numeric === 9 && currencies.profit) return currencies.profit;
  return readMode(records, ['swap_mode', 'swapMode', 'swap_type', 'swapType'], SWAP_MODES);
};

const readSwapRolloverDay = (records: readonly Record<string, unknown>[]): string | null => {
  const value = readRaw(records, [
    'swap_rollover3days', 'swapRollover3Days', 'swap_rollover_day', 'swapRolloverDay',
    'swap_rollover_3days', 'swapRollover_3Days', 'swap_rollover3_days',
    'swap_3day', 'swap3Day', 'swap_3days', 'swap3Days',
    'triple_swap_day', 'tripleSwapDay', 'three_day_swap_day', 'threeDaySwapDay',
  ]);
  const day = normalizeWeekday(value);
  return day ? WEEKDAYS.find((entry) => entry.key === day)!.label : typeof value === 'string' ? titleCase(value) : null;
};

const readSpecificationDescription = (records: readonly Record<string, unknown>[]): string | null => {
  const symbolFromRecords = readString(records, ['symbol', 'id']) ?? '';
  const keys = ['description', 'display_name', 'displayName', 'full_name', 'fullName'] as const;
  const normalizedKeys = new Set(keys.map(normalizeSpecificationKey));

  for (const record of records) {
    const recordSymbol = typeof record.symbol === 'string' && record.symbol.trim()
      ? record.symbol.trim()
      : symbolFromRecords;
    for (const key of keys) {
      const value = record[key];
      if (typeof value !== 'string') continue;
      const normalized = normalizeSymbolDescriptionText(recordSymbol, value);
      if (normalized) return normalized;
    }
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== 'string' || !normalizedKeys.has(normalizeSpecificationKey(key))) continue;
      const normalized = normalizeSymbolDescriptionText(recordSymbol, value);
      if (normalized) return normalized;
    }
    if (recordSymbol && typeof record.name === 'string') {
      const normalized = normalizeSymbolDescriptionText(recordSymbol, record.name);
      if (normalized) return normalized;
    }
  }
  return null;
};

// Exported for contract-level tests; it is a pure broker-payload normalizer.
// eslint-disable-next-line react-refresh/only-export-components
export const buildSymbolSpecificationSnapshot = (
  instrument?: unknown,
  fallbackInstrument?: unknown,
): SymbolSpecificationSnapshot => {
  const records = collectSpecificationRecords(instrument);
  const identityRecords = [
    ...records,
    ...collectSpecificationRecords(fallbackInstrument),
  ];
  const digits = readNumber(records, ['digits', 'precision', 'pip_position', 'pipPosition']);
  const tradeMode = readMode(records, ['trade_mode', 'tradeMode'], {
    0: 'Disabled', 1: 'Long only', 2: 'Short only', 3: 'Close only', 4: 'Full access',
  });
  const tradingEnabled = readBoolean(records, [
    'trading_enabled', 'tradingEnabled', 'enabled', 'is_enabled', 'isEnabled', 'status',
  ]);
  const rawFillingMode = readRaw(records, ['filling_mode', 'fillingMode', 'trade_fill_flags', 'tradeFillFlags']);
  const rawExpirationMode = readRaw(records, ['expiration_mode', 'expirationMode', 'order_expiration_flags', 'orderExpirationFlags']);
  const rawOrderMode = readRaw(records, ['order_mode', 'orderMode', 'order_flags', 'orderFlags']);
  const rawStartTime = readRaw(records, ['start_time', 'startTime']);
  const rawExpirationTime = readRaw(records, ['expiration_time', 'expirationTime']);
  const marginRateSection = buildMarginRateSection(records);
  const baseCurrency = readString(records, ['currency_base', 'currencyBase', 'base_currency', 'baseCurrency']);
  const profitCurrency = readString(records, ['currency_profit', 'currencyProfit', 'profit_currency', 'profitCurrency']);
  const marginCurrency = readString(records, ['currency_margin', 'currencyMargin', 'margin_currency', 'marginCurrency']);
  const depositCurrency = readString(records, ['currency_deposit', 'currencyDeposit', 'deposit_currency', 'depositCurrency', 'account_currency', 'accountCurrency']);

  return {
    description: readSpecificationDescription(identityRecords),
    pageUrl: readString(identityRecords, ['page_url', 'pageUrl', 'page', 'information_url', 'informationUrl']),

    isin: readString(records, ['isin']),
    category: readString(records, ['category', 'asset_class', 'assetClass', 'type']),
    exchange: readString(records, ['exchange', 'exchange_name', 'exchangeName', 'exchange_id', 'exchangeId']),
    cfi: readString(records, ['cfi', 'classification_of_financial_instruments', 'classificationOfFinancialInstruments']),
    sector: readString(records, ['sector', 'sector_name', 'sectorName']),
    industry: readString(records, ['industry', 'industry_name', 'industryName']),
    country: readString(records, ['country', 'country_name', 'countryName']),
    digits: digits === null ? null : Math.max(0, Math.min(12, Math.trunc(digits))),
    spread: readNumber(records, ['spread', 'spread_points', 'spreadPoints']),
    spreadFloating: readBoolean(records, [
      'spread_float', 'spreadFloat', 'spread_floating', 'spreadFloating',
      'is_spread_floating', 'isSpreadFloating', 'spread_is_floating', 'spreadIsFloating',
      'floating_spread', 'floatingSpread',
    ]),
    spreadMode: readString(records, ['spread_mode', 'spreadMode', 'spread_type', 'spreadType']),
    contractSize: readNumber(records, ['contract_size', 'contractSize', 'trade_contract_size', 'tradeContractSize']),
    contractSizeUnit: readString(records, ['contract_size_unit', 'contractSizeUnit', 'contract_unit', 'contractUnit']),
    contractSizeDisplay: readString(records, ['contract_size_display', 'contractSizeDisplay']),
    stopsLevel: readNumber(records, ['stops_level', 'stopsLevel', 'trade_stops_level', 'tradeStopsLevel']),
    freezeLevel: readNumber(records, ['freeze_level', 'freezeLevel', 'trade_freeze_level', 'tradeFreezeLevel']),
    tickSize: readNumber(records, ['tick_size', 'tickSize', 'trade_tick_size', 'tradeTickSize', 'point_size', 'pointSize', 'point']),
    tickValue: readNumber(records, ['tick_value', 'tickValue', 'trade_tick_value', 'tradeTickValue']),
    tickValueProfit: readNumber(records, ['tick_value_profit', 'tickValueProfit', 'trade_tick_value_profit', 'tradeTickValueProfit']),
    tickValueLoss: readNumber(records, ['tick_value_loss', 'tickValueLoss', 'trade_tick_value_loss', 'tradeTickValueLoss']),
    minVolume: readNumber(records, ['volume_min', 'min_volume', 'minVolume', 'min_lot', 'minLot', 'lot_min', 'lotMin', 'lots_min', 'lotsMin']),
    maxVolume: readNumber(records, ['volume_max', 'max_volume', 'maxVolume', 'max_lot', 'maxLot', 'lot_max', 'lotMax', 'lots_max', 'lotsMax']),
    volumeStep: readNumber(records, ['volume_step', 'volumeStep', 'lot_step', 'lotStep', 'lots_step', 'lotsStep']),
    volumeLimit: readNumber(records, ['volume_limit', 'volumeLimit', 'lot_limit', 'lotLimit']),
    marginRate: readNumber(records, ['margin_rate', 'marginRate']),
    marginInitial: readNumber(records, ['margin_initial', 'marginInitial', 'initial_margin', 'initialMargin']),
    marginMaintenance: readNumber(records, ['margin_maintenance', 'marginMaintenance', 'maintenance_margin', 'maintenanceMargin']),
    marginHedged: readNumber(records, ['margin_hedged', 'marginHedged', 'hedged_margin', 'hedgedMargin']),
    marginHedgedUseLeg: readBoolean(records, ['margin_hedged_use_leg', 'marginHedgedUseLeg', 'hedged_margin_use_leg', 'hedgedMarginUseLeg']),
    swapLong: readNumber(records, ['swap_long', 'swapLong']),
    swapShort: readNumber(records, ['swap_short', 'swapShort']),
    swapMode: readSwapMode(records, {
      base: baseCurrency,
      margin: marginCurrency,
      profit: profitCurrency,
      deposit: depositCurrency,
    }),
    swapRolloverDay: readSwapRolloverDay(records),
    swapRates: buildSwapRates(records),
    commission: readNumber(records, ['commission', 'commission_per_lot', 'commissionPerLot']),
    tradingEnabled,
    chartMode: readMode(records, ['chart_mode', 'chartMode'], { 0: 'By bid price', 1: 'By last price' }),
    tradeMode,
    calculationMode: readMode(records, [
      'trade_calc_mode', 'tradeCalcMode', 'calculation_mode', 'calculationMode', 'calc_mode', 'calcMode',
    ], CALCULATION_MODES),
    executionMode: readMode(records, ['trade_exemode', 'tradeExeMode', 'trade_execution', 'tradeExecution', 'execution_mode', 'executionMode'], {
      0: 'Request', 1: 'Instant', 2: 'Market', 3: 'Exchange',
    }),
    gtcMode: readMode(records, ['order_gtc_mode', 'orderGtcMode', 'gtc_mode', 'gtcMode'], {
      0: 'Good till cancelled', 1: 'Good till today including SL/TP', 2: 'Good till today excluding SL/TP',
    }),
    fillingMode: rawFillingMode === undefined ? null : decodeFlags(rawFillingMode, [
      [1, 'Fill or Kill'], [2, 'Immediate or Cancel'], [4, 'Book or Cancel'],
    ], { zeroLabel: null }),
    expirationMode: rawExpirationMode === undefined ? null : decodeFlags(rawExpirationMode, [
      [1, 'GTC'], [2, 'Intraday'], [4, 'Specified time'], [8, 'Date'],
    ], { allMask: 15 }),
    orderMode: rawOrderMode === undefined ? null : decodeFlags(rawOrderMode, [
      [1, 'Market'], [2, 'Limit'], [4, 'Stop'], [8, 'Stop limit'], [16, 'Stop Loss'], [32, 'Take Profit'], [64, 'Close By'],
    ], { allMask: 127 }),
    baseCurrency,
    profitCurrency,
    marginCurrency,
    depositCurrency,
    subscription: readString(records, ['subscription', 'subscription_status', 'subscriptionStatus']),
    ticksHistory: readString(records, ['ticks_history', 'ticksHistory', 'tick_history', 'tickHistory']),
    liquidityRate: readNumber(records, ['trade_liquidity_rate', 'tradeLiquidityRate', 'liquidity_rate', 'liquidityRate']),
    sessions: buildSessions(records),
    sessionTimeZone: readString(records, ['session_time_zone', 'sessionTimeZone', 'server_time_zone', 'serverTimeZone']),
    marginRates: marginRateSection.rates,
    marginRatesMode: marginRateSection.mode,
    marginRatesBasis: marginRateSection.basis,
    marginRatesCurrency: marginRateSection.currency,
    marginRatesAsOf: marginRateSection.asOf,
    startTime: typeof rawStartTime === 'number' || typeof rawStartTime === 'string' ? rawStartTime : null,
    expirationTime: typeof rawExpirationTime === 'number' || typeof rawExpirationTime === 'string' ? rawExpirationTime : null,
    faceValue: readNumber(records, ['trade_face_value', 'tradeFaceValue', 'face_value', 'faceValue']),
    accruedInterest: readNumber(records, ['trade_accrued_interest', 'tradeAccruedInterest', 'accrued_interest', 'accruedInterest']),
    optionMode: readMode(records, ['option_mode', 'optionMode'], { 0: 'European', 1: 'American' }),
    optionRight: readMode(records, ['option_right', 'optionRight'], { 0: 'Call', 1: 'Put' }),
    underlying: readString(records, ['underlying', 'basis', 'underlying_symbol', 'underlyingSymbol']),
    optionStrike: readNumber(records, ['option_strike', 'optionStrike']),
    commissionSchedules: buildCommissionSchedules(records),
    marginSpreads: buildMarginSpreads(records),
  };
};

const formatNumber = (value: number | null, maximumFractionDigits = 12): string | null => (
  value === null
    ? null
    : new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, {
      useGrouping: false,
      maximumFractionDigits,
    }).format(value)
);

const formatGroupedNumber = (
  value: number | null,
  minimumFractionDigits = 0,
  maximumFractionDigits = 12,
): string | null => (
  value === null
    ? null
    : new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, {
      useGrouping: true,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value)
);

const formatDate = (value: number | string | null): string | null => {
  if (value === null || value === '') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return value;
    value = parsed;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(timestamp));
};

const formatSpread = (snapshot: SymbolSpecificationSnapshot): string | null => {
  const normalizedMode = snapshot.spreadMode?.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (snapshot.spreadFloating === true || ['floating', 'variable', 'dynamic'].includes(normalizedMode ?? '')) {
    return 'floating';
  }
  if (snapshot.spread !== null) return formatNumber(snapshot.spread);
  if (snapshot.spreadFloating === false || normalizedMode === 'fixed') return 'fixed';
  return snapshot.spreadMode;
};

const formatContractSize = (snapshot: SymbolSpecificationSnapshot): string | null => {
  if (snapshot.contractSizeDisplay) return snapshot.contractSizeDisplay;
  if (snapshot.contractSize === null) return null;
  const formatted = formatGroupedNumber(snapshot.contractSize) ?? '';
  const forexUnit = snapshot.calculationMode?.toLowerCase().startsWith('forex')
    ? snapshot.baseCurrency
    : null;
  const unit = snapshot.contractSizeUnit ?? forexUnit;
  return `${formatted}${unit ? ` ${unit}` : ''}`;
};

const safeWebUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const PropertyMarker = ({ kind = 'text', selected = false }: { kind?: DisplayRow['kind']; selected?: boolean }) => {
  if (kind === 'enum') {
    return (
      <span className="flex h-3 w-3 shrink-0 flex-col justify-center gap-[1.5px]" aria-hidden="true">
        <span className={`h-[1.5px] w-3 ${selected ? 'bg-white/90' : 'bg-[#2d8ceb]'}`} />
        <span className={`h-[1.5px] w-3 ${selected ? 'bg-[#ff9b9b]' : 'bg-[#e04b4b]'}`} />
        <span className={`h-[1.5px] w-3 ${selected ? 'bg-white/90' : 'bg-[#2d8ceb]'}`} />
      </span>
    );
  }
  if (kind === 'calendar') {
    return (
      <span
        className={`relative h-[11px] w-3 shrink-0 border ${selected ? 'border-white/90' : 'border-[#2d8ceb]'}`}
        aria-hidden="true"
      >
        <span className={`absolute left-0 top-[2px] h-px w-full ${selected ? 'bg-white/90' : 'bg-[#2d8ceb]'}`} />
      </span>
    );
  }
  return (
    <span
      className={`w-3 shrink-0 text-center font-sans text-[9px] font-semibold leading-3 ${
        selected
          ? 'text-white'
          : kind === 'text'
            ? 'text-[#d49b38]'
            : 'text-[#2d8ceb]'
      }`}
      aria-hidden="true"
    >
      {kind === 'integer' ? '01' : kind === 'decimal' ? '½' : 'ab'}
    </span>
  );
};

const PropertyRows = ({
  rows,
  rowKeyPrefix = 'prop',
  selectedRowKey = null,
  onSelectRow,
  startStripeIndex = 0,
}: {
  rows: DisplayRow[];
  rowKeyPrefix?: string;
  selectedRowKey?: string | null;
  onSelectRow?: (key: string) => void;
  startStripeIndex?: number;
}) => {
  const tr = useUiTranslation();
  const availableRows = rows.filter((row): row is DisplayRow & { value: string } => row.value !== null);
  if (availableRows.length === 0) return null;

  return (
    <dl className="rtx-symbol-specification__rows m-0">
      {availableRows.map((row, index) => {
        const rowKey = `${rowKeyPrefix}:${row.label}`;
        const isSelected = selectedRowKey === rowKey;
        const isEven = (startStripeIndex + index) % 2 === 0;
        return (
          <div
            key={row.label}
            data-selected={isSelected ? 'true' : undefined}
            data-stripe={isEven ? 'even' : 'odd'}
            onClick={() => onSelectRow?.(rowKey)}
            className={`rtx-spec-row grid min-h-[20px] grid-cols-[40%_60%] items-center border-b border-[var(--mw-spec-grid,var(--border-primary))] last:border-b-0 ${
              isSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : ''
            }`}
          >
            <dt
              className={`flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-[12px] leading-[16px] ${
                isSelected ? 'text-white' : 'text-[var(--text-primary)]'
              }`}
            >
              <PropertyMarker kind={row.kind} selected={isSelected} />
              <span className="truncate">{tr(row.label)}</span>
            </dt>
            <dd
              className={`m-0 truncate border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right text-[12px] font-normal leading-[16px] tabular-nums ${
                isSelected
                  ? 'text-white'
                  : row.tone === 'positive'
                    ? 'text-[var(--color-profit)]'
                    : row.tone === 'negative'
                      ? 'text-[var(--color-loss)]'
                      : 'text-[var(--text-primary)]'
              }`}
              title={row.value}
            >
              {row.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

const SectionHeading = ({
  children,
  rowKey,
  selectedRowKey,
  onSelectRow,
}: {
  children: React.ReactNode;
  rowKey?: string;
  selectedRowKey?: string | null;
  onSelectRow?: (key: string) => void;
}) => {
  const isSelected = Boolean(rowKey && selectedRowKey === rowKey);
  return (
    <div
      data-selected={isSelected ? 'true' : undefined}
      onClick={rowKey ? () => onSelectRow?.(rowKey) : undefined}
      className={`rtx-spec-row rtx-spec-row--heading grid min-h-[20px] grid-cols-[40%_60%] items-center border-y border-[var(--mw-spec-grid,var(--border-primary))] text-[12px] font-semibold leading-4 first:border-t-0 ${
        isSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
      }`}
    >
      <div className="truncate px-1.5 py-0.5">{children}</div>
      <div className="h-full border-l border-[var(--mw-spec-grid,var(--border-primary))]" aria-hidden="true" />
    </div>
  );
};

const SessionTable = ({
  sessions,
  timeZone,
  selectedRowKey,
  onSelectRow,
}: {
  sessions: SymbolSpecificationSession[];
  timeZone: string | null;
  selectedRowKey?: string | null;
  onSelectRow?: (key: string) => void;
}) => {
  const tr = useUiTranslation();
  const headerKey = 'sessions:header';
  const isHeaderSelected = selectedRowKey === headerKey;
  return (
    <section aria-label={tr('Sessions')} title={timeZone ? `${tr('Broker server time')}: ${timeZone}` : undefined}>
      <table className="w-full table-fixed border-collapse text-[12px]">
        <thead>
          <tr
            data-selected={isHeaderSelected ? 'true' : undefined}
            onClick={() => onSelectRow?.(headerKey)}
            className={`rtx-spec-row rtx-spec-row--heading h-[20px] border-y border-[var(--mw-spec-grid,var(--border-primary))] ${
              isHeaderSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
            }`}
          >
            <th className="w-[40%] px-1.5 py-0.5 text-left font-semibold" scope="col">
              {tr('Sessions')}{timeZone ? <span className={`ml-1 font-normal ${isHeaderSelected ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}>({timeZone})</span> : null}
            </th>
            <th className="w-[30%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{tr('Quotes')}</th>
            <th className="w-[30%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{tr('Trade')}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, index) => {
            const rowKey = `session:${session.day}`;
            const isSelected = selectedRowKey === rowKey;
            return (
              <tr
                key={session.day}
                data-selected={isSelected ? 'true' : undefined}
                data-stripe={index % 2 === 0 ? 'even' : 'odd'}
                onClick={() => onSelectRow?.(rowKey)}
                className={`rtx-spec-row h-[20px] border-b border-[var(--mw-spec-grid,var(--border-primary))] last:border-b-0 ${
                  isSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
                }`}
              >
                <th className="px-1.5 py-0.5 text-left font-normal" scope="row">
                  <span className="flex items-center gap-1.5">
                    <PropertyMarker kind="calendar" selected={isSelected} />
                    {tr(session.label)}
                  </span>
                </th>
                <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">
                  {session.quotes.length > 0 ? session.quotes.join(', ') : '0'}
                </td>
                <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">
                  {session.trade.length > 0 ? session.trade.join(', ') : '0'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
};

const CommissionTable = ({
  schedules,
  selectedRowKey,
  onSelectRow,
}: {
  schedules: SymbolSpecificationCommissionSchedule[];
  selectedRowKey?: string | null;
  onSelectRow?: (key: string) => void;
}) => {
  const tr = useUiTranslation();
  if (schedules.length === 0) return null;
  return (
    <section aria-label={tr('Commission')}>
      {schedules.map((schedule, scheduleIndex) => (
        <div key={`${schedule.title}-${scheduleIndex}`}>
          <SectionHeading
            rowKey={`commission-heading:${scheduleIndex}`}
            selectedRowKey={selectedRowKey}
            onSelectRow={onSelectRow}
          >
            {tr(schedule.title)}{schedule.description ? ` | ${schedule.description}` : ''}
          </SectionHeading>
          <dl className="m-0">
            {schedule.tiers.map((tier, tierIndex) => {
              const label = tier.range ?? tier.label ?? tr('Commission');
              const rowKey = `commission:${scheduleIndex}:${tierIndex}`;
              const isSelected = selectedRowKey === rowKey;
              return (
                <div
                  key={`${label}-${tierIndex}`}
                  data-selected={isSelected ? 'true' : undefined}
                  data-stripe={tierIndex % 2 === 0 ? 'even' : 'odd'}
                  onClick={() => onSelectRow?.(rowKey)}
                  className={`rtx-spec-row grid min-h-[20px] grid-cols-[40%_60%] items-center border-b border-[var(--mw-spec-grid,var(--border-primary))] last:border-b-0 ${
                    isSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
                  }`}
                >
                  <dt className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-[12px]">
                    <PropertyMarker kind="decimal" selected={isSelected} />
                    <span className="truncate">{label}</span>
                  </dt>
                  <dd className="m-0 truncate border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right text-[12px] font-normal tabular-nums" title={tier.value}>
                    {tier.value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </section>
  );
};

const MarginSpreadsTable = ({
  spreads,
  selectedRowKey,
  onSelectRow,
}: {
  spreads: SymbolSpecificationMarginSpread[];
  selectedRowKey?: string | null;
  onSelectRow?: (key: string) => void;
}) => {
  const tr = useUiTranslation();
  if (spreads.length === 0) return null;
  return (
    <section aria-label={tr('Spreads')}>
      <table className="w-full table-fixed border-collapse text-[12px]">
        <thead>
          <tr className="rtx-spec-row rtx-spec-row--heading h-[20px] border-y border-[var(--mw-spec-grid,var(--border-primary))] text-[var(--text-primary)]">
            <th className="w-[40%] px-1.5 py-0.5 text-left font-semibold" scope="col">{tr('Spreads')}</th>
            <th className="w-[20%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-left font-semibold" scope="col">{tr('Leg A')}</th>
            <th className="w-[20%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-left font-semibold" scope="col">{tr('Leg B')}</th>
            <th className="w-[20%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{tr('Margin')}</th>
          </tr>
        </thead>
        <tbody>
          {spreads.map((spread, index) => {
            const rowKey = `spread:${index}`;
            const isSelected = selectedRowKey === rowKey;
            return (
              <tr
                key={`${spread.name}-${index}`}
                data-selected={isSelected ? 'true' : undefined}
                data-stripe={index % 2 === 0 ? 'even' : 'odd'}
                onClick={() => onSelectRow?.(rowKey)}
                className={`rtx-spec-row h-[20px] border-b border-[var(--mw-spec-grid,var(--border-primary))] last:border-b-0 ${
                  isSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
                }`}
              >
                <th className="px-1.5 py-0.5 text-left font-normal" scope="row">{spread.name}</th>
                <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-left">{spread.legA}</td>
                <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-left">{spread.legB}</td>
                <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">{spread.margin ?? '0'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
};

const formatMarginHeadingPart = (value: string): string => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const DEFAULT_FALLBACK_MARGIN_RATES: readonly SymbolSpecificationMarginRate[] = [
  {
    label: 'Market Buy',
    range: null,
    initial: null,
    maintenance: null,
    initialPerLot: null,
    maintenancePerLot: null,
    initialPerLotApproximate: false,
    maintenancePerLotApproximate: false,
    currency: null,
  },
  {
    label: 'Market Sell',
    range: null,
    initial: null,
    maintenance: null,
    initialPerLot: null,
    maintenancePerLot: null,
    initialPerLotApproximate: false,
    maintenancePerLotApproximate: false,
    currency: null,
  },
];

const MarginRatesTable = ({
  rates,
  mode,
  basis,
  currency,
  asOf,
  selectedRowKey,
  onSelectRow,
}: {
  rates: SymbolSpecificationMarginRate[];
  mode: string | null;
  basis: string | null;
  currency: string | null;
  asOf: number | string | null;
  selectedRowKey?: string | null;
  onSelectRow?: (key: string) => void;
}) => {
  const tr = useUiTranslation();
  const effectiveRates = rates.length > 0 ? rates : DEFAULT_FALLBACK_MARGIN_RATES;
  const headingDetails = [mode, basis]
    .filter((value): value is string => Boolean(value))
    .map(formatMarginHeadingPart);
  if (currency) headingDetails.push(currency.toUpperCase());
  const heading = headingDetails.length > 0
    ? `${tr('Margin rates')}: ${headingDetails.join(', ')}`
    : tr('Margin rates');
  const asOfText = formatDate(asOf);
  const perLotHeading = currency ? `${currency.toLowerCase()} / lot` : 'usd / lot';
  const formatPerLot = (value: number | null, rowCurrency: string | null, approximate: boolean): string => {
    if (value === null) return '0';
    const formatted = formatGroupedNumber(value, 2, 2) ?? '0';
    const prefixed = `${approximate ? '~' : ''}${formatted}`;
    if (!rowCurrency || rowCurrency.toUpperCase() === currency?.toUpperCase()) return prefixed;
    return `${prefixed} ${rowCurrency}`;
  };
  const headerKey = 'margin-rates:header';
  const isHeaderSelected = selectedRowKey === headerKey;

  return (
    <section aria-label={tr('Margin rates')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] table-fixed border-collapse text-[12px]">
          <thead>
            <tr
              data-selected={isHeaderSelected ? 'true' : undefined}
              onClick={() => onSelectRow?.(headerKey)}
              className={`rtx-spec-row rtx-spec-row--heading min-h-[20px] border-y border-[var(--mw-spec-grid,var(--border-primary))] ${
                isHeaderSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
              }`}
            >
              <th className="w-[40%] px-1.5 py-0.5 text-left font-semibold" scope="col" title={heading}>
                <span className="block truncate">{heading}</span>
                {asOfText && (
                  <span className={`block truncate text-[10px] font-normal ${isHeaderSelected ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}>
                    {tr('As of')} {asOfText}
                  </span>
                )}
              </th>
              <th className="w-[15%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{tr('Initial')}</th>
              <th className="w-[15%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{perLotHeading}</th>
              <th className="w-[15%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{tr('Maintenance')}</th>
              <th className="w-[15%] border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right font-semibold" scope="col">{perLotHeading}</th>
            </tr>
          </thead>
          <tbody>
            {effectiveRates.map((rate, index) => {
              const groupStart = Boolean(rate.range) && (index === 0 || effectiveRates[index - 1]?.label !== rate.label);
              const groupKey = `margin-group:${rate.label}:${index}`;
              const isGroupSelected = selectedRowKey === groupKey;
              const rowKey = `margin-rate:${rate.label}:${rate.range ?? 'all'}:${index}`;
              const isRowSelected = selectedRowKey === rowKey;
              return (
                <React.Fragment key={`${rate.label}-${rate.range ?? 'all'}-${index}`}>
                  {groupStart && (
                    <tr
                      data-selected={isGroupSelected ? 'true' : undefined}
                      onClick={() => onSelectRow?.(groupKey)}
                      className={`rtx-spec-row h-[20px] border-b border-[var(--mw-spec-grid,var(--border-primary))] ${
                        isGroupSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      <th className="px-1.5 py-0.5 text-left font-normal" scope="rowgroup">
                        <span className="flex items-center gap-1.5">
                          <PropertyMarker kind="decimal" selected={isGroupSelected} />
                          {tr(rate.label)}
                        </span>
                      </th>
                      <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))]" aria-hidden="true" />
                      <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))]" aria-hidden="true" />
                      <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))]" aria-hidden="true" />
                      <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))]" aria-hidden="true" />
                    </tr>
                  )}
                  <tr
                    data-selected={isRowSelected ? 'true' : undefined}
                    data-stripe={index % 2 === 0 ? 'even' : 'odd'}
                    onClick={() => onSelectRow?.(rowKey)}
                    className={`rtx-spec-row h-[20px] border-b border-[var(--mw-spec-grid,var(--border-primary))] last:border-b-0 ${
                      isRowSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    <th className={`px-1.5 py-0.5 text-left font-normal ${rate.range ? 'pl-5 tabular-nums' : ''}`} scope="row">
                      {rate.range ? (
                        rate.range
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <PropertyMarker kind="decimal" selected={isRowSelected} />
                          {tr(rate.label)}
                        </span>
                      )}
                    </th>
                    <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">{formatGroupedNumber(rate.initial, 7, 7) ?? '0'}</td>
                    <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">{formatPerLot(rate.initialPerLot, rate.currency, rate.initialPerLotApproximate)}</td>
                    <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">{formatGroupedNumber(rate.maintenance, 7, 7) ?? '0'}</td>
                    <td className="border-l border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-right tabular-nums">{formatPerLot(rate.maintenancePerLot, rate.currency, rate.maintenancePerLotApproximate)}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const SpecificationTitleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
    <rect x="1.5" y="2.5" width="10" height="11" rx="1" fill="#1b2838" stroke="#42a5f5" strokeWidth="1" />
    <rect x="3.5" y="1.5" width="11" height="12" rx="1" fill="#2b2112" stroke="#d49b38" strokeWidth="1.1" />
    <text x="9" y="10.5" textAnchor="middle" fill="#f5b942" fontSize="8.5" fontWeight="700" fontFamily="Segoe UI, Arial, sans-serif">$</text>
  </svg>
);

export const SymbolSpecificationDialog: React.FC<SymbolSpecificationDialogProps> = ({
  isOpen,
  symbol,
  instrument,
  fallbackInstrument,
  requestStatus = 'ready',
  onClose,
}) => {
  const tr = useUiTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<ResizeGesture | null>(null);
  const [rect, setRect] = useState<DialogRect>(centeredDialogRect);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const snapshot = useMemo(
    () => buildSymbolSpecificationSnapshot(instrument, fallbackInstrument),
    [fallbackInstrument, instrument],
  );

  const moveDialog = useCallback((position: { x: number; y: number }) => {
    setRect((current) => clampDialogRect({ ...current, ...position }));
  }, []);
  const { isDragging, cancelDrag, dragHandleProps } = useFloatingPanelDrag(dialogRef, moveDialog);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
    resizeRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      rect,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsResizing(true);
  }, [cancelDrag, rect]);

  const continueResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setRect(clampDialogRect({
      ...gesture.rect,
      width: gesture.rect.width + event.clientX - gesture.startX,
      height: gesture.rect.height + event.clientY - gesture.startY,
    }));
  }, []);

  const stopResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (gesture.target.hasPointerCapture?.(gesture.pointerId)) {
      gesture.target.releasePointerCapture(gesture.pointerId);
    }
    setIsResizing(false);
  }, []);

  const resizeFromKeyboard = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 32 : 16;
    setRect((current) => clampDialogRect({
      ...current,
      width: current.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      height: current.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
    }));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const fitToViewport = () => setRect((current) => clampDialogRect(current));
    window.addEventListener('resize', fitToViewport);
    return () => window.removeEventListener('resize', fitToViewport);
  }, [isOpen]);

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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && contentRef.current) contentRef.current.scrollTop = 0;
  }, [isOpen, symbol]);

  if (!isOpen) return null;

  const hedgedMargin = snapshot.marginHedgedUseLeg === true
    ? 'calculate using larger leg'
    : formatNumber(snapshot.marginHedged);
  const isTradeDisabled = snapshot.tradeMode?.trim().toLowerCase() === 'disabled';
  const mainRows: DisplayRow[] = [
    { label: 'ISIN', value: snapshot.isin, kind: 'text' },
    { label: 'Category', value: snapshot.category, kind: 'text' },
    { label: 'Exchange', value: snapshot.exchange ?? '0', kind: 'text' },
    { label: 'CFI', value: snapshot.cfi, kind: 'text' },
    { label: 'Sector', value: snapshot.sector ?? '0', kind: 'enum' },
    { label: 'Industry', value: snapshot.industry, kind: 'enum' },
    { label: 'Country', value: snapshot.country, kind: 'text' },
    { label: 'Digits', value: formatNumber(snapshot.digits, 0) ?? '0', kind: 'integer' },
    { label: 'Contract size', value: formatContractSize(snapshot) ?? '0', kind: 'decimal' },
    { label: 'Spread', value: formatSpread(snapshot) ?? '0', kind: 'integer' },
    { label: 'Stops level', value: formatNumber(snapshot.stopsLevel) ?? '0', kind: 'integer' },
    { label: 'Margin currency', value: snapshot.marginCurrency ?? '0', kind: 'text' },
    { label: 'Profit currency', value: snapshot.profitCurrency ?? '0', kind: 'text' },
    { label: 'Calculation', value: snapshot.calculationMode ?? '0', kind: 'enum' },
    { label: 'Tick size', value: formatNumber(snapshot.tickSize), kind: 'decimal' },
    { label: 'Tick value', value: formatNumber(snapshot.tickValue), kind: 'decimal' },
    { label: 'Initial margin', value: formatNumber(snapshot.marginInitial), kind: 'decimal' },
    { label: 'Maintenance margin', value: formatNumber(snapshot.marginMaintenance), kind: 'decimal' },
    { label: 'Hedged margin', value: hedgedMargin ?? '0', kind: 'decimal' },
    { label: 'Chart mode', value: snapshot.chartMode ?? '0', kind: 'enum' },
    { label: 'Subscription', value: snapshot.subscription, kind: 'enum' },
    { label: 'Ticks history', value: snapshot.ticksHistory, kind: 'enum' },
    { label: 'Liquidity rate', value: formatGroupedNumber(snapshot.liquidityRate, 3, 3), kind: 'decimal' },
    { label: 'Trade', value: snapshot.tradeMode ?? '0', kind: 'enum' },
    { label: 'Execution', value: (isTradeDisabled ? null : snapshot.executionMode) ?? '0', kind: 'enum' },
    { label: 'GTC mode', value: (isTradeDisabled ? null : snapshot.gtcMode) ?? '0', kind: 'enum' },
    { label: 'Filling', value: (isTradeDisabled ? null : snapshot.fillingMode) ?? '0', kind: 'enum' },
    { label: 'Expiration', value: (isTradeDisabled ? null : snapshot.expirationMode) ?? '0', kind: 'enum' },
    { label: 'Orders', value: (isTradeDisabled ? null : snapshot.orderMode) ?? '0', kind: 'enum' },
    { label: 'Minimal volume', value: (isTradeDisabled ? null : formatNumber(snapshot.minVolume)) ?? '0', kind: 'decimal' },
    { label: 'Maximal volume', value: (isTradeDisabled ? null : formatNumber(snapshot.maxVolume)) ?? '0', kind: 'decimal' },
    { label: 'Volume step', value: (isTradeDisabled ? null : formatNumber(snapshot.volumeStep)) ?? '0', kind: 'decimal' },
    { label: 'Volume limit', value: isTradeDisabled ? null : formatNumber(snapshot.volumeLimit), kind: 'decimal' },
    { label: 'Swap type', value: snapshot.swapMode ?? '0', kind: 'enum' },
    { label: 'Swap long', value: formatNumber(snapshot.swapLong) ?? '0', kind: 'decimal' },
    { label: 'Swap short', value: formatNumber(snapshot.swapShort) ?? '0', kind: 'decimal' },
    { label: 'First trade', value: formatDate(snapshot.startTime), kind: 'calendar' },
    { label: 'Last trade', value: formatDate(snapshot.expirationTime), kind: 'calendar' },
    { label: 'Face value', value: formatNumber(snapshot.faceValue), kind: 'decimal' },
    { label: 'Accrued interest', value: formatNumber(snapshot.accruedInterest), kind: 'decimal' },
    { label: 'Option type', value: snapshot.optionRight, kind: 'enum' },
    { label: 'Option exercise', value: snapshot.optionMode, kind: 'enum' },
    { label: 'Underlying', value: snapshot.underlying, kind: 'text' },
    { label: 'Strike price', value: formatNumber(snapshot.optionStrike), kind: 'decimal' },
  ];
  const swapRateRows: DisplayRow[] = WEEKDAYS.map((day) => {
    const value = snapshot.swapRates[day.key];
    const isStandardWeekday = day.key !== 'sunday' && day.key !== 'saturday';
    return {
      label: day.label,
      value: typeof value === 'number'
        ? formatNumber(value)
        : value ?? (isStandardWeekday ? '0' : null),
      kind: 'calendar',
    };
  });
  const pageUrl = safeWebUrl(snapshot.pageUrl);
  const displayDescription = resolveSymbolDescription(symbol, snapshot.description) || null;
  const isRequestPending = requestStatus === 'loading' || requestStatus === 'idle';

  const isSymbolBannerSelected = selectedRowKey === 'symbol-banner';

  return createPortal(
    <div
      className="fixed inset-0 z-[10020] bg-transparent"
    >
      <style>{`
        .rtx-symbol-specification-dialog {
          --mw-spec-grid: #3c3c3c;
          --mw-spec-row-even: #262626;
          --mw-spec-row-odd: #1f1f1f;
          font-family: "Segoe UI", Tahoma, Arial, sans-serif;
        }
        .theme-light .rtx-symbol-specification-dialog,
        .rtx-skin-untitled-light .rtx-symbol-specification-dialog {
          --mw-spec-grid: #d8e0ea;
          --mw-spec-row-even: #ffffff;
          --mw-spec-row-odd: #f6f8fb;
          border-radius: 6px;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08);
        }
        .theme-light .rtx-symbol-specification-dialog .rtx-spec-close-btn,
        .rtx-skin-untitled-light .rtx-symbol-specification-dialog .rtx-spec-close-btn {
          border-color: var(--rtx-light-control-border, #c5d0dc);
          border-radius: 5px;
          background: var(--rtx-light-button-secondary, #f8fafc);
          color: var(--rtx-light-text, #0f172a);
          font-weight: 500;
          height: 26px;
        }
        .theme-light .rtx-symbol-specification-dialog .rtx-spec-close-btn:hover,
        .rtx-skin-untitled-light .rtx-symbol-specification-dialog .rtx-spec-close-btn:hover {
          border-color: var(--rtx-light-control-border-hover, #94a3b8);
          background: var(--rtx-light-hover, #eef2f6);
        }
        .rtx-symbol-specification-dialog .rtx-spec-row[data-stripe="even"]:not([data-selected="true"]) {
          background-color: var(--mw-spec-row-even);
        }
        .rtx-symbol-specification-dialog .rtx-spec-row[data-stripe="odd"]:not([data-selected="true"]),
        .rtx-symbol-specification-dialog .rtx-spec-row--heading:not([data-selected="true"]) {
          background-color: var(--mw-spec-row-odd);
        }
      `}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} ${tr('Specification')}`}
        data-testid="symbol-specification-dialog"
        className={`rtx-symbol-specification-dialog absolute flex min-w-0 flex-col overflow-hidden border border-[var(--mw-spec-grid,var(--border-secondary))] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl ${isDragging ? 'select-none' : ''} ${isResizing ? 'select-none' : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          className={`flex h-[30px] shrink-0 items-center gap-2 border-b border-[var(--mw-spec-grid,var(--border-secondary))] bg-[var(--bg-primary)] px-2 ${isDragging ? 'cursor-grabbing' : 'cursor-move'}`}
          {...dragHandleProps}
        >
          <SpecificationTitleIcon />
          <h2 className="min-w-0 flex-1 truncate text-[12px] font-normal">{tr('Specification')}</h2>
          <a
            href="https://www.metatrader5.com/en/terminal/help/trading/market_watch#specification"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={tr('Symbol specification help')}
            title={tr('Symbol specification help')}
            onPointerDown={(event) => event.stopPropagation()}
            className="flex h-6 w-6 items-center justify-center text-[12px] font-normal text-[var(--text-secondary)] hover:bg-[var(--bg-quaternary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            ?
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={tr('Close symbol specification')}
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            className="flex h-6 w-6 items-center justify-center text-[var(--text-secondary)] hover:bg-red-600 hover:text-white focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            <Icon name="x-close" size="xs" />
          </button>
        </header>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-[6px] pb-0">
          <div className="overflow-hidden border border-[var(--mw-spec-grid,var(--border-secondary))] bg-[var(--bg-secondary)]">
            {pageUrl ? (
              <a
                href={pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-selected={isSymbolBannerSelected ? 'true' : undefined}
                data-stripe="odd"
                onClick={() => setSelectedRowKey('symbol-banner')}
                className={`rtx-spec-row flex min-h-[20px] items-center truncate border-b border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-[12px] font-normal hover:underline ${
                  isSymbolBannerSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[#4597ff]'
                }`}
                title={pageUrl}
              >
                {symbol}{displayDescription ? `, ${displayDescription}` : ''}
              </a>
            ) : (
              <div
                data-selected={isSymbolBannerSelected ? 'true' : undefined}
                data-stripe="odd"
                onClick={() => setSelectedRowKey('symbol-banner')}
                className={`rtx-spec-row flex min-h-[20px] items-center truncate border-b border-[var(--mw-spec-grid,var(--border-primary))] px-1.5 py-0.5 text-[12px] font-normal ${
                  isSymbolBannerSelected ? 'rtx-spec-row--selected bg-[#0078d7] text-white' : 'text-[#4597ff]'
                }`}
                title={`${symbol}${displayDescription ? `, ${displayDescription}` : ''}`}
              >
                {symbol}{displayDescription ? `, ${displayDescription}` : ''}
              </div>
            )}
            {isRequestPending ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 px-6 py-8 text-center text-[12px] text-[var(--text-secondary)]" role="status">
                <Icon name="refresh" size="sm" className="animate-spin" />
                <span>{tr('Loading current specification...')}</span>
              </div>
            ) : (
              <>
                <PropertyRows
                  rows={mainRows}
                  rowKeyPrefix="main"
                  selectedRowKey={selectedRowKey}
                  onSelectRow={setSelectedRowKey}
                />
                <section aria-label={tr('Swap rates')}>
                  <SectionHeading
                    rowKey="swap-rates:header"
                    selectedRowKey={selectedRowKey}
                    onSelectRow={setSelectedRowKey}
                  >
                    {tr('Swap rates')}
                  </SectionHeading>
                  <PropertyRows
                    rows={swapRateRows}
                    rowKeyPrefix="swap"
                    selectedRowKey={selectedRowKey}
                    onSelectRow={setSelectedRowKey}
                  />
                </section>
                <CommissionTable
                  schedules={snapshot.commissionSchedules}
                  selectedRowKey={selectedRowKey}
                  onSelectRow={setSelectedRowKey}
                />
                <SessionTable
                  sessions={snapshot.sessions}
                  timeZone={snapshot.sessionTimeZone}
                  selectedRowKey={selectedRowKey}
                  onSelectRow={setSelectedRowKey}
                />
                <MarginSpreadsTable
                  spreads={snapshot.marginSpreads}
                  selectedRowKey={selectedRowKey}
                  onSelectRow={setSelectedRowKey}
                />
                <MarginRatesTable
                  rates={snapshot.marginRates}
                  mode={snapshot.marginRatesMode}
                  basis={snapshot.marginRatesBasis}
                  currency={snapshot.marginRatesCurrency}
                  asOf={snapshot.marginRatesAsOf}
                  selectedRowKey={selectedRowKey}
                  onSelectRow={setSelectedRowKey}
                />
              </>
            )}
          </div>
        </div>

        <footer className="flex h-[38px] shrink-0 items-center justify-center bg-[var(--bg-secondary)] px-3">
          <button
            type="button"
            onClick={onClose}
            className="rtx-spec-close-btn h-[23px] w-[90px] border border-[#8a8a8a] bg-[var(--bg-tertiary)] px-3 text-[12px] font-normal text-[var(--text-primary)] hover:border-[var(--color-info)] hover:bg-[var(--bg-quaternary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-info)]"
          >
            {tr('Close')}
          </button>
        </footer>

        <button
          type="button"
          aria-label={tr('Resize symbol specification dialog')}
          title={tr('Drag or use arrow keys to resize')}
          className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-se-resize bg-transparent focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-info)]"
          onPointerDown={startResize}
          onPointerMove={continueResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onLostPointerCapture={stopResize}
          onKeyDown={resizeFromKeyboard}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[2px] right-[2px] text-[var(--text-tertiary)]"
          >
            <circle cx="8" cy="2" r="0.9" fill="currentColor" />
            <circle cx="5" cy="5" r="0.9" fill="currentColor" />
            <circle cx="8" cy="5" r="0.9" fill="currentColor" />
            <circle cx="2" cy="8" r="0.9" fill="currentColor" />
            <circle cx="5" cy="8" r="0.9" fill="currentColor" />
            <circle cx="8" cy="8" r="0.9" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default SymbolSpecificationDialog;

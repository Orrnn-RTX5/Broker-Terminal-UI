type PositionTimeRecord = Record<string, unknown>;

const toIsoFromTradeTimestamp = (value: unknown): string | null => {
  if (value == null || value === '') return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return toIsoFromTradeTimestamp(numeric);
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const milliseconds = numeric > 10_000_000_000_000
    ? Math.floor(numeric / 1000)
    : numeric > 1_000_000_000_000
      ? numeric
      : numeric * 1000;

  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const resolvePositionOpenTime = (
  record: PositionTimeRecord,
  fallbackIso?: string,
): string => {
  const candidates = [
    record.chartEntryTime,
    record.chart_entry_time,
    record.opened_at,
    record.openedAt,
    record.openTime,
    record.open_time,
    record.time_open,
    record.timeOpen,
    record.time_create_msc,
    record.time_msc,
    record.time_create,
    record.timeCreate,
    record.time_ms,
    record.time,
    record.open_time_captured,
    record.time_setup_msc,
    record.time_setup,
  ];

  for (const candidate of candidates) {
    const iso = toIsoFromTradeTimestamp(candidate);
    if (iso) return iso;
  }

  const fallback = toIsoFromTradeTimestamp(fallbackIso);
  return fallback ?? new Date().toISOString();
};

export const resolveOptionalPositionTime = (value: unknown): string | undefined =>
  toIsoFromTradeTimestamp(value) ?? undefined;

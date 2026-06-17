export const normalizeSymbolName = (value: unknown): string => String(value ?? '').trim().toUpperCase();

export const getInstrumentSymbolName = (instrument: unknown): string => {
  if (instrument && typeof instrument === 'object') {
    const record = instrument as Record<string, unknown>;
    return normalizeSymbolName(record.symbol ?? record.name ?? record.id);
  }
  return normalizeSymbolName(instrument);
};

export const getUniqueSymbolNames = (symbols: unknown[]): string[] => {
  return Array.from(new Set((Array.isArray(symbols) ? symbols : []).map(getInstrumentSymbolName).filter(Boolean)));
};

export const buildChartEligibleSymbolNames = (
  instrumentSymbols: unknown[],
  activeFeedSymbols: unknown[],
): string[] => {
  return getUniqueSymbolNames([...instrumentSymbols, ...activeFeedSymbols]);
};

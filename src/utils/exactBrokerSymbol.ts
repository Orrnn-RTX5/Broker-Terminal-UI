/**
 * FIX: Broker symbols are opaque contract identifiers. Normalization may only
 * remove surrounding whitespace and fold case; punctuation and suffixes are
 * significant (for example, XAUUSD, XAUUSD.raw, and XAUUSD-pro are different).
 */
export const normalizeExactBrokerSymbol = (symbol: unknown): string => (
  String(symbol ?? '').trim().toUpperCase()
);

/** Reads the complete symbol suffix from a ticks.{SYMBOL} channel. */
export const parseExactTickChannelSymbol = (channel: unknown): string => {
  const rawChannel = String(channel ?? '').trim();
  if (!rawChannel.startsWith('ticks.')) return '';
  return normalizeExactBrokerSymbol(rawChannel.slice('ticks.'.length));
};

/** Resolves a record entry without aliasing broker punctuation or suffixes. */
export const resolveExactBrokerSymbolValue = <T>(
  values: Readonly<Record<string, T>>,
  symbol: unknown,
): T | undefined => {
  const expected = normalizeExactBrokerSymbol(symbol);
  if (!expected) return undefined;

  const exactKey = Object.keys(values).find(
    (candidate) => normalizeExactBrokerSymbol(candidate) === expected,
  );
  return exactKey === undefined ? undefined : values[exactKey];
};

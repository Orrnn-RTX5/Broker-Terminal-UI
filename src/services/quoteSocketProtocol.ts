export const QUOTE_SOCKET_OPEN_TIMEOUT_MS = 5_000;
export const QUOTE_SOCKET_STABLE_OPEN_MS = 10_000;
export const QUOTE_SOCKET_SUBSCRIPTION_ACK_TIMEOUT_MS = 3_000;
export const QUOTE_SOCKET_MAX_SUBSCRIPTION_RETRIES = 3;
export const QUOTE_SOCKET_HEARTBEAT_INTERVAL_MS = 15_000;
export const QUOTE_SOCKET_PONG_TIMEOUT_MS = 10_000;

export const MAX_FEED_SYMBOLS_PER_FRAME = 500;
const MAX_LOGGED_SYMBOLS = 12;
const RECONNECT_JITTER_RATIO = 0.2;

export const AUTH_CLOSE_CODES = new Set([1008, 4001, 4003, 4401, 4403]);

export const normalizeQuoteSymbol = (value: unknown): string => (
  typeof value === 'string' ? value.trim().toUpperCase() : ''
);

export const isQuoteMessageRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

export const redactQuoteSocketUrl = (url: string): string => (
  url.replace(/token=[^&]+/g, 'token=***')
);

export const summarizeQuoteSymbols = (symbols: Iterable<string>): string => {
  const values = Array.from(symbols);
  if (values.length <= MAX_LOGGED_SYMBOLS) return values.join(', ');
  const visible = values.slice(0, MAX_LOGGED_SYMBOLS).join(', ');
  return `${visible} ... (+${values.length - MAX_LOGGED_SYMBOLS})`;
};

export const chunkQuoteSymbols = (values: string[], maxSize: number): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += maxSize) {
    chunks.push(values.slice(index, index + maxSize));
  }
  return chunks;
};

export const addQuoteReconnectJitter = (delay: number, maximum: number): number => {
  const jitter = Math.floor(delay * RECONNECT_JITTER_RATIO * Math.random());
  return Math.min(maximum, delay + jitter);
};

/** Merge the confirmation identifiers used by the feed and v2 transports. */
export const collectQuoteConfirmationItems = (data: Record<string, unknown>): string[] => {
  const items: string[] = [];
  const append = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === 'string' && entry) items.push(entry);
      });
    } else if (typeof value === 'string' && value) {
      items.push(value);
    }
  };
  append(data.symbols);
  append(data.channels);
  append(data.channel);
  return items;
};

/** Normalize either bare symbols or `ticks.*` channels from confirmations. */
export const normalizeQuoteConfirmationItems = (list: unknown): string[] => {
  const items = Array.isArray(list)
    ? list
    : typeof list === 'string'
      ? [list]
      : [];

  return items
    .map((entry) => {
      const raw = typeof entry === 'string' ? entry : '';
      const symbol = raw.startsWith('ticks.') ? raw.slice('ticks.'.length) : raw;
      return normalizeQuoteSymbol(symbol);
    })
    .filter(Boolean);
};

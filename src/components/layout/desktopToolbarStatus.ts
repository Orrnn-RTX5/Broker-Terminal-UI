import type { ConnectionState } from '../../store/useWebSocketStore';

export type DesktopFeedState = 'live' | 'checking' | 'silent' | 'unverified' | 'offline';
export type DesktopTransportSecurity = 'secure' | 'insecure' | 'unknown';

export interface DesktopFeedSnapshot {
  symbols: readonly string[];
  loading: boolean;
  settled: boolean;
  current: boolean;
  error: string | null;
}

export interface DesktopToolbarStatusInput {
  symbol: string;
  connectionState: ConnectionState;
  transportSecurity: DesktopTransportSecurity;
  feed: DesktopFeedSnapshot;
}

export interface DesktopToolbarStatusPresentation {
  connectionLabel: string;
  feedLabel: string;
  feedState: DesktopFeedState;
  fillPercent: 0 | 20 | 50 | 100;
  securityTone: 'secure' | 'insecure' | 'pending' | 'offline';
  summary: string;
}

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const formatConnectionState = (state: ConnectionState): string => {
  switch (state) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'offline': return 'Offline';
    case 'error': return 'Connection error';
    default: return 'Disconnected';
  }
};

export const resolveDesktopToolbarStatus = ({
  symbol,
  connectionState,
  transportSecurity,
  feed,
}: DesktopToolbarStatusInput): DesktopToolbarStatusPresentation => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const connectionLabel = formatConnectionState(connectionState);
  const socketConnected = connectionState === 'connected';

  let securityTone: DesktopToolbarStatusPresentation['securityTone'] = 'offline';
  if (connectionState === 'connecting' || connectionState === 'reconnecting') {
    securityTone = 'pending';
  } else if (socketConnected) {
    securityTone = transportSecurity === 'secure'
      ? 'secure'
      : transportSecurity === 'insecure'
        ? 'insecure'
        : 'pending';
  }

  let feedState: DesktopFeedState = 'unverified';
  let feedLabel = normalizedSymbol ? `${normalizedSymbol} feed status unverified` : 'Feed status unverified';

  if (!socketConnected) {
    feedState = connectionState === 'connecting' || connectionState === 'reconnecting'
      ? 'checking'
      : 'offline';
    feedLabel = connectionState === 'connecting' || connectionState === 'reconnecting'
      ? `Checking ${normalizedSymbol || 'selected symbol'} feed`
      : `${normalizedSymbol || 'Selected symbol'} feed offline`;
  } else if (!feed.settled) {
    feedState = 'checking';
    feedLabel = `Checking ${normalizedSymbol || 'selected symbol'} feed`;
  } else if (feed.current) {
    const currentSymbols = new Set(feed.symbols.map(normalizeSymbol).filter(Boolean));
    if (normalizedSymbol && currentSymbols.has(normalizedSymbol)) {
      feedState = 'live';
      feedLabel = `${normalizedSymbol} live feed verified`;
    } else {
      feedState = 'silent';
      feedLabel = `${normalizedSymbol || 'Selected symbol'} is not active in current feed status`;
    }
  } else {
    feedLabel = feed.error
      ? `${normalizedSymbol || 'Selected symbol'} feed could not be verified`
      : `${normalizedSymbol || 'Selected symbol'} feed status unverified`;
  }

  const transportLabel = socketConnected
    ? transportSecurity === 'secure'
      ? 'secure transport'
      : transportSecurity === 'insecure'
        ? 'insecure transport'
        : 'transport security unknown'
    : connectionLabel.toLowerCase();

  return {
    connectionLabel,
    feedLabel,
    feedState,
    fillPercent: feedState === 'live'
      ? 100
      : feedState === 'checking'
        ? 50
        : feedState === 'silent'
          ? 20
          : 0,
    securityTone,
    summary: `${connectionLabel}; ${transportLabel}; ${feedLabel}`,
  };
};

export const formatDesktopAccountBadge = (savedAccountCount: number): string | null => {
  if (!Number.isFinite(savedAccountCount) || savedAccountCount <= 0) return null;
  const count = Math.floor(savedAccountCount);
  return count > 99 ? '99+' : String(count);
};

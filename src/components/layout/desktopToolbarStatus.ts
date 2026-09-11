import type { ConnectionState } from '../../store/useWebSocketStore';
import { translateUi as tr } from '../../hooks/useUiTranslation';

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
    case 'connected': return tr('Connected');
    case 'connecting': return tr('Connecting');
    case 'reconnecting': return tr('Reconnecting');
    case 'offline': return tr('Offline');
    case 'error': return tr('Connection error');
    default: return tr('Disconnected');
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
  let feedLabel = normalizedSymbol
    ? tr('{{value0}} feed status unverified', { value0: normalizedSymbol })
    : tr('Feed status unverified');

  if (!socketConnected) {
    feedState = connectionState === 'connecting' || connectionState === 'reconnecting'
      ? 'checking'
      : 'offline';
    feedLabel = connectionState === 'connecting' || connectionState === 'reconnecting'
      ? tr('Checking {{value0}} feed', { value0: normalizedSymbol || tr('selected symbol') })
      : tr('{{value0}} feed offline', { value0: normalizedSymbol || tr('Selected symbol') });
  } else if (!feed.settled) {
    feedState = 'checking';
    feedLabel = tr('Checking {{value0}} feed', { value0: normalizedSymbol || tr('selected symbol') });
  } else if (feed.current) {
    const currentSymbols = new Set(feed.symbols.map(normalizeSymbol).filter(Boolean));
    if (normalizedSymbol && currentSymbols.has(normalizedSymbol)) {
      feedState = 'live';
      feedLabel = tr('{{value0}} live feed verified', { value0: normalizedSymbol });
    } else {
      feedState = 'silent';
      feedLabel = tr('{{value0}} is not active in current feed status', { value0: normalizedSymbol || tr('Selected symbol') });
    }
  } else {
    feedLabel = feed.error
      ? tr('{{value0}} feed could not be verified', { value0: normalizedSymbol || tr('Selected symbol') })
      : tr('{{value0}} feed status unverified', { value0: normalizedSymbol || tr('Selected symbol') });
  }

  const transportLabel = socketConnected
    ? transportSecurity === 'secure'
      ? tr('secure transport')
      : transportSecurity === 'insecure'
        ? tr('insecure transport')
        : tr('transport security unknown')
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

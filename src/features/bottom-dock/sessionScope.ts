import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from '../../services/brokerSession';

export const getCurrentBrokerAccountSessionScopeKey = (): string => (
  getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())
);

export const normalizeTradeSymbol = (symbol: unknown): string => (
  String(symbol ?? '').trim().toUpperCase()
);

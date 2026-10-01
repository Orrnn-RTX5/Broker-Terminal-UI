import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retainPositionCloseQuotes } from './positionCloseQuoteDemand';
import type { SessionChangeReason } from './brokerSession';

const mocks = vi.hoisted(() => ({
  demands: new Map<string, string[]>(),
  listeners: new Set<(reason: string) => void>(),
  scopeListeners: new Set<() => void>(),
  setDemand: vi.fn(),
  removeDemand: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('./quoteSocketManager', () => ({
  getQuoteSocketManager: () => ({ setDemand: mocks.setDemand, removeDemand: mocks.removeDemand }),
}));
vi.mock('./brokerSession', () => ({
  onCommittedBrokerAccountSessionScopeChange: (listener: () => void) => {
    mocks.scopeListeners.add(listener);
    return () => mocks.scopeListeners.delete(listener);
  },
  onSessionChange: (listener: (reason: string) => void) => {
    mocks.listeners.add(listener);
    return () => { mocks.unsubscribe(); mocks.listeners.delete(listener); };
  },
}));

const sessionChange = (reason: SessionChangeReason): void => {
  for (const listener of mocks.listeners) listener(reason);
};

describe('retainPositionCloseQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demands.clear();
    mocks.listeners.clear();
    mocks.scopeListeners.clear();
    mocks.setDemand.mockImplementation((source: string, symbols: string[]) => {
      mocks.demands.set(source, symbols);
    });
    mocks.removeDemand.mockImplementation((source: string) => { mocks.demands.delete(source); });
  });

  it('keeps a held-only quote after optimistic removal releases ordinary position demand', () => {
    mocks.setDemand('open-positions', ['GBPUSD']);
    const close = retainPositionCloseQuotes('close:123', ['GBPUSD']);

    // The last GBPUSD row disappears, releasing its normal position subscription.
    mocks.removeDemand('open-positions');
    expect(mocks.demands.get('close:123')).toEqual(['GBPUSD']);
    expect(mocks.listeners.size).toBe(1);

    close.release();
    expect(mocks.demands.size).toBe(0);
    expect(mocks.listeners.size).toBe(0);
  });

  it('unions normalized unique symbols discovered after the initial local snapshot', () => {
    const close = retainPositionCloseQuotes('bulk:123', [' gbpusd ', 'GBPUSD', '']);
    close.addSymbols(['btcusd', ' GBPUSD ', 'XAUUSD', '  ']);
    expect(mocks.demands.get('bulk:123')).toEqual(['BTCUSD', 'GBPUSD', 'XAUUSD']);
    close.addSymbols(['BTCUSD']);
    expect(mocks.setDemand).toHaveBeenCalledTimes(2);
    close.release();
  });

  it('can start empty and retain subsequently discovered symbols', () => {
    const close = retainPositionCloseQuotes('bulk:empty', []);
    expect(mocks.setDemand).not.toHaveBeenCalled();
    close.addSymbols(['eurusd']);
    expect(mocks.demands.get('bulk:empty')).toEqual(['EURUSD']);
    close.release();
  });

  it('releases once and ignores symbols added after release', () => {
    const close = retainPositionCloseQuotes('close:123', ['GBPUSD']);
    close.release();
    close.release();
    close.addSymbols(['BTCUSD']);
    expect(mocks.removeDemand).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.setDemand).toHaveBeenCalledTimes(1);
    expect(mocks.demands.size).toBe(0);
  });

  it.each(['login', 'logout', 'broker_url_change', 'account_change'] as const)(
    'releases pending close demand on %s',
    (reason) => {
      const close = retainPositionCloseQuotes('close:123', ['GBPUSD']);
      sessionChange(reason);
      expect(mocks.demands.size).toBe(0);
      expect(mocks.listeners.size).toBe(0);
      close.addSymbols(['BTCUSD']);
      close.release();
      expect(mocks.removeDemand).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps demand across token rotation', () => {
    const close = retainPositionCloseQuotes('close:123', ['GBPUSD']);
    sessionChange('token_rotation');
    expect(mocks.demands.get('close:123')).toEqual(['GBPUSD']);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    close.addSymbols(['BTCUSD']);
    expect(mocks.demands.get('close:123')).toEqual(['BTCUSD', 'GBPUSD']);
    close.release();
  });

  it('releases on a directly committed broker-account change', () => {
    const close = retainPositionCloseQuotes('close:123', ['BTCUSD']);
    for (const listener of mocks.scopeListeners) listener();
    expect(mocks.demands.size).toBe(0);
    expect(mocks.scopeListeners.size).toBe(0);
    expect(mocks.listeners.size).toBe(0);
    close.release();
    expect(mocks.removeDemand).toHaveBeenCalledTimes(1);
  });

  it('cleans demand and the listener when initial setDemand throws after mutation', () => {
    const error = new Error('Socket registration failed');
    mocks.setDemand.mockImplementation((source: string, symbols: string[]) => {
      mocks.demands.set(source, symbols);
      throw error;
    });
    expect(() => retainPositionCloseQuotes('close:123', ['GBPUSD'])).toThrow(error);
    expect(mocks.demands.size).toBe(0);
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('cleans existing demand when adding a discovered symbol fails', () => {
    const close = retainPositionCloseQuotes('bulk:123', ['GBPUSD']);
    const error = new Error('Refresh failed');
    mocks.setDemand.mockImplementationOnce(() => { throw error; });
    expect(() => close.addSymbols(['BTCUSD'])).toThrow(error);
    expect(mocks.demands.size).toBe(0);
    expect(mocks.listeners.size).toBe(0);
    close.release();
    close.addSymbols(['XAUUSD']);
    expect(mocks.removeDemand).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '../../store/useAppStore';
import type { ClosePositionRequestOptions } from '../../api/positionClose';
import { createPositionCloseHandler } from './createPositionCloseHandler';
import { assertTerminalCloseQuote, calibrateTerminalQuoteClock, ingestTerminalQuote, resetTerminalQuoteFreshness } from '../../services/terminalQuoteFreshness';

const mocks = vi.hoisted(() => ({
  positions: [] as Position[],
  close: vi.fn(), feedback: vi.fn(), overlay: vi.fn(), scope: 'broker-a|200001',
  setPositions: vi.fn(), retainQuotes: vi.fn(), releaseQuotes: vi.fn(), login: 200001,
}));
vi.mock('../../services/api', () => ({ api: { positions: { closePosition: mocks.close } } }));
vi.mock('../../services/brokerSession', () => ({ getCommittedBrokerAccountSessionScope: () => ({}), getCommittedBrokerAccountSessionScopeKey: () => mocks.scope }));
vi.mock('../../services/positionCloseQuoteDemand', () => ({ retainPositionCloseQuotes: mocks.retainQuotes }));
vi.mock('../../services/tradeOverlayHistory', () => ({ dispatchTradeOverlayCloseState: mocks.overlay }));
vi.mock('../../store/useAppStore', () => ({ getPositionCloseScope: () => 1,
  useAppStore: { getState: () => ({ positions: mocks.positions, setPositions: mocks.setPositions }) } }));
vi.mock('./positionRuntime', () => ({ buildTradeOverlayCloseSnapshots: () => [] }));
vi.mock('./orderFeedback', () => ({ publishOrderFeedback: mocks.feedback }));
vi.mock('../../utils/audio', () => ({ playSystemSound: vi.fn() }));
vi.mock('../../utils/orderError', () => ({ formatOrderError: (error: unknown) => (error as Error)?.message || 'Close failed' }));

const position: Position = { id: 17, symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  openPrice: 100, currentPrice: 101, openTime: '', sl: 0, tp: 0, swap: 0, commission: 0, unrealizedPnL: 0 };
const commandId = '550e8400-e29b-41d4-a716-446655440000';

describe('position close confirmation UI', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.scope = 'broker-a|200001'; mocks.login = 200001; mocks.positions = [{ ...position }];
    mocks.close.mockReset(); mocks.overlay.mockReset(); mocks.retainQuotes.mockReset();
    mocks.retainQuotes.mockReturnValue({ release: mocks.releaseQuotes });
    mocks.setPositions.mockImplementation((rows: Position[], options?: { closedTickets?: number[] }) => {
      mocks.positions = rows.filter(row => !options?.closedTickets?.includes(row.id));
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetTerminalQuoteFreshness(); });
  const setup = () => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const closePromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    mocks.close.mockReturnValue(closePromise);
    const closingTicketsRef = { current: new Set<string>() };
    const markLocalTradeMutation = vi.fn();
    const handler = createPositionCloseHandler({ getLiveTradingLogin: () => mocks.login, closingTicketsRef,
      isAuthenticatedRef: { current: true }, markLocalTradeMutation, clearOptimisticClosedTickets: vi.fn(),
      refreshPositions: vi.fn().mockResolvedValue(undefined), refreshOrdersAndHistory: vi.fn().mockResolvedValue(undefined) });
    const options = () => mocks.close.mock.calls[0][1] as ClosePositionRequestOptions;
    return { handler, resolve, reject, options, closingTicketsRef, closePromise, markLocalTradeMutation };
  };
  const unknown = (options: ClosePositionRequestOptions) => options.onCloseCommandStatus?.({ status: 'awaiting-confirmation', clientOrderId: commandId, ticket: '17' });

  it('starts the guarded request while fresh before a pending listener ages the quote beyond 3 seconds', async () => {
    let mono = 1000;
    const epoch = 1_800_000_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => epoch + mono);
    vi.stubGlobal('RUNTIME_CONFIG', { TERMINAL_QUOTE_FRESHNESS: true });
    resetTerminalQuoteFreshness();
    expect(calibrateTerminalQuoteClock(epoch + mono, mono, epoch + mono, mono, epoch + mono)).toBe(true);
    expect(ingestTerminalQuote('BTCUSD', { bid: 100, ask: 101, provider_timestamp: epoch + mono,
      source: 'test', sequence: '1' })).toBe(true);
    mono += 2000;
    const f = setup(), sent = vi.fn();
    mocks.close.mockImplementation((_id: string, options: ClosePositionRequestOptions) => {
      expect(options.executionContext?.isCurrent()).toBe(true);
      assertTerminalCloseQuote('BTCUSD');
      sent(options.account_login);
      return f.closePromise;
    });
    mocks.overlay.mockImplementation((_ids, state) => { if (state === 'pending') mono += 2000; });
    const result = f.handler(17);
    expect(sent).toHaveBeenCalledExactlyOnceWith(200001);
    expect(() => assertTerminalCloseQuote('BTCUSD')).toThrow();
    expect(mocks.positions).toHaveLength(0);
    expect(await f.handler(17)).toBe(false);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    f.resolve(); expect(await result).toBe(true);
    expect(mocks.releaseQuotes).toHaveBeenCalledTimes(1);
  });

  it('does not initiate or mutate presentation when quote retention changes the account scope', async () => {
    const f = setup(), otherPosition = { ...position, symbol: 'EURUSD' };
    mocks.retainQuotes.mockImplementation(() => {
      mocks.scope = 'broker-b|200002'; mocks.login = 200002; mocks.positions = [otherPosition];
      return { release: mocks.releaseQuotes };
    });
    expect(await f.handler(17)).toBe(false);
    expect(mocks.close).not.toHaveBeenCalled(); expect(f.markLocalTradeMutation).not.toHaveBeenCalled();
    expect(mocks.overlay).not.toHaveBeenCalled(); expect(mocks.setPositions).not.toHaveBeenCalled();
    expect(mocks.positions).toEqual([otherPosition]); expect(mocks.feedback).not.toHaveBeenCalled();
    expect(mocks.releaseQuotes).toHaveBeenCalledTimes(1); expect(f.closingTicketsRef.current.size).toBe(0);
  });

  it.each(['filled', 'rejected'])('keeps a %s original request from writing into an account switched by the pending listener', async outcome => {
    const f = setup(), otherPosition = { ...position, symbol: 'EURUSD' };
    mocks.overlay.mockImplementation((_ids, state) => {
      if (state === 'pending') {
        mocks.scope = 'broker-b|200002'; mocks.login = 200002; mocks.positions = [otherPosition];
      }
    });
    const result = f.handler(17);
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(f.options().account_login).toBe(200001);
    expect(f.options().executionContext?.isCurrent()).toBe(false);
    unknown(f.options());
    if (outcome === 'filled') f.resolve(); else f.reject(new Error('Close rejected'));
    expect(await result).toBe(false);
    expect(mocks.setPositions).not.toHaveBeenCalled(); expect(mocks.positions).toEqual([otherPosition]);
    expect(mocks.overlay.mock.calls.map(([, state]) => state)).toEqual(['pending']);
    expect(mocks.feedback).not.toHaveBeenCalled(); expect(mocks.releaseQuotes).toHaveBeenCalledTimes(1);
    expect(f.closingTicketsRef.current.size).toBe(0);
  });

  it.each(['pending-overlay', 'pending-store', 'confirmed-overlay'])('still observes the same submitted close after a %s presentation exception', async failure => {
    const f = setup();
    if (failure === 'pending-store') mocks.setPositions.mockImplementationOnce(() => { throw new Error('Render failed'); });
    else mocks.overlay.mockImplementation((_ids, state) => {
      if (state === failure.split('-')[0]) throw new Error('Render failed');
    });
    const result = f.handler(17);
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(f.closingTicketsRef.current.size).toBe(1);
    unknown(f.options());
    expect(mocks.positions[0]).toMatchObject({ closeCommandState: 'awaiting-confirmation', closeClientOrderId: commandId });
    expect(await f.handler(17)).toBe(false);
    f.resolve(); expect(await result).toBe(true);
    expect(mocks.positions).toHaveLength(0);
    expect(mocks.overlay.mock.calls.some(([, state]) => state === 'failed')).toBe(false);
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(mocks.releaseQuotes).toHaveBeenCalledTimes(1);
    expect(f.closingTicketsRef.current.size).toBe(0);
  });

  it('restores an awaiting row, keeps duplicate-close protection, and removes only on late confirmation', async () => {
    const f = setup();
    const first = f.handler(17);
    expect(mocks.positions).toHaveLength(0);
    unknown(f.options());
    expect(mocks.positions).toEqual([expect.objectContaining({ id: 17, closeCommandState: 'awaiting-confirmation', closeClientOrderId: commandId })]);
    expect(JSON.stringify(mocks.feedback.mock.calls)).toContain('Awaiting confirmation');
    expect(await f.handler(17)).toBe(false);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(f.closingTicketsRef.current.size).toBe(1);
    f.resolve();
    expect(await first).toBe(true);
    expect(mocks.positions).toHaveLength(0);
    expect(mocks.overlay).toHaveBeenCalledWith([17], 'confirmed', expect.anything());
    expect(f.closingTicketsRef.current.size).toBe(0);
  });

  it('does not announce a failed or confirmed close when bounded reconciliation remains unresolved', async () => {
    const f = setup(); const result = f.handler(17);
    unknown(f.options());
    f.reject({ data: { code: 'ORDER_OUTCOME_UNKNOWN' }, message: 'Awaiting confirmation' });
    expect(await result).toBe(false);
    expect(mocks.positions[0].closeCommandState).toBe('awaiting-confirmation');
    expect(mocks.overlay.mock.calls.some(([, state]) => state === 'failed' || state === 'confirmed')).toBe(false);
    expect(f.closingTicketsRef.current.size).toBe(0);
    expect(await f.handler(17)).toBe(false);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('clears the awaiting marker on an authoritative rejection', async () => {
    const f = setup(); const result = f.handler(17);
    unknown(f.options());
    f.options().onCloseCommandStatus?.({ status: 'rejected', clientOrderId: commandId, ticket: '17' });
    f.reject(new Error('Position close rejected'));
    expect(await result).toBe(false);
    expect(mocks.positions[0].closeCommandState).toBeUndefined();
    expect(mocks.overlay).toHaveBeenCalledWith([17], 'failed');
  });

  it('does not restore an old account position after session ownership changes', async () => {
    const f = setup(); const result = f.handler(17);
    mocks.scope = 'broker-b|200002';
    unknown(f.options());
    expect(mocks.positions).toHaveLength(0);
    f.resolve(); expect(await result).toBe(false);
    expect(mocks.feedback).not.toHaveBeenCalled();
  });
});

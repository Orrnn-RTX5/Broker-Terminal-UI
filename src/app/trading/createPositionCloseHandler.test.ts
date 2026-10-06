import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '../../store/useAppStore';
import type { ClosePositionRequestOptions } from '../../api/positionClose';
import { createPositionCloseHandler } from './createPositionCloseHandler';

const mocks = vi.hoisted(() => ({
  positions: [] as Position[],
  close: vi.fn(), feedback: vi.fn(), overlay: vi.fn(), scope: 'broker-a|200001',
  setPositions: vi.fn(),
}));
vi.mock('../../services/api', () => ({ api: { positions: { closePosition: mocks.close } } }));
vi.mock('../../services/brokerSession', () => ({ getCommittedBrokerAccountSessionScope: () => ({}), getCommittedBrokerAccountSessionScopeKey: () => mocks.scope }));
vi.mock('../../services/positionCloseQuoteDemand', () => ({ retainPositionCloseQuotes: () => ({ release: vi.fn() }) }));
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
    vi.clearAllMocks(); mocks.scope = 'broker-a|200001'; mocks.positions = [{ ...position }];
    mocks.setPositions.mockImplementation((rows: Position[], options?: { closedTickets?: number[] }) => {
      mocks.positions = rows.filter(row => !options?.closedTickets?.includes(row.id));
    });
  });
  const setup = () => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    mocks.close.mockReturnValue(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const closingTicketsRef = { current: new Set<string>() };
    const handler = createPositionCloseHandler({ getLiveTradingLogin: () => 200001, closingTicketsRef,
      isAuthenticatedRef: { current: true }, markLocalTradeMutation: vi.fn(), clearOptimisticClosedTickets: vi.fn(),
      refreshPositions: vi.fn().mockResolvedValue(undefined), refreshOrdersAndHistory: vi.fn().mockResolvedValue(undefined) });
    const options = () => mocks.close.mock.calls[0][1] as ClosePositionRequestOptions;
    return { handler, resolve, reject, options, closingTicketsRef };
  };
  const unknown = (options: ClosePositionRequestOptions) => options.onCloseCommandStatus?.({ status: 'awaiting-confirmation', clientOrderId: commandId, ticket: '17' });

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

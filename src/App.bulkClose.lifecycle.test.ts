import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { closePositionsLocalFirst } from './services/localFirstCloseCoordinator';

// Execute the actual App handler with its real coordinator and narrow boundary
// doubles, avoiding a whole React tree for synchronous listener race coverage.
const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const start = source.indexOf('  const handleCloseBulk = async');
const end = source.indexOf('  // Connect to WebSocket using centralized hook', start);
const handler = ts.transpileModule(source.slice(start, end) + '\nglobalThis.runBulk = handleCloseBulk;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture() {
  const original = { id: 17, symbol: 'BTCUSD', volume: 0.01 };
  const other = { id: 17, symbol: 'EURUSD', volume: 0.02 };
  const state = { login: 200050, scope: 'original', marker: 1, positions: [original] };
  const switchAccount = () => { state.login = 200051; state.scope = 'other'; state.marker = 2; state.positions = [other]; };
  const setPositions = vi.fn((rows: typeof state.positions, options?: { closedTickets?: number[] }) => {
    state.positions = rows.filter(row => !options?.closedTickets?.includes(row.id));
  });
  const overlay = vi.fn(), feedback = vi.fn(), clear = vi.fn(), release = vi.fn(), addSymbols = vi.fn();
  const close = vi.fn(async () => {}), refresh = vi.fn(async () => {}), history = vi.fn(async () => {});
  const context = {
    console: { error: vi.fn(), warn: vi.fn() },
    getLiveTradingLogin: () => state.login, getPositionCloseScope: () => state.marker,
    getCommittedBrokerAccountSessionScope: () => state.scope, getCommittedBrokerAccountSessionScopeKey: (value: string) => value,
    isAuthenticatedRef: { current: true }, bulkCloseInFlightScopesRef: { current: new Set<string>() }, closingTicketsRef: { current: new Set<string>() },
    normalizePositions: (rows: typeof state.positions) => rows, backendCloseProfit: () => 1,
    useAppStore: { getState: () => ({ positions: state.positions, setPositions }) },
    retainPositionCloseQuotes: () => ({ release, addSymbols }),
    buildTradeOverlayCloseSnapshots: (rows: typeof state.positions) => rows.map(row => ({ ticketId: row.id, symbol: row.symbol })),
    createSessionScopedTicketKey: (scope: string, id: number) => `${scope}|${id}`,
    api: { positions: { closePosition: close, getPositions: async () => [] } },
    tradingV2Api: { getPositions: async () => [] }, closePositionsLocalFirst,
    markLocalTradeMutation: vi.fn(), dispatchTradeOverlayCloseState: overlay, clearOptimisticClosedTickets: clear,
    publishOrderFeedback: feedback, feedbackLabel: (text: string) => text, feedbackValue: (text: string) => text,
    formatOrderError: String, refreshPositions: refresh, refreshOrdersAndHistory: history,
    runBulk: undefined as unknown as (type: 'ALL') => Promise<void>,
  };
  runInNewContext(handler, context);
  return { context, state, original, other, switchAccount, setPositions, overlay, feedback, clear, release, addSymbols, close, refresh, history,
    run: () => context.runBulk('ALL') };
}

describe('bulk close actual App callback lifecycle', () => {
  it('never writes old positions after a pending listener switches account; original request still settles', async () => {
    const f = fixture();let settle!: () => void;f.close.mockImplementation(() => new Promise<void>(resolve => { settle = resolve; }));
    f.overlay.mockImplementation((_ids, status) => { if (status === 'pending') f.switchAccount(); });
    const operation = f.run();expect(f.close).toHaveBeenCalledTimes(1);expect(f.release).not.toHaveBeenCalled();
    settle();await operation;
    expect(f.state.positions).toEqual([f.other]);expect(f.setPositions).not.toHaveBeenCalled();expect(f.feedback).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledTimes(1);expect(f.context.closingTicketsRef.current.size).toBe(0);
  });
  it('rechecks account after confirmation store listeners before emitting confirmation or refreshing', async () => {
    const f = fixture();f.setPositions.mockImplementation((rows, options) => { f.state.positions = rows; if (options?.closedTickets) f.switchAccount(); });
    await f.run();expect(f.state.positions).toEqual([f.other]);
    expect(f.overlay.mock.calls.map(([, status]) => status)).toEqual(['pending']);expect(f.refresh).not.toHaveBeenCalled();expect(f.history).not.toHaveBeenCalled();
  });
  it('does not restore failed old positions or publish feedback after a failed-overlay listener switches account', async () => {
    const f = fixture();f.close.mockRejectedValue(new Error('Rejected'));
    f.overlay.mockImplementation((_ids, status) => { if (status === 'failed') f.switchAccount(); });
    await f.run();expect(f.state.positions).toEqual([f.other]);expect(f.setPositions).toHaveBeenCalledTimes(1);
    expect(f.feedback).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();expect(f.history).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('restores a rejected position and refreshes the captured account when scope is unchanged', async () => {
    const f = fixture();f.close.mockRejectedValue(new Error('Rejected'));await f.run();
    expect(f.state.positions).toEqual([f.original]);expect(f.overlay.mock.calls.map(([, status]) => status)).toEqual(['pending', 'failed']);
    expect(f.feedback).toHaveBeenCalledTimes(1);expect(f.refresh).toHaveBeenCalledWith(200050, { allowWsCommit: true });expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('presentation exceptions cannot abandon the original promise or release its claim early', async () => {
    const f = fixture();let settle!: () => void;f.close.mockImplementation(() => new Promise<void>(resolve => { settle = resolve; }));
    f.overlay.mockImplementation(() => { throw new Error('Presentation failed'); });
    const operation = f.run();expect(f.release).not.toHaveBeenCalled();expect(f.context.closingTicketsRef.current.size).toBe(1);
    settle();await operation;expect(f.close).toHaveBeenCalledTimes(1);expect(f.release).toHaveBeenCalledTimes(1);expect(f.state.positions).toEqual([]);
    expect(f.context.closingTicketsRef.current.size).toBe(0);expect(f.feedback).not.toHaveBeenCalled();
  });
  it('quote-demand preparation switching account stops dispatch and captured-account catch feedback', async () => {
    const f = fixture();f.addSymbols.mockImplementation(() => { f.switchAccount();throw Error('Demand failed'); });
    await f.run();expect(f.close).not.toHaveBeenCalled();expect(f.overlay).not.toHaveBeenCalled();expect(f.setPositions).not.toHaveBeenCalled();
    expect(f.feedback).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledTimes(1);expect(f.state.positions).toEqual([f.other]);
  });
});

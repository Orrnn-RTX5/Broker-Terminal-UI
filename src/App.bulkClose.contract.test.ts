import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const bottomDockSource = readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8');

const bulkStart = appSource.indexOf("const handleCloseBulk = async (type: 'ALL' | 'WINNERS' | 'LOSERS'");
const bulkEnd = appSource.indexOf('// Connect to WebSocket using centralized hook', bulkStart);
const bulkHandler = appSource.slice(bulkStart, bulkEnd);

const startedStart = bulkHandler.indexOf('onCandidatesStarted: (candidates) => {');
const startedEnd = bulkHandler.indexOf('onTicketConfirmed: (ticketId) => {', startedStart);
const candidatesStartedHandler = bulkHandler.slice(startedStart, startedEnd);

const singleStart = appSource.indexOf('const handleClosePosition = async (');
const singleEnd = appSource.indexOf('// ── cTrader-style chart position actions', singleStart);
const singleHandler = appSource.slice(singleStart, singleEnd);

const dockStart = bottomDockSource.indexOf("const handleTradeCloseBulk = useCallback((type: 'ALL' | 'WINNERS' | 'LOSERS'");
const dockEnd = bottomDockSource.indexOf('// Helpers', dockStart);
const dockHandler = bottomDockSource.slice(dockStart, dockEnd);

describe('Close All source contract', () => {
  it('does not remove dock positions before App confirmation and execution', () => {
    expect(dockStart).toBeGreaterThan(-1);
    expect(dockEnd).toBeGreaterThan(dockStart);
    expect(dockHandler).toContain('onCloseBulk?.(type, symbol)');
    expect(dockHandler).not.toContain('removePositionsByMode');
  });

  it('uses the current account and the working per-ticket close contract for every bulk mode', () => {
    expect(bulkStart).toBeGreaterThan(-1);
    expect(bulkEnd).toBeGreaterThan(bulkStart);
    expect(bulkHandler).toContain('const accId = getLiveTradingLogin();');
    expect(bulkHandler).toContain('.getPositions(accId, { limit: 500, offset: 0 })');
    expect(bulkHandler).toContain('await closePositionsLocalFirst({');
    expect(bulkHandler).toContain('localCandidates,');
    expect(bulkHandler).toContain('loadAuthoritativeCandidates: async () =>');
    expect(bulkHandler).toContain('onCandidatesStarted: (candidates) => {');
    expect(bulkHandler).toContain('(ticketId) => api.positions.closePosition(String(ticketId))');
    expect(bulkHandler).not.toContain('for (const position of candidates)');
    expect(bulkHandler).not.toContain('accountV2Api.closeAllPositions');
  });

  it('keeps every row visible until the backend confirms that ticket (MT5 behaviour)', () => {
    expect(startedStart).toBeGreaterThan(-1);
    expect(startedEnd).toBeGreaterThan(startedStart);
    expect(candidatesStartedHandler).not.toContain('setPositions');
    expect(candidatesStartedHandler).not.toContain('markLocalTradeMutation');
    expect(candidatesStartedHandler).not.toContain('dispatchTradeOverlayCloseState');
    expect(bulkHandler).not.toContain("'pending'");

    expect(bulkHandler).toContain('onTicketConfirmed: (ticketId) => {');
    expect(bulkHandler).toContain('markLocalTradeMutation([ticketId]);');
    expect(bulkHandler).toContain('.positions.filter((position) => position.id !== ticketId)');
    expect(bulkHandler).toContain("dispatchTradeOverlayCloseState([ticketId], 'confirmed', {");
  });

  it('leaves failed tickets open and reports them', () => {
    expect(bulkHandler).not.toContain('clearOptimisticClosedTickets');
    expect(bulkHandler).not.toContain("'failed'");
    expect(bulkHandler).toContain("feedbackLabel('closed')");
    expect(bulkHandler).toContain('${confirmedTicketIds.length}/${closeResult.attemptedTicketIds.length}');
    expect(bulkHandler).toContain('${failedTicketIds.length} — ${failureMessage}');
  });

  it('guards duplicate submissions and stale broker-account results', () => {
    expect(bulkHandler).toContain('if (bulkCloseInFlightRef.current) return;');
    expect(bulkHandler).toContain('bulkCloseInFlightRef.current = true;');
    expect(bulkHandler).toContain('bulkCloseInFlightRef.current = false;');
    expect(bulkHandler).toContain('closingTicketsRef.current.has(ticketId)');
    expect(bulkHandler).toContain('closingTicketsRef.current.add(ticketId)');
    expect(bulkHandler).toContain('closingTicketsRef.current.delete(ticket)');
    expect(bulkHandler).toContain('const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(');
    expect(bulkHandler).toContain('getCurrentSessionKey: getCurrentCloseSessionKey,');
    expect(bulkHandler).toContain('if (getCurrentCloseSessionKey() !== closeSessionScope) return;');
    expect(bulkHandler).toContain('if (!closeResult.sessionCurrent) return;');
  });
});

describe('single position close source contract', () => {
  it('removes the row only after the backend confirms the close', () => {
    expect(singleStart).toBeGreaterThan(-1);
    expect(singleEnd).toBeGreaterThan(singleStart);
    const closeRequest = singleHandler.indexOf('await api.positions.closePosition(String(id));');
    expect(closeRequest).toBeGreaterThan(-1);
    for (const hideStep of [
      'markLocalTradeMutation([id]);',
      'useAppStore.getState().setPositions(',
      "dispatchTradeOverlayCloseState([id], 'confirmed'",
    ]) {
      expect(singleHandler.indexOf(hideStep)).toBeGreaterThan(closeRequest);
    }
    expect(singleHandler).not.toContain("'pending'");
    expect(singleHandler).not.toContain("'failed'");
    expect(singleHandler).not.toContain('clearOptimisticClosedTickets');
  });
});

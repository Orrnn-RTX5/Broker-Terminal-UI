import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const bottomDockSource = readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8');

const bulkStart = appSource.indexOf("const handleCloseBulk = async (type: 'ALL' | 'WINNERS' | 'LOSERS'");
const bulkEnd = appSource.indexOf('// Connect to WebSocket using centralized hook', bulkStart);
const bulkHandler = appSource.slice(bulkStart, bulkEnd);

const dockStart = bottomDockSource.indexOf("const handleTradeCloseBulk = (type: 'ALL' | 'WINNERS' | 'LOSERS'");
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

  it('keeps successful closes confirmed while failed tickets are restored and reported', () => {
    expect(bulkHandler).toContain("dispatchTradeOverlayCloseState(confirmedTicketIds, 'confirmed')");
    expect(bulkHandler).toContain('clearOptimisticClosedTickets(failedTicketIds)');
    expect(bulkHandler).toContain("dispatchTradeOverlayCloseState(failedTicketIds, 'failed')");
    expect(bulkHandler).toContain('Closed ${confirmedTicketIds.length} of ${closeResult.attemptedTicketIds.length} positions.');
  });

  it('guards duplicate submissions and stale broker-account results', () => {
    expect(bulkHandler).toContain('if (bulkCloseInFlightRef.current) return;');
    expect(bulkHandler).toContain('bulkCloseInFlightRef.current = true;');
    expect(bulkHandler).toContain('bulkCloseInFlightRef.current = false;');
    expect(bulkHandler).toContain('closingTicketsRef.current.has(ticketId)');
    expect(bulkHandler).toContain('closingTicketsRef.current.add(ticketId)');
    expect(bulkHandler).toContain('closingTicketsRef.current.delete(ticket)');
    expect(bulkHandler).toContain('const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(');
    expect(bulkHandler).toContain('getCurrentSessionKey: () => {');
    expect(bulkHandler).toContain('if (!closeResult.sessionCurrent) return;');
  });
});

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

const singleSource = readFileSync(resolve(process.cwd(), 'src/app/trading/createPositionCloseHandler.ts'), 'utf8');
const singleStart = singleSource.indexOf('const handleClosePosition = async (');
const singleEnd = singleSource.indexOf('return handleClosePosition;', singleStart);
const singleHandler = singleSource.slice(singleStart, singleEnd);

const dockStart = bottomDockSource.indexOf("const handleTradeCloseBulk = useCallback((type: 'ALL' | 'WINNERS' | 'LOSERS'");
const dockEnd = bottomDockSource.indexOf('// Helpers', dockStart);
const dockHandler = bottomDockSource.slice(dockStart, dockEnd);

describe('Close All source contract', () => {
  it('delegates dock bulk actions to App execution without removing positions itself', () => {
    expect(dockStart).toBeGreaterThan(-1);
    expect(dockEnd).toBeGreaterThan(dockStart);
    expect(dockHandler).toContain('onCloseBulk?.(type, symbol)');
    expect(dockHandler).not.toContain('removePositionsByMode');
    expect(dockHandler).not.toContain('setTimeout');
    expect(dockHandler).not.toContain('toolboxTrade.refresh');
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
    expect(bulkHandler).toContain('(ticketId, candidate) => api.positions.closePosition(String(ticketId), {');
    expect(bulkHandler).toContain('symbol: candidate.symbol');
    expect(bulkHandler).toContain('isCurrent: () => getCurrentCloseSessionKey() === closeSessionScope');
    expect(bulkHandler).not.toContain('for (const position of candidates)');
    expect(bulkHandler).not.toContain('accountV2Api.closeAllPositions');
  });

  it('executes Close All, In-Profit, and In-Loss directly without a confirmation sheet', () => {
    const execution = bulkHandler.indexOf('bulkCloseInFlightScopesRef.current.add(closeSessionScope);');
    const closeRequest = bulkHandler.indexOf('await closePositionsLocalFirst({');
    const beforeExecution = bulkHandler.slice(0, execution);

    expect(bulkStart).toBeGreaterThan(-1);
    expect(bulkHandler).toContain("type: 'ALL' | 'WINNERS' | 'LOSERS'");
    expect(bulkHandler).toContain('if (localCandidates.length === 0) return;');
    expect(appSource).not.toContain('confirmBulkCloseForSession');
    expect(appSource).not.toContain('useBulkCloseConfirmStore');
    expect(appSource).not.toContain('BulkCloseConfirmDialog');
    expect(execution).toBeGreaterThan(-1);
    expect(closeRequest).toBeGreaterThan(execution);
    expect(beforeExecution).not.toContain('await ');
    expect(beforeExecution).not.toContain('getPositions(');
    expect(beforeExecution).not.toContain('setTimeout');
    expect(beforeExecution).not.toContain('requestAnimationFrame');
  });

  it('removes every claimed row immediately, then makes confirmations durable', () => {
    expect(startedStart).toBeGreaterThan(-1);
    expect(startedEnd).toBeGreaterThan(startedStart);
    expect(candidatesStartedHandler).toContain('markLocalTradeMutation(ticketIds);');
    expect(candidatesStartedHandler).toContain("dispatchTradeOverlayCloseState(ticketIds, 'pending', {");
    expect(candidatesStartedHandler).toContain('.positions.filter((position) => !ticketSet.has(position.id))');
    expect(candidatesStartedHandler).toContain('{ removedTickets: ticketIds }');

    expect(bulkHandler).toContain('onTicketConfirmed: (ticketId) => {');
    expect(bulkHandler).toContain('{ closedTickets: [ticketId] }');
    expect(bulkHandler).toContain("dispatchTradeOverlayCloseState([ticketId], 'confirmed', {");
  });

  it('restores failed tickets immediately and reports them', () => {
    expect(bulkHandler).toContain('clearOptimisticClosedTickets(failedTicketIds, closeMarkerScope);');
    expect(bulkHandler).toContain("dispatchTradeOverlayCloseState(failedTicketIds, 'failed');");
    expect(bulkHandler).toContain('closeCandidatesByTicket.get(ticketId)');
    expect(bulkHandler).toContain('store.setPositions([...store.positions, ...restoredPositions]);');
    expect(bulkHandler).toContain("feedbackLabel('closed')");
    expect(bulkHandler).toContain('${confirmedTicketIds.length}/${closeResult.attemptedTicketIds.length}');
    expect(bulkHandler).toContain('${failedTicketIds.length} — ${failureMessage}');
  });

  it('keeps successful bulk closes silent and failure feedback non-modal', () => {
    const failureStart = bulkHandler.indexOf('if (failedTicketIds.length > 0) {');
    const failureEnd = bulkHandler.indexOf('if (closeResult.authoritativeSnapshotError)', failureStart);
    const failureBranch = bulkHandler.slice(failureStart, failureEnd);

    expect(failureStart).toBeGreaterThan(-1);
    expect(failureEnd).toBeGreaterThan(failureStart);
    expect(bulkHandler).not.toContain('buildPositionCloseReport(');
    expect(bulkHandler).not.toContain('closeReportRows');
    expect(bulkHandler).not.toContain("'success',");
    expect(failureBranch).toContain('publishOrderFeedback(');
    expect(failureBranch).toContain("'error',");
    expect(failureBranch).not.toContain('closeReport');
  });

  it('guards duplicate submissions and stale broker-account results', () => {
    expect(bulkHandler).toContain('if (bulkCloseInFlightScopesRef.current.has(closeSessionScope)) return;');
    expect(bulkHandler).toContain('bulkCloseInFlightScopesRef.current.add(closeSessionScope);');
    expect(bulkHandler).toContain('bulkCloseInFlightScopesRef.current.delete(closeSessionScope);');
    expect(bulkHandler).toContain('const ticketKey = createSessionScopedTicketKey(closeSessionScope, ticketId);');
    expect(bulkHandler).toContain('closingTicketsRef.current.has(ticketKey)');
    expect(bulkHandler).toContain('closingTicketsRef.current.add(ticketKey)');
    expect(bulkHandler).toContain('createSessionScopedTicketKey(closeSessionScope, ticket)');
    expect(bulkHandler).toContain('const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(');
    expect(bulkHandler).toContain('getCurrentSessionKey: getCurrentCloseSessionKey,');
    expect(bulkHandler).toContain('if (getCurrentCloseSessionKey() !== closeSessionScope) return;');
    expect(bulkHandler).toContain('if (!closeResult.sessionCurrent) {');
    expect(bulkHandler).toContain('clearOptimisticClosedTickets(closeResult.attemptedTicketIds, closeMarkerScope);');
  });
});

describe('single position close source contract', () => {
  it('removes the row before waiting for confirmation and restores a rejection', () => {
    expect(singleStart).toBeGreaterThan(-1);
    expect(singleEnd).toBeGreaterThan(singleStart);
    const closeRequest = singleHandler.indexOf('await api.positions.closePosition(String(id), {');
    expect(closeRequest).toBeGreaterThan(-1);
    for (const pendingStep of [
      'markLocalTradeMutation([id]);',
      "dispatchTradeOverlayCloseState([id], 'pending'",
      'useAppStore.getState().setPositions(',
      '{ removedTickets: [id] }',
    ]) {
      expect(singleHandler.indexOf(pendingStep)).toBeGreaterThan(-1);
      expect(singleHandler.indexOf(pendingStep)).toBeLessThan(closeRequest);
    }
    expect(singleHandler.indexOf("dispatchTradeOverlayCloseState([id], 'confirmed'")).toBeGreaterThan(closeRequest);
    expect(singleHandler).toContain('clearOptimisticClosedTickets([id], closeMarkerScope);');
    expect(singleHandler).toContain("dispatchTradeOverlayCloseState([id], 'failed');");
    expect(singleHandler).toContain('store.setPositions([...store.positions, ...restoredPositions]);');
  });

  it('scopes close recovery and UI mutation to the initiating broker account', () => {
    expect(singleHandler).toContain('const closeLogin = getLiveTradingLogin();');
    expect(singleHandler).toContain('const closeSessionScope = getCommittedBrokerAccountSessionScopeKey(');
    expect(singleHandler).toContain('const isCurrentCloseSession = () => Boolean(');
    expect(singleHandler).toContain('account_login: closeLogin,');
    expect(singleHandler).toContain('symbol: closingPosition.symbol,');
    expect(singleHandler).toContain('isCurrent: isCurrentCloseSession,');
    expect(singleHandler).toContain('executionContext,');
    expect(singleHandler).toContain('if (!isCurrentCloseSession()) {');
  });

  it('keeps successful single closes silent and reports rejections without a modal receipt', () => {
    expect(singleHandler).not.toContain("scope: 'SINGLE'");
    expect(singleHandler).not.toContain('publishCloseReceipt');
    expect(singleHandler).toContain('publishSingleCloseFailure(formatOrderError(err));');
    expect(singleHandler).toContain("[feedbackLabel('Close position')");
    expect(singleHandler).toContain("'error',");
  });
});

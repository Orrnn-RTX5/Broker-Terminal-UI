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
    expect(bulkHandler).toContain("(ticketId) => api.positions.closePosition(String(ticketId), { account_login: accId })");
    expect(bulkHandler).not.toContain('for (const position of candidates)');
    expect(bulkHandler).not.toContain('accountV2Api.closeAllPositions');
  });

  it('keeps the first confirmation for Close All, In-Profit, and In-Loss', () => {
    const confirmation = bulkHandler.indexOf('await useBulkCloseConfirmStore.getState().showBulkCloseConfirm({');
    const execution = bulkHandler.indexOf('bulkCloseInFlightRef.current = true;');
    const beforeConfirmation = bulkHandler.slice(0, confirmation);

    expect(bulkStart).toBeGreaterThan(-1);
    expect(bulkHandler).toContain("type: 'ALL' | 'WINNERS' | 'LOSERS'");
    expect(bulkHandler).toContain('positions: previewPositions,');
    expect(bulkHandler).toContain('combinedPnL: combinedProfit,');
    expect(bulkHandler).toContain('if (!confirmed) return;');
    expect(confirmation).toBeGreaterThan(-1);
    expect(execution).toBeGreaterThan(confirmation);
    expect(beforeConfirmation).not.toContain('await ');
    expect(beforeConfirmation).not.toContain('getPositions(');
    expect(beforeConfirmation).not.toContain('setTimeout');
    expect(beforeConfirmation).not.toContain('requestAnimationFrame');
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
    expect(bulkHandler).toContain('if (bulkCloseInFlightRef.current) return;');
    expect(bulkHandler).toContain('bulkCloseInFlightRef.current = true;');
    expect(bulkHandler).toContain('bulkCloseInFlightRef.current = false;');
    expect(bulkHandler).toContain('closingTicketsRef.current.has(ticketId)');
    expect(bulkHandler).toContain('closingTicketsRef.current.add(ticketId)');
    expect(bulkHandler).toContain('closingTicketsRef.current.delete(ticket)');
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
    const closeRequest = singleHandler.indexOf("await api.positions.closePosition(String(id), { account_login: closeLogin });");
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
    expect(singleHandler).toContain('{ account_login: closeLogin }');
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

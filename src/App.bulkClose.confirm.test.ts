import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Fail-closed contract for T4: every bulk-close entry (dock buttons, row
// menu, DOM) funnels through App.handleCloseBulk, so the shared
// BulkCloseConfirmDialog + confirmBulkCloseForSession gate must run before
// any order is sent. Dismissal aborts with zero side effects.
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const bottomDockSource = readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8');
const tradeTabSource = readFileSync(
  resolve(process.cwd(), 'src/features/bottom-dock/trade/TradeTab.tsx'),
  'utf8',
);

const bulkStart = appSource.indexOf("const handleCloseBulk = async (type: 'ALL' | 'WINNERS' | 'LOSERS'");
const bulkEnd = appSource.indexOf('// Connect to WebSocket using centralized hook', bulkStart);
const bulkHandler = appSource.slice(bulkStart, bulkEnd);

describe('bulk close confirmation gate', () => {
  it('routes handleCloseBulk through the shared confirm dialog, session-bound', () => {
    expect(bulkStart).toBeGreaterThan(-1);
    expect(bulkEnd).toBeGreaterThan(bulkStart);
    expect(bulkHandler).toContain('confirmBulkCloseForSession');
    expect(bulkHandler).toContain('showBulkCloseConfirm');
    expect(bulkHandler).toContain('closeBulkCloseConfirm');
    expect(bulkHandler).toContain('sessionScope: closeSessionScope');
    expect(bulkHandler).toContain('getCurrentSessionScope');
    expect(bulkHandler).toContain('subscribeToSessionChange');
    expect(bulkHandler).toContain('onCommittedBrokerAccountSessionScopeChange');
    expect(appSource).toContain("from './features/trading/mutations/confirmBulkCloseForSession'");
    expect(appSource).toContain("from './store/useBulkCloseConfirmStore'");
  });

  it('mounts the shared BulkCloseConfirmDialog so the gate can resolve', () => {
    expect(appSource).toContain("from './components/ui/BulkCloseConfirmDialog'");
    expect(appSource).toContain('<BulkCloseConfirmDialog');
  });

  it('builds the confirmation preview from the local candidates only', () => {
    expect(bulkHandler).toContain('localCandidates.map');
    expect(bulkHandler).toContain('backendCloseProfit(position) ?? 0');
    expect(bulkHandler).toContain('combinedPnL');
    const previewIndex = bulkHandler.indexOf('localCandidates.map');
    const confirmIndex = bulkHandler.indexOf('await confirmBulkCloseForSession');
    expect(previewIndex).toBeGreaterThan(-1);
    expect(confirmIndex).toBeGreaterThan(previewIndex);
  });

  it('awaits confirmation before any close, mutation, or refresh — dismiss aborts with zero side effects', () => {
    const confirmIndex = bulkHandler.indexOf('await confirmBulkCloseForSession');
    const dismissIndex = bulkHandler.indexOf('if (!bulkCloseConfirmed) return;');
    const executionIndex = bulkHandler.indexOf('await closePositionsLocalFirst({');
    expect(confirmIndex).toBeGreaterThan(-1);
    expect(dismissIndex).toBeGreaterThan(confirmIndex);
    expect(executionIndex).toBeGreaterThan(dismissIndex);

    // Nothing that sends orders, mutates the store, or refreshes runs on the
    // dismiss path: every one of these first appears at or after execution.
    for (const sideEffect of [
      'api.positions.closePosition',
      'markLocalTradeMutation',
      'dispatchTradeOverlayCloseState',
      'useAppStore.getState().setPositions',
      'refreshPositions(',
    ]) {
      const firstUse = bulkHandler.indexOf(sideEffect);
      expect(firstUse).toBeGreaterThan(dismissIndex);
    }

    // No authoritative network read happens before the user confirms either:
    // the only pre-confirm await is the dialog itself.
    const beforeConfirm = bulkHandler.slice(0, confirmIndex);
    expect(beforeConfirm).not.toContain('getPositions(');
    expect(beforeConfirm).not.toContain('closePosition(');
  });

  it('keeps dock bulk buttons as pure delegation into the gated handler', () => {
    const dockStart = bottomDockSource.indexOf("const handleTradeCloseBulk = useCallback((type: 'ALL' | 'WINNERS' | 'LOSERS'");
    expect(dockStart).toBeGreaterThan(-1);
    const dockHandler = bottomDockSource.slice(dockStart, bottomDockSource.indexOf('// Helpers', dockStart));
    expect(dockHandler).toContain('onCloseBulk?.(type, symbol)');
    expect(dockHandler).not.toContain('confirmBulkCloseForSession');
    expect(dockHandler).not.toContain('showBulkCloseConfirm');
    expect(dockHandler).not.toContain('onClosePosition');
  });

  it('keeps row-menu bulk entries as pure delegation into the gated handler', () => {
    const menuStart = tradeTabSource.indexOf("label: 'Bulk Operations'");
    expect(menuStart).toBeGreaterThan(-1);
    const menuBlock = tradeTabSource.slice(menuStart, tradeTabSource.indexOf('];', menuStart));
    expect(menuBlock).toContain("onCloseBulk?.('ALL')");
    expect(menuBlock).toContain("onCloseBulk?.('WINNERS')");
    expect(menuBlock).toContain("onCloseBulk?.('LOSERS')");
    expect(menuBlock).toContain("onCloseBulk?.('ALL', symbol)");
    expect(menuBlock).not.toContain('confirmBulkCloseForSession');
    expect(menuBlock).not.toContain('showBulkCloseConfirm');
    expect(menuBlock).not.toContain('onClosePosition');
  });
});

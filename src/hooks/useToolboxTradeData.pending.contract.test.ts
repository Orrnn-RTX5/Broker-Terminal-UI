import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hookSource = readFileSync(resolve(process.cwd(), 'src/hooks/useToolboxTradeData.ts'), 'utf8');
const dockSource = [
  readFileSync(resolve(process.cwd(), 'src/components/BottomDock.tsx'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'src/features/bottom-dock/trade/TradeTab.tsx'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'src/features/bottom-dock/trade/TradeTable.tsx'), 'utf8'),
].join('\n');

const lifecycleStart = hookSource.indexOf('const handleMarketOrderPlacement = (event: Event) => {');
const lifecycleEnd = hookSource.indexOf('const handleCloseState', lifecycleStart);
const lifecycleHandler = hookSource.slice(lifecycleStart, lifecycleEnd);
const pendingStart = lifecycleHandler.indexOf("if (['pending', 'accepted', 'processing', 'rejected', 'expired'].includes(detail.status))");
const pendingEnd = lifecycleHandler.indexOf('pendingMarketOrdersRef.current.delete(detail.clientOrderId)', pendingStart);
const pendingBranch = lifecycleHandler.slice(pendingStart, pendingEnd);

describe('Toolbox provisional market-order source contract', () => {
  it('keeps pending rows isolated from confirmed positions and the app store', () => {
    expect(lifecycleStart).toBeGreaterThan(-1);
    expect(lifecycleEnd).toBeGreaterThan(lifecycleStart);
    expect(pendingBranch).toContain('pendingMarketOrdersRef.current.set');
    expect(pendingBranch).toContain('pendingPositions:');
    expect(pendingBranch).not.toContain('commitPositions(');
    expect(lifecycleHandler).toContain("if (detail.status === 'failed') return;");
    expect(lifecycleHandler).toContain('commitPositions(next);');
  });

  it('passes pending rows separately and disables every trade action on them', () => {
    expect(dockSource).toContain('toolboxTrade.pendingPositions');
    expect(dockSource).toContain('() => [...pendingPositions, ...sortedLivePositions]');
    expect(dockSource).toContain('const isPendingPlacement = Boolean(');
    expect(dockSource).toContain('const actionsDisabled = investorReadOnly || isPendingPlacement || isAwaitingClose;');
    expect(dockSource).toContain('disabled={actionsDisabled}');
    expect(dockSource).toContain('openModifyPosition(position);');
    expect(dockSource).toContain('sessionScope: getCurrentBrokerAccountSessionScopeKey()');
    expect(dockSource).toContain('if (actionsDisabled) return;');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('authenticated startup trade-snapshot ownership contract', () => {
  it('shares account and position hydration between App and Toolbox', () => {
    const app = readSource('src/App.tsx');
    const accountSnapshotRuntime = readSource('src/app/trading/useAccountSnapshotRuntime.ts');
    const heartbeatStart = accountSnapshotRuntime.indexOf('const fetchAccountHeartbeat = async');
    const heartbeatEnd = accountSnapshotRuntime.indexOf('void fetchAccountHeartbeat(true)', heartbeatStart);
    const heartbeat = accountSnapshotRuntime.slice(heartbeatStart, heartbeatEnd);

    const toolbox = readSource('src/hooks/useToolboxTradeData.ts');
    const refreshStart = toolbox.indexOf('const refresh = useCallback(async () => {');
    const refreshEnd = toolbox.indexOf('const removePosition = useCallback', refreshStart);
    const refresh = toolbox.slice(refreshStart, refreshEnd);

    expect(app).toContain("import { useAccountSnapshotRuntime } from './app/trading/useAccountSnapshotRuntime'");
    expect(app).toContain('useAccountSnapshotRuntime({');
    expect(app).toContain('setInitialTradeSnapshotSettledFor,');
    expect(heartbeat).toContain('loadSessionTradeSnapshot(loginId)');
    expect(heartbeat).not.toContain('api.account.getAccountSummary(loginId)');
    expect(heartbeat).not.toContain('api.positions.getPositions(loginId)');

    expect(refresh).toContain('getSessionTradeSnapshotRequests(login)');
    expect(refresh.indexOf('await startupRequests.positionsResultPromise'))
      .toBeLessThan(refresh.indexOf('await startupRequests.accountResultPromise'));
    expect(refresh.indexOf('commitPositions('))
      .toBeLessThan(refresh.indexOf('await metricsPromise'));
    expect(refresh).toContain('`/account/${login}/metrics`');
    expect(refresh).not.toContain('`/account/${login}`');
    expect(refresh).not.toContain('`/positions/${login}`');
  });
});

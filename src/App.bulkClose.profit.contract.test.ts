import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('Close Winners/Losers profit contract', () => {
  it('selects tickets from backend profit only', () => {
    expect(appSource).toContain('readBackendPositionProfit');
    expect(appSource).toContain('const profit = backendCloseProfit(position);');
    expect(appSource).toContain('if (profit === null) return false;');
    expect(appSource).not.toContain('const getLivePositionPnL');
    expect(appSource).not.toContain('multiplier = 100000');
  });
});

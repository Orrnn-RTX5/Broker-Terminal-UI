import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = [
  'src/App.tsx',
  'src/app/trading/positionRuntime.ts',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

describe('Close Winners/Losers profit contract', () => {
  it('selects tickets from backend profit only', () => {
    expect(source).toContain('readBackendPositionProfit');
    expect(source).toContain('const profit = backendCloseProfit(position);');
    expect(source).toContain('if (profit === null) return false;');
    expect(source).not.toContain('const getLivePositionPnL');
    expect(source).not.toContain('multiplier = 100000');
  });
});

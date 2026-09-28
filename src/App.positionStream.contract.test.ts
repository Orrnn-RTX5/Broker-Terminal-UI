import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPositionStreamTicket } from './services/tradePositionStream';

const source = [
  'src/app/trading/positionRuntime.ts',
  'src/app/trading/useTradeStreamRuntime.ts',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

describe('App position stream admission contract', () => {
  it('never fabricates a position ticket from its array index', () => {
    expect(source).toContain(
      "raw.ticket ?? raw.position_id ?? raw.position_ticket ?? raw.id ?? ''",
    );
    expect(source).toContain('if (!Number.isFinite(parsedId) || parsedId <= 0) return [];');
    expect(source).not.toContain('raw.ticket ?? raw.id ?? index + 1');
    expect(source).not.toContain('id: Number.isFinite(parsedId) ? parsedId : index + 1');
  });

  it('recognizes broker volume_lots when normalizing a complete position', () => {
    expect(source).toContain('raw.volume_lots ?? raw.quantity ?? raw.volume');
    expect(getPositionStreamTicket({ position_id: 2984272 })).toBe(2984272);
  });

  it('uses shared batch reconciliation for partial and empty stream updates', () => {
    expect(source).toContain('const batch = readPositionStreamBatch(data);');
    expect(source).toContain('reconcilePositionStreamBatch(useAppStore.getState().positions, batch)');
    expect(source).toContain('if (result.needsRevalidation) requestPositionSnapshotRevalidation();');
  });
});

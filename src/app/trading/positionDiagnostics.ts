import { quoteDiagnosticsEnabled, recordQuoteDiagnostic, type QuoteDiagnosticInput } from '../../services/quoteDiagnostics';
import { getPositionId } from '../../services/positionStream';

type Row = {
  symbol?: unknown; id?: unknown; ticket?: unknown; position_id?: unknown; position_ticket?: unknown;
  state_version_text?: unknown; state_version?: unknown; price_time_msc?: unknown;
  price_current?: unknown; current_price?: unknown; currentPrice?: unknown;
  profit?: unknown; unrealized_pl?: unknown; unrealizedPnL?: unknown;
};
const decimal = (value: unknown): string | undefined => (
  (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)))
  && /^\d{1,20}$/.test(String(value)) ? String(value) : undefined
);
const finite = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
};
const fields = (row: Row): Pick<QuoteDiagnosticInput, 'positionVersion' | 'sourcePriceTimeMs' | 'backendPrice' | 'backendProfit'> => ({
  positionVersion: decimal(row.state_version_text ?? row.state_version),
  sourcePriceTimeMs: decimal(row.price_time_msc),
  backendPrice: finite(row.price_current ?? row.current_price ?? row.currentPrice),
  backendProfit: finite(row.profit ?? row.unrealized_pl ?? row.unrealizedPnL),
});
const changed = (before: Row | undefined, after: Row): boolean => {
  if (!before) return true;
  const old = fields(before), next = fields(after);
  return old.positionVersion !== next.positionVersion || old.sourcePriceTimeMs !== next.sourcePriceTimeMs
    || old.backendPrice !== next.backendPrice || old.backendProfit !== next.backendProfit;
};

/** Called only after channel/account/broker/session validation. Tickets are used
 * transiently to inspect the store, never included in evidence. Without ticket
 * identity, multiple same-symbol positions cannot be uniquely joined externally.
 * receiptMonoMs is subscription callback entry, not browser network receipt.
 */
export function beginPositionDiagnostics(
  rows: readonly Row[], before: readonly Row[], receiptMonoMs: number | undefined,
): ((after: readonly Row[]) => void) | undefined {
  if (receiptMonoMs === undefined || !quoteDiagnosticsEnabled()) return undefined;
  try {
    const previous = new Map(before.map(row => [getPositionId(row), row]));
    const captures = rows.flatMap(row => {
      const id = getPositionId(row), existing = previous.get(id);
      const symbol = typeof (row.symbol ?? existing?.symbol) === 'string' ? String(row.symbol ?? existing?.symbol).trim().toUpperCase() : '';
      if (!Number.isSafeInteger(id) || !(id > 0) || !/^[A-Z0-9_.-]{1,64}$/.test(symbol)) return [];
      const evidence = fields(row);
      recordQuoteDiagnostic({ kind: 'position', phase: 'position-received', transport: 'v2', symbol, receiptMonoMs, ingestMonoMs: performance.now(), positionCount: before.length, ...evidence });
      return [{ id, existing, symbol, evidence }];
    });
    return (after) => {
      if (!quoteDiagnosticsEnabled()) return;
      try {
        const appliedAt = performance.now();
        const current = new Map(after.map(row => [getPositionId(row), row]));
        for (const capture of captures) {
          const applied = current.get(capture.id);
          if (!applied) continue; // Closure/removal has no applied price state.
          const state = fields(applied);
          // Inspect the actual accepted state, not merely a reconciliation call.
          // Rejected versions, rejected old P&L timestamps and exact repeats
          // must not be presented as newly applied position prices.
          if (!changed(capture.existing, applied)) continue;
          if (capture.evidence.positionVersion !== undefined && capture.evidence.positionVersion !== state.positionVersion) continue;
          if (capture.evidence.sourcePriceTimeMs !== undefined && capture.evidence.sourcePriceTimeMs !== state.sourcePriceTimeMs) continue;
          if (capture.evidence.backendPrice !== undefined && capture.evidence.backendPrice !== state.backendPrice) continue;
          if (capture.evidence.backendProfit !== undefined && capture.evidence.backendProfit !== state.backendProfit) continue;
          recordQuoteDiagnostic({ kind: 'position', phase: 'position-applied', transport: 'v2', symbol: capture.symbol, receiptMonoMs, ingestMonoMs: appliedAt, positionCount: after.length, accepted: true, ...state });
        }
      } catch { /* Diagnostic failures cannot affect trading state. */ }
    };
  } catch { return undefined; }
}

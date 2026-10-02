import { tradeGatewayApi } from '../../../api/tradeGateway';
import { readBackendNumber } from '../../../services/backendAccountMetrics';

export type HistoryBalanceOperation = {
  id: string;
  type: 'deposit' | 'withdrawal' | 'credit';
  amount: number;
  time: number | null;
};

const recordsFrom = (value: unknown, depth = 0): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && depth < 4) {
    const record = value as Record<string, unknown>;
    for (const key of ['history', 'data', 'items', 'results']) {
      if (record[key] !== undefined) return recordsFrom(record[key], depth + 1);
    }
  }
  throw new Error('Balance history response is unavailable');
};

const operationTime = (value: unknown): number | null => {
  const numeric = readBackendNumber(value) ?? null;
  if (numeric !== null) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Load the account ledger separately; it may repeat cash records in /deals. */
export const loadBalanceHistory = async (
  login: number,
  isCurrent: () => boolean = () => true,
): Promise<HistoryBalanceOperation[]> => {
  const operations: HistoryBalanceOperation[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 500_000; offset += 500) {
    if (!isCurrent()) throw new Error('History session changed');
    const page = recordsFrom(await tradeGatewayApi.getBalanceHistory(login, 500, offset));
    let added = 0;
    for (const value of page) {
      if (!value || typeof value !== 'object') throw new Error('Invalid balance history record');
      const record = value as Record<string, unknown>;
      if (record.account_login !== undefined && Number(record.account_login) !== login) {
        throw new Error('Balance history belongs to another account');
      }
      const type = String(record.type ?? '').trim().toLowerCase();
      const amount = readBackendNumber(record.amount) ?? null;
      if (!['deposit', 'withdrawal', 'credit'].includes(type) || amount === null || record.id == null) {
        throw new Error('Incomplete balance history record');
      }
      const id = String(record.id);
      if (seen.has(id)) continue;
      seen.add(id);
      added += 1;
      operations.push({
        id,
        type: type as HistoryBalanceOperation['type'],
        amount: type === 'withdrawal' ? -Math.abs(amount) : amount,
        time: operationTime(record.time),
      });
    }
    if (page.length < 500) return operations;
    if (!added) throw new Error('Balance history pagination did not advance');
  }
  throw new Error('Balance history exceeds the supported page limit');
};

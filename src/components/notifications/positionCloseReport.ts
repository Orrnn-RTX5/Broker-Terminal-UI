export type PositionCloseScope = 'ALL' | 'WINNERS' | 'LOSERS';
export type PositionCloseOutcome = 'completed' | 'partial' | 'failed';

export type PositionCloseReportRow = {
  ticket: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  /** Quote the close was sent against; the broker fill may differ by slippage. */
  closePrice: number | null;
  /** Backend unrealized profit at the moment the close was sent. */
  profit: number | null;
  digits: number;
  status: 'closed' | 'rejected';
};

/** Structured receipt for a bulk position close, rendered by ActionFeedbackToast. */
export type PositionCloseReport = {
  kind: 'position-close';
  scope: PositionCloseScope;
  symbol?: string;
  requested: number;
  closed: number;
  rows: PositionCloseReportRow[];
  /** Sum of known profits for closed rows, or null when none were known. */
  realizedProfit: number | null;
  currency?: string;
  failureReason?: string;
  completedAt: number;
};

type BuildPositionCloseReportInput = {
  scope: PositionCloseScope;
  symbol?: string;
  rows: readonly Omit<PositionCloseReportRow, 'status'>[];
  confirmedTicketIds: readonly number[];
  failedTicketIds: readonly number[];
  currency?: string;
  failureReason?: string;
  completedAt?: number;
};

export const getPositionCloseOutcome = (report: Pick<PositionCloseReport, 'closed' | 'requested'>): PositionCloseOutcome => {
  if (report.closed <= 0) return 'failed';
  return report.closed >= report.requested ? 'completed' : 'partial';
};

export const buildPositionCloseReport = ({
  scope,
  symbol,
  rows,
  confirmedTicketIds,
  failedTicketIds,
  currency,
  failureReason,
  completedAt = Date.now(),
}: BuildPositionCloseReportInput): PositionCloseReport => {
  const confirmed = new Set(confirmedTicketIds);
  const failed = new Set(failedTicketIds);
  const reportRows = rows
    .filter((row) => confirmed.has(row.ticket) || failed.has(row.ticket))
    .map((row): PositionCloseReportRow => ({
      ...row,
      status: confirmed.has(row.ticket) ? 'closed' : 'rejected',
    }))
    // Rejections first so a partial result leads with what needs attention.
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'rejected' ? -1 : 1));

  const knownProfits = reportRows
    .filter((row) => row.status === 'closed' && row.profit !== null && Number.isFinite(row.profit))
    .map((row) => row.profit as number);

  return {
    kind: 'position-close',
    scope,
    symbol: symbol || undefined,
    requested: confirmed.size + failed.size,
    closed: confirmed.size,
    rows: reportRows,
    realizedProfit: knownProfits.length > 0 ? knownProfits.reduce((sum, value) => sum + value, 0) : null,
    currency: currency?.trim() || undefined,
    failureReason: failed.size > 0 ? failureReason : undefined,
    completedAt,
  };
};

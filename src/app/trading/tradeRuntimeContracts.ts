export interface TradeRestRead {
  startedAt: number;
  startedVersion: number;
  startedLocalMutationVersion: number;
}

export interface RefreshPositionsOptions {
  allowWsCommit?: boolean;
}

export interface PendingPositionsRefresh {
  login: number;
  options?: RefreshPositionsOptions;
}

export interface OptimisticCloseReconcileOptions {
  clearConfirmedAbsent?: boolean;
}

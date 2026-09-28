export interface ActiveMarketSymbolsSnapshot {
  symbols: string[];
  loading: boolean;
  settled: boolean;
  current: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

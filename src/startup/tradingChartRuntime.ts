type TradingChartModule = typeof import('../components/TradingChart');

let tradingChartRuntimePromise: Promise<TradingChartModule> | null = null;
let resolvedTradingChartRuntime: TradingChartModule | null = null;

/**
 * Warm the large chart graph without making it part of the authenticated-shell
 * gate. The broker request is dispatched before this loader is started.
 */
export const preloadTradingChartRuntime = (): Promise<TradingChartModule> => {
  if (resolvedTradingChartRuntime) return Promise.resolve(resolvedTradingChartRuntime);

  if (!tradingChartRuntimePromise) {
    tradingChartRuntimePromise = import('../components/TradingChart')
      .then((module) => {
        resolvedTradingChartRuntime = module;
        return module;
      })
      .catch((error) => {
        tradingChartRuntimePromise = null;
        throw error;
      });
  }

  return tradingChartRuntimePromise;
};

export const getResolvedTradingChartRuntime = (): TradingChartModule | null => (
  resolvedTradingChartRuntime
);

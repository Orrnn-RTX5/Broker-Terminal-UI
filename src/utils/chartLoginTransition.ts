import { getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';

export interface ChartLoginPresentation {
  sessionScope: string;
  marketSource: string;
  symbol: string;
  timeframe: string;
}

/** Token-free identity of the explicitly configured public web market. */
export const getChartMarketSourceIdentity = (): string => {
  if (isDesktopBackendTarget()) return '';
  const configuration = getRuntimeBrokerConfiguration();
  if (!configuration.valid) return '';
  return JSON.stringify([
    configuration.brokerId, configuration.apiHost, configuration.apiHostExt,
    configuration.wsHost, configuration.feedBrokerId,
    configuration.publicCandleBridge, configuration.publicMarketApi,
  ]);
};

/** Keep only the public guest presentation while this same chart authenticates. */
export const canRetainPublicChartOnLogin = (
  previous: ChartLoginPresentation,
  next: ChartLoginPresentation,
): boolean => (
  previous.sessionScope.startsWith('anonymous|')
  && next.sessionScope.startsWith('authenticated|')
  && Boolean(previous.marketSource)
  && previous.marketSource === next.marketSource
  && Boolean(previous.symbol.trim())
  && previous.symbol.trim().toUpperCase() === next.symbol.trim().toUpperCase()
  && previous.timeframe === next.timeframe
);

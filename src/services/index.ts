// Service exports
export { default as api } from './api';
export * from './api';
export {
  accountV2Api,
  authV2Api,
  brokerV2Api,
  historyV2Api,
  marketV2Api,
  tradeApi,
  tradingV2Api,
  watchlistV2Api,
  TradeWebSocketClient,
  destroyTradeWebSocketClient,
  getTradeWebSocketClient,
} from './tradeApi';
export type {
  TradeSocketHandler,
  TradeSocketOptions,
  TradeSocketState,
} from './tradeApi';

export { historyDataManager } from './historyDataManager';
export { chartDataService } from './chartDataService';
export { CacheManager } from './cache-manager';
export {
  commandBus,
  dispatchCommand,
  getCommandHistory,
  clearCommandHistory,
  replayCommands,
} from './commandBus';

// Chart services
export { chartManager } from './chartManager';
export { drawingManager } from './drawingManager';
export { indicatorManager } from './indicatorManager';
export { ChartExporter } from './chartExporter';
export type { ChartExportOptions, ChartMetadata } from './chartExporter';

// Candle Engine
export { CandleEngine, createCandleEngine } from './candleEngine';
export type { CandleEngineConfig, CandleProcessingResult } from './candleEngine';

// Types
export type { Drawing, DrawingType, DrawingPoint } from './drawingManager';
export type { IndicatorConfig } from './indicatorManager';
export type { OHLCData, Timeframe } from './chartDataService';

// Trade Sound (TTS)
export { tradeSoundService, default as tradeSoundServiceDefault } from './tradeSoundService';

// Fix Market Data WebSocket
export {
  FixMarketDataSocket,
  getFixMarketDataSocket,
  destroyFixMarketDataSocket,
} from './fixMarketDataSocket';
export type {
  FixSocketState,
  FixTickMessage,
  FixCandleMessage,
  FixSocketMessage,
} from './fixMarketDataSocket';

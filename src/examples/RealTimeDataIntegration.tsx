/**
 * Example Integration of Advanced Real-Time Data Features
 * Demonstrates how to use all the optimized components together
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { useMarketDataStore, useCurrentTick, useSymbolStats } from '../store/useMarketDataStore';
import { getCacheManager } from '../services/cache-manager';
import { useWebWorker } from '../hooks/useWebWorker';
import { getPerformanceMonitor } from '../services/performance-monitor';
import { getErrorHandler, setupGlobalErrorHandler } from '../services/error-handler';


// ============================================
// Real-Time Price Display Component
// ============================================

const PriceDisplay = React.memo(({ symbol }: { symbol: string }) => {
  const startTime = performance.now();

  // Use optimized selector to prevent unnecessary re-renders
  const tick = useCurrentTick(symbol);
  const stats = useSymbolStats(symbol);

  useEffect(() => {
    const renderTime = performance.now() - startTime;
    getPerformanceMonitor().recordRender('PriceDisplay', renderTime);
  });

  if (!tick) {
    return <div>Loading {symbol}...</div>;
  }

  return (
    <div className="price-display">
      <h3>{symbol}</h3>
      <div className="prices">
        <span className="bid">Bid: {tick.bid.toFixed(5)}</span>
        <span className="ask">Ask: {tick.ask.toFixed(5)}</span>
        <span className="spread">Spread: {tick.spread.toFixed(1)}</span>
      </div>
      {stats && (
        <div className="stats">
          <div>24h High: {stats.high24h.toFixed(5)}</div>
          <div>24h Low: {stats.low24h.toFixed(5)}</div>
          <div>
            24h Change: {stats.change24h.toFixed(5)} ({stats.changePercent24h.toFixed(2)}%)
          </div>
          <div>VWAP: {stats.vwap.toFixed(5)}</div>
          <div>SMA(20): {stats.sma20.toFixed(5)}</div>
          <div>EMA(20): {stats.ema20.toFixed(5)}</div>
        </div>
      )}
    </div>
  );
});

PriceDisplay.displayName = 'PriceDisplay';

// ============================================
// Performance Monitor Component
// ============================================

const PerformanceStats = React.memo(() => {
  const [metrics, setMetrics] = React.useState(() => getPerformanceMonitor().getMetrics());

  useEffect(() => {
    const unsubscribe = getPerformanceMonitor().subscribe((newMetrics) => {
      setMetrics(newMetrics);
    });

    return unsubscribe;
  }, []);

  const degradation = useMemo(() => {
    return getPerformanceMonitor().isPerformanceDegraded();
  }, [metrics]);

  return (
    <div className={`performance-stats ${degradation.degraded ? 'degraded' : ''}`}>
      <h4>Performance</h4>
      <div>FPS: {metrics.fps}</div>
      <div>Memory: {metrics.memoryUsage}MB</div>
      <div>WS Latency: {metrics.wsLatency}ms</div>
      <div>Ticks/sec: {metrics.ticksPerSecond}</div>
      {degradation.degraded && (
        <div className="warnings">
          {degradation.reasons.map((reason, i) => (
            <div key={i} className="warning">
              {reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

PerformanceStats.displayName = 'PerformanceStats';

// ============================================
// Main Integration Example
// ============================================

export const RealTimeDataIntegration: React.FC = () => {
  const [symbols] = React.useState(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']);
  const [wsConnected, setWsConnected] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);

  const updateTick = useMarketDataStore((state) => state.updateTick);
  const subscribeSymbol = useMarketDataStore((state) => state.subscribeSymbol);

  // Web Worker for calculations
  const { postMessage: calculateIndicators } = useWebWorker(
    '../workers/aggregation.worker.ts'
  );

  // Initialize services
  useEffect(() => {
    const initServices = async () => {
      try {
        // Setup global error handler
        setupGlobalErrorHandler();

        // Initialize cache
        const cache = await getCacheManager();
        console.log('[App] Cache initialized');

        // Initialize WebSocket
        const ws = getEnhancedWebSocketService('ws://localhost:7999/ws');

        // Listen to connection state
        ws.onStateChange((state) => {
          console.log('[App] WebSocket state:', state);
          setWsConnected(state === 'connected');
        });

        // Listen to metrics
        ws.onMetricsChange((metrics) => {
          getPerformanceMonitor().recordWSLatency(metrics.lastLatency);
        });

        // Subscribe to error events
        getErrorHandler().subscribe((error) => {
          setErrors((prev) => [...prev, error.userMessage].slice(-5));
        });

        // Connect WebSocket
        ws.connect();

        // Subscribe to symbols
        symbols.forEach((symbol) => {
          subscribeSymbol(symbol);

          ws.subscribe(symbol, (data: any) => {
            // Record tick for performance monitoring
            getPerformanceMonitor().recordTick();

            // Update store
            updateTick(symbol, {
              symbol,
              bid: data.bid,
              ask: data.ask,
              spread: data.spread,
              timestamp: data.timestamp || Date.now(),
              volume: data.volume,
            });

            // Cache the tick
            cache.set(`tick:${symbol}:latest`, data, { ttl: 60000 });
          });
        });

        // Cleanup expired cache every 5 minutes
        const cleanupInterval = setInterval(() => {
          cache.cleanup();
        }, 5 * 60 * 1000);

        return () => {
          clearInterval(cleanupInterval);
          ws.disconnect();
        };
      } catch (error) {
        getErrorHandler().handleError(
          error as Error,
          { component: 'RealTimeDataIntegration', action: 'init' },
          'critical'
        );
      }
    };

    initServices();
  }, [symbols, subscribeSymbol, updateTick]);

  // Calculate indicators using Web Worker
  const calculateIndicatorsForSymbol = useCallback(
    async (symbol: string) => {
      try {
        const ohlcv = useMarketDataStore.getState().getOHLCV(symbol, '1h');

        if (ohlcv.length === 0) return;

        const result = await calculateIndicators('indicators', {
          ohlcv,
          indicators: ['sma20', 'ema20', 'rsi', 'macd'],
        });

        console.log(`[App] Indicators for ${symbol}:`, result);
      } catch (error) {
        getErrorHandler().handleComponentError(
          error as Error,
          'RealTimeDataIntegration',
          { action: 'calculateIndicators', metadata: { symbol } }
        );
      }
    },
    [calculateIndicators]
  );

  // Trigger indicator calculation every minute
  useEffect(() => {
    const interval = setInterval(() => {
      symbols.forEach((symbol) => {
        calculateIndicatorsForSymbol(symbol);
      });
    }, 60000);

    return () => clearInterval(interval);
  }, [symbols, calculateIndicatorsForSymbol]);

  return (
    <div className="real-time-integration">
      <div className="status-bar">
        <div className={`connection-status ${wsConnected ? 'connected' : 'disconnected'}`}>
          {wsConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
        <PerformanceStats />
      </div>

      <div className="symbols-grid">
        {symbols.map((symbol) => (
          <PriceDisplay key={symbol} symbol={symbol} />
        ))}
      </div>

      {errors.length > 0 && (
        <div className="error-panel">
          <h4>Recent Errors</h4>
          {errors.map((error, i) => (
            <div key={i} className="error-message">
              {error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RealTimeDataIntegration;

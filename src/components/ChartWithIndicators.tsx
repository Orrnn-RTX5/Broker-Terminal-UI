/**
 * Chart With Indicators
 * Wrapper component that integrates TradingChart with IndicatorNavigator
 */

import { useState, useEffect } from 'react';
import { TradingChart } from './TradingChart';
import type { ChartType, Timeframe } from './TradingChart';
import { IndicatorNavigator } from './IndicatorNavigator';
import type { IndicatorInfo } from './IndicatorNavigator';
import { indicatorManager } from '../services/indicatorManager';

interface ChartWithIndicatorsProps {
  symbol: string;
  currentPrice?: { bid: number; ask: number };
  chartType?: ChartType;
  timeframe?: Timeframe;
  positions?: any[];
  onClosePosition?: (id: number) => void;
  onModifyPosition?: (id: number, sl: number, tp: number) => void;
}

export function ChartWithIndicators(props: ChartWithIndicatorsProps) {
  const [showIndicatorNavigator, setShowIndicatorNavigator] = useState(false);

  // Subscribe to indicator navigator command (will work when Agent 1 creates commandBus)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const setupCommandBus = async () => {
      try {
        const { commandBus } = await import('../services/commandBus');

        unsubscribe = commandBus.subscribe('OPEN_INDICATOR_NAVIGATOR', () => {
          setShowIndicatorNavigator(true);
        });
      } catch (error) {
        console.log('Command bus not yet available');
      }
    };

    setupCommandBus();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleAddIndicator = (indicator: IndicatorInfo) => {
    indicatorManager.addIndicator({
      id: indicator.id,
      name: indicator.name,
      type: indicator.id.split('-')[0], // Extract base type from ID
      parameters: indicator.parameters || {},
      visible: true,
      color: undefined // Use default color
    });

    setShowIndicatorNavigator(false);
  };

  return (
    <>
      <TradingChart {...props} />

      <IndicatorNavigator
        isOpen={showIndicatorNavigator}
        onClose={() => setShowIndicatorNavigator(false)}
        onAddIndicator={handleAddIndicator}
      />
    </>
  );
}

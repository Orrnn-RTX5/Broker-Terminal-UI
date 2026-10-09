import { memo, useEffect, useState } from 'react';
import { commandBus } from '../services/commandBus';
import { getActiveChartCommandTarget } from '../services/chartCommandTarget';
import { useChartSettingsStore } from '../store/useChartSettingsStore';
import type { Timeframe } from '../types/chart';
import { IndicatorNavigator, type IndicatorInfo } from './IndicatorNavigator';

type IndicatorRequest = {
  category?: string;
  targetContextId?: string;
  symbol?: string;
};

/** Keep opening this small, ready-to-render dialog out of the terminal render. */
export const IndicatorNavigatorHost = memo(function IndicatorNavigatorHost({
  selectedSymbol,
  timeframe,
}: { selectedSymbol: string; timeframe: Timeframe }) {
  const [request, setRequest] = useState<IndicatorRequest | null>(null);

  useEffect(() => commandBus.subscribe('OPEN_INDICATOR_LIST', payload => {
    const activeTarget = getActiveChartCommandTarget();
    setRequest({
      category: payload.category,
      targetContextId: payload.targetContextId ?? activeTarget.targetContextId,
      symbol: payload.symbol ?? activeTarget.symbol,
    });
  }), []);

  if (!request) return null;

  const addIndicator = (indicator: IndicatorInfo) => {
    const activeTarget = getActiveChartCommandTarget(selectedSymbol, timeframe);
    const targetContextId = request.targetContextId ?? activeTarget.targetContextId;
    const targetSymbol = request.symbol ?? activeTarget.symbol ?? selectedSymbol;
    if (indicator.category === 'Volume' && indicator.name === 'Volume') {
      const settings = useChartSettingsStore.getState();
      if (targetSymbol) {
        settings.updateSymbolProperty(targetSymbol, 'showTickVolumes', true);
        settings.updateSymbolProperty(targetSymbol, 'showRealVolumes', false);
      } else {
        settings.updateGlobalProperty('showTickVolumes', true);
        settings.updateGlobalProperty('showRealVolumes', false);
      }
    } else {
      commandBus.dispatch({
        type: 'ADD_INDICATOR',
        payload: {
          id: indicator.id,
          name: indicator.name,
          indicatorType: indicator.id.replace(/-\d+$/, ''),
          params: indicator.parameters ?? {},
          targetContextId,
          symbol: targetSymbol,
        },
      });
    }
    setRequest(null);
  };

  return <IndicatorNavigator isOpen initialCategory={request.category}
    onClose={() => setRequest(null)} onAddIndicator={addIndicator} />;
});

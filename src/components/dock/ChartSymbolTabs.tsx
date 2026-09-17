import { useEffect, useRef } from 'react';
import type { DockPanelConfig } from '../../services/dockManager';
import { getChartSymbolTabs, hasArrangedChartWindows } from '../../utils/chartSymbolTabs';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { normalizeExactBrokerSymbol } from '../../utils/exactBrokerSymbol';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { Icon } from '../ui/Icon';
import { X } from 'lucide-react';
import { closeChartPanelSymbolTab } from '../../services/chartPanelNavigation';

export function ChartSymbolTabs({ panel }: { panel: DockPanelConfig }) {
  const tr = useUiTranslation();
  const showSymbolDropdown = useDockLayoutStore(state => hasArrangedChartWindows(state.layout));
  const activeRef = useRef<HTMLButtonElement>(null);
  const symbol = normalizeExactBrokerSymbol(panel.props?.symbol);
  const tabs = getChartSymbolTabs(panel);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [symbol]);

  if (!tabs.length) return <span>{panel.title}</span>;
  return (
    <span role="tablist" aria-label={tr('Symbol charts')} className="flex flex-1 min-w-0 h-full overflow-x-auto [scrollbar-width:none]">
      {tabs.map(tab => {
        const active = normalizeExactBrokerSymbol(tab.symbol) === symbol;
        return (
          <span key={tab.symbol} className={`flex shrink-0 items-center border-r border-[var(--border-primary)] ${active ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}>
            <button
              ref={active ? activeRef : undefined}
              type="button" role="tab" aria-selected={active}
              aria-label={`${tab.symbol}, ${tab.timeframe}`}
              className="inline-flex items-center gap-2 px-2 h-full whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400"
              onClick={event => {
                event.stopPropagation();
                window.dispatchEvent(new CustomEvent('openChart', { detail: { panelId: panel.id, symbol: tab.symbol } }));
              }}
            >
              <span>{tab.symbol}</span><span className="text-[12px] opacity-70">{tab.timeframe}</span>
            </button>
            {active && showSymbolDropdown && <button type="button"
              className="h-full px-1 hover:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400"
              aria-label={tr('Change symbol for {{symbol}}', { symbol: tab.symbol })}
              title={tr('Change chart symbol')}
              onClick={event => {
                event.stopPropagation();
                window.dispatchEvent(new CustomEvent('request-chart-symbol-change', { detail: { panelId: panel.id } }));
              }}><Icon name="chevron-down" size="xs" /></button>}
            {panel.closable !== false && <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center w-5 h-5 mr-1 rounded-sm text-zinc-400 hover:bg-red-500/80 hover:text-white transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400"
              aria-label={tr('Close {{symbol}} tab', { symbol: tab.symbol })}
              title={tr('Close {{symbol}} tab', { symbol: tab.symbol })}
              onMouseDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                closeChartPanelSymbolTab(panel.id, tab.symbol);
              }}
            ><X className="w-3 h-3" /></button>}
          </span>
        );
      })}
    </span>
  );
}

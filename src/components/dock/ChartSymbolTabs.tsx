import { Fragment, useEffect, useRef } from 'react';
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const symbol = normalizeExactBrokerSymbol(panel.props?.symbol);
  const tabs = getChartSymbolTabs(panel);
  useEffect(() => {
    tabRefs.current.find(button => button?.getAttribute('aria-selected') === 'true')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [symbol]);

  if (!tabs.length) return <span>{panel.title}</span>;
  return (
    <span className="grid flex-1 min-w-0 h-full overflow-x-auto [scrollbar-width:none]"
      style={{ gridTemplateColumns: tabs.map(tab => `max-content ${showSymbolDropdown && normalizeExactBrokerSymbol(tab.symbol) === symbol ? '24px' : '0px'} ${panel.closable !== false ? '24px' : '0px'}`).join(' ') }}>
      <span role="tablist" aria-label={tr('Symbol charts')} className="contents">
      {tabs.map((tab, index) => {
        const active = normalizeExactBrokerSymbol(tab.symbol) === symbol;
        return (
            <button
              key={tab.symbol}
              ref={button => { tabRefs.current[index] = button; }}
              type="button" role="tab" aria-selected={active}
              aria-label={`${tab.symbol} ${tab.timeframe}`}
              tabIndex={active ? 0 : -1}
              style={{ gridColumn: index * 3 + 1, gridRow: 1 }}
              className={`inline-flex items-center gap-2 px-2 h-full min-h-6 whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400 ${active ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
              onKeyDown={event => {
                const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                if (next === null) return;
                event.preventDefault();
                tabRefs.current[next]?.focus();
                tabRefs.current[next]?.click();
              }}
              onClick={event => {
                event.stopPropagation();
                window.dispatchEvent(new CustomEvent('openChart', { detail: { panelId: panel.id, symbol: tab.symbol } }));
              }}
            >
              <span>{tab.symbol}</span><span className="text-[12px] opacity-70">{tab.timeframe}</span>
            </button>
        );
      })}
      </span>
      {tabs.map((tab, index) => {
        const active = normalizeExactBrokerSymbol(tab.symbol) === symbol;
        return <Fragment key={tab.symbol}>
            {active && showSymbolDropdown && <button type="button"
              style={{ gridColumn: index * 3 + 2, gridRow: 1 }}
              className="h-full min-h-6 px-1 hover:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400"
              aria-label={tr('Change symbol for {{symbol}}', { symbol: tab.symbol })}
              title={tr('Change chart symbol')}
              onClick={event => {
                event.stopPropagation();
                window.dispatchEvent(new CustomEvent('request-chart-symbol-change', { detail: { panelId: panel.id } }));
              }}><Icon name="chevron-down" size="xs" /></button>}
            {panel.closable !== false && <button
              type="button"
              style={{ gridColumn: index * 3 + 3, gridRow: 1 }}
              className="inline-flex shrink-0 items-center justify-center w-6 h-6 border-r border-[var(--border-primary)] rounded-sm text-zinc-400 hover:bg-red-500/80 hover:text-white transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400"
              aria-label={tr('Close {{symbol}} tab', { symbol: tab.symbol })}
              title={tr('Close {{symbol}} tab', { symbol: tab.symbol })}
              onMouseDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                closeChartPanelSymbolTab(panel.id, tab.symbol);
              }}
            ><X className="w-3 h-3" /></button>}
          </Fragment>;
      })}
    </span>
  );
}

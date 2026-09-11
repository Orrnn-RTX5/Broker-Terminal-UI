import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { useUiTranslation } from '../hooks/useUiTranslation';
import './ChartSymbolDropdown.css';

export interface ChartSymbolAnchor { left: number; bottom: number }

export function ChartSymbolTrigger({ symbol, panelId }: { symbol: string; panelId?: string }) {
  const tr = useUiTranslation();
  if (!window.electron?.window || !panelId) return <>{symbol}</>;
  return <button type="button" className="rtx-chart-symbol-trigger" aria-haspopup="listbox"
    aria-label={tr('Change symbol for {{value0}}', { value0: symbol })}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('request-chart-symbol-change', {
        detail: { panelId, anchor: { left: rect.left, bottom: rect.bottom } },
      }));
    }}>
    {symbol}<ChevronDown size={11} aria-hidden="true" />
  </button>;
}

export function ChartSymbolDropdown({ symbols, currentSymbol, anchor, onSelect, onClose }: {
  symbols: string[]; currentSymbol?: string; anchor: ChartSymbolAnchor;
  onSelect: (symbol: string) => void; onClose: () => void;
}) {
  const tr = useUiTranslation();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const filtered = symbols.filter(symbol => symbol.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  useEffect(() => {
    root.current?.querySelector(`[data-option-index="${highlighted}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted]);
  const choose = (symbol: string) => { onSelect(symbol); onClose(); };
  return ReactDOM.createPortal(<div ref={root} className="rtx-chart-symbol-dropdown"
    style={{ left: Math.max(8, Math.min(anchor.left, window.innerWidth - 288)), top: Math.max(8, Math.min(anchor.bottom + 5, window.innerHeight - 328)) }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      }
      if (event.key === 'Enter' && filtered[highlighted]) { event.preventDefault(); choose(filtered[highlighted]); }
    }}>
    <label className="rtx-chart-symbol-dropdown__search"><Search size={16} aria-hidden="true" />
      <input ref={input} role="combobox" aria-expanded="true" aria-controls="chart-symbol-options"
        aria-activedescendant={filtered[highlighted] ? `chart-symbol-option-${highlighted}` : undefined}
        aria-autocomplete="list" aria-label={tr('Search symbols')} placeholder={tr('Search symbols')}
        value={query} onChange={event => { setQuery(event.target.value); setHighlighted(0); }} />
    </label>
    <div id="chart-symbol-options" role="listbox" aria-label={tr('Symbols')} className="rtx-chart-symbol-dropdown__options">
      {filtered.map((symbol, index) => <button type="button" role="option" id={`chart-symbol-option-${index}`} key={symbol}
        data-option-index={index} data-highlighted={index === highlighted} aria-selected={symbol === currentSymbol}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(symbol)}>{symbol}</button>)}
      {filtered.length === 0 && <div role="status" className="rtx-chart-symbol-dropdown__empty">{tr('No symbols found')}</div>}
    </div>
  </div>, document.body);
}

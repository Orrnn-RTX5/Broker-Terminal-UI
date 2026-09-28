import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { MarketWatchSymbolGroup } from '../../utils/marketWatchGroups';
import { getMarketWatchSymbolLabel } from '../../utils/marketWatchSource';
import { getFallbackSymbolDescription } from '../../utils/symbolDescription';
import { Icon } from '../ui/Icon';
import {
  SYMBOL_EXPLORER_FALLBACK_HEIGHT,
  SYMBOL_EXPLORER_OVERSCAN,
  SYMBOL_EXPLORER_ROW_HEIGHT,
  SYMBOL_GROUP_ROW_HEIGHT,
  normalizeSymbol,
} from './marketWatchPanelModel';

type Translate = (source: string, values?: Record<string, unknown>) => string;

interface MarketWatchSymbolExplorerProps {
  filteredSymbols: readonly string[];
  highlightIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  isSymbolListLoading: boolean;
  marketWatchSymbolSet: ReadonlySet<string>;
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectSymbol: (symbol: string) => void;
  search: string;
  searchListboxId: string;
  searchUniverse: readonly string[];
  selectedSymbolGroup: MarketWatchSymbolGroup | null;
  setHighlightIndex: Dispatch<SetStateAction<number>>;
  setSelectedSymbolGroupKey: Dispatch<SetStateAction<string | null>>;
  setShowSymbolsPanel: Dispatch<SetStateAction<boolean>>;
  showSymbolsPanel: boolean;
  showingSymbolGroups: boolean;
  symbolDescriptionByName: ReadonlyMap<string, string>;
  symbolGroups: readonly MarketWatchSymbolGroup[];
  translate: Translate;
}

/** Search bar and virtualized symbol/group explorer for Market Watch. */
export const MarketWatchSymbolExplorer = ({
  filteredSymbols,
  highlightIndex,
  inputRef,
  isSymbolListLoading,
  marketWatchSymbolSet,
  onClose,
  onSearchChange,
  onSearchKeyDown,
  onSelectSymbol,
  search,
  searchListboxId,
  searchUniverse,
  selectedSymbolGroup,
  setHighlightIndex,
  setSelectedSymbolGroupKey,
  setShowSymbolsPanel,
  showSymbolsPanel,
  showingSymbolGroups,
  symbolDescriptionByName,
  symbolGroups,
  translate,
}: MarketWatchSymbolExplorerProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: SYMBOL_EXPLORER_FALLBACK_HEIGHT,
  });
  const optionCount = showingSymbolGroups ? symbolGroups.length : filteredSymbols.length;
  const activeOptionId = highlightIndex >= 0 && highlightIndex < optionCount
    ? `${searchListboxId}-option-${highlightIndex}`
    : undefined;
  const explorerWindow = useMemo(() => {
    const maxScrollTop = Math.max(
      0,
      filteredSymbols.length * SYMBOL_EXPLORER_ROW_HEIGHT - viewport.height,
    );
    const effectiveScrollTop = Math.min(viewport.scrollTop, maxScrollTop);
    const startIndex = Math.max(
      0,
      Math.floor(effectiveScrollTop / SYMBOL_EXPLORER_ROW_HEIGHT) - SYMBOL_EXPLORER_OVERSCAN,
    );
    const endIndex = Math.min(
      filteredSymbols.length,
      Math.ceil((effectiveScrollTop + viewport.height) / SYMBOL_EXPLORER_ROW_HEIGHT)
      + SYMBOL_EXPLORER_OVERSCAN,
    );
    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * SYMBOL_EXPLORER_ROW_HEIGHT,
      bottomSpacerHeight: (filteredSymbols.length - endIndex) * SYMBOL_EXPLORER_ROW_HEIGHT,
    };
  }, [filteredSymbols.length, viewport]);
  const renderedSymbols = filteredSymbols.slice(explorerWindow.startIndex, explorerWindow.endIndex);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || showingSymbolGroups) return;
    const measure = () => {
      const height = element.clientHeight || SYMBOL_EXPLORER_FALLBACK_HEIGHT;
      setViewport((current) => current.height === height ? current : { ...current, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showSymbolsPanel, showingSymbolGroups]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => {
      setViewport((current) => current.scrollTop === 0 ? current : { ...current, scrollTop: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [search, selectedSymbolGroup?.key]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const scrollTop = element.scrollTop;
    const height = element.clientHeight || SYMBOL_EXPLORER_FALLBACK_HEIGHT;
    setViewport((current) => (
      current.scrollTop === scrollTop && current.height === height
        ? current
        : { scrollTop, height }
    ));
  }, []);

  useEffect(() => {
    if (highlightIndex < 0 || showingSymbolGroups) return;
    const option = document.getElementById(`${searchListboxId}-option-${highlightIndex}`);
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
      return;
    }
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = highlightIndex * SYMBOL_EXPLORER_ROW_HEIGHT;
    handleScroll();
  }, [handleScroll, highlightIndex, searchListboxId, showingSymbolGroups]);

  return (
    <div
      className="rtx-market-watch__search"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: showSymbolsPanel ? '1 1 auto' : '0 0 auto',
        minHeight: 0,
        borderBottom: '1px solid var(--border-primary)',
        background: 'var(--bg-secondary)',
      }}
    >
      <div className="rtx-market-watch__search-bar" style={{ position: 'relative', height: 42, flexShrink: 0 }}>
        <Icon
          name="search"
          size={20}
          style={{
            position: 'absolute',
            left: 13,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-primary)',
            pointerEvents: 'none',
          }}
        />
        <input
          id="rtxMarketWatchSymbolSearch"
          name="marketWatchSymbolSearch"
          ref={inputRef}
          className="mw-input"
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 0,
            padding: '0 42px 0 42px',
            fontSize: 14,
            fontWeight: 400,
            color: 'var(--text-primary)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
          aria-label={translate('Add symbol')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSymbolsPanel}
          aria-controls={showSymbolsPanel ? searchListboxId : undefined}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          placeholder={translate('Search symbol')}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          onFocus={() => setShowSymbolsPanel(true)}
        />
        <button
          type="button"
          aria-label={showSymbolsPanel ? translate('Close symbol search') : translate('Close Market Watch')}
          title={showSymbolsPanel ? translate('Close symbol search') : translate('Close')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
          className="rtx-market-watch__close"
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 30,
            height: 30,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 0,
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <Icon name="x-close" size={18} />
        </button>
      </div>

      {showSymbolsPanel && (
        <div
          className="rtx-market-watch__symbol-explorer"
          style={{
            display: 'flex',
            flex: '1 1 auto',
            flexDirection: 'column',
            minHeight: 0,
            background: 'var(--bg-secondary)',
          }}
        >
          {isSymbolListLoading && symbolGroups.length === 0 ? (
            <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {translate('Loading symbols…')}
            </div>
          ) : showingSymbolGroups ? (
            <div
              id={searchListboxId}
              role="listbox"
              aria-label={translate('Symbol groups')}
              className="rtx-market-watch__group-list mw-scrollbar"
              style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
            >
              {symbolGroups.length === 0 ? (
                <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {translate('No symbols available')}
                </div>
              ) : symbolGroups.map((group, index) => (
                <button
                  key={group.key}
                  id={`${searchListboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlightIndex}
                  aria-label={translate('{{value0}} {{value1}} of {{value2}}', {
                    value0: group.label,
                    value1: group.visibleCount,
                    value2: group.symbols.length,
                  })}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => {
                    setSelectedSymbolGroupKey(group.key);
                    setHighlightIndex(0);
                  }}
                  className="rtx-market-watch__explorer-option rtx-market-watch__group-option"
                  style={{
                    width: '100%',
                    height: SYMBOL_GROUP_ROW_HEIGHT,
                    padding: '0 13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    border: 0,
                    background: index === highlightIndex ? 'var(--bg-quaternary)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 600,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {translate(group.label)}
                  </span>
                  <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
                    {group.visibleCount}/{group.symbols.length}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {selectedSymbolGroup && !search.trim() && (
                <button
                  type="button"
                  aria-label={translate('Back to symbol groups')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedSymbolGroupKey(null);
                    setHighlightIndex(-1);
                  }}
                  style={{
                    height: SYMBOL_GROUP_ROW_HEIGHT,
                    padding: '0 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    flexShrink: 0,
                    border: 0,
                    borderBottom: '1px solid var(--border-primary)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: 600,
                    textAlign: 'left',
                  }}
                >
                  <Icon name="chevron-left" size="sm" />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedSymbolGroup.label}
                  </span>
                  <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 400 }}>
                    {selectedSymbolGroup.symbols.length}
                  </span>
                </button>
              )}
              <div
                ref={scrollRef}
                id={searchListboxId}
                role="listbox"
                aria-label={search.trim()
                  ? translate('Symbol search results')
                  : translate('{{value0}} symbols', { value0: selectedSymbolGroup?.label ?? '' })}
                data-testid="market-watch-symbol-scroll"
                onScroll={handleScroll}
                className="rtx-market-watch__symbol-list mw-scrollbar"
                style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}
              >
                {filteredSymbols.length === 0 ? (
                  <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {search.trim() ? translate('No matches found') : translate('No symbols in this group')}
                  </div>
                ) : (
                  <>
                    {explorerWindow.topSpacerHeight > 0 && (
                      <div aria-hidden="true" style={{ height: explorerWindow.topSpacerHeight }} />
                    )}
                    {renderedSymbols.map((symbol, visibleIndex) => {
                      const absoluteIndex = explorerWindow.startIndex + visibleIndex;
                      const label = getMarketWatchSymbolLabel(symbol, searchUniverse);
                      const description = symbolDescriptionByName.get(normalizeSymbol(symbol))
                        ?? getFallbackSymbolDescription(symbol);
                      const isSubscribed = marketWatchSymbolSet.has(symbol);
                      return (
                        <button
                          key={symbol}
                          id={`${searchListboxId}-option-${absoluteIndex}`}
                          type="button"
                          role="option"
                          aria-selected={absoluteIndex === highlightIndex}
                          aria-disabled={false}
                          aria-label={description ? `${label}, ${description}` : label}
                          aria-posinset={absoluteIndex + 1}
                          aria-setsize={filteredSymbols.length}
                          data-subscribed={isSubscribed ? 'true' : 'false'}
                          tabIndex={-1}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setHighlightIndex(absoluteIndex)}
                          onClick={() => onSelectSymbol(symbol)}
                          className="rtx-market-watch__explorer-option rtx-market-watch__symbol-option"
                          style={{
                            width: '100%',
                            height: SYMBOL_EXPLORER_ROW_HEIGHT,
                            padding: isSubscribed ? '0 11px 0 10px' : '0 13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            borderTop: 0,
                            borderRight: 0,
                            borderBottom: '1px solid var(--bg-tertiary)',
                            borderLeft: isSubscribed ? '3px solid var(--status-connected)' : 0,
                            background: absoluteIndex === highlightIndex
                              ? 'var(--bg-quaternary)'
                              : isSubscribed ? 'var(--color-profit-dimmer)' : 'transparent',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 14,
                            fontWeight: 500,
                            textAlign: 'left',
                          }}
                        >
                          <span
                            className="rtx-market-watch__symbol-copy"
                            style={{ minWidth: 0, display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}
                          >
                            <span
                              className="rtx-market-watch__symbol"
                              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '17px' }}
                            >
                              {label}
                            </span>
                            {description && (
                              <span
                                className="rtx-market-watch__symbol-description"
                                title={description}
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  color: 'var(--text-secondary)',
                                  fontSize: 11,
                                  fontWeight: 400,
                                  lineHeight: '14px',
                                }}
                              >
                                {description}
                              </span>
                            )}
                          </span>
                          {isSubscribed && (
                            <span
                              aria-hidden="true"
                              className="rtx-market-watch__subscribed-badge"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                flexShrink: 0,
                                color: 'var(--status-connected)',
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.02em',
                              }}
                            >
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                              {translate('Subscribed')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {explorerWindow.bottomSpacerHeight > 0 && (
                      <div aria-hidden="true" style={{ height: explorerWindow.bottomSpacerHeight }} />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { MarketWatchSymbolGroup } from '../../utils/marketWatchGroups';
import { resolveMarketWatchSymbolGroup } from '../../utils/marketWatchGroups';
import type {
  MarketWatchColumnId,
  MarketWatchOptions,
  MarketWatchSavedSet,
  MarketWatchSortMetadata,
  MarketWatchSortMode,
} from '../../utils/marketWatchView';
import { deleteMarketWatchSavedSet } from '../../utils/marketWatchView';
import type { ContextMenuItemConfig } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import {
  getFundamentalLinks,
  openTrustedExternalLink,
  uniqueSymbols,
  type MarketWatchViewId,
} from './marketWatchPanelModel';

interface UseMarketWatchContextMenuOptions {
  actionableSymbolSet: ReadonlySet<string>;
  applySymbolSet: (set: MarketWatchSavedSet) => void;
  brokerAccountScopeKey: string;
  canLoadBrokerSpecification: boolean;
  chartOpenableSymbolSet: ReadonlySet<string>;
  columns: readonly MarketWatchColumnId[];
  handleExport: () => Promise<void>;
  handleHideAll: () => void;
  handleHideSymbol: (symbol: string) => void;
  handleShowAll: () => void;
  marketWatchOptions: MarketWatchOptions;
  protectedSymbolSet: ReadonlySet<string>;
  quoteEligibleSymbolSet: ReadonlySet<string>;
  rows: readonly string[];
  savedSets: Readonly<Record<string, MarketWatchSavedSet>>;
  setIsSaveSetOpen: Dispatch<SetStateAction<boolean>>;
  setMarketWatchOptions: Dispatch<SetStateAction<MarketWatchOptions>>;
  setMarketWatchView: Dispatch<SetStateAction<MarketWatchViewId>>;
  setPopupPricesOpen: Dispatch<SetStateAction<boolean>>;
  setRefreshedSpecification: Dispatch<SetStateAction<{
    scopeKey: string;
    symbol: string;
    instrument: Readonly<Record<string, unknown>>;
  } | null>>;
  setSavedSets: Dispatch<SetStateAction<Record<string, MarketWatchSavedSet>>>;
  setSaveSetName: Dispatch<SetStateAction<string>>;
  setShowSymbolsPanel: Dispatch<SetStateAction<boolean>>;
  setSortMode: Dispatch<SetStateAction<MarketWatchSortMode>>;
  setSpecificationRequestKey: Dispatch<SetStateAction<string | null>>;
  setSpecificationRequestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>>;
  setSpecificationSymbol: Dispatch<SetStateAction<string | null>>;
  setTickChartSymbol: (symbol: string) => void;
  sortMetadata: ReadonlyMap<string, MarketWatchSortMetadata>;
  sortMode: MarketWatchSortMode;
  symbolGroupKeyByName: ReadonlyMap<string, string>;
  symbolGroups: readonly MarketWatchSymbolGroup[];
  toggleColumn: (column: MarketWatchColumnId | 'highLow') => void;
}

/** Builds the complete MT-style symbol context menu from controller state. */
export const useMarketWatchContextMenu = ({
  actionableSymbolSet,
  applySymbolSet,
  brokerAccountScopeKey,
  canLoadBrokerSpecification,
  chartOpenableSymbolSet,
  columns,
  handleExport,
  handleHideAll,
  handleHideSymbol,
  handleShowAll,
  marketWatchOptions,
  protectedSymbolSet,
  quoteEligibleSymbolSet,
  rows,
  savedSets,
  setIsSaveSetOpen,
  setMarketWatchOptions,
  setMarketWatchView,
  setPopupPricesOpen,
  setRefreshedSpecification,
  setSavedSets,
  setSaveSetName,
  setShowSymbolsPanel,
  setSortMode,
  setSpecificationRequestKey,
  setSpecificationRequestStatus,
  setSpecificationSymbol,
  setTickChartSymbol,
  sortMetadata,
  sortMode,
  symbolGroupKeyByName,
  symbolGroups,
  toggleColumn,
}: UseMarketWatchContextMenuOptions): ((symbol: string) => ContextMenuItemConfig[]) => useCallback((symbol: string) => {
  const tradeDisabled = !actionableSymbolSet.has(symbol);
  const chartDisabled = !chartOpenableSymbolSet.has(symbol);
  const symbolProtected = protectedSymbolSet.has(symbol);
  const groupKey = symbolGroupKeyByName.get(symbol) ?? resolveMarketWatchSymbolGroup(symbol).key;
  const fundamentalLinks = getFundamentalLinks(symbol, groupKey);
  const isSubscriptionSymbol = groupKey === 'stocks';
  const hasIndustry = Array.from(sortMetadata.values()).some((metadata) => Boolean(metadata.industry));
  const hasSector = Array.from(sortMetadata.values()).some((metadata) => Boolean(metadata.sector));
  const savedSetEntries = Object.entries(savedSets).sort(([left], [right]) => left.localeCompare(right));
  const columnItems: ContextMenuItemConfig[] = [
    { label: 'Last', checked: columns.includes('last'), action: () => toggleColumn('last'), autoClose: false },
    { label: 'High/Low', checked: columns.includes('high') || columns.includes('low'), action: () => toggleColumn('highLow'), autoClose: false },
    { label: 'Volume', checked: columns.includes('volume'), action: () => toggleColumn('volume'), autoClose: false },
    { label: 'Spread', checked: columns.includes('spread'), action: () => toggleColumn('spread'), autoClose: false },
    { label: 'Time', checked: columns.includes('time'), action: () => toggleColumn('time'), autoClose: false },
    { label: 'Change', checked: columns.includes('dailyChangePrice'), action: () => toggleColumn('dailyChangePrice'), autoClose: false },
    { label: 'Change %', checked: columns.includes('dailyChange'), action: () => toggleColumn('dailyChange'), autoClose: false },
    { label: 'Source', checked: columns.includes('source'), action: () => toggleColumn('source'), autoClose: false },
  ];
  const setsSubmenu: ContextMenuItemConfig[] = [
    {
      label: 'Save as',
      action: () => {
        setSaveSetName('');
        setIsSaveSetOpen(true);
      },
    },
    {
      label: 'Remove',
      disabled: savedSetEntries.length === 0,
      submenu: savedSetEntries.map(([name]) => ({
        label: name,
        action: () => setSavedSets(deleteMarketWatchSavedSet(name)),
      })),
    },
    {
      label: 'Add',
      submenu: symbolGroups.map((group) => ({
        label: group.label,
        action: () => applySymbolSet({
          symbols: uniqueSymbols([...rows, ...group.symbols]),
          columns: [...columns],
        }),
      })),
    },
    ...(savedSetEntries.length > 0 ? [
      { divider: true } as ContextMenuItemConfig,
      ...savedSetEntries.map(([name, set]) => ({ label: name, action: () => applySymbolSet(set) })),
    ] : []),
  ];

  return [
    {
      label: 'New Order',
      icon: <Icon name="new-order" size="xs" />,
      shortcut: 'F9',
      disabled: tradeDisabled,
      action: () => window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } })),
    },
    {
      label: 'Chart Window',
      icon: <Icon name="new-chart" size="xs" />,
      disabled: chartDisabled,
      action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol, newWindow: true } })),
    },
    {
      label: 'Tick Chart',
      icon: <Icon name="line-chart" size="xs" />,
      disabled: !quoteEligibleSymbolSet.has(symbol),
      action: () => {
        setTickChartSymbol(symbol);
        setMarketWatchView('ticks');
        setShowSymbolsPanel(false);
      },
    },
    {
      label: 'Depth Of Market',
      icon: <Icon name="grid-3x3" size="xs" />,
      shortcut: 'Alt+B',
      disabled: tradeDisabled,
      action: () => window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } })),
    },
    { label: 'Options Board', icon: <Icon name="layers" size="xs" />, disabled: true },
    {
      label: 'Specification',
      icon: <Icon name="file-text" size="xs" />,
      action: () => {
        setRefreshedSpecification(null);
        setSpecificationRequestKey(`${brokerAccountScopeKey}\u0000${symbol}`);
        setSpecificationRequestStatus(canLoadBrokerSpecification ? 'loading' : 'ready');
        setSpecificationSymbol(symbol);
      },
    },
    ...(isSubscriptionSymbol ? [{
      label: 'Subscribe to Realtime Datafeed',
      icon: <Icon name="refresh" size="xs" />,
      disabled: true,
    } as ContextMenuItemConfig] : []),
    ...(fundamentalLinks.length > 0 ? [{
      label: 'Fundamental Data',
      submenu: fundamentalLinks.map((link) => ({
        label: link.label,
        action: () => openTrustedExternalLink(link.url),
      })),
    } as ContextMenuItemConfig] : []),
    {
      label: 'Popup Prices',
      icon: <Icon name="bar-chart-2" size="xs" />,
      shortcut: 'F10',
      action: () => setPopupPricesOpen(true),
    },
    { divider: true },
    {
      label: 'Hide',
      icon: <Icon name="eye-off" size="xs" />,
      shortcut: 'Delete',
      disabled: symbolProtected,
      action: () => handleHideSymbol(symbol),
    },
    { label: 'Hide All', icon: <Icon name="x-close" size="xs" />, action: handleHideAll },
    { label: 'Show All', icon: <Icon name="eye" size="xs" />, action: handleShowAll },
    { divider: true },
    {
      label: 'Symbols',
      icon: <Icon name="symbol-box" size="xs" />,
      shortcut: 'Ctrl+U',
      action: () => window.dispatchEvent(new CustomEvent('openSymbolsDialog')),
    },
    { label: 'Sets', submenu: setsSubmenu },
    {
      label: 'Sort',
      icon: <Icon name="sort" size="xs" />,
      submenu: [
        { label: 'Symbol', checked: sortMode === 'symbol', action: () => setSortMode('symbol') },
        { label: 'Industry', checked: sortMode === 'industry', disabled: !hasIndustry, action: () => setSortMode('industry') },
        { label: 'Sector', checked: sortMode === 'sector', disabled: !hasSector, action: () => setSortMode('sector') },
        { label: 'Gainers', checked: sortMode === 'gainers', action: () => setSortMode('gainers') },
        { label: 'Losers', checked: sortMode === 'losers', action: () => setSortMode('losers') },
        { label: 'Deals Volume', checked: sortMode === 'volume', action: () => setSortMode('volume') },
        { divider: true },
        { label: 'Reset', checked: sortMode === null, action: () => setSortMode(null) },
      ],
    },
    { label: 'Export', icon: <Icon name="export" size="xs" />, action: handleExport },
    { divider: true },
    {
      label: 'Show Milliseconds',
      checked: marketWatchOptions.showMilliseconds,
      action: () => setMarketWatchOptions((current) => ({ ...current, showMilliseconds: !current.showMilliseconds })),
      autoClose: false,
    },
    { label: 'Auto Remove Expired', checked: marketWatchOptions.autoRemoveExpired, disabled: true },
    {
      label: 'Auto Arrange',
      checked: marketWatchOptions.autoArrange,
      shortcut: 'A',
      action: () => setMarketWatchOptions((current) => ({ ...current, autoArrange: !current.autoArrange })),
      autoClose: false,
    },
    {
      label: 'Grid',
      icon: <Icon name="grid-3x3" size="xs" />,
      shortcut: 'G',
      checked: marketWatchOptions.showGrid,
      action: () => setMarketWatchOptions((current) => ({ ...current, showGrid: !current.showGrid })),
      autoClose: false,
    },
    { divider: true },
    { label: 'Columns', submenu: columnItems },
  ];
}, [
  actionableSymbolSet,
  applySymbolSet,
  brokerAccountScopeKey,
  canLoadBrokerSpecification,
  chartOpenableSymbolSet,
  columns,
  handleExport,
  handleHideAll,
  handleHideSymbol,
  handleShowAll,
  marketWatchOptions,
  protectedSymbolSet,
  quoteEligibleSymbolSet,
  rows,
  savedSets,
  setIsSaveSetOpen,
  setMarketWatchOptions,
  setMarketWatchView,
  setPopupPricesOpen,
  setRefreshedSpecification,
  setSavedSets,
  setSaveSetName,
  setShowSymbolsPanel,
  setSortMode,
  setSpecificationRequestKey,
  setSpecificationRequestStatus,
  setSpecificationSymbol,
  setTickChartSymbol,
  sortMetadata,
  sortMode,
  symbolGroupKeyByName,
  symbolGroups,
  toggleColumn,
]);

interface UseMarketWatchDetailsContextMenuOptions {
  actionableSymbolSet: ReadonlySet<string>;
  brokerAccountScopeKey: string;
  canLoadBrokerSpecification: boolean;
  chartOpenableSymbolSet: ReadonlySet<string>;
  marketWatchOptions: MarketWatchOptions;
  quoteEligibleSymbolSet: ReadonlySet<string>;
  setMarketWatchOptions: Dispatch<SetStateAction<MarketWatchOptions>>;
  setMarketWatchView: Dispatch<SetStateAction<MarketWatchViewId>>;
  setRefreshedSpecification: Dispatch<SetStateAction<{
    scopeKey: string;
    symbol: string;
    instrument: Readonly<Record<string, unknown>>;
  } | null>>;
  setShowSymbolsPanel: Dispatch<SetStateAction<boolean>>;
  setSpecificationRequestKey: Dispatch<SetStateAction<string | null>>;
  setSpecificationRequestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>>;
  setSpecificationSymbol: Dispatch<SetStateAction<string | null>>;
  setTickChartSymbol: (symbol: string) => void;
}

/** Builds the MT5 Market Watch "Details" tab right-click context menu. */
export const useMarketWatchDetailsContextMenu = ({
  actionableSymbolSet,
  brokerAccountScopeKey,
  canLoadBrokerSpecification,
  chartOpenableSymbolSet,
  marketWatchOptions,
  quoteEligibleSymbolSet,
  setMarketWatchOptions,
  setMarketWatchView,
  setRefreshedSpecification,
  setShowSymbolsPanel,
  setSpecificationRequestKey,
  setSpecificationRequestStatus,
  setSpecificationSymbol,
  setTickChartSymbol,
}: UseMarketWatchDetailsContextMenuOptions): ((symbol: string) => ContextMenuItemConfig[]) => useCallback((symbol: string) => {
  if (!symbol) return [];
  const tradeDisabled = !actionableSymbolSet.has(symbol);
  const chartDisabled = !chartOpenableSymbolSet.has(symbol);

  return [
    {
      label: 'New Order',
      icon: <Icon name="new-order" size="xs" />,
      disabled: tradeDisabled,
      action: () => window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } })),
    },
    {
      label: 'Chart Window',
      icon: <Icon name="new-chart" size="xs" />,
      disabled: chartDisabled,
      action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol, newWindow: true } })),
    },
    {
      label: 'Tick Chart',
      icon: <Icon name="line-chart" size="xs" />,
      disabled: !quoteEligibleSymbolSet.has(symbol),
      action: () => {
        setTickChartSymbol(symbol);
        setMarketWatchView('ticks');
        setShowSymbolsPanel(false);
      },
    },
    {
      label: 'Depth Of Market',
      icon: <Icon name="grid-3x3" size="xs" />,
      disabled: tradeDisabled,
      action: () => window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } })),
    },
    {
      label: 'Specification',
      icon: <Icon name="file-text" size="xs" />,
      action: () => {
        setRefreshedSpecification(null);
        setSpecificationRequestKey(`${brokerAccountScopeKey}\u0000${symbol}`);
        setSpecificationRequestStatus(canLoadBrokerSpecification ? 'loading' : 'ready');
        setSpecificationSymbol(symbol);
      },
    },
    { divider: true },
    {
      label: 'Grid',
      shortcut: 'G',
      checked: marketWatchOptions.showGrid,
      action: () => setMarketWatchOptions((current) => ({ ...current, showGrid: !current.showGrid })),
      autoClose: false,
    },
  ];
}, [
  actionableSymbolSet,
  brokerAccountScopeKey,
  canLoadBrokerSpecification,
  chartOpenableSymbolSet,
  marketWatchOptions.showGrid,
  quoteEligibleSymbolSet,
  setMarketWatchOptions,
  setMarketWatchView,
  setRefreshedSpecification,
  setShowSymbolsPanel,
  setSpecificationRequestKey,
  setSpecificationRequestStatus,
  setSpecificationSymbol,
  setTickChartSymbol,
]);


import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { commandBus } from '../../services/commandBus';
import { getActiveChartCommandTarget } from '../../services/chartCommandTarget';
import { runTerminalShortcutAction } from '../../services/shortcutCatalog';
import { useAppStore } from '../../store/useAppStore';
import { useChartSettingsStore } from '../../store/useChartSettingsStore';
import { TREND_LINE_TOOLS } from '../../drawing-tools/toolCatalog';
import { GANN_FIBONACCI_TOOLS } from '../../drawing-tools/gannFibonacciToolCatalog';
import { CHART_PATTERN_TOOLS } from '../../drawing-tools/chartPatternToolCatalog';
import { FORECASTING_MEASUREMENT_TOOLS } from '../../drawing-tools/forecastingMeasurementToolCatalog';
import { BRUSH_SHAPE_TOOLS } from '../../drawing-tools/brushShapeToolCatalog';
import { ANNOTATION_TOOLS as TEXT_NOTE_TOOLS } from '../../drawing-tools/annotationToolCatalog';
import { CURSOR_TOOLS } from '../../drawing-tools/cursorToolCatalog';
import { STAMP_OPTIONS } from './stampOptions';
import type { ChartType, Timeframe } from '../../types/chart';
import './TopToolbarSearch.css';

export type SearchCategoryId =
  | 'all'
  | 'indicators'
  | 'menus'
  | 'toolbar'
  | 'drawings'
  | 'panels'
  | 'symbols';

export interface SearchLocationTarget {
  /** Human-readable location path */
  path: string;
  /** Whether this location opens an action sheet / popup menu / flyout (defaults to Boolean(prepare)) */
  hasActionSheet?: boolean;
  /** Opens any parent menu, submenu chain, dropdown, action sheet, or panel before DOM lookup */
  prepare?: () => void;
  /** Finds the ordered path + target DOM element(s) to highlight in-place */
  findElements: () => HTMLElement[];
  /** Optional additional target elements (e.g. a Top Toolbar icon alongside an open Menu Bar row) */
  findExtraTargets?: () => HTMLElement[];
}

export interface UniversalSearchItem {
  id: string;
  title: string;
  category: Exclude<SearchCategoryId, 'all'>;
  categoryLabel: string;
  description: string;
  shortcut?: string;
  keywords: string[];
  locations: SearchLocationTarget[];
  execute: () => void;
}

export interface TopToolbarSearchProps {
  selectedSymbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: Timeframe) => void;
  onChartTypeChange: (chartType: ChartType) => void;
  onNewOrder?: () => void;
  onOpenSymbols?: () => void;
  onOpenChart?: (symbol: string) => void;
  onOpenHistoryDownloader?: () => void;
  onOpenDepthOfMarket?: (symbol?: string) => void;
  onOpenChartProperties?: () => void;
  onOpenChartObjects?: () => void;
  onTileWindows?: () => void;
  onCascadeWindows?: () => void;
  onResetWindows?: () => void;
  onPrintChart?: () => void;
}

const INDICATOR_CATALOG: ReadonlyArray<{
  id: string;
  name: string;
  category: 'Trend' | 'Oscillators' | 'Volumes' | 'Bill Williams';
  menuCategory: 'Trend' | 'Oscillators' | 'Volumes' | 'Bill Williams';
  description: string;
  keywords: string[];
}> = [
  { id: 'ind-sma', name: 'Moving Average (SMA)', category: 'Trend', menuCategory: 'Trend', description: 'Simple Moving Average trend overlay indicator', keywords: ['sma', 'ma', 'moving average', 'trend', 'indicator'] },
  { id: 'ind-ema', name: 'Exponential Moving Average (EMA)', category: 'Trend', menuCategory: 'Trend', description: 'Exponentially weighted moving average overlay', keywords: ['ema', 'exponential', 'moving average', 'trend', 'indicator'] },
  { id: 'ind-bb', name: 'Bollinger Bands', category: 'Trend', menuCategory: 'Trend', description: 'Volatility bands around a moving average', keywords: ['bb', 'bollinger', 'bands', 'volatility', 'trend', 'indicator'] },
  { id: 'ind-ichimoku', name: 'Ichimoku Cloud (Ichimoku Kinko Hyo)', category: 'Trend', menuCategory: 'Trend', description: 'Equilibrium cloud, Tenkan-sen, and Kijun-sen trend system', keywords: ['ichimoku', 'cloud', 'kinko hyo', 'trend', 'indicator'] },
  { id: 'ind-psar', name: 'Parabolic SAR', category: 'Trend', menuCategory: 'Trend', description: 'Stop and Reverse trend-following indicator', keywords: ['sar', 'parabolic', 'stop and reverse', 'trend', 'indicator'] },
  { id: 'ind-rsi', name: 'Relative Strength Index (RSI)', category: 'Oscillators', menuCategory: 'Oscillators', description: 'Momentum oscillator measuring speed and change of price movements', keywords: ['rsi', 'relative strength', 'oscillator', 'overbought', 'oversold', 'indicator'] },
  { id: 'ind-macd', name: 'MACD (Moving Average Convergence Divergence)', category: 'Oscillators', menuCategory: 'Oscillators', description: 'Trend-following momentum oscillator with signal line and histogram', keywords: ['macd', 'histogram', 'convergence', 'divergence', 'oscillator', 'indicator'] },
  { id: 'ind-stoch', name: 'Stochastic Oscillator', category: 'Oscillators', menuCategory: 'Oscillators', description: 'K% and D% momentum oscillator comparing closing price to price range', keywords: ['stoch', 'stochastic', 'oscillator', 'indicator'] },
  { id: 'ind-cci', name: 'Commodity Channel Index (CCI)', category: 'Oscillators', menuCategory: 'Oscillators', description: 'Cyclical momentum oscillator measuring price deviation from average', keywords: ['cci', 'commodity channel', 'oscillator', 'indicator'] },
  { id: 'ind-mom', name: 'Momentum', category: 'Oscillators', menuCategory: 'Oscillators', description: 'Rate of change price momentum oscillator', keywords: ['momentum', 'roc', 'oscillator', 'indicator'] },
  { id: 'ind-vol', name: 'Volume (Tick Volumes)', category: 'Volumes', menuCategory: 'Volumes', description: 'Bar-by-bar tick activity volume histogram', keywords: ['volume', 'tick volume', 'bars', 'histogram', 'indicator'] },
  { id: 'ind-obv', name: 'On Balance Volume (OBV)', category: 'Volumes', menuCategory: 'Volumes', description: 'Cumulative buying and selling volume pressure indicator', keywords: ['obv', 'on balance volume', 'volumes', 'indicator'] },
  { id: 'ind-vwap', name: 'VWAP (Volume Weighted Average Price)', category: 'Volumes', menuCategory: 'Volumes', description: 'Intraday volume-weighted benchmark price overlay', keywords: ['vwap', 'volume weighted', 'average price', 'indicator'] },
  { id: 'ind-mfi', name: 'Money Flow Index (MFI)', category: 'Volumes', menuCategory: 'Volumes', description: 'Volume-weighted RSI measuring buying and selling pressure', keywords: ['mfi', 'money flow', 'volumes', 'indicator'] },
  { id: 'ind-alligator', name: 'Alligator', category: 'Bill Williams', menuCategory: 'Bill Williams', description: 'Bill Williams Jaw, Teeth, and Lips smoothed moving averages', keywords: ['alligator', 'bill williams', 'jaw', 'teeth', 'lips', 'indicator'] },
  { id: 'ind-ao', name: 'Awesome Oscillator (AO)', category: 'Bill Williams', menuCategory: 'Bill Williams', description: 'Bill Williams 5/34 midpoint moving average histogram', keywords: ['ao', 'awesome oscillator', 'bill williams', 'indicator'] },
  { id: 'ind-fractals', name: 'Fractals', category: 'Bill Williams', menuCategory: 'Bill Williams', description: 'Bill Williams 5-bar local high/low reversal markers', keywords: ['fractals', 'bill williams', 'reversal', 'indicator'] },
  { id: 'ind-gator', name: 'Gator Oscillator', category: 'Bill Williams', menuCategory: 'Bill Williams', description: 'Bill Williams Alligator convergence/divergence dual histogram', keywords: ['gator', 'oscillator', 'bill williams', 'indicator'] },
];

const normalizeToken = (val: string) => val.toLowerCase().replace(/[\s_-]+/g, '');

const SINGLE_TOKEN_STOP_WORDS = new Set([
  'a', 'all', 'alt', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can',
  'ctrl', 'do', 'for', 'from', 'get', 'has', 'how', 'in', 'into', 'is', 'it',
  'its', 'log', 'logo', 'may', 'new', 'no', 'non', 'not', 'now', 'of', 'off',
  'old', 'on', 'one', 'or', 'our', 'out', 'own', 'per', 'put', 'run', 'see',
  'set', 'shift', 'sub', 'tab', 'the', 'to', 'top', 'try', 'two', 'up', 'use',
  'via', 'way', 'web', 'who', 'why', 'with', 'yes',
]);

const extractSearchWords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .map((w) => w.trim())
    .filter(Boolean);

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
};

const stripSimplePlural = (word: string): string => {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
};

/**
 * Checks whether a user query token represents a complete word (or close full-word typo like "incator" -> "indicator")
 * rather than a 1–2 letter fragment ("i", "in") or an unfinished prefix ("ind", "ins", "inse").
 */
const matchCompleteWordToken = (
  queryToken: string,
  candidateWords: string[],
  allowStopWordExact = false,
): 'exact' | 'fuzzy' | null => {
  if (!queryToken) return null;
  if (!allowStopWordExact && SINGLE_TOKEN_STOP_WORDS.has(queryToken)) {
    return null;
  }

  const hasDigit = /\d/.test(queryToken);
  if (queryToken.length < 3 && !hasDigit) {
    return null;
  }
  if (queryToken.length < 2) {
    return null;
  }

  const qSingular = stripSimplePlural(queryToken);

  for (const w of candidateWords) {
    if (!w) continue;
    if (!allowStopWordExact && SINGLE_TOKEN_STOP_WORDS.has(w)) continue;
    if (w.length < 3 && !/\d/.test(w)) continue;

    const wSingular = stripSimplePlural(w);
    if (queryToken === w || qSingular === wSingular) {
      return 'exact';
    }
  }

  // Whole-word typo tolerance (e.g. "incator" -> "indicator"):
  // Must be at least 5 characters, share the same 2-letter start and final letter, and be within edit distance <= 2
  if (qSingular.length >= 5) {
    for (const w of candidateWords) {
      if (!w || SINGLE_TOKEN_STOP_WORDS.has(w)) continue;
      const wSingular = stripSimplePlural(w);
      if (wSingular.length < 5) continue;
      if (
        qSingular.slice(0, 2) === wSingular.slice(0, 2) &&
        qSingular[qSingular.length - 1] === wSingular[wSingular.length - 1]
      ) {
        const lenRatio = Math.min(qSingular.length, wSingular.length) / Math.max(qSingular.length, wSingular.length);
        if (lenRatio >= 0.72 && levenshteinDistance(qSingular, wSingular) <= 2) {
          return 'fuzzy';
        }
      }
    }
  }

  return null;
};

const ensurePanelVisible = (_selector: string, _shortcutId?: string) => {
  // Read-only locator: never toggle workspace panels or mutate layout state during search
};

const isElementVisible = (el: HTMLElement | null | undefined): el is HTMLElement => {
  if (!el) return false;
  if (el.classList.contains('hidden') || el.closest('.hidden')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

interface ProgressiveSheetState {
  openDepth: number;
  activeWebRootId?: string;
  activeDesktopMenuKey?: string;
  activeSubmenuPath: string[];
  activeFileSubmenu: 'profiles' | null;
  manualTargetElement: HTMLElement | null;
  lastTargetMenuSpec?: {
    webRootId?: string;
    desktopMenuKey?: string;
    submenuPath: string[];
    targetLabel?: string;
    fileMenuItemKey?: string;
  };
}

const searchSheetState: ProgressiveSheetState = {
  openDepth: 0,
  activeWebRootId: undefined,
  activeDesktopMenuKey: undefined,
  activeSubmenuPath: [],
  activeFileSubmenu: null,
  manualTargetElement: null,
  lastTargetMenuSpec: undefined,
};

const resetSearchSheetState = () => {
  searchSheetState.openDepth = 0;
  searchSheetState.activeWebRootId = undefined;
  searchSheetState.activeDesktopMenuKey = undefined;
  searchSheetState.activeSubmenuPath = [];
  searchSheetState.activeFileSubmenu = null;
  searchSheetState.manualTargetElement = null;
  searchSheetState.lastTargetMenuSpec = undefined;
};

const getActionSheetButtonsForSurface = (surface: HTMLElement): HTMLElement[] => {
  return Array.from(surface.querySelectorAll<HTMLElement>('button:not(:disabled)')).filter(
    (btn) => btn.closest('.rtx-menu-surface') === surface && isElementVisible(btn),
  );
};

const getDeepestOpenActionSheetItems = (): HTMLElement[] => {
  if (typeof document === 'undefined') return [];

  // 1. Check open .rtx-menu-surface action sheets (2nd, 3rd, 4th, 5th action sheets)
  const allSurfaces = Array.from(document.querySelectorAll<HTMLElement>('.rtx-menu-surface')).filter(
    (surface) => isElementVisible(surface),
  );
  if (allSurfaces.length > 0) {
    const deepestSurface = allSurfaces[allSurfaces.length - 1];
    const items = getActionSheetButtonsForSurface(deepestSurface);
    if (items.length > 0) return items;
  }

  // 2. Check 1st action sheet (.rtx-application-menu root menu)
  const appMenu = document.querySelector<HTMLElement>('.rtx-application-menu');
  if (isElementVisible(appMenu)) {
    const rootItems = Array.from(
      appMenu.querySelectorAll<HTMLElement>('[data-root-menu-item="true"]:not(:disabled)'),
    ).filter((btn) => isElementVisible(btn));
    if (rootItems.length > 0) return rootItems;
  }

  // 3. Check Left Drawing Rail flyout menu (.web-drawing-tools-menu)
  const drawingFlyout = Array.from(document.querySelectorAll<HTMLElement>('.web-drawing-tools-menu')).find(
    (el) => isElementVisible(el),
  );
  if (drawingFlyout) {
    const flyoutItems = Array.from(
      drawingFlyout.querySelectorAll<HTMLElement>(
        '.web-drawing-tools-menu__item:not(:disabled), .web-drawing-tools-menu__toggle-row:not(:disabled)',
      ),
    ).filter((el) => isElementVisible(el));
    if (flyoutItems.length > 0) return flyoutItems;
  }

  // 4. Check Top Toolbar dropdown overlay (.rtx-AnchoredOverlay-overlay)
  const overlay = Array.from(document.querySelectorAll<HTMLElement>('.rtx-AnchoredOverlay-overlay')).find(
    (el) => isElementVisible(el),
  );
  if (overlay) {
    const overlayItems = Array.from(
      overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input[type="checkbox"]:not(:disabled)'),
    ).filter((el) => isElementVisible(el));
    if (overlayItems.length > 0) return overlayItems;
  }

  return [];
};

const doesElementHaveChildActionSheet = (el: HTMLElement | null | undefined): boolean => {
  if (!el) return false;
  if (el.getAttribute('aria-haspopup') === 'menu') return true;
  if (el.getAttribute('data-file-menu-item') === 'profiles') return true;
  if (el.getAttribute('data-file-menu-item') === 'open-deleted' && !el.hasAttribute('disabled')) return true;
  return false;
};

const queryVisibleElements = (selectors: string[]): HTMLElement[] => {
  if (typeof document === 'undefined') return [];
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const selector of selectors) {
    try {
      const nodes = document.querySelectorAll<HTMLElement>(selector);
      nodes.forEach((node) => {
        if (seen.has(node)) return;
        if (isElementVisible(node)) {
          seen.add(node);
          results.push(node);
        }
      });
    } catch {
      // Ignore invalid selector syntax
    }
  }
  return results;
};

const resetSearchRevealedMenus = () => {
  if (typeof window === 'undefined') return;
  resetSearchSheetState();
  window.dispatchEvent(new CustomEvent('rtx:reveal-menu-path', { detail: { close: true } }));
  window.dispatchEvent(new CustomEvent('rtx:reveal-file-submenu', { detail: { submenu: null } }));
  window.dispatchEvent(new CustomEvent('rtx:reveal-drawing-menu', { detail: { menuId: null } }));
  window.dispatchEvent(new CustomEvent('rtx:reveal-toolbar-dropdown', { detail: { id: null } }));
};

const clearDomHighlightClasses = () => {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll<HTMLElement>('.rtx-search-located-target, .rtx-search-located-step')
    .forEach((el) => {
      el.classList.remove('rtx-search-located-target', 'rtx-search-located-step');
    });
  document
    .querySelectorAll<HTMLElement>('.rtx-ui-spotlight-layer, [data-testid="rtx-ui-spotlight-layer"]')
    .forEach((el) => {
      el.remove();
    });
};

const applyDomHighlightClasses = (elements: HTMLElement[], extraTargets: HTMLElement[] = []) => {
  clearDomHighlightClasses();
  elements.forEach((el, index) => {
    const isFinalTarget = index === elements.length - 1;
    if (isFinalTarget) {
      el.classList.add('rtx-search-located-target');
    } else {
      el.classList.add('rtx-search-located-step');
    }
  });
  extraTargets.forEach((el) => {
    el.classList.remove('rtx-search-located-step');
    el.classList.add('rtx-search-located-target');
  });
};

const revealMenuBarPath = (
  webRootId: string | undefined,
  desktopMenuKey: string | undefined,
  submenuPath: string[] = [],
  openDepthOverride?: number,
) => {
  const openDepth = openDepthOverride ?? searchSheetState.openDepth;
  searchSheetState.lastTargetMenuSpec = {
    ...searchSheetState.lastTargetMenuSpec,
    webRootId,
    desktopMenuKey,
    submenuPath,
  };
  if (!searchSheetState.activeWebRootId) {
    searchSheetState.activeWebRootId = webRootId;
  }
  if (!searchSheetState.activeDesktopMenuKey) {
    searchSheetState.activeDesktopMenuKey = desktopMenuKey;
  }
  window.dispatchEvent(
    new CustomEvent('rtx:reveal-menu-path', {
      detail: {
        webRootId: searchSheetState.activeWebRootId ?? webRootId,
        desktopMenuKey: searchSheetState.activeDesktopMenuKey ?? desktopMenuKey,
        submenuPath:
          searchSheetState.activeSubmenuPath.length > 0
            ? searchSheetState.activeSubmenuPath
            : submenuPath,
        openDepth,
      },
    }),
  );
};

const findMenuElements = (
  targetLabel: string,
  webRootId?: string,
  submenuPath: string[] = [],
): HTMLElement[] => {
  searchSheetState.lastTargetMenuSpec = {
    webRootId,
    desktopMenuKey: searchSheetState.lastTargetMenuSpec?.desktopMenuKey,
    submenuPath,
    targetLabel,
  };

  const depth = searchSheetState.openDepth;
  const effectiveRootId = searchSheetState.activeWebRootId || webRootId;
  const effectiveSubmenuPath =
    searchSheetState.activeSubmenuPath.length > 0
      ? searchSheetState.activeSubmenuPath
      : submenuPath;

  const elements: HTMLElement[] = [];
  const trigger = document.querySelector<HTMLElement>('.rtx-application-menu-trigger');
  if (isElementVisible(trigger)) elements.push(trigger);

  if (effectiveRootId) {
    const rootBtn = document.querySelector<HTMLElement>(`[data-menu-key="${effectiveRootId}"]`);
    if (isElementVisible(rootBtn)) elements.push(rootBtn);
  }

  // Depth 0: Only 1st Action Sheet (.rtx-application-menu) is open
  if (depth === 0) {
    const appMenu = document.querySelector<HTMLElement>('.rtx-application-menu');
    if (isElementVisible(appMenu) && elements.some((el) => appMenu.contains(el))) {
      if (
        searchSheetState.manualTargetElement &&
        appMenu.contains(searchSheetState.manualTargetElement) &&
        isElementVisible(searchSheetState.manualTargetElement)
      ) {
        elements[elements.length - 1] = searchSheetState.manualTargetElement;
      }
      return elements;
    }
  }

  // Depth >= 1: Add visible ancestor steps up to depth - 1
  const openSteps = effectiveSubmenuPath.slice(0, Math.max(0, depth - 1));
  for (const stepLabel of openSteps) {
    const stepEl =
      document.querySelector<HTMLElement>(`[data-menu-item-label="${stepLabel}"]`) ||
      document.querySelector<HTMLElement>(`.rtx-menu-row[aria-label="${stepLabel}"]`);
    if (isElementVisible(stepEl) && !elements.includes(stepEl)) {
      elements.push(stepEl);
    }
  }

  // Highlight target inside the deepest currently open .rtx-menu-surface
  const visibleSurfaces = Array.from(document.querySelectorAll<HTMLElement>('.rtx-menu-surface')).filter(
    (s) => isElementVisible(s),
  );
  const deepestSurface = visibleSurfaces[visibleSurfaces.length - 1];

  if (deepestSurface) {
    if (
      searchSheetState.manualTargetElement &&
      deepestSurface.contains(searchSheetState.manualTargetElement) &&
      isElementVisible(searchSheetState.manualTargetElement)
    ) {
      if (!elements.includes(searchSheetState.manualTargetElement)) {
        elements.push(searchSheetState.manualTargetElement);
      }
      return elements;
    }

    const surfaceButtons = getActionSheetButtonsForSurface(deepestSurface);
    const isOnOriginalBranch =
      effectiveRootId === webRootId &&
      openSteps.every((s, idx) => normalizeToken(s) === normalizeToken(submenuPath[idx] || ''));

    const desiredLabelInThisSheet = isOnOriginalBranch
      ? submenuPath[depth - 1] || targetLabel
      : undefined;

    if (desiredLabelInThisSheet) {
      const normDesired = normalizeToken(desiredLabelInThisSheet);
      const matchedBtn =
        surfaceButtons.find(
          (btn) =>
            normalizeToken(btn.getAttribute('data-menu-item-label') || btn.getAttribute('aria-label') || '') ===
            normDesired,
        ) ||
        surfaceButtons.find((btn) =>
          normalizeToken(btn.getAttribute('data-menu-item-label') || btn.textContent || '').startsWith(normDesired),
        );
      if (matchedBtn) {
        if (!elements.includes(matchedBtn)) elements.push(matchedBtn);
        return elements;
      }
    }

    if (surfaceButtons.length > 0) {
      const firstBtn = surfaceButtons[0];
      if (!elements.includes(firstBtn)) elements.push(firstBtn);
      return elements;
    }
  }

  // Fallback when .rtx-application-menu / .rtx-menu-surface are not rendered (e.g. isolated unit tests)
  for (const stepLabel of submenuPath) {
    if (normalizeToken(stepLabel) === normalizeToken(targetLabel)) continue;
    const stepEl = document.querySelector<HTMLElement>(`[data-menu-item-label="${stepLabel}"]`)
      || document.querySelector<HTMLElement>(`.rtx-menu-row[aria-label="${stepLabel}"]`);
    if (isElementVisible(stepEl) && !elements.includes(stepEl)) {
      elements.push(stepEl);
    }
  }

  const normalizedTarget = normalizeToken(targetLabel);
  const exactItem = document.querySelector<HTMLElement>(`[data-menu-item-label="${targetLabel}"]`)
    || document.querySelector<HTMLElement>(`.rtx-menu-row[aria-label="${targetLabel}"]`)
    || Array.from(document.querySelectorAll<HTMLElement>('.rtx-menu-row')).find(
      (row) => normalizeToken(row.getAttribute('data-menu-item-label') || row.textContent || '').startsWith(normalizedTarget),
    );
  if (isElementVisible(exactItem) && !elements.includes(exactItem)) {
    elements.push(exactItem);
  }

  return elements;
};

const findFileMenuElements = (fileMenuItemKey: string, extraSelector?: string): HTMLElement[] => {
  searchSheetState.lastTargetMenuSpec = {
    webRootId: 'trading-accounts',
    desktopMenuKey: 'File',
    submenuPath: [],
    fileMenuItemKey,
  };

  const depth = searchSheetState.openDepth;
  const elements: HTMLElement[] = [];
  const trigger = document.querySelector<HTMLElement>('.rtx-application-menu-trigger');
  if (isElementVisible(trigger)) elements.push(trigger);

  const rootBtn = document.querySelector<HTMLElement>('[data-menu-key="trading-accounts"]');
  if (isElementVisible(rootBtn)) elements.push(rootBtn);

  // Depth 0: Only 1st Action Sheet (.rtx-application-menu) is open
  if (depth === 0) {
    const appMenu = document.querySelector<HTMLElement>('.rtx-application-menu');
    if (isElementVisible(appMenu) && elements.some((el) => appMenu.contains(el))) {
      if (
        searchSheetState.manualTargetElement &&
        appMenu.contains(searchSheetState.manualTargetElement) &&
        isElementVisible(searchSheetState.manualTargetElement)
      ) {
        elements[elements.length - 1] = searchSheetState.manualTargetElement;
      }
      return elements;
    }
  }

  const visibleSurfaces = Array.from(document.querySelectorAll<HTMLElement>('.rtx-menu-surface')).filter(
    (s) => isElementVisible(s),
  );
  const deepestSurface = visibleSurfaces[visibleSurfaces.length - 1];

  if (
    deepestSurface &&
    searchSheetState.manualTargetElement &&
    deepestSurface.contains(searchSheetState.manualTargetElement) &&
    isElementVisible(searchSheetState.manualTargetElement)
  ) {
    const fileItem = document.querySelector<HTMLElement>(`[data-file-menu-item="${fileMenuItemKey}"]`);
    if (depth >= 2 && isElementVisible(fileItem) && fileItem !== searchSheetState.manualTargetElement) {
      elements.push(fileItem);
    }
    elements.push(searchSheetState.manualTargetElement);
    return elements;
  }

  const fileItem = document.querySelector<HTMLElement>(`[data-file-menu-item="${fileMenuItemKey}"]`);
  if (isElementVisible(fileItem)) elements.push(fileItem);

  if (depth >= 2) {
    if (extraSelector) {
      const extra = document.querySelector<HTMLElement>(extraSelector);
      if (isElementVisible(extra)) elements.push(extra);
    }
    if (deepestSurface) {
      const btns = getActionSheetButtonsForSurface(deepestSurface);
      if (btns.length > 0 && !elements.includes(btns[0])) {
        elements.push(btns[0]);
      }
    }
  }

  return elements;
};

const findDrawingFlyoutElements = (menuId: string, toolLabel?: string, toolId?: string): HTMLElement[] => {
  const elements: HTMLElement[] = [];
  const railBtn = document.querySelector<HTMLElement>(`[data-rail-menu="${menuId}"]`);
  if (isElementVisible(railBtn)) elements.push(railBtn);

  const flyout = document.querySelector<HTMLElement>(`[data-menu="${menuId}"]`);
  if (
    flyout &&
    searchSheetState.manualTargetElement &&
    flyout.contains(searchSheetState.manualTargetElement) &&
    isElementVisible(searchSheetState.manualTargetElement)
  ) {
    elements.push(searchSheetState.manualTargetElement);
    return elements;
  }
  if (flyout && (toolLabel || toolId)) {
    if (toolId) {
      const byToolId = flyout.querySelector<HTMLElement>(`[data-tool-id="${toolId}"]`);
      if (isElementVisible(byToolId)) {
        elements.push(byToolId);
        return elements;
      }
    }
    if (toolLabel) {
      const items = Array.from(
        flyout.querySelectorAll<HTMLElement>('.web-drawing-tools-menu__item, .web-drawing-tools-menu__toggle-row'),
      );
      const normTarget = normalizeToken(toolLabel);
      const exact = items.find((item) => {
        const labelEl = item.querySelector('.web-drawing-tools-menu__label');
        const normText = normalizeToken(labelEl?.textContent || item.textContent || '');
        return normText === normTarget || normText.includes(normTarget) || normTarget.includes(normText);
      });
      if (isElementVisible(exact)) {
        elements.push(exact);
        return elements;
      }
    }
  }

  if (isElementVisible(flyout)) {
    elements.push(flyout);
  }
  return elements;
};

export const TopToolbarSearch: React.FC<TopToolbarSearchProps> = ({
  selectedSymbol,
  timeframe,
  onSymbolChange,
  onTimeframeChange,
  onChartTypeChange,
  onNewOrder,
  onOpenChart,
  onOpenHistoryDownloader,
  onTileWindows,
  onResetWindows,
}) => {
  const tr = useUiTranslation();
  const [query, setQuery] = useState('');
  const [activeFlatIndex, setActiveFlatIndex] = useState(0);
  const [isHighlighting, setIsHighlighting] = useState(false);

  const queryRef = useRef(query);
  queryRef.current = query;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const locateTimersRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const hasRevealedSomethingRef = useRef(false);

  const storeSymbols = useAppStore((state) => (state as { symbols?: Array<{ symbol?: string; description?: string; category?: string }> }).symbols);
  const storeTicks = useAppStore((state) => state.ticks);

  const clearLocateTimers = useCallback(() => {
    if (rafRef.current !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    locateTimersRef.current.forEach((id) => window.clearTimeout(id));
    locateTimersRef.current = [];
  }, []);

  const clearAllSearchEffects = useCallback((shouldCloseMenus = true) => {
    clearLocateTimers();
    clearDomHighlightClasses();
    setIsHighlighting(false);
    if (shouldCloseMenus && hasRevealedSomethingRef.current) {
      resetSearchRevealedMenus();
      hasRevealedSomethingRef.current = false;
    }
  }, [clearLocateTimers]);

  useEffect(() => {
    if (!queryRef.current.trim()) {
      clearDomHighlightClasses();
    }
    return () => {
      clearLocateTimers();
      clearDomHighlightClasses();
    };
  }, [clearLocateTimers]);

  const openIndicatorDialog = useCallback((category?: string) => {
    const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
    commandBus.dispatch({
      type: 'OPEN_INDICATOR_LIST',
      payload: {
        ...(category ? { category } : {}),
        targetContextId: target.targetContextId,
        symbol: target.symbol ?? selectedSymbol,
      },
    });
  }, [selectedSymbol, timeframe]);

  const selectDrawingTool = useCallback((tool: string, subtype?: string) => {
    const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
    commandBus.dispatch({
      type: 'SELECT_TOOL',
      payload: {
        tool: tool as never,
        ...(subtype ? { subtype } : {}),
        targetContextId: target.targetContextId,
      },
    });
  }, [selectedSymbol, timeframe]);

  const ensureDrawingRailAndOpenMenu = useCallback((menuId?: string) => {
    if (menuId) {
      window.dispatchEvent(new CustomEvent('rtx:reveal-drawing-menu', { detail: { menuId } }));
    }
  }, []);

  // Comprehensive catalog of every option, menu, submenu, flyout tool, indicator, panel, tab, and symbol
  const catalogItems = useMemo<UniversalSearchItem[]>(() => {
    const items: UniversalSearchItem[] = [];

    // =========================================================================
    // 1. TRADING ACCOUNTS (`FileMenu`) — Log Out, Exit, Profiles, Print, Save, Login, etc.
    // =========================================================================
    items.push(
      {
        id: 'file-logout',
        title: 'Log Out',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Disconnect and log out from the active trading account session',
        keywords: ['logout', 'log out', 'sign out', 'signout', 'disconnect', 'trading accounts', 'account', 'session'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Log Out',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('logout'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-exit',
        title: 'Exit',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Exit the trading terminal or sign out from the web session',
        keywords: ['exit', 'quit', 'close app', 'logout', 'log out', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Exit',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('exit'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'menu-trading-accounts',
        title: 'Trading accounts',
        category: 'menus',
        categoryLabel: 'Menu Bar → Trading accounts',
        description: 'Open Trading accounts menu to inspect current login, switch accounts, log out, or manage workspace profiles',
        keywords: ['trading accounts', 'current account', 'account', 'file menu', 'broker account'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => {
              const els = findFileMenuElements('logout');
              const card = document.querySelector<HTMLElement>('.rtx-file-menu__account-card');
              if (isElementVisible(card)) {
                return [...els.slice(0, 2), card];
              }
              return els.slice(0, 2);
            },
          },
          {
            path: 'Navigator Panel → Accounts',
            prepare: () => ensurePanelVisible('.navigator-panel, [data-dock-panel="navigator"]', 'view.toggle-navigator'),
            findElements: () => queryVisibleElements(['.navigator-panel', '[data-dock-panel="navigator"]']),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-open-deleted',
        title: 'Open Deleted',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Restore any recently closed chart tab with its drawings and settings',
        keywords: ['open deleted', 'restore chart', 'reopen closed chart', 'deleted charts', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Open Deleted',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('open-deleted'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-profiles',
        title: 'Profiles',
        category: 'menus',
        categoryLabel: 'Trading accounts → Profiles',
        description: 'Switch between saved chart workspace profiles, save current layout as a profile, or restore Default',
        keywords: ['profiles', 'workspace profile', 'save profile', 'default profile', 'next profile', 'previous profile', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Profiles',
            prepare: () => {
              revealMenuBarPath('trading-accounts', 'File', []);
              if (searchSheetState.openDepth >= 2) {
                window.dispatchEvent(new CustomEvent('rtx:reveal-file-submenu', { detail: { submenu: 'profiles' } }));
              }
            },
            findElements: () => findFileMenuElements('profiles', '.rtx-file-submenu'),
          },
        ],
        execute: () => {
          revealMenuBarPath('trading-accounts', 'File', []);
          window.dispatchEvent(new CustomEvent('rtx:reveal-file-submenu', { detail: { submenu: 'profiles' } }));
        },
      },
      {
        id: 'file-close-chart',
        title: 'Close',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Close the currently focused chart tab',
        shortcut: 'Shift+Alt+Q',
        keywords: ['close', 'close chart', 'shift+alt+q', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Close (Shift+Alt+Q)',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('close'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-save-workspace',
        title: 'Save',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Save current charts, indicators, and workspace arrangement',
        shortcut: 'Ctrl+S',
        keywords: ['save', 'save workspace', 'ctrl+s', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Save (Ctrl+S)',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('save'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-save-as-picture',
        title: 'Save As Picture',
        category: 'menus',
        categoryLabel: 'Trading accounts & Toolbar',
        description: 'Export the active chart or workspace as a high-resolution PNG image',
        shortcut: 'Ctrl+Shift+S',
        keywords: ['save as picture', 'screenshot', 'export image', 'chart picture', 'ctrl+shift+s', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Save As Picture',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('save-picture'),
            findExtraTargets: () => queryVisibleElements(['[aria-label="Screenshot"]']),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-open-data-folder',
        title: 'Open Data Folder',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Open the local terminal data directory',
        shortcut: 'Ctrl+Shift+D',
        keywords: ['open data folder', 'data folder', 'directory', 'files', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Open Data Folder',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('open-data-folder'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-print-chart',
        title: 'Print',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Print the active chart canvas',
        shortcut: 'Ctrl+P',
        keywords: ['print', 'print chart', 'ctrl+p', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Print (Ctrl+P)',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('print'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-print-preview',
        title: 'Print Preview',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Preview the active chart before printing',
        shortcut: 'Ctrl+Shift+P',
        keywords: ['print preview', 'preview print', 'ctrl+shift+p', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Print Preview (Ctrl+Shift+P)',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('print-preview'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-print-setup',
        title: 'Print Setup',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Configure page orientation, paper size, margins, and color mode for chart printing',
        keywords: ['print setup', 'page setup', 'printer settings', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Print Setup',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('print-setup'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-login-trade',
        title: 'Login to Trade Account',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Connect or switch to another trading account login and server',
        keywords: ['login', 'login to trade account', 'connect account', 'switch account', 'password', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Login to Trade Account',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('login-trade'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-login-web',
        title: 'Login to Web Trader',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Launch or authenticate the Web Trader session',
        keywords: ['login to web trader', 'web trader', 'browser trader', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Login to Web Trader',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('login-web'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
      {
        id: 'file-login-community',
        title: 'Login to the community',
        category: 'menus',
        categoryLabel: 'Trading accounts',
        description: 'Community integration status inside Trading accounts menu',
        keywords: ['login to the community', 'community', 'trading accounts'],
        locations: [
          {
            path: 'Menu Bar → Trading accounts → Login to the community',
            prepare: () => revealMenuBarPath('trading-accounts', 'File', []),
            findElements: () => findFileMenuElements('login-community'),
          },
        ],
        execute: () => revealMenuBarPath('trading-accounts', 'File', []),
      },
    );

    // =========================================================================
    // 2. INDICATORS — Master List, Categories, and All 18 Technical Indicators
    // =========================================================================
    const makeIndicatorLocations = (menuCategory?: string): SearchLocationTarget[] => [
      {
        path: menuCategory
          ? `Menu Bar → Chart settings → Insert & drawing tools → Indicators → ${menuCategory}`
          : 'Menu Bar → Chart settings → Insert & drawing tools → Indicators',
        prepare: () => revealMenuBarPath(
          'chart-settings',
          'Insert',
          ['Insert & drawing tools', 'Indicators'],
        ),
        findElements: () => findMenuElements(
          menuCategory || 'All Indicators',
          'chart-settings',
          ['Insert & drawing tools', 'Indicators'],
        ),
        findExtraTargets: () => queryVisibleElements(['[aria-label="Indicators List"]']),
      },
      {
        path: 'Top Toolbar → Chart Tools → Indicators List (Ctrl+I)',
        findElements: () => queryVisibleElements(['[aria-label="Indicators List"]']),
      },
      {
        path: 'Navigator Panel → Indicators',
        prepare: () => ensurePanelVisible('.navigator-panel, [data-dock-panel="navigator"]', 'view.toggle-navigator'),
        findElements: () => {
          const rows = Array.from(document.querySelectorAll<HTMLElement>('.navigator-tree-item__row'));
          const indRow = rows.find((r) => r.textContent?.toLowerCase().includes('indicators'));
          return indRow ? [indRow] : queryVisibleElements(['.navigator-panel', '[data-dock-panel="navigator"]']);
        },
      },
    ];

    items.push(
      {
        id: 'menu-insert-drawing-tools',
        title: 'Insert & drawing tools',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart settings',
        description: 'Open Insert & drawing tools menu to access Indicators, Objects, Lines, Channels, Fibonacci, Shapes, and Stamps',
        keywords: ['insert', 'insert menu', 'insert & drawing tools', 'drawing tools'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Insert & drawing tools',
            prepare: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools']),
            findElements: () => findMenuElements('Insert & drawing tools', 'chart-settings', []),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools']),
      },
      {
        id: 'indicators-master',
        title: 'Indicators List',
        category: 'indicators',
        categoryLabel: 'Indicators',
        description: 'Browse and attach Trend, Oscillators, Volumes, and Bill Williams indicators to the active chart',
        shortcut: 'Ctrl+I',
        keywords: ['indicators', 'indicator', 'indicator list', 'all indicators', 'technical analysis', 'study', 'studies', 'ctrl+i', 'trend', 'oscillators', 'volumes', 'bill williams'],
        locations: makeIndicatorLocations(),
        execute: () => openIndicatorDialog(),
      },
    );

    for (const ind of INDICATOR_CATALOG) {
      items.push({
        id: ind.id,
        title: ind.name,
        category: 'indicators',
        categoryLabel: `Indicator · ${ind.category}`,
        description: ind.description,
        shortcut: 'Ctrl+I',
        keywords: [...ind.keywords, ind.name.toLowerCase(), ind.category.toLowerCase(), 'indicator', 'indicators'],
        locations: makeIndicatorLocations(ind.menuCategory),
        execute: () => openIndicatorDialog(ind.category),
      });
    }

    // =========================================================================
    // 3. ALL INDIVIDUAL DRAWING TOOLS FROM LIVE RAIL CATALOGS
    // =========================================================================
    for (const tool of TREND_LINE_TOOLS) {
      const menuSubpath = tool.group === 'Lines'
        ? ['Insert & drawing tools', 'Objects', 'Lines']
        : tool.group === 'Channels'
          ? ['Insert & drawing tools', 'Objects', 'Channels']
          : undefined;
      const menuItemLabel = tool.id === 'trendline'
        ? 'Trend Line'
        : tool.id === 'horizontal_line'
          ? 'Horizontal Line'
          : tool.id === 'vertical_line'
            ? 'Vertical Line'
            : tool.id === 'parallel_channel'
              ? 'Equidistant Channel'
              : undefined;

      const locs: SearchLocationTarget[] = [
        {
          path: `Left Drawing Rail → ${tool.group} → ${tool.label}`,
          prepare: () => ensureDrawingRailAndOpenMenu('trend'),
          findElements: () => findDrawingFlyoutElements('trend', tool.label, tool.id),
        },
      ];
      if (menuSubpath && menuItemLabel) {
        locs.push({
          path: `Menu Bar → Chart settings → ${menuSubpath.join(' → ')} → ${menuItemLabel}`,
          prepare: () => revealMenuBarPath('chart-settings', 'Insert', menuSubpath),
          findElements: () => findMenuElements(menuItemLabel, 'chart-settings', menuSubpath),
        });
      }

      items.push({
        id: `draw-trend-${tool.id}`,
        title: tool.label,
        category: 'drawings',
        categoryLabel: `Drawing · ${tool.group}`,
        description: `${tool.label} drawing tool inside Left Drawing Rail (${tool.group})`,
        shortcut: tool.shortcut,
        keywords: [tool.label.toLowerCase(), tool.id.replace(/_/g, ' '), tool.id, tool.group.toLowerCase(), 'trendline', 'trend line', 'drawing'],
        locations: locs,
        execute: () => {
          ensureDrawingRailAndOpenMenu('trend');
          selectDrawingTool(tool.drawingType, tool.id);
        },
      });
    }

    for (const tool of GANN_FIBONACCI_TOOLS) {
      const locs: SearchLocationTarget[] = [
        {
          path: `Left Drawing Rail → ${tool.group} → ${tool.label}`,
          prepare: () => ensureDrawingRailAndOpenMenu('fibonacci'),
          findElements: () => findDrawingFlyoutElements('fibonacci', tool.label, tool.id),
        },
      ];
      if (tool.id === 'fib_retracement' || tool.id === 'trend_based_fib_extension') {
        const menuLabel = tool.id === 'fib_retracement' ? 'Fibonacci Retracement' : 'Fibonacci Extension';
        locs.push({
          path: `Menu Bar → Chart settings → Insert & drawing tools → Objects → Fibonacci → ${menuLabel}`,
          prepare: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools', 'Objects', 'Fibonacci']),
          findElements: () => findMenuElements(menuLabel, 'chart-settings', ['Insert & drawing tools', 'Objects', 'Fibonacci']),
        });
      }
      items.push({
        id: `draw-fib-${tool.id}`,
        title: tool.label,
        category: 'drawings',
        categoryLabel: `Drawing · ${tool.group}`,
        description: `${tool.label} tool inside Left Drawing Rail (${tool.group})`,
        shortcut: tool.shortcut,
        keywords: [tool.label.toLowerCase(), tool.id.replace(/_/g, ' '), 'fibonacci', 'gann', 'drawing'],
        locations: locs,
        execute: () => {
          ensureDrawingRailAndOpenMenu('fibonacci');
          selectDrawingTool(tool.drawingType, tool.id);
        },
      });
    }

    for (const tool of CHART_PATTERN_TOOLS) {
      items.push({
        id: `draw-pattern-${tool.id}`,
        title: tool.label,
        category: 'drawings',
        categoryLabel: `Pattern · ${tool.group}`,
        description: `${tool.label} inside Left Drawing Rail (Chart patterns)`,
        keywords: [tool.label.toLowerCase(), tool.id.replace(/_/g, ' '), 'pattern', 'chart patterns', 'elliott', 'harmonic', 'drawing'],
        locations: [
          {
            path: `Left Drawing Rail → Chart patterns → ${tool.label}`,
            prepare: () => ensureDrawingRailAndOpenMenu('patterns'),
            findElements: () => findDrawingFlyoutElements('patterns', tool.label, tool.id),
          },
        ],
        execute: () => {
          ensureDrawingRailAndOpenMenu('patterns');
          selectDrawingTool('pattern', tool.id);
        },
      });
    }

    for (const tool of FORECASTING_MEASUREMENT_TOOLS) {
      items.push({
        id: `draw-forecast-${tool.id}`,
        title: tool.label,
        category: 'drawings',
        categoryLabel: `Forecasting · ${tool.group}`,
        description: `${tool.label} inside Left Drawing Rail (Forecasting & measurement)`,
        keywords: [tool.label.toLowerCase(), tool.id.replace(/_/g, ' '), 'forecasting', 'risk reward', 'position', 'range', 'drawing'],
        locations: [
          {
            path: `Left Drawing Rail → Forecasting → ${tool.label}`,
            prepare: () => ensureDrawingRailAndOpenMenu('forecasting'),
            findElements: () => findDrawingFlyoutElements('forecasting', tool.label, tool.id),
          },
        ],
        execute: () => {
          ensureDrawingRailAndOpenMenu('forecasting');
          selectDrawingTool(tool.drawingType, tool.id);
        },
      });
    }

    for (const brushTool of [
      { id: 'brush', label: 'Brush', tool: 'freehand', subtype: undefined },
      { id: 'highlighter', label: 'Highlighter', tool: 'freehand', subtype: 'highlighter' },
    ]) {
      items.push({
        id: `draw-shape-${brushTool.id}`,
        title: brushTool.label,
        category: 'drawings',
        categoryLabel: 'Drawing · Brushes',
        description: `${brushTool.label} freehand tool inside Left Drawing Rail (Brushes & shapes)`,
        keywords: [brushTool.label.toLowerCase(), 'freehand', 'shapes', 'drawing'],
        locations: [
          {
            path: `Left Drawing Rail → Brushes → ${brushTool.label}`,
            prepare: () => ensureDrawingRailAndOpenMenu('shapes'),
            findElements: () => findDrawingFlyoutElements('shapes', brushTool.label),
          },
        ],
        execute: () => {
          ensureDrawingRailAndOpenMenu('shapes');
          selectDrawingTool(brushTool.tool, brushTool.subtype);
        },
      });
    }

    for (const tool of BRUSH_SHAPE_TOOLS) {
      const locs: SearchLocationTarget[] = [
        {
          path: `Left Drawing Rail → ${tool.group} → ${tool.label}`,
          prepare: () => ensureDrawingRailAndOpenMenu('shapes'),
          findElements: () => findDrawingFlyoutElements('shapes', tool.label, tool.id),
        },
      ];
      if (tool.id === 'rectangle' || tool.id === 'ellipse') {
        const menuLabel = tool.id === 'rectangle' ? 'Rectangle' : 'Ellipse';
        locs.push({
          path: `Menu Bar → Chart settings → Insert & drawing tools → Objects → Shapes → ${menuLabel}`,
          prepare: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools', 'Objects', 'Shapes']),
          findElements: () => findMenuElements(menuLabel, 'chart-settings', ['Insert & drawing tools', 'Objects', 'Shapes']),
        });
      }
      items.push({
        id: `draw-shape-${tool.id}`,
        title: tool.label,
        category: 'drawings',
        categoryLabel: `Drawing · ${tool.group}`,
        description: `${tool.label} inside Left Drawing Rail (${tool.group})`,
        keywords: [tool.label.toLowerCase(), tool.id.replace(/_/g, ' '), 'shapes', 'arrows', 'drawing'],
        locations: locs,
        execute: () => {
          ensureDrawingRailAndOpenMenu('shapes');
          selectDrawingTool('shapes', tool.id);
        },
      });
    }

    for (const tool of TEXT_NOTE_TOOLS) {
      const locs: SearchLocationTarget[] = [
        {
          path: `Left Drawing Rail → Annotation tools → ${tool.label}`,
          prepare: () => ensureDrawingRailAndOpenMenu('annotations'),
          findElements: () => findDrawingFlyoutElements('annotations', tool.label, tool.id),
        },
      ];
      if (tool.id === 'text' || tool.id === 'callout') {
        const menuLabel = tool.id === 'text' ? 'Text' : 'Callout';
        locs.push({
          path: `Menu Bar → Chart settings → Insert & drawing tools → Objects → ${menuLabel}`,
          prepare: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools', 'Objects']),
          findElements: () => findMenuElements(menuLabel, 'chart-settings', ['Insert & drawing tools', 'Objects']),
        });
      }
      items.push({
        id: `draw-annot-${tool.id}`,
        title: tool.label,
        category: 'drawings',
        categoryLabel: 'Drawing · Annotations',
        description: `${tool.label} annotation tool inside Left Drawing Rail`,
        keywords: [tool.label.toLowerCase(), tool.id.replace(/_/g, ' '), 'annotation', 'text', 'note', 'drawing'],
        locations: locs,
        execute: () => {
          ensureDrawingRailAndOpenMenu('annotations');
          selectDrawingTool('text', tool.id);
        },
      });
    }

    for (const cursor of CURSOR_TOOLS) {
      items.push({
        id: `draw-cursor-${cursor.id}`,
        title: `${cursor.label} Cursor`,
        category: 'drawings',
        categoryLabel: 'Cursors',
        description: `Switch chart pointer to ${cursor.label} mode`,
        keywords: [cursor.label.toLowerCase(), `${cursor.label.toLowerCase()} cursor`, 'cursor', 'crosshair', 'pointer'],
        locations: [
          {
            path: `Left Drawing Rail → Cursors → ${cursor.label}`,
            prepare: () => ensureDrawingRailAndOpenMenu('cursors'),
            findElements: () => findDrawingFlyoutElements('cursors', cursor.label, cursor.id),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('cursors'),
      });
    }

    items.push(
      {
        id: 'draw-emojis',
        title: 'Emojis & Stickers Picker',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Open the Emoji picker flyout on the Left Drawing Rail',
        keywords: ['emojis', 'emoji', 'stickers', 'smiley'],
        locations: [
          {
            path: 'Left Drawing Rail → Emojis',
            prepare: () => ensureDrawingRailAndOpenMenu('emojis'),
            findElements: () => findDrawingFlyoutElements('emojis'),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('emojis'),
      },
      {
        id: 'draw-stamps',
        title: 'Stamps & Trade Icons',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Place directional arrows, checkmarks, stars, and stamps on the chart',
        keywords: ['stamps', 'icons', ...STAMP_OPTIONS.map((s) => s.label.toLowerCase())],
        locations: [
          {
            path: 'Left Drawing Rail → Icons and Stamps',
            prepare: () => ensureDrawingRailAndOpenMenu('stamps'),
            findElements: () => findDrawingFlyoutElements('stamps'),
          },
          {
            path: 'Menu Bar → Chart settings → Insert & drawing tools → Objects → Stamps',
            prepare: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools', 'Objects', 'Stamps']),
            findElements: () => findMenuElements('Stamps', 'chart-settings', ['Insert & drawing tools', 'Objects']),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('stamps'),
      },
      {
        id: 'draw-measure',
        title: 'Measure (Ruler Tool)',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Measure price distance, percentage change, and bar count between two points',
        keywords: ['measure', 'ruler', 'distance', 'pips', 'bars'],
        locations: [
          {
            path: 'Left Drawing Rail → Measure',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.web-drawing-tools-rail [aria-label="Measure"]']),
          },
          {
            path: 'Menu Bar → Chart settings → Insert & drawing tools → Objects → Measure',
            prepare: () => revealMenuBarPath('chart-settings', 'Insert', ['Insert & drawing tools', 'Objects']),
            findElements: () => findMenuElements('Measure', 'chart-settings', ['Insert & drawing tools', 'Objects']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('.web-drawing-tools-rail [aria-label="Measure"]');
          if (btn) {
            btn.click();
          } else {
            selectDrawingTool('ruler');
          }
        },
      },
      {
        id: 'draw-keep-drawing',
        title: 'Keep drawing',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Keep the selected drawing tool active after placing a drawing on the chart',
        keywords: ['keep drawing', 'continuous drawing', 'stay in drawing mode'],
        locations: [
          {
            path: 'Left Drawing Rail → Keep drawing',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.web-drawing-tools-rail [aria-label="Keep drawing"]']),
          },
        ],
        execute: () => {
          document.querySelector<HTMLButtonElement>('.web-drawing-tools-rail [aria-label="Keep drawing"]')?.click();
        },
      },
      {
        id: 'draw-magnet',
        title: 'Magnet Mode (Weak / Strong Magnet)',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Snap drawing anchor points automatically to nearby candle OHLC prices',
        keywords: ['magnet', 'magnet mode', 'weak magnet', 'strong magnet', 'snap to indicators', 'snap'],
        locations: [
          {
            path: 'Left Drawing Rail → Magnet mode',
            prepare: () => ensureDrawingRailAndOpenMenu('magnet'),
            findElements: () => findDrawingFlyoutElements('magnet', 'Weak magnet'),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('magnet'),
      },
      {
        id: 'draw-lock',
        title: 'Lock / Unlock Drawings & Indicators',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Lock drawings or indicators on the chart to prevent accidental movement',
        keywords: ['lock', 'lock drawings', 'unlock drawings', 'lock indicators', 'lock all', 'lock objects'],
        locations: [
          {
            path: 'Left Drawing Rail → Lock objects',
            prepare: () => ensureDrawingRailAndOpenMenu('lock'),
            findElements: () => findDrawingFlyoutElements('lock', 'drawings'),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('lock'),
      },
      {
        id: 'draw-hide',
        title: 'Hide / Show Drawings, Indicators & Positions',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Temporarily hide or show chart drawings, indicators, or trade positions',
        keywords: ['hide', 'hide drawings', 'hide indicators', 'hide positions', 'hide objects', 'visibility'],
        locations: [
          {
            path: 'Left Drawing Rail → Hide objects',
            prepare: () => ensureDrawingRailAndOpenMenu('hide'),
            findElements: () => findDrawingFlyoutElements('hide', 'drawings'),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('hide'),
      },
      {
        id: 'draw-remove',
        title: 'Remove / Delete Drawings & Indicators',
        category: 'drawings',
        categoryLabel: 'Drawing Tools',
        description: 'Open Remove flyout to delete drawings, indicators, or clear the chart',
        keywords: ['remove', 'remove drawings', 'delete drawings', 'trash', 'clear chart', 'delete all'],
        locations: [
          {
            path: 'Left Drawing Rail → Remove Drawings',
            prepare: () => ensureDrawingRailAndOpenMenu('remove'),
            findElements: () => findDrawingFlyoutElements('remove'),
          },
          {
            path: 'Menu Bar → Chart settings → Chart controls → Objects → Delete All',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls', 'Objects']),
            findElements: () => findMenuElements('Delete All', 'chart-settings', ['Chart controls', 'Objects']),
          },
        ],
        execute: () => ensureDrawingRailAndOpenMenu('remove'),
      },
    );

    // =========================================================================
    // 4. TOP TOOLBAR CONTROLS, CHART TYPES, TIMEFRAMES & DROPDOWN SHEETS
    // =========================================================================
    items.push(
      {
        id: 'toolbar-new-order',
        title: 'New Order',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Open the Market / Pending Order execution ticket for the selected symbol',
        shortcut: 'F9',
        keywords: ['new order', 'buy', 'sell', 'market order', 'limit order', 'stop order', 'trade', 'f9', 'ticket'],
        locations: [
          {
            path: 'Top Toolbar → New Order (F9)',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.rtx-toolbar-action--primary', '[aria-label*="New Order"]']),
          },
        ],
        execute: () => {
          if (onNewOrder) {
            onNewOrder();
          } else {
            document.querySelector<HTMLButtonElement>('.rtx-toolbar-action--primary, [aria-label*="New Order"]')?.click();
          }
        },
      },
      {
        id: 'toolbar-last-symbol',
        title: `Last Symbol (${selectedSymbol})`,
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Quickly re-activate or place an order on the active chart symbol',
        keywords: ['last symbol', 'current symbol', selectedSymbol.toLowerCase(), 'toolbar'],
        locations: [
          {
            path: 'Top Toolbar → Last Symbol',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.rtx-toolbar-action--last-symbol', '[aria-label*="Last Symbol"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('.rtx-toolbar-action--last-symbol, [aria-label*="Last Symbol"]');
          if (btn) {
            btn.click();
          } else {
            onSymbolChange(selectedSymbol);
          }
        },
      },
      {
        id: 'toolbar-chart-candlesticks',
        title: 'Candlesticks',
        category: 'toolbar',
        categoryLabel: 'Chart Type',
        description: 'Switch the active chart to Japanese Candlesticks mode',
        shortcut: 'Alt+2',
        keywords: ['candlesticks', 'candles', 'chart type', 'alt+2', 'japanese'],
        locations: [
          {
            path: 'Top Toolbar → Candlesticks',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Candlesticks"]']),
          },
        ],
        execute: () => onChartTypeChange('candlestick'),
      },
      {
        id: 'toolbar-chart-bars',
        title: 'Bar Chart',
        category: 'toolbar',
        categoryLabel: 'Chart Type',
        description: 'Switch the active chart to high-low-open-close Bar Chart mode',
        shortcut: 'Alt+1',
        keywords: ['bar chart', 'bars', 'ohlc', 'chart type', 'alt+1'],
        locations: [
          {
            path: 'Top Toolbar → Bar Chart',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Bar Chart"]']),
          },
        ],
        execute: () => onChartTypeChange('bar'),
      },
      {
        id: 'toolbar-chart-line',
        title: 'Line Chart',
        category: 'toolbar',
        categoryLabel: 'Chart Type',
        description: 'Switch the active chart to close-price Line Chart mode',
        shortcut: 'Alt+3',
        keywords: ['line chart', 'chart type', 'alt+3'],
        locations: [
          {
            path: 'Top Toolbar → Line Chart',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Line Chart"]']),
          },
        ],
        execute: () => onChartTypeChange('line'),
      },
      {
        id: 'toolbar-chart-area',
        title: 'Area Chart',
        category: 'toolbar',
        categoryLabel: 'Chart Type',
        description: 'Switch the active chart to shaded Area Chart mode',
        shortcut: 'Alt+4',
        keywords: ['area chart', 'area', 'mountain', 'chart type', 'alt+4'],
        locations: [
          {
            path: 'Top Toolbar → Area Chart',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Area Chart"]']),
          },
        ],
        execute: () => onChartTypeChange('area'),
      },
      {
        id: 'toolbar-trade-history-dropdown',
        title: 'Trade History Overlays (Entry / close line & Entry / close arrows)',
        category: 'toolbar',
        categoryLabel: 'Dropdown / Action Sheet',
        description: 'Open the Trade History Overlays dropdown sheet to toggle Entry/close lines and execution arrows on the chart',
        keywords: ['trade history', 'overlays', 'entry', 'close', 'entry / close line', 'entry / close arrows', 'arrows', 'dropdown', 'action sheet', 'execution markers', 'deals'],
        locations: [
          {
            path: 'Top Toolbar → Trade History Overlays (Dropdown Sheet)',
            hasActionSheet: true,
            prepare: () => {
              window.dispatchEvent(new CustomEvent('rtx:reveal-toolbar-dropdown', { detail: { id: 'trade-history-overlays' } }));
            },
            findElements: () => queryVisibleElements([
              '[aria-label="Trade History Overlays"]',
              '[role="menu"][aria-label*="Trade History Overlays"]',
            ]),
          },
        ],
        execute: () => {
          window.dispatchEvent(new CustomEvent('rtx:reveal-toolbar-dropdown', { detail: { id: 'trade-history-overlays' } }));
        },
      },
      {
        id: 'toolbar-period-separators',
        title: 'Period Separators',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Toggle vertical session/period separator lines on the active chart',
        keywords: ['period separators', 'vertical lines', 'session breaks', 'chart tools'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Period Separators',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.rtx-period-separator-toggle', '[aria-label*="Period Separators"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('.rtx-period-separator-toggle, [aria-label*="Period Separators"]');
          if (btn) {
            btn.click();
          } else {
            const store = useChartSettingsStore.getState();
            const symbolProps = (selectedSymbol ? store.symbolProperties[selectedSymbol] : undefined) ?? store.globalProperties;
            const current = symbolProps.showPeriodSeparators !== false;
            store.updateGlobalProperty('showPeriodSeparators', !current);
            store.updateSymbolProperty(selectedSymbol, 'showPeriodSeparators', !current);
          }
        },
      },
      {
        id: 'toolbar-chart-shift',
        title: 'Chart Shift',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Shift the latest candle away from the right price scale for forward projection space',
        keywords: ['chart shift', 'shift', 'right margin', 'offset', 'candle'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Chart Shift',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label*="Chart Shift"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label*="Chart Shift"]');
          if (btn) {
            btn.click();
          } else {
            const store = useChartSettingsStore.getState();
            const symbolProps = (selectedSymbol ? store.symbolProperties[selectedSymbol] : undefined) ?? store.globalProperties;
            const current = Boolean(symbolProps.chartShift);
            store.updateSymbolProperty(selectedSymbol, 'chartShift', !current);
            const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
            commandBus.dispatch({
              type: 'SET_CHART_SHIFT',
              payload: {
                enabled: !current,
                ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}),
              },
            });
          }
        },
      },
      {
        id: 'toolbar-auto-scroll',
        title: 'Auto Scroll / Jump to Latest Candle',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Scroll chart automatically to the latest incoming tick / candle',
        keywords: ['auto scroll', 'jump to latest candle', 'latest bar', 'scroll', 'navigation'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Jump to Latest Candle',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label*="Jump to Latest Candle"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label*="Jump to Latest Candle"]');
          if (btn) {
            btn.click();
          } else {
            const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
            commandBus.dispatch({
              type: 'JUMP_TO_LATEST_CANDLE',
              payload: {
                ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}),
              },
            });
          }
        },
      },
      {
        id: 'toolbar-screenshot',
        title: 'Screenshot',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Capture and download a PNG snapshot of the current chart canvas',
        keywords: ['screenshot', 'camera', 'snapshot', 'save picture', 'image', 'export chart'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Screenshot',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label*="Screenshot"]']),
          },
        ],
        execute: () => {
          document.querySelector<HTMLButtonElement>('[aria-label*="Screenshot"]')?.click();
        },
      },
      {
        id: 'toolbar-zoom',
        title: 'Zoom In',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Magnify the horizontal candle density on the active chart',
        shortcut: '+',
        keywords: ['zoom in', 'zoom', 'magnify', 'scale', 'candles'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Zoom In',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Zoom In"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label="Zoom In"]');
          if (btn) {
            btn.click();
          } else {
            const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
            commandBus.dispatch({
              type: 'ZOOM_IN',
              payload: { ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) },
            });
          }
        },
      },
      {
        id: 'toolbar-zoom-out',
        title: 'Zoom Out',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Compress the horizontal candle density on the active chart',
        shortcut: '-',
        keywords: ['zoom out', 'compress', 'scale'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Zoom Out',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Zoom Out"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label="Zoom Out"]');
          if (btn) {
            btn.click();
          } else {
            const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
            commandBus.dispatch({
              type: 'ZOOM_OUT',
              payload: { ...(target.targetContextId ? { targetContextId: target.targetContextId } : {}) },
            });
          }
        },
      },
      {
        id: 'toolbar-arrange-windows',
        title: 'Arrange Windows / Tile Windows',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Tile all open chart windows evenly across the workspace',
        shortcut: 'Alt+R',
        keywords: ['arrange windows', 'tile windows', 'cascade', 'grid layout', 'multi chart', 'alt+r'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Arrange Windows',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Arrange Windows"]']),
          },
        ],
        execute: () => {
          if (onTileWindows) {
            onTileWindows();
          } else {
            document.querySelector<HTMLButtonElement>('[aria-label="Arrange Windows"]')?.click();
          }
        },
      },
      {
        id: 'toolbar-reset-layout',
        title: 'Reset Layout',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Reset multi-chart and dock panel layout to defaults',
        keywords: ['reset layout', 'reset windows', 'restore layout'],
        locations: [
          {
            path: 'Top Toolbar → Chart Tools → Reset Layout',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['[aria-label="Reset Layout"]']),
          },
        ],
        execute: () => {
          if (onResetWindows) {
            onResetWindows();
          } else {
            document.querySelector<HTMLButtonElement>('[aria-label="Reset Layout"]')?.click();
          }
        },
      },
      {
        id: 'toolbar-report-bug',
        title: 'Report a Bug',
        category: 'toolbar',
        categoryLabel: 'Top Toolbar',
        description: 'Open the Bug Report dialog to submit diagnostic feedback',
        keywords: ['report a bug', 'bug report', 'issue', 'feedback', 'support'],
        locations: [
          {
            path: 'Top Toolbar → Report a Bug',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.rtx-report-bug-button', '.rtx-report-bug-btn', '[aria-label="Report a Bug"]']),
          },
        ],
        execute: () => {
          const btn = document.querySelector<HTMLButtonElement>('.rtx-report-bug-button, .rtx-report-bug-btn, [aria-label="Report a Bug"]');
          if (btn) {
            btn.click();
          } else {
            const target = getActiveChartCommandTarget(selectedSymbol, timeframe);
            window.dispatchEvent(
              new CustomEvent('rtx5:open-bug-report', {
                detail: { symbol: target.symbol ?? selectedSymbol, timeframe: target.timeframe ?? timeframe },
              }),
            );
          }
        },
      },
    );

    // All 9 Timeframes
    const timeframes: Array<{ tf: Timeframe; alias: string; name: string; desc: string }> = [
      { tf: 'M1', alias: '1m', name: 'M1 Timeframe (1 Minute)', desc: 'Switch active chart to 1-minute candles' },
      { tf: 'M5', alias: '5m', name: 'M5 Timeframe (5 Minutes)', desc: 'Switch active chart to 5-minute candles' },
      { tf: 'M15', alias: '15m', name: 'M15 Timeframe (15 Minutes)', desc: 'Switch active chart to 15-minute candles' },
      { tf: 'M30', alias: '30m', name: 'M30 Timeframe (30 Minutes)', desc: 'Switch active chart to 30-minute candles' },
      { tf: 'H1', alias: '1h', name: 'H1 Timeframe (1 Hour)', desc: 'Switch active chart to 1-hour candles' },
      { tf: 'H4', alias: '4h', name: 'H4 Timeframe (4 Hours)', desc: 'Switch active chart to 4-hour candles' },
      { tf: 'D1', alias: '1d', name: 'D1 Timeframe (Daily)', desc: 'Switch active chart to Daily candles' },
      { tf: 'W1', alias: '1w', name: 'W1 Timeframe (Weekly)', desc: 'Switch active chart to Weekly candles' },
      { tf: 'MN', alias: '1m', name: 'MN Timeframe (Monthly)', desc: 'Switch active chart to Monthly candles' },
    ];
    for (const { tf, alias, name, desc } of timeframes) {
      const code = name.split(' ')[0];
      items.push({
        id: `tf-${tf}`,
        title: name,
        category: 'toolbar',
        categoryLabel: 'Timeframe Strip',
        description: desc,
        keywords: ['timeframe', 'period', code.toLowerCase(), tf.toLowerCase(), alias, name.toLowerCase()],
        locations: [
          {
            path: `Top Toolbar → Timeframe Strip → ${code}`,
            hasActionSheet: false,
            findElements: () => {
              const opts = Array.from(document.querySelectorAll<HTMLElement>('.rtx-timeframe-option'));
              const match = opts.find((el) => el.textContent?.trim() === code);
              return match ? [match] : queryVisibleElements(['.rtx-timeframe-strip']);
            },
          },
        ],
        execute: () => onTimeframeChange(tf),
      });
    }

    // =========================================================================
    // 5. MENU BAR & NESTED SUBMENUS (Chart settings, Themes, Algo Trading, Terminal)
    // =========================================================================
    items.push(
      {
        id: 'menu-one-click-trading',
        title: 'One Click Trading',
        category: 'menus',
        categoryLabel: 'Menu Bar & Chart HUD',
        description: 'Show or hide the One Click Trading Buy/Sell panel directly on the chart top-left corner',
        shortcut: 'Alt+T',
        keywords: ['one click trading', 'quick trade', 'buy sell buttons', 'chart hud', 'alt+t'],
        locations: [
          {
            path: 'Menu Bar → One Click Trading',
            prepare: () => revealMenuBarPath('one-click-trading', 'Tools', []),
            findElements: () => findMenuElements('One Click Trading', 'one-click-trading'),
            findExtraTargets: () => queryVisibleElements(['.rtx-one-click-panel', '.rtx-chart-hud']),
          },
        ],
        execute: () => revealMenuBarPath('one-click-trading', 'Tools', []),
      },
      {
        id: 'menu-drawing-sidebar-toggle',
        title: 'Hide / Show drawing tools',
        category: 'menus',
        categoryLabel: 'Menu Bar',
        description: 'Toggle visibility of the Left Drawing Tools Rail',
        keywords: ['hide drawing tools', 'show drawing tools', 'drawing sidebar', 'line studies'],
        locations: [
          {
            path: 'Menu Bar → Hide / Show drawing tools',
            prepare: () => revealMenuBarPath('drawing-sidebar', 'View', ['Toolbars']),
            findElements: () => findMenuElements('Hide drawing tools', 'drawing-sidebar', []),
          },
        ],
        execute: () => revealMenuBarPath('drawing-sidebar', 'View', ['Toolbars']),
      },
      {
        id: 'menu-chart-properties',
        title: 'Properties (Chart Properties)',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls',
        description: 'Open Chart Properties dialog to customize candle colors, grid, volumes, OHLC, and trade overlay lines',
        shortcut: 'F8',
        keywords: ['properties', 'chart properties', 'settings', 'colors', 'f8', 'candle colors', 'background'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Properties (F8)',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
            findElements: () => findMenuElements('Properties', 'chart-settings', ['Chart controls']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
      },
      {
        id: 'menu-objects-list',
        title: 'Object List',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls → Objects',
        description: 'Open the Chart Object List dialog to inspect, edit, lock, or delete drawings',
        shortcut: 'Ctrl+B',
        keywords: ['objects', 'object list', 'drawings list', 'manage drawings', 'ctrl+b', 'delete last', 'delete all arrows', 'undo delete', 'selection mode'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Objects → Object List (Ctrl+B)',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls', 'Objects']),
            findElements: () => findMenuElements('Object List', 'chart-settings', ['Chart controls', 'Objects']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls', 'Objects']),
      },
      {
        id: 'menu-show-grid',
        title: 'Grid',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls',
        description: 'Toggle background price/time grid lines on the active chart',
        shortcut: 'Ctrl+G',
        keywords: ['grid', 'show grid', 'grid lines', 'ctrl+g', 'chart controls'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Grid (Ctrl+G)',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
            findElements: () => findMenuElements('Grid', 'chart-settings', ['Chart controls']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
      },
      {
        id: 'menu-show-volumes',
        title: 'Volumes',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls',
        description: 'Toggle tick volume bars at the bottom of the active chart',
        shortcut: 'Ctrl+L',
        keywords: ['volumes', 'show volumes', 'tick volume', 'ctrl+l', 'chart controls'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Volumes (Ctrl+L)',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
            findElements: () => findMenuElements('Volumes', 'chart-settings', ['Chart controls']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
      },
      {
        id: 'menu-show-ohlc',
        title: 'Show OHLC',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls',
        description: 'Toggle Open, High, Low, Close price readout in the chart header legend',
        keywords: ['ohlc', 'show ohlc', 'open high low close', 'legend', 'chart controls'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Show OHLC',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
            findElements: () => findMenuElements('Show OHLC', 'chart-settings', ['Chart controls']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
      },
      {
        id: 'menu-background-logo',
        title: 'Background Logo',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls',
        description: 'Show or hide the background watermark logo on the chart canvas',
        keywords: ['background logo', 'watermark', 'logo', 'chart controls'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Background Logo',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
            findElements: () => findMenuElements('Background Logo', 'chart-settings', ['Chart controls']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
      },
      {
        id: 'menu-color-templates',
        title: 'Color Templates',
        category: 'menus',
        categoryLabel: 'Menu Bar → Color Templates',
        description: 'Apply chart color scheme templates or sync Bid/Ask price colors with chart',
        keywords: [
          'color templates',
          'color template',
          'green and red',
          'green and white',
          'green and blue',
          'blue and white',
          'blue and red',
          'gray and white',
          'yellow and white',
          'color scheme',
          'bid ask color',
        ],
        locations: [
          {
            path: 'Menu Bar → Color Templates',
            prepare: () => revealMenuBarPath('color-templates', 'Charts', []),
            findElements: () => findMenuElements('Green and Red', 'color-templates', []),
          },
        ],
        execute: () => revealMenuBarPath('color-templates', 'Charts', []),
      },
      {
        id: 'menu-theme-appearance',
        title: 'Appearance & Themes...',
        category: 'menus',
        categoryLabel: 'Menu Bar → Appearance & Themes',
        description: 'Open Appearance & Themes dialog to customize Light/Dark presets and terminal colors',
        keywords: ['appearance', 'themes', 'appearance & themes', 'custom theme', 'skin'],
        locations: [
          {
            path: 'Menu Bar → Appearance & Themes...',
            prepare: () => revealMenuBarPath('appearance-themes', 'View', ['Theme']),
            findElements: () => findMenuElements('Appearance & Themes...', 'appearance-themes', []),
          },
        ],
        execute: () => revealMenuBarPath('appearance-themes', 'View', ['Theme']),
      },
      {
        id: 'menu-font-size',
        title: 'Font Size',
        category: 'menus',
        categoryLabel: 'Menu Bar → View & interface',
        description: 'Adjust terminal typography scale between Small, Normal, and Large',
        keywords: ['font size', 'text size', 'small', 'normal', 'large', 'scale', 'view'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Font Size',
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface', 'Font Size']),
            findElements: () => findMenuElements('Normal', 'terminal', ['View & interface', 'Font Size']),
          },
        ],
        execute: () => revealMenuBarPath('terminal', 'View', ['View & interface', 'Font Size']),
      },
      {
        id: 'menu-focus-chart',
        title: 'Focus Chart / Full Screen',
        category: 'menus',
        categoryLabel: 'Menu Bar → View & interface',
        description: 'Maximize chart focus or toggle browser Full Screen mode',
        keywords: ['focus chart', 'full screen', 'fullscreen', 'maximize chart', 'view'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Full Screen',
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
            findElements: () => findMenuElements('Full Screen', 'terminal', ['View & interface']),
          },
        ],
        execute: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
      },
      {
        id: 'menu-toolbars-bars',
        title: 'Toolbars / Status Bar / Charts Bar',
        category: 'menus',
        categoryLabel: 'Menu Bar → View & interface',
        description: 'Show or hide Standard toolbar, Line Studies, Timeframes, Status Bar, and Charts Bar',
        keywords: ['toolbars', 'status bar', 'charts bar', 'timeframes bar', 'line studies', 'view'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Toolbars',
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface', 'Toolbars']),
            findElements: () => findMenuElements('Timeframes', 'terminal', ['View & interface', 'Toolbars']),
          },
        ],
        execute: () => revealMenuBarPath('terminal', 'View', ['View & interface', 'Toolbars']),
      },
      {
        id: 'menu-search-symbols',
        title: 'Search Symbols',
        category: 'menus',
        categoryLabel: 'Menu Bar → View & interface',
        description: 'Open the full Symbols manager dialog to show/hide symbols in Market Watch and inspect contract specifications',
        shortcut: 'Ctrl+U',
        keywords: ['symbols', 'search symbols', 'instruments', 'contract specification', 'specification', 'ctrl+u', 'watchlist'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Search Symbols (Ctrl+U)',
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
            findElements: () => findMenuElements('Search Symbols', 'terminal', ['View & interface']),
          },
        ],
        execute: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
      },
      {
        id: 'menu-depth-of-market',
        title: 'Depth of Market',
        category: 'menus',
        categoryLabel: 'Menu Bar → Chart controls & View',
        description: 'Open the Depth of Market (DOM) price ladder for the active symbol',
        shortcut: 'Alt+B',
        keywords: ['depth of market', 'dom', 'order book', 'level 2', 'ladder', 'alt+b'],
        locations: [
          {
            path: 'Menu Bar → Chart settings → Chart controls → Depth of Market (Alt+B)',
            prepare: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
            findElements: () => findMenuElements('Depth of Market', 'chart-settings', ['Chart controls']),
          },
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Depth of Market',
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
            findElements: () => findMenuElements('Depth of Market', 'terminal', ['View & interface']),
          },
        ],
        execute: () => revealMenuBarPath('chart-settings', 'Charts', ['Chart controls']),
      },
      {
        id: 'menu-options',
        title: 'Options',
        category: 'menus',
        categoryLabel: 'Menu Bar → RTX5 Algo Trading',
        description: 'Configure default order volume, deviation, one-click trading, notifications, and server settings',
        shortcut: 'Ctrl+O',
        keywords: ['options', 'settings', 'preferences', 'default lot', 'volume', 'ctrl+o', 'algo trading'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Algo Trading → Options (Ctrl+O)',
            prepare: () => revealMenuBarPath('algo-trading', 'Tools', []),
            findElements: () => findMenuElements('Options', 'algo-trading'),
          },
        ],
        execute: () => revealMenuBarPath('algo-trading', 'Tools', []),
      },
      {
        id: 'menu-algo-trading-suite',
        title: 'RTX5 Algo Trading',
        category: 'menus',
        categoryLabel: 'Menu Bar → RTX5 Algo Trading',
        description: 'View algorithmic trading tools: Strategy Tester, Script Editor, Agents Manager, Task Manager, Global Variables, Marketplace, and Signals Hub',
        keywords: ['algo trading', 'strategy tester', 'script editor', 'agents manager', 'task manager', 'global variables', 'marketplace', 'signals hub', 'cloud hosting'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Algo Trading',
            prepare: () => revealMenuBarPath('algo-trading', 'Tools', []),
            findElements: () => findMenuElements('Strategy Tester', 'algo-trading'),
          },
        ],
        execute: () => revealMenuBarPath('algo-trading', 'Tools', []),
      },
      {
        id: 'menu-window-layout',
        title: 'Window layout',
        category: 'menus',
        categoryLabel: 'Menu Bar → RTX5 Terminal',
        description: 'Add a new chart, tile horizontally/vertically, cascade, reset windows, or set terminal resolution',
        keywords: ['window layout', 'add chart', 'tile windows', 'cascade', 'tile horizontally', 'tile vertically', 'reset windows', 'resolution'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Terminal → Window layout',
            prepare: () => revealMenuBarPath('terminal', 'Window', ['Window layout']),
            findElements: () => findMenuElements('Tile Windows', 'terminal', ['Window layout']),
          },
        ],
        execute: () => revealMenuBarPath('terminal', 'Window', ['Window layout']),
      },
      {
        id: 'menu-languages',
        title: 'Language',
        category: 'menus',
        categoryLabel: 'Menu Bar → Language',
        description: 'Switch the terminal UI language across supported locales',
        keywords: ['language', 'languages', 'translate', 'locale', 'english'],
        locations: [
          {
            path: 'Menu Bar → Language',
            prepare: () => revealMenuBarPath('language', 'View', ['Languages']),
            findElements: () => findMenuElements('English', 'language', []),
          },
        ],
        execute: () => revealMenuBarPath('language', 'View', ['Languages']),
      },
      {
        id: 'menu-shortcuts',
        title: 'Shortcuts',
        category: 'menus',
        categoryLabel: 'Menu Bar → Shortcuts',
        description: 'View all keyboard shortcuts for chart navigation, drawing tools, trading, and panels',
        shortcut: 'Shift+?',
        keywords: ['shortcuts', 'hotkeys', 'keyboard', 'help', 'keys'],
        locations: [
          {
            path: 'Menu Bar → Shortcuts',
            prepare: () => revealMenuBarPath('shortcuts', 'Help', []),
            findElements: () => findMenuElements('Shortcuts', 'shortcuts', []),
          },
        ],
        execute: () => revealMenuBarPath('shortcuts', 'Help', []),
      },
      {
        id: 'menu-about-contact',
        title: 'About program / Contact us',
        category: 'menus',
        categoryLabel: 'Menu Bar → Help',
        description: 'View terminal version information, documentation, video guides, and support links',
        keywords: ['about', 'about program', 'contact us', 'version', 'help topics', 'whats new', 'documentation'],
        locations: [
          {
            path: 'Menu Bar → About program',
            prepare: () => revealMenuBarPath('about', 'Help', []),
            findElements: () => findMenuElements('About', 'about'),
          },
        ],
        execute: () => revealMenuBarPath('about', 'Help', []),
      },
    );

    // =========================================================================
    // 6. WORKSPACE PANELS, MARKET WATCH TABS & BOTTOM DOCK TABS
    // =========================================================================
    items.push(
      {
        id: 'panel-market-watch',
        title: 'Market Watch',
        category: 'panels',
        categoryLabel: 'Left Dock Panel',
        description: 'Live Bid/Ask quotes, daily change, contract details, quick trading, and tick chart',
        shortcut: 'Ctrl+M',
        keywords: ['market watch', 'quotes', 'bid ask', 'symbols tab', 'details tab', 'trading tab', 'ticks tab', 'ctrl+m'],
        locations: [
          {
            path: 'Left Dock → Market Watch Panel',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.rtx-market-watch', '[data-dock-panel="marketWatch"]']),
          },
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Market Watch (Ctrl+M)',
            hasActionSheet: true,
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
            findElements: () => findMenuElements('Market Watch', 'terminal', ['View & interface']),
          },
        ],
        execute: () => runTerminalShortcutAction('view.toggle-market-watch'),
      },
      {
        id: 'panel-navigator',
        title: 'Navigator',
        category: 'panels',
        categoryLabel: 'Left Dock Panel',
        description: 'Tree view of trading accounts, favorite logins, indicators, automated strategies, and scripts',
        shortcut: 'Ctrl+N',
        keywords: ['navigator', 'accounts tree', 'favorites', 'indicators tree', 'automated strategies', 'scripts', 'ctrl+n'],
        locations: [
          {
            path: 'Left Dock → Navigator Panel',
            hasActionSheet: false,
            findElements: () => queryVisibleElements(['.navigator-panel', '[data-dock-panel="navigator"]']),
          },
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Navigator (Ctrl+N)',
            hasActionSheet: true,
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
            findElements: () => findMenuElements('Navigator', 'terminal', ['View & interface']),
          },
        ],
        execute: () => runTerminalShortcutAction('view.toggle-navigator'),
      },
      {
        id: 'panel-data-window',
        title: 'Data Window',
        category: 'panels',
        categoryLabel: 'Floating Panel',
        description: 'Inspect exact Date, Time, Open, High, Low, Close, Spread, and Volume under the crosshair',
        shortcut: 'Ctrl+D',
        keywords: ['data window', 'crosshair values', 'ohlc readout', 'ctrl+d'],
        locations: [
          {
            path: 'Menu Bar → RTX5 Terminal → View & interface → Data Window (Ctrl+D)',
            hasActionSheet: true,
            prepare: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
            findElements: () => findMenuElements('Data Window', 'terminal', ['View & interface']),
          },
        ],
        execute: () => revealMenuBarPath('terminal', 'View', ['View & interface']),
      },
    );

    const bottomTabs: Array<{ id: string; label: string; desc: string; keywords: string[] }> = [
      { id: 'trade', label: 'Trade Tab', desc: 'View and manage active positions, pending orders, balance, equity, and margin', keywords: ['trade tab', 'positions', 'open orders', 'pending orders', 'balance', 'equity', 'margin'] },
      { id: 'history', label: 'History Tab', desc: 'View historical trades, closed positions, profit/loss summary, and custom date exports', keywords: ['history tab', 'closed trades', 'deals', 'account history', 'statement', 'export'] },
      { id: 'exposure', label: 'Exposure Tab', desc: 'Analyze portfolio net exposure by asset and currency with visual distribution', keywords: ['exposure', 'portfolio', 'currency exposure', 'risk'] },
      { id: 'toolbox', label: 'Toolbox Tab', desc: 'Calculate required margin, pip value, swap rates, and risk-based position size', keywords: ['toolbox', 'calculator', 'margin calculator', 'pip value', 'position size'] },
      { id: 'historical-data', label: 'Historical Data', desc: 'Download historical OHLCV bars and tick data for any symbol and timeframe', keywords: ['historical data', 'history downloader', 'export csv', 'candles download', 'f2'] },
      { id: 'journal', label: 'Journal Tab', desc: 'Inspect real-time terminal activity, order execution telemetry, and connection status logs', keywords: ['journal', 'logs', 'activity log', 'execution log', 'errors'] },
    ];

    for (const bt of bottomTabs) {
      items.push({
        id: `bottom-tab-${bt.id}`,
        title: bt.label,
        category: 'panels',
        categoryLabel: 'Bottom Dock Tab',
        description: bt.desc,
        keywords: [...bt.keywords, 'bottom dock', 'tab'],
        locations: [
          {
            path: `Bottom Dock → ${bt.label}`,
            hasActionSheet: false,
            findElements: () => {
              const tabs = Array.from(document.querySelectorAll<HTMLElement>('.rtx-bottom-dock__tabs .rtx-dock-tab'));
              const match = tabs.find((b) => b.textContent?.toLowerCase().includes(bt.label.split(' ')[0].toLowerCase()));
              return match ? [match] : queryVisibleElements(['.rtx-bottom-dock__tabs']);
            },
          },
        ],
        execute: () => {
          if (bt.id === 'historical-data' && onOpenHistoryDownloader) {
            onOpenHistoryDownloader();
            return;
          }
          const tabs = Array.from(document.querySelectorAll<HTMLElement>('.rtx-bottom-dock__tabs .rtx-dock-tab'));
          const match = tabs.find((b) => b.textContent?.toLowerCase().includes(bt.label.split(' ')[0].toLowerCase()));
          match?.click();
        },
      });
    }

    const bulkActions = [
      { id: 'bulk-close-profit', label: 'Close In-Profit', matchText: 'Close In-Profit', desc: 'One-click bulk close all currently profitable open positions' },
      { id: 'bulk-close-loss', label: 'Close In-Loss', matchText: 'Close In-Loss', desc: 'One-click bulk close all currently losing open positions' },
      { id: 'bulk-close-all', label: 'Close All', matchText: 'Close All', desc: 'One-click bulk close all open positions for the active account' },
    ];
    for (const ba of bulkActions) {
      items.push({
        id: ba.id,
        title: ba.label,
        category: 'panels',
        categoryLabel: 'Bottom Dock Action',
        description: ba.desc,
        keywords: [ba.label.toLowerCase(), ba.matchText.toLowerCase(), 'bulk close', 'close positions', 'bottom dock'],
        locations: [
          {
            path: `Bottom Dock Tab Bar → ${ba.matchText}`,
            hasActionSheet: false,
            findElements: () => {
              const btns = Array.from(document.querySelectorAll<HTMLElement>('.rtx-bottom-dock__tabs button'));
              const found = btns.find((b) => b.textContent?.trim() === ba.matchText);
              return found ? [found] : queryVisibleElements(['.rtx-bottom-dock__tabs']);
            },
          },
        ],
        execute: () => {
          const btns = Array.from(document.querySelectorAll<HTMLElement>('.rtx-bottom-dock__tabs button'));
          const found = btns.find((b) => b.textContent?.trim() === ba.matchText);
          found?.click();
        },
      });
    }

    // =========================================================================
    // 7. DYNAMIC BROKER SYMBOLS FROM RUNTIME STORE (Zero Hardcoded Symbols)
    // =========================================================================
    const safeSymbols: Array<{ symbol?: string; description?: string; category?: string }> = Array.isArray(storeSymbols)
      ? storeSymbols
      : Object.keys(storeTicks || {}).map((sym) => ({ symbol: sym }));
    for (const sym of safeSymbols) {
      const symbolName = String(sym.symbol || '').trim();
      if (!symbolName) continue;
      const desc = String(sym.description || sym.category || 'Trading Instrument').trim();
      const cat = String(sym.category || 'Symbol').trim();
      items.push({
        id: `sym-${symbolName}`,
        title: symbolName,
        category: 'symbols',
        categoryLabel: `Symbol · ${cat}`,
        description: `${desc} — Switch active chart or locate in Market Watch`,
        keywords: [symbolName.toLowerCase(), desc.toLowerCase(), cat.toLowerCase(), 'symbol', 'instrument', 'chart'],
        locations: [
          {
            path: `Market Watch → Symbols → ${symbolName}`,
            hasActionSheet: false,
            findElements: () => {
              const rows = Array.from(document.querySelectorAll<HTMLElement>('.rtx-market-watch [data-symbol], .rtx-market-watch tr'));
              const matched = rows.find((r) => r.getAttribute('data-symbol') === symbolName || r.textContent?.includes(symbolName));
              return matched ? [matched] : queryVisibleElements(['.rtx-market-watch']);
            },
          },
        ],
        execute: () => {
          onSymbolChange(symbolName);
          onOpenChart?.(symbolName);
        },
      });
    }

    return items;
  }, [
    ensureDrawingRailAndOpenMenu,
    onChartTypeChange,
    onNewOrder,
    onOpenChart,
    onOpenHistoryDownloader,
    onResetWindows,
    onSymbolChange,
    onTileWindows,
    onTimeframeChange,
    openIndicatorDialog,
    selectDrawingTool,
    selectedSymbol,
    storeSymbols,
    storeTicks,
    timeframe,
  ]);

  // Rank matching items and flatten their locations so user can step through all matches/places directly.
  // Requires at least one complete word (or close full-word typo like "incator" -> "indicator")
  // so 1–2 letter fragments ("i", "in") or unfinished prefixes ("ind", "ins") never pop open menus prematurely.
  const matchedLocations = useMemo<Array<{ item: UniversalSearchItem; location: SearchLocationTarget }>>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = extractSearchWords(q);
    if (tokens.length === 0) return [];
    const normalizedQuery = normalizeToken(q);

    // Quick guard: if user only typed a single 1-letter token or a single 2-letter non-digit token (e.g. "i", "in"),
    // never match or reveal any menu/action sheet.
    if (tokens.length === 1) {
      const onlyTok = tokens[0];
      if (onlyTok.length < 2) return [];
      if (onlyTok.length < 3 && !/\d/.test(onlyTok)) return [];
      if (SINGLE_TOKEN_STOP_WORDS.has(onlyTok)) return [];
    }

    const scored: Array<{ item: UniversalSearchItem; score: number }> = [];
    for (const item of catalogItems) {
      const titleLower = item.title.toLowerCase();
      const normalizedTitle = normalizeToken(titleLower);
      const locText = item.locations.map((l) => l.path.toLowerCase()).join(' ');

      const titleWords = extractSearchWords(titleLower);
      const keywordWords = item.keywords.flatMap((k) => extractSearchWords(k));
      const normalizedPhrases = [
        normalizedTitle,
        ...item.keywords.map((k) => normalizeToken(k)),
      ].filter(Boolean);

      const candidateWords = Array.from(new Set([...titleWords, ...keywordWords, ...normalizedPhrases]));

      let isMatch = false;
      let matchQuality: 'exact' | 'fuzzy' = 'exact';

      if (tokens.length === 1) {
        const res = matchCompleteWordToken(tokens[0], candidateWords, false);
        if (res) {
          isMatch = true;
          matchQuality = res;
        }
      } else {
        // Multi-word query: check joined compound token first (e.g. "log out" -> "logout", "trend line" -> "trendline")
        const joinedRes = matchCompleteWordToken(normalizedQuery, normalizedPhrases, false);
        if (joinedRes) {
          isMatch = true;
          matchQuality = joinedRes;
        } else {
          // Otherwise every token in the multi-word query must be a complete word in candidateWords,
          // and at least one token must be a non-stopword complete word.
          let hasPrimaryCompleteWord = false;
          let allTokensValid = true;
          for (const tok of tokens) {
            const primaryRes = matchCompleteWordToken(tok, candidateWords, false);
            if (primaryRes) {
              hasPrimaryCompleteWord = true;
              if (primaryRes === 'fuzzy') matchQuality = 'fuzzy';
              continue;
            }
            const secondaryRes = matchCompleteWordToken(tok, candidateWords, true);
            if (!secondaryRes) {
              allTokensValid = false;
              break;
            }
          }
          isMatch = allTokensValid && hasPrimaryCompleteWord;
        }
      }

      if (!isMatch) continue;

      let score = matchQuality === 'exact' ? 100 : 45;
      const qSingular = stripSimplePlural(normalizedQuery);
      if (titleLower === q || normalizedTitle === normalizedQuery) score += 320;
      else if (titleWords.includes(tokens[0])) score += 240;
      else if (titleWords.some((w) => stripSimplePlural(w) === qSingular)) score += 170;
      else if (titleWords.some((w) => matchCompleteWordToken(tokens[0], [w], false) === 'fuzzy')) score += 140;

      if (item.keywords.some((k) => k === q || normalizeToken(k) === normalizedQuery)) score += 180;
      if (keywordWords.includes(tokens[0])) score += 110;
      else if (keywordWords.some((w) => stripSimplePlural(w) === qSingular)) score += 80;
      if (locText.includes(q)) score += 35;

      if (item.id === 'menu-insert-drawing-tools' && normalizedQuery === 'insert') score += 450;
      if (
        item.id === 'indicators-master' &&
        (normalizedQuery === 'indicator' ||
          normalizedQuery === 'indicators' ||
          matchCompleteWordToken(normalizedQuery, ['indicator', 'indicators'], false) === 'fuzzy')
      ) {
        score += 450;
      }
      if (item.id === 'file-logout' && (normalizedQuery === 'logout' || normalizedQuery === 'signout')) score += 450;
      if (item.id === 'draw-trend-trendline' && (normalizedQuery === 'trendline' || normalizedQuery === 'trend')) score += 450;
      if (item.id === 'toolbar-trade-history-dropdown' && (normalizedQuery === 'arrows' || normalizedQuery === 'overlays')) score += 350;

      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));

    const flattened: Array<{ item: UniversalSearchItem; location: SearchLocationTarget }> = [];
    for (const { item } of scored.slice(0, 12)) {
      for (const location of item.locations) {
        flattened.push({ item, location });
      }
    }
    return flattened;
  }, [catalogItems, query]);

  useEffect(() => {
    setActiveFlatIndex(0);
  }, [query]);

  // Apply direct in-place highlight classes on the actual DOM elements ONLY when query is non-empty
  const syncDomHighlights = useCallback((location: SearchLocationTarget) => {
    if (!queryRef.current.trim()) {
      clearDomHighlightClasses();
      return;
    }
    const elements = location.findElements();
    const extraTargets = location.findExtraTargets?.() ?? [];
    applyDomHighlightClasses(elements, extraTargets);
    elements.forEach((el) => {
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  }, []);

  const scheduleDomHighlightSync = useCallback((location: SearchLocationTarget) => {
    clearLocateTimers();
    const updateDom = () => {
      if (!queryRef.current.trim()) {
        clearDomHighlightClasses();
        return;
      }
      syncDomHighlights(location);
    };

    updateDom();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      rafRef.current = window.requestAnimationFrame(updateDom);
    }
    locateTimersRef.current.push(
      window.setTimeout(updateDom, 35),
      window.setTimeout(updateDom, 95),
      window.setTimeout(updateDom, 200),
    );
  }, [clearLocateTimers, syncDomHighlights]);

  const revealInPlace = useCallback((
    _item: UniversalSearchItem,
    location: SearchLocationTarget,
  ) => {
    clearLocateTimers();
    if (!queryRef.current.trim()) {
      clearDomHighlightClasses();
      return;
    }

    if (hasRevealedSomethingRef.current) {
      resetSearchRevealedMenus();
    } else {
      resetSearchSheetState();
    }
    hasRevealedSomethingRef.current = true;
    setIsHighlighting(true);
    location.prepare?.();
    scheduleDomHighlightSync(location);
  }, [clearLocateTimers, scheduleDomHighlightSync]);

  // LIVE IN-PLACE REVEAL: As soon as user types in the search bar, open the actual menu/flyout/screen
  // where the item lives and highlight it directly there — with zero dropdown under the search bar!
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      clearAllSearchEffects(true);
      return;
    }
    const current = matchedLocations[activeFlatIndex] ?? matchedLocations[0];
    if (!current) {
      clearAllSearchEffects(true);
      return;
    }
    revealInPlace(current.item, current.location);
  }, [query, activeFlatIndex, matchedLocations, revealInPlace, clearAllSearchEffects]);

  // Global Escape shortcut to clear active search highlights
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (isHighlighting || query)) {
        queryRef.current = '';
        setQuery('');
        clearAllSearchEffects(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [clearAllSearchEffects, isHighlighting, query]);

  // Dismiss in-place highlight classes after outside click completes (so clicking the highlighted menu item works seamlessly)
  useEffect(() => {
    if (!isHighlighting) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-rtx-universal-search]')) return;
      window.setTimeout(() => {
        clearLocateTimers();
        clearDomHighlightClasses();
        setIsHighlighting(false);
      }, 150);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [clearLocateTimers, isHighlighting]);

  const activeMatch = matchedLocations[activeFlatIndex] ?? matchedLocations[0];

  return (
    <div
      ref={containerRef}
      className="rtx-toolbar-search"
      data-rtx-universal-search="true"
      data-testid="top-toolbar-universal-search"
    >
      <div
        className={`rtx-toolbar-search__field ${query.trim() ? 'has-query' : ''} ${query.trim().length >= 4 && matchedLocations.length === 0 ? 'is-no-match' : ''}`}
        title={activeMatch ? `${activeMatch.item.title} — ${activeMatch.location.path}` : tr('Search & highlight any option in its actual place')}
        onClick={() => {
          inputRef.current?.focus();
        }}
      >
        <span className="rtx-toolbar-search__icon" aria-hidden="true">
          <Search size={14} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          role="searchbox"
          aria-label={tr('Search anywhere in application')}
          placeholder={tr('Search tools, menus...')}
          className="rtx-toolbar-search__input"
          onChange={(event) => {
            const nextVal = event.target.value;
            queryRef.current = nextVal;
            setQuery(nextVal);
            if (!nextVal.trim()) {
              clearAllSearchEffects(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && matchedLocations.length > 1) {
              event.preventDefault();
              setActiveFlatIndex((prev) =>
                event.shiftKey
                  ? (prev - 1 + matchedLocations.length) % matchedLocations.length
                  : (prev + 1) % matchedLocations.length,
              );
              return;
            }

            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const sheetItems = getDeepestOpenActionSheetItems();
              if (sheetItems.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                clearLocateTimers();
                const currentIdx = sheetItems.findIndex(
                  (item) =>
                    item.classList.contains('rtx-search-located-target') ||
                    item === searchSheetState.manualTargetElement,
                );
                const nextIdx =
                  event.key === 'ArrowDown'
                    ? currentIdx >= 0
                      ? (currentIdx + 1) % sheetItems.length
                      : 0
                    : currentIdx >= 0
                      ? (currentIdx - 1 + sheetItems.length) % sheetItems.length
                      : sheetItems.length - 1;
                const nextEl = sheetItems[nextIdx];
                if (nextEl) {
                  searchSheetState.manualTargetElement = nextEl;
                  sheetItems.forEach((item) => {
                    item.classList.remove('rtx-search-located-target');
                  });
                  nextEl.classList.remove('rtx-search-located-step');
                  nextEl.classList.add('rtx-search-located-target');
                  nextEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
                }
                return;
              }

              if (matchedLocations.length > 0) {
                event.preventDefault();
                setActiveFlatIndex((prev) =>
                  event.key === 'ArrowDown'
                    ? (prev + 1) % matchedLocations.length
                    : (prev - 1 + matchedLocations.length) % matchedLocations.length,
                );
              }
              return;
            }

            if (event.key === 'ArrowRight') {
              const sheetItems = getDeepestOpenActionSheetItems();
              const currentTarget =
                sheetItems.find((el) => el.classList.contains('rtx-search-located-target')) ??
                searchSheetState.manualTargetElement ??
                document.querySelector<HTMLElement>('.rtx-search-located-target');

              if (currentTarget && doesElementHaveChildActionSheet(currentTarget) && activeMatch) {
                event.preventDefault();
                event.stopPropagation();
                searchSheetState.manualTargetElement = null;

                if (currentTarget.getAttribute('data-root-menu-item') === 'true') {
                  const rootKey =
                    currentTarget.getAttribute('data-menu-key') ||
                    searchSheetState.lastTargetMenuSpec?.webRootId;
                  searchSheetState.openDepth = 1;
                  searchSheetState.activeWebRootId = rootKey;
                  searchSheetState.activeSubmenuPath = [];
                  searchSheetState.activeFileSubmenu = null;
                  window.dispatchEvent(
                    new CustomEvent('rtx:reveal-file-submenu', { detail: { submenu: null } }),
                  );
                  revealMenuBarPath(
                    rootKey,
                    searchSheetState.lastTargetMenuSpec?.desktopMenuKey,
                    [],
                    1,
                  );
                } else if (currentTarget.getAttribute('data-file-menu-item') === 'profiles') {
                  searchSheetState.openDepth = 2;
                  searchSheetState.activeFileSubmenu = 'profiles';
                  window.dispatchEvent(
                    new CustomEvent('rtx:reveal-file-submenu', { detail: { submenu: 'profiles' } }),
                  );
                } else {
                  const itemLabel =
                    currentTarget.getAttribute('data-menu-item-label') ||
                    currentTarget.textContent?.trim() ||
                    '';
                  const prevSubmenuPath = searchSheetState.activeSubmenuPath.slice(
                    0,
                    Math.max(0, searchSheetState.openDepth - 1),
                  );
                  const nextSubmenuPath = [...prevSubmenuPath, itemLabel];
                  searchSheetState.openDepth = nextSubmenuPath.length + 1;
                  searchSheetState.activeSubmenuPath = nextSubmenuPath;
                  revealMenuBarPath(
                    searchSheetState.activeWebRootId || searchSheetState.lastTargetMenuSpec?.webRootId,
                    searchSheetState.lastTargetMenuSpec?.desktopMenuKey,
                    nextSubmenuPath,
                    searchSheetState.openDepth,
                  );
                }

                scheduleDomHighlightSync(activeMatch.location);
              }
              return;
            }

            if (event.key === 'ArrowLeft') {
              if (searchSheetState.openDepth > 0 && activeMatch) {
                event.preventDefault();
                event.stopPropagation();
                searchSheetState.manualTargetElement = null;

                if (searchSheetState.activeFileSubmenu === 'profiles') {
                  searchSheetState.activeFileSubmenu = null;
                  searchSheetState.openDepth = 1;
                  window.dispatchEvent(
                    new CustomEvent('rtx:reveal-file-submenu', { detail: { submenu: null } }),
                  );
                } else {
                  const nextDepth = searchSheetState.openDepth - 1;
                  searchSheetState.openDepth = nextDepth;
                  searchSheetState.activeSubmenuPath = searchSheetState.activeSubmenuPath.slice(
                    0,
                    Math.max(0, nextDepth - 1),
                  );
                  revealMenuBarPath(
                    searchSheetState.activeWebRootId || searchSheetState.lastTargetMenuSpec?.webRootId,
                    searchSheetState.lastTargetMenuSpec?.desktopMenuKey,
                    searchSheetState.activeSubmenuPath,
                    nextDepth,
                  );
                }

                scheduleDomHighlightSync(activeMatch.location);
              }
              return;
            }

            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              const sheetItems = getDeepestOpenActionSheetItems();
              if (sheetItems.length > 0) {
                const currentTarget =
                  sheetItems.find((el) => el.classList.contains('rtx-search-located-target')) ??
                  searchSheetState.manualTargetElement;
                if (currentTarget && !doesElementHaveChildActionSheet(currentTarget)) {
                  currentTarget.click();
                  clearAllSearchEffects(true);
                }
                return;
              }

              if (activeMatch) {
                const hasActionSheet =
                  activeMatch.location.hasActionSheet ?? Boolean(activeMatch.location.prepare);
                if (!hasActionSheet) {
                  activeMatch.item.execute();
                } else {
                  const directTarget = document.querySelector<HTMLElement>('.rtx-search-located-target');
                  if (
                    directTarget &&
                    !doesElementHaveChildActionSheet(directTarget) &&
                    directTarget.tagName === 'BUTTON'
                  ) {
                    directTarget.click();
                    clearAllSearchEffects(true);
                  }
                }
              }
            } else if (event.key === 'Escape') {
              event.preventDefault();
              queryRef.current = '';
              setQuery('');
              clearAllSearchEffects(true);
              inputRef.current?.blur();
            }
          }}
        />
        {query.trim() && (
          <span className="rtx-toolbar-search__suffix">
            {(matchedLocations.length > 0 || query.trim().length >= 4) && (
              <>
                <span
                  className={`rtx-toolbar-search__stepper ${matchedLocations.length > 1 ? 'is-multi' : ''} ${matchedLocations.length === 0 ? 'is-empty' : ''}`}
                >
                  {matchedLocations.length > 1 && (
                    <button
                      type="button"
                      className="rtx-toolbar-search__step-btn"
                      aria-label={tr('Previous location')}
                      title={tr('Previous match / location')}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveFlatIndex((prev) => (prev - 1 + matchedLocations.length) % matchedLocations.length);
                        inputRef.current?.focus();
                      }}
                    >
                      <ChevronLeft size={11} strokeWidth={2.3} />
                    </button>
                  )}
                  <span
                    className={`rtx-toolbar-search__count ${matchedLocations.length === 0 ? 'is-empty' : ''}`}
                    title={activeMatch ? activeMatch.location.path : tr('No matching option')}
                    data-testid="top-toolbar-search-count"
                  >
                    {matchedLocations.length > 0 ? `${activeFlatIndex + 1}/${matchedLocations.length}` : '0'}
                  </span>
                  {matchedLocations.length > 1 && (
                    <button
                      type="button"
                      className="rtx-toolbar-search__step-btn"
                      aria-label={tr('Next location')}
                      title={tr('Next match / location')}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveFlatIndex((prev) => (prev + 1) % matchedLocations.length);
                        inputRef.current?.focus();
                      }}
                    >
                      <ChevronRight size={11} strokeWidth={2.3} />
                    </button>
                  )}
                </span>
                <span className="rtx-toolbar-search__divider" aria-hidden="true" />
              </>
            )}
            <button
              type="button"
              className="rtx-toolbar-search__clear"
              aria-label={tr('Clear application search')}
              title={tr('Clear search (Esc)')}
              onClick={(event) => {
                event.stopPropagation();
                queryRef.current = '';
                setQuery('');
                clearAllSearchEffects(true);
                inputRef.current?.focus();
              }}
            >
              <X size={11.5} strokeWidth={2.3} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
};

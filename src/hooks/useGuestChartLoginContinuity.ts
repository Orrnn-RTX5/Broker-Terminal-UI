import { useLayoutEffect, useRef } from 'react';
import { getChartPanels } from '../services/chartPanelNavigation';
import type { DockLayout } from '../services/dockManager';
import { canRetainPublicChartOnLogin } from '../utils/chartLoginTransition';
import { resolveRenderedChartSymbol } from '../utils/chartSelectionReadiness';
import { normalizeSymbolName } from '../utils/symbolEligibility';

export interface RetainedGuestChart {
  symbol: string;
  timeframe: string;
}

interface GuestChartSnapshot {
  sessionScope: string;
  marketSource: string;
  panels: Record<string, RetainedGuestChart & { selection: string }>;
}

interface ContinuityState {
  guest: GuestChartSnapshot | null;
  authenticatedScope: string | null;
  finished: boolean;
}

interface Options {
  enabled: boolean;
  sessionScope: string;
  marketSource: string;
  guestReady: boolean;
  accountCatalogPending: boolean;
  layout: DockLayout;
  chartSymbols: string[];
  selectedSymbol: string;
  timeframe: string;
}

const EMPTY_STATE: ContinuityState = { guest: null, authenticatedScope: null, finished: false };
const EMPTY_CHARTS: Record<string, RetainedGuestChart> = {};

/**
 * Only a canvas already displayed to a guest may bridge the first login.
 * This records presentation, never an account catalogue or trading permission.
 */
export function useGuestChartLoginContinuity(options: Options) {
  const stateRef = useRef<ContinuityState>(EMPTY_STATE);
  let nextState = stateRef.current;
  let retainedCharts = EMPTY_CHARTS;
  let preserveGuestLayout = false;

  const anonymous = options.sessionScope.startsWith('anonymous|');
  const authenticated = options.sessionScope.startsWith('authenticated|');
  if (!options.enabled || !options.marketSource) {
    nextState = EMPTY_STATE;
  } else if (anonymous && options.accountCatalogPending && nextState.guest
    && !nextState.authenticatedScope) {
    // The store publishes authentication just before the canonical owner
    // notification. Its catalogue can already be pending in that commit frame.
    // Keep the existing public presentation read-only until ownership catches up.
    const guest = nextState.guest;
    const matchingCharts: Record<string, RetainedGuestChart> = {};
    if (guest.marketSource === options.marketSource) {
      getChartPanels(options.layout).forEach(panel => {
        const previous = guest.panels[panel.id];
        const selection = normalizeSymbolName(panel.props?.symbol ?? panel.title?.split(',')[0]);
        const timeframe = panel.props?.timeframe || options.timeframe;
        if (previous?.selection === selection && previous.timeframe === timeframe) {
          matchingCharts[panel.id] = { symbol: previous.symbol, timeframe };
        }
      });
    }
    preserveGuestLayout = Object.keys(matchingCharts).length > 0;
    if (preserveGuestLayout) retainedCharts = matchingCharts;
    else nextState = EMPTY_STATE;
  } else if (anonymous) {
    const panels: GuestChartSnapshot['panels'] = {};
    if (options.guestReady) {
      getChartPanels(options.layout).forEach(panel => {
        const selection = normalizeSymbolName(panel.props?.symbol ?? panel.title?.split(',')[0]);
        const symbol = resolveRenderedChartSymbol(selection, options.selectedSymbol, options.chartSymbols);
        if (symbol) panels[panel.id] = {
          selection, symbol, timeframe: panel.props?.timeframe || options.timeframe,
        };
      });
    }
    nextState = {
      guest: Object.keys(panels).length ? {
        sessionScope: options.sessionScope, marketSource: options.marketSource, panels,
      } : null,
      authenticatedScope: null,
      finished: false,
    };
  } else if (authenticated && nextState.guest
    && (!nextState.authenticatedScope || nextState.authenticatedScope === options.sessionScope)) {
    const guest = nextState.guest;
    const matchingCharts: Record<string, RetainedGuestChart> = {};
    getChartPanels(options.layout).forEach(panel => {
      const previous = guest.panels[panel.id];
      const selection = normalizeSymbolName(panel.props?.symbol ?? panel.title?.split(',')[0]);
      const timeframe = panel.props?.timeframe || options.timeframe;
      if (!previous || previous.selection !== selection) return;
      if (!canRetainPublicChartOnLogin({
        sessionScope: guest.sessionScope, marketSource: guest.marketSource,
        symbol: previous.symbol, timeframe: previous.timeframe,
      }, {
        sessionScope: options.sessionScope, marketSource: options.marketSource,
        symbol: previous.symbol, timeframe,
      })) return;
      matchingCharts[panel.id] = { symbol: previous.symbol, timeframe };
    });
    preserveGuestLayout = Object.keys(matchingCharts).length > 0;
    if (preserveGuestLayout) {
      // Once this account's catalogue settles, a later refresh cannot restore
      // its old public preview. Other account scopes never inherit this bridge.
      if (options.accountCatalogPending && !nextState.finished) retainedCharts = matchingCharts;
      nextState = {
        guest, authenticatedScope: options.sessionScope,
        finished: nextState.finished || !options.accountCatalogPending,
      };
    } else nextState = EMPTY_STATE;
  } else nextState = EMPTY_STATE;

  // Capture only committed guest canvases; discarded React renders never gain
  // authority to retain a canvas during a future login.
  useLayoutEffect(() => { stateRef.current = nextState; });

  return { retainedCharts, preserveGuestLayout };
}

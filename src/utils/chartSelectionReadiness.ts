import type { DockContainer, DockLayout, DockPanelConfig } from '../services/dockManager';
import {
  getUniqueSymbolNames,
  normalizeSymbolName,
  resolveAuthorizedChartSymbol,
} from './symbolEligibility';

const isContainer = (value: DockContainer | DockPanelConfig): value is DockContainer => (
  Array.isArray((value as DockContainer).children)
);

const MAX_DIAGNOSTIC_PANEL_ID_LENGTH = 64;
const INTERNAL_PANEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const getChartPanelDiagnosticId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  if (value.length === 0 || value.length > MAX_DIAGNOSTIC_PANEL_ID_LENGTH) return '';
  return INTERNAL_PANEL_ID_PATTERN.test(value) ? value : '';
};

const getPanelSymbol = (panel: DockPanelConfig): string => normalizeSymbolName(
  panel.props?.symbol ?? panel.title?.split(',')[0],
);

export const getAuthorizedChartDiagnosticSymbol = (
  value: unknown,
  authorizedSymbols: unknown[],
): string => resolveAuthorizedChartSymbol(value, getUniqueSymbolNames(authorizedSymbols));

export const resolveRenderedChartSymbol = (
  panelSymbol: unknown,
  selectedSymbol: unknown,
  authorizedSymbols: unknown[],
): string => {
  const authorized = getUniqueSymbolNames(authorizedSymbols);
  return getAuthorizedChartDiagnosticSymbol(panelSymbol, authorized)
    || getAuthorizedChartDiagnosticSymbol(selectedSymbol, authorized)
    || authorized[0]
    || '';
};

const collectVisibleChartPanels = (
  container: DockContainer,
  panels: DockPanelConfig[],
): void => {
  const children = Array.isArray(container.children) ? container.children : [];
  const visibleChildren = container.type === 'tabs'
    ? children.filter((child, index) => child.id === (container.activeTab || children[0]?.id) || (index === 0 && !container.activeTab))
    : children;

  visibleChildren.forEach((child) => {
    if (isContainer(child)) {
      collectVisibleChartPanels(child, panels);
    } else if (child.component === 'Chart') {
      panels.push(child);
    }
  });
};

const appendLayoutSelectionParts = (container: DockContainer, parts: string[]): void => {
  parts.push(`container:${container.id}:${container.type}:${container.activeTab ?? ''}`);
  (container.children ?? []).forEach((child) => {
    if (isContainer(child)) {
      appendLayoutSelectionParts(child, parts);
    } else if (child.component === 'Chart') {
      parts.push(`chart:${child.id}:${getPanelSymbol(child)}`);
    }
  });
};

export const getChartLayoutSelectionKey = (layout: DockLayout): string => {
  const parts: string[] = [];
  appendLayoutSelectionParts(layout.root, parts);
  (layout.floatingPanels ?? []).forEach((container) => appendLayoutSelectionParts(container, parts));
  return parts.join('|');
};

export const buildChartSelectionReconciliationKey = ({
  sessionKey,
  selectedSymbol,
  authorizedSymbols,
  layout,
}: {
  sessionKey: string;
  selectedSymbol: unknown;
  authorizedSymbols: unknown[];
  layout: DockLayout;
}): string => [
  sessionKey,
  normalizeSymbolName(selectedSymbol),
  getUniqueSymbolNames(authorizedSymbols).join(','),
  getChartLayoutSelectionKey(layout),
].join('::');

export interface ChartSelectionReadinessInput {
  authenticated: boolean;
  layoutRestored: boolean;
  catalogSettled: boolean;
  feedPreferenceSettled: boolean;
  selectedSymbol: unknown;
  authorizedSymbols: unknown[];
  layout: DockLayout;
  reconciliationKey: string;
  committedReconciliationKey: string;
}

export interface ChartSelectionReadinessSnapshot {
  ready: boolean;
  selectedSymbol: string;
  activePanelSymbol: string;
  renderedChartSymbol: string;
}

export interface ChartRuntimeMountInput {
  authenticated: boolean;
  accountId: string;
  restoredLayoutAccountId: string;
  catalogSettled: boolean;
  feedPreferenceSettled: boolean;
}

/**
 * Feed preference is deliberately diagnostic-only here. The authorized
 * catalog and restored layout are enough to paint a chart; feed status can
 * reconcile the preferred symbol later without holding the UI for its
 * network timeout.
 */
export const shouldMountChartRuntime = (input: ChartRuntimeMountInput): boolean => Boolean(
  input.authenticated
  && input.accountId
  && input.restoredLayoutAccountId === input.accountId
  && input.catalogSettled
);

export const getChartSelectionDiagnosticAttributes = (
  snapshot: ChartSelectionReadinessSnapshot,
): Record<string, string> => ({
  'data-chart-selection-ready': snapshot.ready ? 'true' : 'false',
  'data-chart-selected-symbol': snapshot.selectedSymbol,
  'data-chart-active-panel-symbol': snapshot.activePanelSymbol,
  'data-chart-rendered-symbol': snapshot.renderedChartSymbol,
});

export const getChartSelectionReadinessSnapshot = ({
  authenticated,
  layoutRestored,
  catalogSettled,
  feedPreferenceSettled,
  selectedSymbol,
  authorizedSymbols,
  layout,
  reconciliationKey,
  committedReconciliationKey,
}: ChartSelectionReadinessInput): ChartSelectionReadinessSnapshot => {
  const authorizedSelected = getAuthorizedChartDiagnosticSymbol(selectedSymbol, authorizedSymbols);
  const visiblePanels: DockPanelConfig[] = [];
  collectVisibleChartPanels(layout.root, visiblePanels);
  (layout.floatingPanels ?? []).forEach((container) => collectVisibleChartPanels(container, visiblePanels));
  // Tabs provide one explicit active child. Split and floating layouts do not
  // expose a global focus owner, so multiple visible charts are ambiguous.
  const activePanel = visiblePanels.length === 1 ? visiblePanels[0] : undefined;
  const activePanelSymbol = activePanel
    ? getAuthorizedChartDiagnosticSymbol(getPanelSymbol(activePanel), authorizedSymbols)
    : '';
  const renderedChartSymbol = activePanel
    ? resolveRenderedChartSymbol(getPanelSymbol(activePanel), authorizedSelected, authorizedSymbols)
    : '';
  const symbolsAgree = Boolean(
    authorizedSelected
    && authorizedSelected === activePanelSymbol
    && activePanelSymbol === renderedChartSymbol
  );

  return {
    ready: Boolean(
      authenticated
      && layoutRestored
      && catalogSettled
      && feedPreferenceSettled
      && symbolsAgree
      && reconciliationKey
      && reconciliationKey === committedReconciliationKey
    ),
    selectedSymbol: authorizedSelected,
    activePanelSymbol,
    renderedChartSymbol,
  };
};

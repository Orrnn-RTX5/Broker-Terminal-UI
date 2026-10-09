import { useEffect } from 'react';
import { createPreloadableFeature } from './createPreloadableFeature';
import { scheduleFeatureWarmup } from './scheduleFeatureWarmup';

export const lastSymbolFeature = createPreloadableFeature(() => import('../components/LastSymbolPanel').then(module => ({ default: module.LastSymbolPanel })));
export const accountPanelFeature = createPreloadableFeature(() => import('../components/AccountPanel').then(module => ({ default: module.AccountPanel })));
export const chartPropertiesFeature = createPreloadableFeature(() => import('../components/dialogs/ChartPropertiesDialog').then(module => ({ default: module.ChartPropertiesDialog })));
export const chartObjectsFeature = createPreloadableFeature(() => import('../components/dialogs/ChartObjectsDialog').then(module => ({ default: module.ChartObjectsDialog })));
export const saveWorkspaceFeature = createPreloadableFeature(() => import('../components/dialogs/SaveWorkspaceDialog').then(module => ({ default: module.SaveWorkspaceDialog })));
export const symbolsFeature = createPreloadableFeature(() => import('../components/SymbolsDialog').then(module => ({ default: module.SymbolsDialog })));
export const optionsFeature = createPreloadableFeature(() => import('../components/settings/OptionsDialog').then(module => ({ default: module.OptionsDialog })));
export const loginFeature = createPreloadableFeature(() => import('../components/LoginDialog').then(module => ({ default: module.LoginDialog })));
export const depthOfMarketFeature = createPreloadableFeature(() => import('../components/DepthOfMarket').then(module => ({ default: module.DepthOfMarket })));
export const dataWindowFeature = createPreloadableFeature(() => import('../components/DataWindow'));
export const printSetupFeature = createPreloadableFeature(() => import('../components/dialogs/PrintSetupDialog').then(module => ({ default: module.PrintSetupDialog })));
export const printPreviewFeature = createPreloadableFeature(() => import('../components/dialogs/PrintPreviewDialog').then(module => ({ default: module.PrintPreviewDialog })));
export const exitConfirmFeature = createPreloadableFeature(() => import('../components/dialogs/ExitConfirmDialog').then(module => ({ default: module.ExitConfirmDialog })));
export const savePictureFeature = createPreloadableFeature(() => import('../components/dialogs/SavePictureDialog').then(module => ({ default: module.SavePictureDialog })));
export const openAccountFeature = createPreloadableFeature(() => import('../components/dialogs/OpenAccountDialog').then(module => ({ default: module.OpenAccountDialog })));

// This registry creates loaders only; importing it never downloads tool chunks.
export const terminalFeatureLoaders = [
  lastSymbolFeature.preload, symbolsFeature.preload, chartPropertiesFeature.preload,
  optionsFeature.preload, depthOfMarketFeature.preload, dataWindowFeature.preload,
  saveWorkspaceFeature.preload, chartObjectsFeature.preload,
  accountPanelFeature.preload, loginFeature.preload, printSetupFeature.preload,
  printPreviewFeature.preload, savePictureFeature.preload, openAccountFeature.preload,
  exitConfirmFeature.preload,
];

export const LazyLastSymbolPanel = lastSymbolFeature.Component;
export const LazyAccountPanel = accountPanelFeature.Component;
export const LazyChartPropertiesDialog = chartPropertiesFeature.Component;
export const LazyChartObjectsDialog = chartObjectsFeature.Component;
export const LazySaveWorkspaceDialog = saveWorkspaceFeature.Component;
export const LazySymbolsDialog = symbolsFeature.Component;

export function useTerminalFeatureWarmup(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    return scheduleFeatureWarmup(terminalFeatureLoaders);
  }, [enabled]);
}

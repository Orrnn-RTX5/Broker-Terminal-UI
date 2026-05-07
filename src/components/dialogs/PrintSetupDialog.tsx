/**
 * Print Setup Dialog
 * Allows users to configure print preferences before printing
 */

import { Icon } from '../ui/Icon';
import React, { useState, useEffect } from 'react';
import {
  chartPrinter,
  type PrintPreferences,
  type PageSize,
  type PageOrientation,
  type ColorMode,
  DEFAULT_PRINT_PREFERENCES,
} from '../../services/chartPrinter';

export interface PrintSetupDialogProps {
  onConfirm: (preferences: PrintPreferences) => void;
  onCancel: () => void;
  accountId?: string;
}

export type PrintSettings = PrintPreferences;

export const PrintSetupDialog: React.FC<PrintSetupDialogProps> = ({
  onConfirm,
  onCancel,
  accountId,
}) => {
  const [preferences, setPreferences] = useState<PrintPreferences>(DEFAULT_PRINT_PREFERENCES);
  const [isSaving, setIsSaving] = useState(false);
  const [savePreferences, setSavePreferences] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    if (accountId) {
      chartPrinter.loadPreferences(accountId).then(setPreferences);
    }
  }, [accountId]);

  const handleChange = <K extends keyof PrintPreferences>(
    key: K,
    value: PrintPreferences[K]
  ) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  const handlePrint = async () => {
    if (savePreferences && accountId) {
      setIsSaving(true);
      try {
        await chartPrinter.savePreferences(accountId, preferences);
      } catch (error) {
        console.error('Failed to save preferences:', error);
      } finally {
        setIsSaving(false);
      }
    }
    onConfirm(preferences);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={onCancel}>
            <div
                className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[480px] animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
                    <div className="flex items-center gap-2">
                        <Icon name="settings" size="md" className="text-blue-400" />
                        <h2 className="text-sm font-semibold text-zinc-100">Print Setup</h2>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-zinc-400 hover:text-zinc-100 transition-colors p-1 hover:bg-zinc-700/50 rounded"
                        aria-label="Close"
                    >
                        <Icon name="x-close" size="md" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
                    {/* Page Setup */}
                    <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-200 border-b border-zinc-700 pb-1">
                            Page Setup
                        </h3>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Orientation</label>
                                <select
                                    value={preferences.orientation}
                                    onChange={(e) => handleChange('orientation', e.target.value as PageOrientation)}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="portrait">Portrait</option>
                                    <option value="landscape">Landscape</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Paper Size</label>
                                <select
                                    value={preferences.pageSize}
                                    onChange={(e) => handleChange('pageSize', e.target.value as PageSize)}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="A4">A4 (210 × 297 mm)</option>
                                    <option value="Letter">Letter (8.5 × 11 in)</option>
                                    <option value="Legal">Legal (8.5 × 14 in)</option>
                                    <option value="A3">A3 (297 × 420 mm)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Margins */}
                    <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-200 border-b border-zinc-700 pb-1">
                            Margins (mm)
                        </h3>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Top</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={preferences.marginTop}
                                    onChange={(e) => handleChange('marginTop', Number(e.target.value))}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Right</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={preferences.marginRight}
                                    onChange={(e) => handleChange('marginRight', Number(e.target.value))}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Bottom</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={preferences.marginBottom}
                                    onChange={(e) => handleChange('marginBottom', Number(e.target.value))}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Left</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={preferences.marginLeft}
                                    onChange={(e) => handleChange('marginLeft', Number(e.target.value))}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Print Options */}
                    <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-200 border-b border-zinc-700 pb-1">
                            Print Options
                        </h3>

                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={preferences.includeHeader}
                                    onChange={(e) => handleChange('includeHeader', e.target.checked)}
                                    className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-zinc-300">Include Header</span>
                            </label>

                            {preferences.includeHeader && (
                              <input
                                type="text"
                                placeholder="Header text (optional)"
                                value={preferences.headerText || ''}
                                onChange={(e) => handleChange('headerText', e.target.value)}
                                className="w-full ml-5 bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            )}

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={preferences.includeFooter}
                                    onChange={(e) => handleChange('includeFooter', e.target.checked)}
                                    className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-zinc-300">Include Footer</span>
                            </label>

                            {preferences.includeFooter && (
                              <input
                                type="text"
                                placeholder="Footer text (optional)"
                                value={preferences.footerText || ''}
                                onChange={(e) => handleChange('footerText', e.target.value)}
                                className="w-full ml-5 bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            )}

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={preferences.includeGrid}
                                    onChange={(e) => handleChange('includeGrid', e.target.checked)}
                                    className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-zinc-300">Include Grid Lines</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={preferences.includeIndicators}
                                    onChange={(e) => handleChange('includeIndicators', e.target.checked)}
                                    className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-zinc-300">Include Indicators Legend</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={preferences.includeDrawings}
                                    onChange={(e) => handleChange('includeDrawings', e.target.checked)}
                                    className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-zinc-300">Include Drawings Legend</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={preferences.scaleToFit}
                                    onChange={(e) => handleChange('scaleToFit', e.target.checked)}
                                    className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-xs text-zinc-300">Scale to Fit Page</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-1 gap-3 pt-2">
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1.5">Color Mode</label>
                                <select
                                    value={preferences.colorMode}
                                    onChange={(e) => handleChange('colorMode', e.target.value as ColorMode)}
                                    className="w-full bg-[#252528] border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="color">Color</option>
                                    <option value="grayscale">Black & White</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Save Preferences */}
                    {accountId && (
                      <div className="pt-4 border-t border-zinc-700">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={savePreferences}
                            onChange={(e) => setSavePreferences(e.target.checked)}
                            className="w-3.5 h-3.5 bg-[#252528] border border-zinc-700 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-xs text-zinc-300">Save these preferences as default</span>
                        </label>
                      </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-700 bg-[#252528]">
                    <button
                        onClick={onCancel}
                        className="px-4 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700/50 rounded transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handlePrint}
                        disabled={isSaving}
                        className="px-4 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Icon name="print" size="xs" />
                        {isSaving ? 'Saving...' : 'OK'}
                    </button>
                </div>
            </div>
        </div>
    );
};

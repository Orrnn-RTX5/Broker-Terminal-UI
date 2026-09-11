import { useUiTranslation } from '../../hooks/useUiTranslation';
/**
 * Print Setup Dialog
 * Allows users to configure print preferences before printing
 */

import { Icon } from '../ui/Icon';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
    const tr = useUiTranslation();
  const accountScope = accountId?.trim() || undefined;
  const [preferences, setPreferences] = useState<PrintPreferences>(() => (
    accountScope ? chartPrinter.getPreferences(accountScope) : DEFAULT_PRINT_PREFERENCES
  ));
  const [isSaving, setIsSaving] = useState(false);
  const [savePreferences, setSavePreferences] = useState(false);
  const hasEditedPreferences = useRef(false);

  // Load preferences on mount
  useEffect(() => {
    let isCurrentScope = true;
    hasEditedPreferences.current = false;
    setSavePreferences(false);

    if (!accountScope) {
      setPreferences(chartPrinter.getPreferences());
      return () => {
        isCurrentScope = false;
      };
    }

    // Apply the account-scoped local value immediately. A remote value may
    // refresh it in the background, but never overwrite edits made meanwhile.
    setPreferences(chartPrinter.getPreferences(accountScope));
    void chartPrinter.loadPreferences(accountScope).then((loadedPreferences) => {
      if (isCurrentScope && !hasEditedPreferences.current) {
        setPreferences(loadedPreferences);
      }
    });

    return () => {
      isCurrentScope = false;
    };
  }, [accountScope]);

  const handleChange = <K extends keyof PrintPreferences>(
    key: K,
    value: PrintPreferences[K]
  ) => {
    hasEditedPreferences.current = true;
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  const handlePrint = async () => {
    if (savePreferences && accountScope) {
      setIsSaving(true);
      try {
        await chartPrinter.savePreferences(accountScope, preferences);
      } catch (error) {
        console.error('Failed to save preferences:', error);
      } finally {
        setIsSaving(false);
      }
    }
    onConfirm(preferences);
  };

  const inputClass = "w-full bg-[#252528] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-300 rounded px-2 py-1.5 text-xs text-zinc-100 [.rtx-advanced-view_&]:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 [.rtx-advanced-view_&]:focus:ring-indigo-500 [.rtx-advanced-view_&]:focus:border-indigo-500";
  const labelClass = "block text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 mb-1.5";
  const sectionTitleClass = "text-xs font-semibold text-zinc-200 [.rtx-advanced-view_&]:text-gray-800 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 pb-1";
  const checkboxClass = "w-3.5 h-3.5 bg-[#252528] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-300 rounded text-blue-600 [.rtx-advanced-view_&]:text-indigo-600 focus:ring-2 focus:ring-blue-500 [.rtx-advanced-view_&]:focus:ring-indigo-500 accent-blue-600 [.rtx-advanced-view_&]:accent-indigo-600";
  const checkboxLabelClass = "text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-700";

  return createPortal(
    <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
        onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) onCancel();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
    >
        <div
            className="bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[480px] animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 shrink-0">
                <div className="flex items-center gap-2">
                    <Icon name="settings" size="md" className="text-blue-400 [.rtx-advanced-view_&]:text-indigo-600" />
                    <h2 className="text-sm font-semibold text-zinc-100 [.rtx-advanced-view_&]:text-gray-900">{tr("Print Setup")}</h2>
                </div>
                <button
                    onClick={onCancel}
                    className="text-zinc-400 hover:text-zinc-100 [.rtx-advanced-view_&]:text-gray-500 [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors p-1 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-100 rounded"
                    aria-label={tr("Close")}
                >
                    <Icon name="x-close" size="md" />
                </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4 overflow-y-auto min-h-0">
                {/* Page Setup */}
                <div className="space-y-3">
                    <h3 className={sectionTitleClass}>
                        {tr("Page Setup")}</h3>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>{tr("Orientation")}</label>
                            <select
                                value={preferences.orientation}
                                onChange={(e) => handleChange('orientation', e.target.value as PageOrientation)}
                                className={inputClass}
                            >
                                <option value="portrait">{tr("Portrait")}</option>
                                <option value="landscape">{tr("Landscape")}</option>
                            </select>
                        </div>

                        <div>
                            <label className={labelClass}>{tr("Paper Size")}</label>
                            <select
                                value={preferences.pageSize}
                                onChange={(e) => handleChange('pageSize', e.target.value as PageSize)}
                                className={inputClass}
                            >
                                <option value="A4">{tr("A4 (210 × 297 mm)")}</option>
                                <option value="Letter">{tr("Letter (8.5 × 11 in)")}</option>
                                <option value="Legal">{tr("Legal (8.5 × 14 in)")}</option>
                                <option value="A3">{tr("A3 (297 × 420 mm)")}</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Margins */}
                <div className="space-y-3">
                    <h3 className={sectionTitleClass}>
                        {tr("Margins (mm)")}</h3>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>{tr("Top")}</label>
                            <input
                                type="number"
                                min="0"
                                max="50"
                                value={preferences.marginTop}
                                onChange={(e) => handleChange('marginTop', Number(e.target.value))}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className={labelClass}>{tr("Right")}</label>
                            <input
                                type="number"
                                min="0"
                                max="50"
                                value={preferences.marginRight}
                                onChange={(e) => handleChange('marginRight', Number(e.target.value))}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className={labelClass}>{tr("Bottom")}</label>
                            <input
                                type="number"
                                min="0"
                                max="50"
                                value={preferences.marginBottom}
                                onChange={(e) => handleChange('marginBottom', Number(e.target.value))}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className={labelClass}>{tr("Left")}</label>
                            <input
                                type="number"
                                min="0"
                                max="50"
                                value={preferences.marginLeft}
                                onChange={(e) => handleChange('marginLeft', Number(e.target.value))}
                                className={inputClass}
                            />
                        </div>
                    </div>
                </div>

                {/* Print Options */}
                <div className="space-y-3">
                    <h3 className={sectionTitleClass}>
                        {tr("Print Options")}</h3>

                    <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={preferences.includeHeader}
                                onChange={(e) => handleChange('includeHeader', e.target.checked)}
                                className={checkboxClass}
                            />
                            <span className={checkboxLabelClass}>{tr("Include Header")}</span>
                        </label>

                        {preferences.includeHeader && (
                          <input
                            type="text"
                            placeholder={tr("Header text (optional)")}
                            value={preferences.headerText || ''}
                            onChange={(e) => handleChange('headerText', e.target.value)}
                            className={`${inputClass} ml-5 w-[calc(100%-1.25rem)]`}
                          />
                        )}

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={preferences.includeFooter}
                                onChange={(e) => handleChange('includeFooter', e.target.checked)}
                                className={checkboxClass}
                            />
                            <span className={checkboxLabelClass}>{tr("Include Footer")}</span>
                        </label>

                        {preferences.includeFooter && (
                          <input
                            type="text"
                            placeholder={tr("Footer text (optional)")}
                            value={preferences.footerText || ''}
                            onChange={(e) => handleChange('footerText', e.target.value)}
                            className={`${inputClass} ml-5 w-[calc(100%-1.25rem)]`}
                          />
                        )}

                        <p className="text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-600">{tr("The print captures the visible chart, including its grid, indicators and drawings.")}</p>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={preferences.includeIndicators}
                                onChange={(e) => handleChange('includeIndicators', e.target.checked)}
                                className={checkboxClass}
                            />
                            <span className={checkboxLabelClass}>{tr("Include Indicators Legend")}</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={preferences.includeDrawings}
                                onChange={(e) => handleChange('includeDrawings', e.target.checked)}
                                className={checkboxClass}
                            />
                            <span className={checkboxLabelClass}>{tr("Include Drawings Legend")}</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={preferences.scaleToFit}
                                onChange={(e) => handleChange('scaleToFit', e.target.checked)}
                                className={checkboxClass}
                            />
                            <span className={checkboxLabelClass}>{tr("Scale to Fit Page")}</span>
                        </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 pt-2">
                        <div>
                            <label className={labelClass}>{tr("Color Mode")}</label>
                            <select
                                value={preferences.colorMode}
                                onChange={(e) => handleChange('colorMode', e.target.value as ColorMode)}
                                className={inputClass}
                            >
                                <option value="color">{tr("Color")}</option>
                                <option value="grayscale">{tr("Black & White")}</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Save Preferences */}
                {accountScope && (
                  <div className="pt-4 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={savePreferences}
                        onChange={(e) => setSavePreferences(e.target.checked)}
                        className={checkboxClass}
                      />
                      <span className={checkboxLabelClass}>{tr("Save these preferences as default")}</span>
                    </label>
                  </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50 shrink-0">
                <button
                    onClick={onCancel}
                    className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors"
                >
                    {tr("Cancel")}</button>
                <button
                    onClick={handlePrint}
                    disabled={isSaving}
                    className="px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-indigo-600 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-indigo-700 text-white rounded transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Icon name="print" size="xs" />
                    {isSaving ? tr("Saving...") : tr("OK")}
                </button>
            </div>
        </div>
    </div>,
    document.body
  );
};


/**
 * Chart Template Manager
 * Dropdown + Modal UI for saving/loading/managing chart templates
 */

import { Icon } from './ui/Icon';
import { useState, useRef } from 'react';
import { useChartTemplateStore, type ChartTemplate } from '../store/useChartTemplateStore';

interface ChartTemplateManagerProps {
  currentSymbol: string;
  currentTimeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';
  currentChartType: 'candlestick' | 'heikinAshi' | 'bar' | 'line' | 'area';
  currentShowVolume: boolean;
  currentShowGrid: boolean;
  currentIndicators: any[];
  currentDrawingTools: any[];
  onLoadTemplate: (template: ChartTemplate) => void;
}

export const ChartTemplateManager = ({
  currentSymbol,
  currentTimeframe,
  currentChartType,
  currentShowVolume,
  currentShowGrid,
  currentIndicators,
  currentDrawingTools,
  onLoadTemplate,
}: ChartTemplateManagerProps) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ChartTemplate | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    templates,
    saveTemplate,
    deleteTemplate,
    renameTemplate,
    duplicateTemplate,
    importTemplates,
    exportTemplates,
  } = useChartTemplateStore();

  const handleSaveTemplate = (name: string) => {
    const template = saveTemplate({
      name,
      symbol: currentSymbol,
      timeframe: currentTimeframe,
      chartType: currentChartType,
      showVolume: currentShowVolume,
      showGrid: currentShowGrid,
      indicators: currentIndicators || [],
      drawingTools: currentDrawingTools || [],
    });

    setSaveDialogOpen(false);
    setNewTemplateName('');
    console.log('[ChartTemplateManager] Template saved:', template);
  };

  const handleQuickSave = () => {
    const name = `${currentSymbol} ${currentTimeframe} (${new Date().toLocaleString()})`;
    handleSaveTemplate(name);
    setDropdownOpen(false);
  };

  const handleLoadTemplate = (template: ChartTemplate) => {
    onLoadTemplate(template);
    setDropdownOpen(false);
    console.log('[ChartTemplateManager] Template loaded:', template);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this template?')) {
      deleteTemplate(id);
    }
  };

  const handleRename = (template: ChartTemplate) => {
    setEditingTemplate(template);
    setRenameValue(template.name);
  };

  const handleDuplicate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateTemplate(id);
  };

  const handleExport = () => {
    const data = exportTemplates();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chart-templates-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.version && data.templates && Array.isArray(data.templates)) {
          importTemplates(data.templates);
          alert(`Imported ${data.templates.length} template(s)`);
        } else {
          alert('Invalid template file format');
        }
      } catch (err) {
        console.error('Import error:', err);
        alert('Failed to import templates');
      }
    };
    reader.readAsText(file);

    // Reset input for re-import
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="relative">
      {/* Dropdown Button */}
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded border border-zinc-700 transition-colors"
      >
        <Icon name="save" size="sm" className="w-3.5 h-3.5" />
        Templates
        <Icon name="chevron-down" size="sm" className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {dropdownOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-72 bg-zinc-900 border border-zinc-800 rounded shadow-xl z-50 max-h-96 overflow-y-auto">
            {/* Quick Actions */}
            <div className="border-b border-zinc-800 p-2">
              <button
                onClick={handleQuickSave}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
              >
                <Icon name="save" size="sm" className="w-3.5 h-3.5 text-emerald-500" />
                Save Current
              </button>
              <button
                onClick={() => {
                  setSaveDialogOpen(true);
                  setDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
              >
                <Icon name="plus" size="sm" className="w-3.5 h-3.5 text-blue-500" />
                Save As...
              </button>
            </div>

            {/* Template List */}
            <div className="py-1">
              {templates.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-zinc-500">
                  No saved templates
                </div>
              ) : (
                templates.map((template) => (
                  <div
                    key={template.id}
                    className="group flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors"
                    onClick={() => handleLoadTemplate(template)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{template.name}</div>
                      <div className="text-[10px] text-zinc-500">
                        {template.symbol} · {template.timeframe} · {template.chartType}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(template.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 rounded transition-opacity"
                      title="Delete"
                    >
                      <Icon name="trash" size="sm" className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Manage Link */}
            <div className="border-t border-zinc-800 p-2">
              <button
                onClick={() => {
                  setManagerOpen(true);
                  setDropdownOpen(false);
                }}
                className="w-full px-3 py-2 text-xs text-blue-400 hover:bg-zinc-800 rounded transition-colors text-left"
              >
                Manage Templates...
              </button>
            </div>
          </div>
        </>
      )}

      {/* Save Dialog */}
      {saveDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-100">Save Template</h3>
              <button
                onClick={() => {
                  setSaveDialogOpen(false);
                  setNewTemplateName('');
                }}
                className="p-1 hover:bg-zinc-800 rounded transition-colors"
              >
                <Icon name="x-close" size="sm" className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <input
              type="text"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="Template name"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTemplateName.trim()) {
                  handleSaveTemplate(newTemplateName.trim());
                }
              }}
            />

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setSaveDialogOpen(false);
                  setNewTemplateName('');
                }}
                className="flex-1 px-4 py-2 text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => newTemplateName.trim() && handleSaveTemplate(newTemplateName.trim())}
                disabled={!newTemplateName.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Manager Modal */}
      {managerOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-zinc-800">
              <h2 className="text-xl font-semibold text-zinc-100">Manage Templates</h2>
              <button
                onClick={() => setManagerOpen(false)}
                className="p-2 hover:bg-zinc-800 rounded transition-colors"
              >
                <Icon name="x-close" size="sm" className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            {/* Import/Export Toolbar */}
            <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800 bg-zinc-900/50">
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
              >
                <Icon name="download" size="sm" className="w-3.5 h-3.5" />
                Export All
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
              >
                <Icon name="upload" size="sm" className="w-3.5 h-3.5" />
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
              <div className="flex-1" />
              <div className="text-xs text-zinc-500">
                {templates.length} template{templates.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              {templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                  <Icon name="save" size="sm" className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-sm">No templates saved yet</p>
                  <p className="text-xs mt-2">Click "Save Current" to create your first template</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                    <tr className="text-left text-xs text-zinc-400 uppercase tracking-wide">
                      <th className="px-6 py-3 font-medium">Name</th>
                      <th className="px-6 py-3 font-medium">Symbol</th>
                      <th className="px-6 py-3 font-medium">Timeframe</th>
                      <th className="px-6 py-3 font-medium">Created</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {templates.map((template) => (
                      <tr key={template.id} className="hover:bg-zinc-800/50 transition-colors">
                        <td className="px-6 py-3">
                          <div className="font-medium text-zinc-200">{template.name}</div>
                          <div className="text-xs text-zinc-500">{template.chartType}</div>
                        </td>
                        <td className="px-6 py-3 text-zinc-300">{template.symbol}</td>
                        <td className="px-6 py-3 text-zinc-300">{template.timeframe}</td>
                        <td className="px-6 py-3 text-zinc-400 text-xs">
                          {new Date(template.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleRename(template)}
                              className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                              title="Rename"
                            >
                              <Icon name="edit" size="sm" className="w-3.5 h-3.5 text-blue-400" />
                            </button>
                            <button
                              onClick={(e) => handleDuplicate(template.id, e)}
                              className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                              title="Duplicate"
                            >
                              <Icon name="copy" size="sm" className="w-3.5 h-3.5 text-emerald-400" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(template.id, e)}
                              className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                              title="Delete"
                            >
                              <Icon name="trash" size="sm" className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-6 border-t border-zinc-800">
              <button
                onClick={() => setManagerOpen(false)}
                className="px-4 py-2 text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Rename Dialog */}
      {editingTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={() => setEditingTemplate(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-100 mb-3">Rename Template</h3>
            <input
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  renameTemplate(editingTemplate.id, renameValue.trim());
                  setEditingTemplate(null);
                }
                if (e.key === 'Escape') setEditingTemplate(null);
              }}
              autoFocus
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 outline-none focus:border-blue-500 mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingTemplate(null)} className="px-3 py-1.5 text-xs bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Cancel</button>
              <button
                onClick={() => { if (renameValue.trim()) { renameTemplate(editingTemplate.id, renameValue.trim()); setEditingTemplate(null); } }}
                disabled={!renameValue.trim()}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

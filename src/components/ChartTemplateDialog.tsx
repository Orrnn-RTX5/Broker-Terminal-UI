import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Chart Template Management Dialog
 * Allows users to save, load, and delete chart templates
 * MT5-inspired UI for template management
 */

import ReactDOM from 'react-dom';
import { Icon } from './ui/Icon';
import React, { useState, useRef } from 'react';
import { useTemplateStore, type ChartTemplate } from '../store/useTemplateStore';
import type { ChartType, Timeframe } from './TradingChart';
import { Save, Download, X, CheckCircle, Trash2, Plus } from 'lucide-react';

interface ChartTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'save' | 'load';
  currentConfig?: {
    chartType: ChartType;
    timeframe: Timeframe;
    showGrid: boolean;
    showVolumes: boolean;
    indicators: any[];
    drawingTools: any[];
    colors: any;
  };
  onLoadTemplate?: (template: ChartTemplate) => void;
}

export const ChartTemplateDialog: React.FC<ChartTemplateDialogProps> = ({
  isOpen,
  onClose,
  mode,
  currentConfig,
  onLoadTemplate,
}) => {
    const tr = useUiTranslation();
  const { templates, saveTemplate, deleteTemplate, loadTemplate } = useTemplateStore();
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showSaveInput, setShowSaveInput] = useState(mode === 'save');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  if (!isOpen) return null;

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      alert('Please enter a template name');
      return;
    }

    if (!currentConfig) {
      alert('No chart configuration available');
      return;
    }

    const newTemplate = saveTemplate({
      name: templateName,
      chartType: currentConfig.chartType,
      timeframe: currentConfig.timeframe,
      showGrid: currentConfig.showGrid,
      showVolumes: currentConfig.showVolumes,
      indicators: currentConfig.indicators || [],
      drawingTools: currentConfig.drawingTools || [],
      colors: currentConfig.colors || {
        background: '#000000',
        grid: '#2b2b2b',
        candle: { up: '#26a69a', down: '#ef5350', border: '#378658' },
        volume: { up: '#26a69a', down: '#ef5350' },
      },
    });

    console.log('[ChartTemplateDialog] Saved template:', newTemplate);
    setTemplateName('');
    setShowSaveInput(false);
    onClose();
  };

  const handleLoadTemplate = (templateId: string) => {
    const template = loadTemplate(templateId);
    if (template && onLoadTemplate) {
      onLoadTemplate(template);
      onClose();
    }
  };

  const handleDeleteTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (template?.isDefault) {
      alert('Cannot delete default templates');
      return;
    }

    if (confirm(`Delete template "${template?.name}"?`)) {
      deleteTemplate(templateId);
      if (selectedTemplate === templateId) {
        setSelectedTemplate(null);
      }
    }
  };

  const defaultTemplates = templates.filter((t) => t.isDefault);
  const customTemplates = templates.filter((t) => !t.isDefault);

  return ReactDOM.createPortal(
    <div 
      className="rtx-chart-template-dialog-backdrop fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      onContextMenuCapture={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onContextMenu={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div 
        className="rtx-chart-template-dialog bg-[#1e222d] border border-white/10 rounded-lg shadow-[0_32px_64px_rgba(0,0,0,0.8)] w-[420px] max-h-[600px] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden"
        style={{ 
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: dragRef.current ? 'none' : 'transform 0.1s ease-out'
        }}
        onContextMenu={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header - Drag Handle */}
        <div 
          className="flex items-center justify-between px-4 py-3 border-b border-white/5 cursor-move active:cursor-grabbing select-none"
          onMouseDown={handleHeaderMouseDown}
        >
          <div className="flex items-center gap-2.5">
            {mode === 'save' ? (
              <div className="bg-blue-600/20 p-1.5 rounded-md">
                <Save size={18} className="text-[#1e40af]" strokeWidth={2.5} />
              </div>
            ) : (
              <div className="bg-blue-600/20 p-1.5 rounded-md">
                <Download size={18} className="text-blue-400" strokeWidth={2.5} />
              </div>
            )}
            <h2 className="text-[13px] font-bold text-zinc-100 uppercase tracking-wider">
              {mode === 'save' ? tr("Save Chart Template") : tr("Load Chart Template")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 hover:bg-white/5 rounded-md"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Save Input */}
          {mode === 'save' && showSaveInput && (
            <div className="bg-[#252526] border border-zinc-700 rounded-lg p-4">
              <label className="block text-xs text-zinc-400 mb-2 font-medium">
                {tr("Template Name")}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={tr("My Custom Template")}
                  className="flex-1 bg-[#131316] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveTemplate();
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={handleSaveTemplate}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-semibold transition-colors shadow-lg shadow-blue-500/10"
                >
                  {tr("Save")}</button>
              </div>
              {currentConfig && (
                <div className="mt-3 text-xs text-zinc-500 space-y-1">
                  <div className="flex justify-between">
                    <span>{tr("Chart Type:")}</span>
                    <span className="text-zinc-400 font-mono">{currentConfig.chartType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("Timeframe:")}</span>
                    <span className="text-zinc-400 font-mono">{currentConfig.timeframe}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("Indicators:")}</span>
                    <span className="text-zinc-400">{currentConfig.indicators?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("Grid:")}</span>
                    <span className="text-zinc-400">{currentConfig.showGrid ? tr("On") : tr("Off")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("Volumes:")}</span>
                    <span className="text-zinc-400">{currentConfig.showVolumes ? tr("On") : tr("Off")}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Default Templates */}
          {defaultTemplates.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5 px-1">
                <CheckCircle size={14} className="text-[#eab308]" />
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  {tr("Default Templates")}</h3>
              </div>
              <div className="space-y-2">
                {defaultTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplate === template.id}
                    onSelect={() => setSelectedTemplate(template.id)}
                    onLoad={() => handleLoadTemplate(template.id)}
                    onDelete={null} // Cannot delete defaults
                    mode={mode}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom Templates */}
          {customTemplates.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                {tr("Custom Templates")}</h3>
              <div className="space-y-2">
                {customTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplate === template.id}
                    onSelect={() => setSelectedTemplate(template.id)}
                    onLoad={() => handleLoadTemplate(template.id)}
                    onDelete={() => handleDeleteTemplate(template.id)}
                    mode={mode}
                  />
                ))}
              </div>
            </div>
          )}

          {customTemplates.length === 0 && mode === 'load' && !showSaveInput && (
            <div className="text-center py-12 text-zinc-600">
              <Plus size={32} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">{tr("No custom templates")}</p>
              <p className="text-[11px] mt-1 opacity-60">{tr("Right-click chart to save a new template")}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/5 bg-black/20">
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs rounded font-bold uppercase tracking-wider transition-all"
          >
            {tr("Close")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

interface TemplateCardProps {
  template: ChartTemplate;
  isSelected: boolean;
  onSelect: () => void;
  onLoad: () => void;
  onDelete: (() => void) | null;
  mode: 'save' | 'load';
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onSelect,
  onLoad,
  onDelete,
  mode,
}) => {
    const tr = useUiTranslation();
  return (
    <div
      className={`bg-[#252526] border rounded-lg p-3 cursor-pointer transition-all ${
        isSelected
          ? 'border-zinc-600 shadow-lg shadow-blue-500/20'
          : 'border-zinc-700 hover:border-zinc-600'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-200">{template.name}</h4>
            {template.isDefault && (
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">
                {tr("Default")}</span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {new Date(template.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-1">
          {mode === 'load' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onLoad();
              }}
              className="p-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition-all"
              title={tr("Load template")}
            >
              <Download size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white rounded transition-all"
              title={tr("Delete template")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Template Preview */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">{tr("Type:")}</span>
          <span className="text-zinc-400 font-mono">{template.chartType}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">{tr("Timeframe:")}</span>
          <span className="text-zinc-400 font-mono">{template.timeframe}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">{tr("Indicators:")}</span>
          <span className="text-zinc-400">{template.indicators.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">{tr("Grid:")}</span>
          <span className={template.showGrid ? 'text-emerald-400' : 'text-zinc-600'}>
            {template.showGrid ? tr("On") : tr("Off")}
          </span>
        </div>
      </div>
    </div>
  );
};

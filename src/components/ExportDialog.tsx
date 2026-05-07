import { Icon } from './ui/Icon';
import { useState } from 'react';
import Papa from 'papaparse';
import type { Trade } from '../store/useAppStore';

interface ExportDialogProps {
  accountId: string;
  onClose: () => void;
}

type ExportFormat = 'csv' | 'pdf' | 'json';
type ExportDataType = 'trades' | 'positions' | 'performance';

import { API_BASE_URL } from '../config/api';
import { FileSpreadsheet, FileJson } from 'lucide-react';

export const ExportDialog = ({ accountId, onClose }: ExportDialogProps) => {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dataType, setDataType] = useState<ExportDataType>('trades');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(['symbol', 'side', 'volume', 'profit', 'openTime', 'closeTime'])
  );
  const [csvDelimiter, setCsvDelimiter] = useState<',' | ';' | '\t'>(',');

  // Available columns for selection
  const allColumns = {
    trades: [
      { key: 'id', label: 'Trade ID' },
      { key: 'symbol', label: 'Symbol' },
      { key: 'side', label: 'Side' },
      { key: 'volume', label: 'Volume' },
      { key: 'openPrice', label: 'Open Price' },
      { key: 'closePrice', label: 'Close Price' },
      { key: 'profit', label: 'Profit' },
      { key: 'commission', label: 'Commission' },
      { key: 'swap', label: 'Swap' },
      { key: 'openTime', label: 'Open Time' },
      { key: 'closeTime', label: 'Close Time' },
    ],
    positions: [
      { key: 'id', label: 'Position ID' },
      { key: 'symbol', label: 'Symbol' },
      { key: 'side', label: 'Side' },
      { key: 'volume', label: 'Volume' },
      { key: 'openPrice', label: 'Open Price' },
      { key: 'currentPrice', label: 'Current Price' },
      { key: 'unrealizedPnL', label: 'Unrealized P&L' },
      { key: 'sl', label: 'Stop Loss' },
      { key: 'tp', label: 'Take Profit' },
    ],
  };

  const toggleColumn = (column: string) => {
    setSelectedColumns((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(column)) {
        newSet.delete(column);
      } else {
        newSet.add(column);
      }
      return newSet;
    });
  };

  const handleExport = async () => {
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }

    setIsLoading(true);
    try {
      if (format === 'csv') {
        await exportCSV();
      } else if (format === 'pdf') {
        await exportPDF();
      } else if (format === 'json') {
        await exportJSON();
      }
      onClose();
    } catch (error) {
      console.error('Export error:', error);
      alert(`Failed to export data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const exportCSV = async () => {
    // Fetch data from API
    const data = await fetchData();

    // Filter columns based on selection
    const filteredData = data.map((item: any) => {
      const filtered: any = {};
      selectedColumns.forEach((col) => {
        filtered[col] = item[col];
      });
      return filtered;
    });

    // Generate CSV using papaparse
    const csv = Papa.unparse(filteredData, {
      delimiter: csvDelimiter,
      header: true,
    });

    // Download CSV file
    downloadFile(csv, `${dataType}_${Date.now()}.csv`, 'text/csv');
  };

  const exportPDF = async () => {
    // Call backend API for PDF generation
    const queryParams = new URLSearchParams({
      start: startDate,
      end: endDate,
      accountId,
    });

    const response = await fetch(
      `${API_BASE_URL}/api/analytics/export/pdf?${queryParams}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`PDF export failed: ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report_${Date.now()}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportJSON = async () => {
    const data = await fetchData();

    // Filter columns
    const filteredData = data.map((item: any) => {
      const filtered: any = {};
      selectedColumns.forEach((col) => {
        filtered[col] = item[col];
      });
      return filtered;
    });

    const json = JSON.stringify(filteredData, null, 2);
    downloadFile(json, `${dataType}_${Date.now()}.json`, 'application/json');
  };

  const fetchData = async () => {
    const endpoint =
      dataType === 'trades'
        ? `/api/trades?accountId=${accountId}`
        : dataType === 'positions'
          ? `/api/positions?accountId=${accountId}`
          : `/api/performance?accountId=${accountId}`;

    const response = await fetch(`${API_BASE_URL}${endpoint}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${dataType}`);
    }

    const data = await response.json();

    // Filter by date range if applicable
    if (dataType === 'trades' && Array.isArray(data)) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      return data.filter((item: Trade) => {
        const closeTime = item.closeTime ? new Date(item.closeTime).getTime() : 0;
        return closeTime >= start && closeTime <= end;
      });
    }

    return data || [];
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const currentColumns =
    dataType === 'trades' ? allColumns.trades : allColumns.positions;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Icon name="download" size="sm" className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">Export Data</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
          >
            <Icon name="x-close" size="sm" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Data Type Selection */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Data Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['trades', 'positions', 'performance'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setDataType(type)}
                  className={`p-2 rounded border text-sm font-medium transition-colors ${dataType === type
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                    }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Export Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setFormat('csv')}
                className={`flex items-center justify-center gap-2 p-3 rounded border transition-colors ${format === 'csv'
                    ? 'bg-blue-600 border-zinc-600 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                  }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span className="text-sm font-medium">CSV</span>
              </button>
              <button
                onClick={() => setFormat('pdf')}
                className={`flex items-center justify-center gap-2 p-3 rounded border transition-colors ${format === 'pdf'
                    ? 'bg-blue-600 border-zinc-600 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                  }`}
              >
                <Icon name="file-text" size="sm" className="w-4 h-4" />
                <span className="text-sm font-medium">PDF</span>
              </button>
              <button
                onClick={() => setFormat('json')}
                className={`flex items-center justify-center gap-2 p-3 rounded border transition-colors ${format === 'json'
                    ? 'bg-blue-600 border-zinc-600 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                  }`}
              >
                <FileJson className="w-4 h-4" />
                <span className="text-sm font-medium">JSON</span>
              </button>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                <Icon name="calendar" size="sm" className="inline w-3 h-3 mr-1" />
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                <Icon name="calendar" size="sm" className="inline w-3 h-3 mr-1" />
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* CSV Options */}
          {format === 'csv' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                CSV Delimiter
              </label>
              <select
                value={csvDelimiter}
                onChange={(e) => setCsvDelimiter(e.target.value as ',' | ';' | '\t')}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="\t">Tab (\t)</option>
              </select>
            </div>
          )}

          {/* Column Selection (for CSV and JSON) */}
          {(format === 'csv' || format === 'json') && dataType !== 'performance' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Select Columns
              </label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto bg-zinc-800 border border-zinc-700 rounded p-3">
                {currentColumns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-700 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedColumns.has(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="w-4 h-4 text-emerald-600 bg-zinc-700 border-zinc-600 rounded focus:ring-emerald-500"
                    />
                    <span className="text-zinc-300">{col.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded text-white hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isLoading || !startDate || !endDate || selectedColumns.size === 0}
              className="flex-1 px-4 py-2 bg-emerald-600 border border-emerald-500 rounded text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <Icon name="download" size="sm" className="w-4 h-4" />
                  <span>Export</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

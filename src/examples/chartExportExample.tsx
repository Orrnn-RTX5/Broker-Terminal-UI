/**
 * Chart Export Usage Examples
 *
 * This file demonstrates various ways to use the chart export functionality
 */

import { Icon } from '../components/ui/Icon';
import React, { useState, useRef } from 'react';
import { ChartExporter, ChartMetadata, ChartExportOptions } from '../services/chartExporter';
import { SavePictureDialog } from '../components/dialogs/SavePictureDialog';
import { FileImage } from 'lucide-react';
/**
 * Example 1: Basic Export with Dialog
 */
export function BasicExportExample() {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <div>
      <button
        onClick={() => setShowDialog(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Export Chart
      </button>

      <SavePictureDialog
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        symbol="EURUSD"
        timeframe="5m"
      />
    </div>
  );
}

/**
 * Example 2: Programmatic Export (No Dialog)
 */
export function ProgrammaticExportExample() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleQuickExport = async () => {
    if (!canvasRef.current) return;

    try {
      const metadata: ChartMetadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      const blob = await ChartExporter.exportCanvas(
        canvasRef.current,
        metadata,
        {
          format: 'png',
          scale: 1,
          includeTimestamp: true,
          includeSymbolInfo: true
        }
      );

      const filename = ChartExporter.generateFilename(metadata, 'png');
      ChartExporter.downloadBlob(blob, filename);

      alert('Chart exported successfully!');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export chart');
    }
  };

  return (
    <div>
      <canvas ref={canvasRef} width={800} height={600} />
      <button onClick={handleQuickExport}>Quick Export (PNG)</button>
    </div>
  );
}

/**
 * Example 3: High-Quality Print Export
 */
export function HighQualityExportExample() {
  const exportForPrint = async (canvas: HTMLCanvasElement) => {
    const metadata: ChartMetadata = {
      symbol: 'EURUSD',
      timeframe: '1h',
      timestamp: new Date()
    };

    const options: Partial<ChartExportOptions> = {
      format: 'png',
      scale: 3, // 3x resolution for printing
      includeSymbolInfo: true,
      includeTimestamp: true,
      includeWatermark: true,
      watermarkText: 'Trading Engine - Professional Analysis',
      backgroundColor: '#ffffff' // White background for print
    };

    const blob = await ChartExporter.exportCanvas(canvas, metadata, options);
    const filename = ChartExporter.generateFilename(metadata, 'png');
    ChartExporter.downloadBlob(blob, filename);
  };

  return (
    <button onClick={() => {
      const canvas = document.querySelector('canvas');
      if (canvas) exportForPrint(canvas);
    }}>
      Export for Print (High Quality)
    </button>
  );
}

/**
 * Example 4: Email-Friendly Export
 */
export function EmailFriendlyExportExample() {
  const exportForEmail = async (canvas: HTMLCanvasElement) => {
    const metadata: ChartMetadata = {
      symbol: 'GBPUSD',
      timeframe: '5m',
      timestamp: new Date()
    };

    const options: Partial<ChartExportOptions> = {
      format: 'jpg',
      quality: 0.75, // Lower quality = smaller file
      scale: 1,
      includeSymbolInfo: true,
      includeTimestamp: false, // Omit timestamp for cleaner look
      includeWatermark: false
    };

    const blob = await ChartExporter.exportCanvas(canvas, metadata, options);
    const filename = ChartExporter.generateFilename(metadata, 'jpg');
    ChartExporter.downloadBlob(blob, filename);
  };

  return (
    <button onClick={() => {
      const canvas = document.querySelector('canvas');
      if (canvas) exportForEmail(canvas);
    }}>
      Export for Email (Small File)
    </button>
  );
}

/**
 * Example 5: Batch Export (Multiple Timeframes)
 */
export function BatchExportExample() {
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  const exportAllTimeframes = async () => {
    const symbol = 'EURUSD';

    for (const timeframe of timeframes) {
      try {
        // In real implementation, you'd switch timeframes and wait for chart to update
        const canvas = document.querySelector('canvas');
        if (!canvas) continue;

        const metadata: ChartMetadata = {
          symbol,
          timeframe,
          timestamp: new Date()
        };

        const blob = await ChartExporter.exportCanvas(canvas, metadata);
        const filename = ChartExporter.generateFilename(metadata, 'png');
        ChartExporter.downloadBlob(blob, filename);

        // Delay between exports
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to export ${timeframe}:`, error);
      }
    }

    alert('Batch export complete!');
  };

  return (
    <button onClick={exportAllTimeframes}>
      Export All Timeframes
    </button>
  );
}

/**
 * Example 6: Custom Watermark Export
 */
export function CustomWatermarkExample() {
  const [watermarkText, setWatermarkText] = useState('My Trading System');

  const exportWithCustomWatermark = async (canvas: HTMLCanvasElement) => {
    const metadata: ChartMetadata = {
      symbol: 'BTCUSD',
      timeframe: '1d',
      timestamp: new Date()
    };

    const options: Partial<ChartExportOptions> = {
      format: 'png',
      scale: 2,
      includeWatermark: true,
      watermarkText,
      includeSymbolInfo: true,
      includeTimestamp: true
    };

    const blob = await ChartExporter.exportCanvas(canvas, metadata, options);
    const filename = ChartExporter.generateFilename(metadata, 'png');
    ChartExporter.downloadBlob(blob, filename);
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={watermarkText}
        onChange={(e) => setWatermarkText(e.target.value)}
        placeholder="Enter watermark text"
        className="px-3 py-2 border rounded"
      />
      <button onClick={() => {
        const canvas = document.querySelector('canvas');
        if (canvas) exportWithCustomWatermark(canvas);
      }}>
        Export with Custom Watermark
      </button>
    </div>
  );
}

/**
 * Example 7: Preview Before Export
 */
export function PreviewExportExample() {
  const [previewUrl, setPreviewUrl] = useState<string>('');

  const generatePreview = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const preview = ChartExporter.getPreview(canvas, 400, 300);
    setPreviewUrl(preview);
  };

  const exportFromPreview = async () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const metadata: ChartMetadata = {
      symbol: 'XAUUSD',
      timeframe: '1h',
      timestamp: new Date()
    };

    const blob = await ChartExporter.exportCanvas(canvas, metadata);
    const filename = ChartExporter.generateFilename(metadata, 'png');
    ChartExporter.downloadBlob(blob, filename);
  };

  return (
    <div className="space-y-4">
      <button onClick={generatePreview} className="px-4 py-2 bg-blue-600 text-white rounded">
        Generate Preview
      </button>

      {previewUrl && (
        <div className="border rounded p-4">
          <img src={previewUrl} alt="Chart preview" className="max-w-full" />
          <button
            onClick={exportFromPreview}
            className="mt-2 px-4 py-2 bg-green-600 text-white rounded"
          >
            Export This Chart
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Example 8: Auto-Detect Active Chart
 */
export function AutoDetectExportExample() {
  const exportActiveChart = async () => {
    try {
      const metadata: ChartMetadata = {
        symbol: 'Auto-Detected',
        timeframe: '5m',
        timestamp: new Date()
      };

      // Automatically finds and exports the largest canvas on the page
      const blob = await ChartExporter.exportActiveChart(metadata);
      const filename = ChartExporter.generateFilename(metadata, 'png');
      ChartExporter.downloadBlob(blob, filename);

      alert('Active chart exported successfully!');
    } catch (error) {
      console.error('Export failed:', error);
      alert('No chart found to export');
    }
  };

  return (
    <button onClick={exportActiveChart}>
      Export Active Chart (Auto-Detect)
    </button>
  );
}

/**
 * Example 9: Export Menu Integration
 */
export function ExportMenuExample() {
  const [showDialog, setShowDialog] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleQuickExport = async (format: 'png' | 'jpg') => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const metadata: ChartMetadata = {
      symbol: 'EURUSD',
      timeframe: '5m',
      timestamp: new Date()
    };

    const blob = await ChartExporter.exportCanvas(canvas, metadata, { format });
    const filename = ChartExporter.generateFilename(metadata, format);
    ChartExporter.downloadBlob(blob, filename);

    setAnchorEl(null);
  };

  return (
    <div className="relative">
      <button
        onClick={(e) => setAnchorEl(anchorEl ? null : e.currentTarget)}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
      >
        <Icon name="download" size="md" />
        Export Chart
      </button>

      {anchorEl && (
        <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg py-1 z-10 min-w-[180px]">
          <button
            onClick={() => handleQuickExport('png')}
            className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
          >
            <Icon name="image" size="sm" />
            Quick Export (PNG)
          </button>
          <button
            onClick={() => handleQuickExport('jpg')}
            className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
          >
            <FileImage size={14} />
            Quick Export (JPG)
          </button>
          <div className="h-px bg-gray-200 my-1" />
          <button
            onClick={() => {
              setShowDialog(true);
              setAnchorEl(null);
            }}
            className="w-full px-4 py-2 text-left hover:bg-gray-100"
          >
            Export Options...
          </button>
        </div>
      )}

      <SavePictureDialog
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        symbol="EURUSD"
        timeframe="5m"
      />
    </div>
  );
}

/**
 * Example 10: Comprehensive Export Component
 */
export function ComprehensiveExportComponent() {
  return (
    <div className="space-y-4 p-4">
      <h2 className="text-xl font-bold">Chart Export Examples</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Basic Export</h3>
          <BasicExportExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Quick Export</h3>
          <ProgrammaticExportExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">High Quality</h3>
          <HighQualityExportExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Email Friendly</h3>
          <EmailFriendlyExportExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Batch Export</h3>
          <BatchExportExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Custom Watermark</h3>
          <CustomWatermarkExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Preview</h3>
          <PreviewExportExample />
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Auto-Detect</h3>
          <AutoDetectExportExample />
        </div>

        <div className="border rounded p-4 md:col-span-2">
          <h3 className="font-semibold mb-2">Export Menu</h3>
          <ExportMenuExample />
        </div>
      </div>
    </div>
  );
}

export default ComprehensiveExportComponent;

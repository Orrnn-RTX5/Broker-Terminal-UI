/**
 * CanvasSelection Example Component
 * Demonstrates integration with existing trading terminal
 */

import { Icon } from '../ui/Icon';
import React, { useState, useCallback, useRef } from 'react';
import { CanvasSelection } from './CanvasSelection';
import type { Rect } from '../../store/useCanvasSelectionStore';
import { LayoutDashboard } from 'lucide-react';
/**
 * Example 1: Basic Canvas Selection
 */
export const BasicExample: React.FC = () => {
  const [selection, setSelection] = useState<Rect | null>(null);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">Basic Selection</h2>
      <CanvasSelection
        width={600}
        height={400}
        onSelectionChange={setSelection}
        onSelectionConfirm={(rect) => console.log('Confirmed:', rect)}
        onSelectionCancel={() => console.log('Cancelled')}
      >
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <LayoutDashboard className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p>Select an area to begin</p>
          </div>
        </div>
      </CanvasSelection>
      {selection && (
        <div className="text-sm text-muted-foreground font-mono">
          Selection: {Math.round(selection.x)}, {Math.round(selection.y)} - {' '}
          {Math.round(selection.width)}x{Math.round(selection.height)}
        </div>
      )}
    </div>
  );
};

/**
 * Example 2: Chart Area Selector
 * Simulates selecting a region on a trading chart for analysis
 */
export const ChartAreaSelector: React.FC = () => {
  const [selectedRegion, setSelectedRegion] = useState<Rect | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  const handleConfirm = useCallback((rect: Rect) => {
    setSelectedRegion(rect);
    setIsAnalyzing(true);

    // Simulate analysis
    setTimeout(() => {
      setIsAnalyzing(false);
      setAnalysisResult(
        `Analysis complete for region (${Math.round(rect.x)}, ${Math.round(rect.y)}) - ` +
        `${Math.round(rect.width)}x${Math.round(rect.height)} pixels`
      );
    }, 1000);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Chart Area Analysis</h2>
        {analysisResult && (
          <span className="text-sm text-success">{analysisResult}</span>
        )}
      </div>

      <CanvasSelection
        width={800}
        height={500}
        onSelectionConfirm={handleConfirm}
        accentColor="#10b981"
      >
        {/* Simulated Chart Content */}
        <div className="relative w-full h-full bg-gradient-to-b from-background to-muted/20">
          {/* Grid Lines */}
          <div className="absolute inset-0 opacity-10">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={`h-${i}`}
                className="absolute w-full border-t border-foreground"
                style={{ top: `${(i + 1) * 10}%` }}
              />
            ))}
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={`v-${i}`}
                className="absolute h-full border-l border-foreground"
                style={{ left: `${(i + 1) * 10}%` }}
              />
            ))}
          </div>

          {/* Simulated Price Action */}
          <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <path
              d="M0,400 Q100,350 200,380 T400,300 T600,250 T800,200"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-primary opacity-60"
            />
            <path
              d="M0,400 Q100,350 200,380 T400,300 T600,250 T800,200 V500 H0 Z"
              fill="currentColor"
              className="text-primary opacity-10"
            />
          </svg>

          {/* Price Labels */}
          <div className="absolute right-2 top-4 text-xs font-mono space-y-2 text-muted-foreground">
            <div>1.2500</div>
            <div>1.2450</div>
            <div>1.2400</div>
            <div>1.2350</div>
            <div>1.2300</div>
          </div>

          {/* Time Labels */}
          <div className="absolute bottom-2 left-4 right-4 flex justify-between text-xs font-mono text-muted-foreground">
            <span>09:00</span>
            <span>10:00</span>
            <span>11:00</span>
            <span>12:00</span>
            <span>13:00</span>
          </div>
        </div>
      </CanvasSelection>

      {isAnalyzing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Analyzing selected region...
        </div>
      )}
    </div>
  );
};

/**
 * Example 3: Layout Zone Selector
 * For selecting predefined layout sections like in professional trading terminals
 */
export const LayoutZoneSelector: React.FC = () => {
  const [activeZone, setActiveZone] = useState<string | null>(null);

  const customZones = [
    { id: 'chart-main', label: 'Main Chart', rect: { x: 0, y: 0, width: 600, height: 300 }, priority: 1 },
    { id: 'chart-secondary', label: 'Secondary', rect: { x: 0, y: 300, width: 600, height: 150 }, priority: 1 },
    { id: 'panel-left', label: 'Market Watch', rect: { x: 600, y: 0, width: 200, height: 225 }, priority: 1 },
    { id: 'panel-right-top', label: 'Trades', rect: { x: 600, y: 225, width: 200, height: 225 }, priority: 1 },
  ];

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">Layout Zone Selection</h2>
      <p className="text-sm text-muted-foreground">
        Select a zone to configure the layout. The selection will snap to predefined zones.
      </p>

      <CanvasSelection
        width={800}
        height={450}
        customSnapZones={customZones}
        onSelectionChange={(rect) => {
          if (rect) {
            const zone = customZones.find(z =>
              Math.abs(z.rect.x - rect.x) < 10 &&
              Math.abs(z.rect.y - rect.y) < 10 &&
              Math.abs(z.rect.width - rect.width) < 10 &&
              Math.abs(z.rect.height - rect.height) < 10
            );
            setActiveZone(zone?.id || null);
          } else {
            setActiveZone(null);
          }
        }}
        accentColor="#f59e0b"
      >
        <div className="absolute inset-0 grid grid-cols-4 gap-1 p-1">
          <div className="col-span-3 row-span-2 bg-muted/30 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center">
            <span className="text-muted-foreground text-sm">Chart Area</span>
          </div>
          <div className="bg-muted/30 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center">
            <span className="text-muted-foreground text-xs">Market Watch</span>
          </div>
          <div className="bg-muted/30 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center">
            <span className="text-muted-foreground text-xs">Trades</span>
          </div>
        </div>
      </CanvasSelection>

      {activeZone && (
        <div className="text-sm">
          <span className="text-muted-foreground">Active Zone: </span>
          <span className="font-medium text-primary">
            {customZones.find(z => z.id === activeZone)?.label}
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Example 4: Screenshot/Capture Tool
 * For capturing specific regions of the interface
 */
export const ScreenshotCapture: React.FC = () => {
  const [captures, setCaptures] = useState<Rect[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleCapture = useCallback((rect: Rect) => {
    setCaptures(prev => [...prev, rect]);
  }, []);

  const downloadCapture = useCallback((rect: Rect, index: number) => {
    // In a real implementation, this would use html2canvas or similar
    console.log(`Downloading capture ${index}:`, rect);
    alert(`Capture ${index + 1} would be downloaded: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Screenshot Capture</h2>
        <div className="text-sm text-muted-foreground">
          {captures.length} capture{captures.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div ref={canvasRef}>
        <CanvasSelection
          width={700}
          height={400}
          onSelectionConfirm={handleCapture}
          features={{ resize: true, move: true, crop: true, snap: true, undoRedo: true }}
        >
          <div className="flex flex-col h-full">
            {/* Mock Trading Interface */}
            <div className="h-10 border-b border-border bg-muted/50 flex items-center px-4 gap-4">
              <div className="w-20 h-4 bg-muted rounded" />
              <div className="w-32 h-4 bg-muted rounded" />
              <div className="flex-1" />
              <div className="w-24 h-6 bg-primary/20 rounded" />
            </div>
            <div className="flex-1 flex">
              <div className="w-48 border-r border-border bg-muted/30 p-2 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 bg-muted rounded" />
                ))}
              </div>
              <div className="flex-1 p-4">
                <div className="h-full bg-muted/20 rounded border border-dashed border-muted-foreground/30" />
              </div>
            </div>
          </div>
        </CanvasSelection>
      </div>

      {captures.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Recent Captures</h3>
          <div className="flex gap-2 flex-wrap">
            {captures.map((capture, index) => (
              <button
                key={index}
                onClick={() => downloadCapture(capture, index)}
                className="flex items-center gap-2 px-3 py-2 bg-muted hover:bg-muted/80 rounded text-xs transition-colors"
              >
                <Icon name="image" size="sm" className="w-3 h-3" />
                <span className="font-mono">
                  {Math.round(capture.width)}×{Math.round(capture.height)}
                </span>
                <Icon name="download" size="sm" className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Example 5: Compare Regions Side-by-Side
 * Select two regions for comparison
 */
export const RegionCompare: React.FC = () => {
  const [regions, setRegions] = useState<{ rect: Rect; label: string }[]>([]);
  const [step, setStep] = useState(1);

  const handleConfirm = useCallback((rect: Rect) => {
    setRegions(prev => [...prev, { rect, label: `Region ${step}` }]);
    setStep(s => s + 1);
  }, [step]);

  const reset = useCallback(() => {
    setRegions([]);
    setStep(1);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Region Compare</h2>
        {regions.length > 0 && (
          <button
            onClick={reset}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        Step {Math.min(step, 2)} of 2: Select region {step === 1 ? 'A' : 'B'} to compare
      </div>

      <CanvasSelection
        width={700}
        height={400}
        onSelectionConfirm={handleConfirm}
      >
        <div className="relative w-full h-full">
          {/* Show existing selections */}
          {regions.map((region, index) => (
            <div
              key={index}
              className="absolute border-2 border-primary/50 bg-primary/10 flex items-center justify-center"
              style={{
                left: region.rect.x,
                top: region.rect.y,
                width: region.rect.width,
                height: region.rect.height,
              }}
            >
              <span className="text-primary font-medium">{region.label}</span>
            </div>
          ))}

          {/* Background content */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="grid" size="sm" className="w-12 h-12 text-muted-foreground/20" />
          </div>
        </div>
      </CanvasSelection>

      {regions.length === 2 && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          {regions.map((region, index) => (
            <div key={index} className="p-4 bg-muted rounded">
              <div className="text-sm font-medium mb-2">{region.label}</div>
              <div className="text-xs text-muted-foreground font-mono space-y-1">
                <div>Position: ({Math.round(region.rect.x)}, {Math.round(region.rect.y)})</div>
                <div>Size: {Math.round(region.rect.width)} × {Math.round(region.rect.height)}</div>
                <div>Area: {Math.round(region.rect.width * region.rect.height)} px²</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Main Example Showcase
 */
export const CanvasSelectionExample: React.FC = () => {
  const [activeExample, setActiveExample] = useState<string>('basic');

  const examples = [
    { id: 'basic', label: 'Basic Selection', component: BasicExample },
    { id: 'chart', label: 'Chart Analysis', component: ChartAreaSelector },
    { id: 'layout', label: 'Layout Zones', component: LayoutZoneSelector },
    { id: 'screenshot', label: 'Screenshot Tool', component: ScreenshotCapture },
    { id: 'compare', label: 'Region Compare', component: RegionCompare },
  ];

  const ActiveComponent = examples.find(e => e.id === activeExample)?.component || BasicExample;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Canvas Selection Component</h1>
          <p className="text-muted-foreground">
            Professional trading-style canvas selection with drag, resize, crop, and snap.
          </p>
        </div>

        {/* Example Selector */}
        <div className="flex flex-wrap gap-2">
          {examples.map(example => (
            <button
              key={example.id}
              onClick={() => setActiveExample(example.id)}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activeExample === example.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                }
              `}
            >
              {example.label}
            </button>
          ))}
        </div>

        {/* Active Example */}
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <ActiveComponent />
        </div>

        {/* Features List */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div className="p-4 bg-muted rounded-lg">
            <div className="font-medium mb-1">Click & Drag</div>
            <div className="text-muted-foreground">Create selection by clicking and dragging</div>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <div className="font-medium mb-1">Move & Resize</div>
            <div className="text-muted-foreground">Drag selection to move, use handles to resize</div>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <div className="font-medium mb-1">Snap to Zones</div>
            <div className="text-muted-foreground">Magnetic snap to predefined layout zones</div>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <div className="font-medium mb-1">Crop Mode</div>
            <div className="text-muted-foreground">Crop selection to specific dimensions</div>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <div className="font-medium mb-1">Undo/Redo</div>
            <div className="text-muted-foreground">Full history support with keyboard shortcuts</div>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <div className="font-medium mb-1">Touch Support</div>
            <div className="text-muted-foreground">Works with mouse and touch devices</div>
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="font-medium mb-3">Keyboard Shortcuts</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Enter</span>
              <span>Confirm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Escape</span>
              <span>Cancel</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ctrl+Z</span>
              <span>Undo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ctrl+Shift+Z</span>
              <span>Redo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Arrow Keys</span>
              <span>Nudge</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shift+Arrow</span>
              <span>Nudge 10px</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CanvasSelectionExample;

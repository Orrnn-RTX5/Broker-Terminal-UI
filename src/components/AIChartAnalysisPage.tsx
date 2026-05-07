import React, { useState } from 'react';
import { ChartImageUpload } from './ChartImageUpload';
import { LiveForexChart } from './LiveForexChart';
import './AIChartAnalysisPage.css';

export const AIChartAnalysisPage: React.FC = () => {
    const [detectedPairs, setDetectedPairs] = useState<string[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

    const handlePairsDetected = (pairs: string[]) => {
        setDetectedPairs(pairs);
        if (pairs.length > 0) {
            setSelectedSymbol(pairs[0]); // Auto-select first pair
        }
    };

    const handleSymbolSelect = (symbol: string) => {
        setSelectedSymbol(symbol);
    };

    return (
        <div className="ai-chart-analysis-page">
            {/* Step 1: Upload Image */}
            <ChartImageUpload onPairsDetected={handlePairsDetected} />

            {/* Step 2: Display Charts for Detected Pairs */}
            {detectedPairs.length > 0 && (
                <div className="charts-section">
                    <div className="section-header">
                        <h2>📊 Live Charts - Detected Symbols Only</h2>
                        <p>Showing {detectedPairs.length} symbol{detectedPairs.length !== 1 ? 's' : ''} from your image</p>
                    </div>

                    {/* Symbol Tabs */}
                    <div className="symbol-tabs">
                        {detectedPairs.map((symbol) => (
                            <button
                                key={symbol}
                                className={`symbol-tab ${selectedSymbol === symbol ? 'active' : ''}`}
                                onClick={() => handleSymbolSelect(symbol)}
                            >
                                {symbol}
                            </button>
                        ))}
                    </div>

                    {/* Chart Display */}
                    {selectedSymbol && (
                        <div className="chart-display">
                            <LiveForexChart key={selectedSymbol} initialSymbol={selectedSymbol} availableSymbols={detectedPairs} />
                        </div>
                    )}
                </div>
            )}

            {/* Empty State */}
            {detectedPairs.length === 0 && (
                <div className="empty-state">
                    <div className="empty-icon">📈</div>
                    <h3>Upload Your Market Watch Image</h3>
                    <p>AI will automatically detect all visible forex pairs</p>
                    <ul className="features-list">
                        <li>✓ Detects ONLY visible symbols - no extras</li>
                        <li>✓ Supports all forex pairs, commodities, crypto</li>
                        <li>✓ Live OHLC charts with multiple timeframes</li>
                        <li>✓ Real-time price updates via WebSocket</li>
                    </ul>
                </div>
            )}
        </div>
    );
};

export default AIChartAnalysisPage;

const fs = require('fs');
let code = fs.readFileSync('src/components/TradingChart.tsx', 'utf8');

// Fix import
code = code.replace(
  /import \{ PriceDisplay, getSymbolDigits \} from '\.\/ui\/PriceDisplay';/,
  "import { PriceDisplay } from './ui/PriceDisplay';\nimport { getSymbolDigits } from '../utils/symbolUtils';"
);

// Fix cleanup to also clear markers
code = code.replace(
  /(\/\/ Also remove any orphaned position elements from the overlay[\s\S]*?querySelectorAll\('.rtx-position-line, \.rtx-position-label'\)\.forEach\(el => el\.remove\(\)\);\n\s*\})/,
  "$1\n      if (seriesRef.current) {\n        try { seriesRef.current.setMarkers([]); } catch { }\n      }\n"
);

// Fix createLeftLabel by replacing it with createPositionElement and the new rendering logic
const newRenderCode = `    const createPositionElement = (text: string, color: string, price: number, isDashed: boolean) => {
      const overlayEl = overlayRef.current;
      if (!overlayEl || !seriesRef.current) return;

      const line = document.createElement('div');
      line.className = 'rtx-position-line';
      line.style.cssText = \`
        position: absolute;
        left: 0;
        right: 50px;
        height: 0;
        border-top: 1px \${isDashed ? 'dashed' : 'dotted'} \${color};
        z-index: 4;
        pointer-events: none;
      \`;
      overlayEl.appendChild(line);
      positionLabelsRef.current.push(line);
      positionLabelDataRef.current.push({ price, text: '', color });

      const label = document.createElement('div');
      label.className = 'rtx-position-label';
      label.style.cssText = \`
        position: absolute;
        left: 4px;
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 1px 6px;
        background: \${color}22;
        border: 1px solid \${color}66;
        border-radius: 3px;
        color: \${color};
        font-size: 10px;
        font-family: Consolas, monospace;
        font-weight: 600;
        white-space: nowrap;
        z-index: 5;
        pointer-events: none;
        line-height: 16px;
      \`;
      label.textContent = text;
      
      overlayEl.appendChild(label);
      positionLabelsRef.current.push(label);
      positionLabelDataRef.current.push({ price, text, color });
    };

    const renderPositionLines = () => {
      if (isDisposedRef.current || !seriesRef.current) return;

      cleanup();

      const state = useAppStore.getState();
      const appPositions = state.positions || [];
      const mt5State = useMT5Store.getState();
      const mt5Positions = (mt5State.positions || []).map((p: any) => {
        const rawAction = p.action;
        const actionStr = String(rawAction ?? '').toUpperCase().trim();
        const isBuy = rawAction === 0 || actionStr === '0' || actionStr === 'BUY';
        return {
          id: p.ticket,
          symbol: p.symbol,
          side: isBuy ? 'BUY' : 'SELL',
          volume: p.volume,
          openPrice: p.open_price || p.price_open || p.openPrice || p.current_price || 0,
          currentPrice: p.current_price || p.price_current || p.currentPrice || 0,
          openTime: p.time_ms ? new Date(p.time_ms).toISOString() : new Date().toISOString(),
          sl: p.sl,
          tp: p.tp,
        };
      });

      const allIds = new Set(mt5Positions.map((p: any) => p.id));
      const positions = [
        ...mt5Positions,
        ...appPositions.filter((p: any) => !allIds.has(p.id)),
      ];

      const normalizedChartSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const myPositions = positions.filter(p => {
        const posSymbol = (p.symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        return posSymbol === normalizedChartSymbol || posSymbol.startsWith(normalizedChartSymbol) || normalizedChartSymbol.startsWith(posSymbol);
      });

      const series = seriesRef.current;

      if (myPositions.length === 0) {
        if (markersHandleRef.current) {
          try { markersHandleRef.current.detach(); } catch { }
          markersHandleRef.current = null;
        }
        try { series.setMarkers([]); } catch { }
        return;
      }

      const markers: any[] = [];

      for (const pos of myPositions) {
        const isBuy = pos.side === 'BUY';
        const entryColor = isBuy ? '#26a69a' : '#ef5350';
        const volume = pos.volume != null ? Number(pos.volume) : 0;

        const entryPrice = Number(pos.openPrice) > 0 ? Number(pos.openPrice) : (Number(pos.currentPrice) || 0);
        if (entryPrice > 0) {
          createPositionElement(\`\${isBuy ? 'BUY' : 'SELL'} \${volume}\`, entryColor, entryPrice, true);
        }

        if (pos.sl && pos.sl > 0) {
          createPositionElement(\`SL \${pos.sl}\`, '#ef5350', pos.sl, false);
        }

        if (pos.tp && pos.tp > 0) {
          createPositionElement(\`TP \${pos.tp}\`, '#26a69a', pos.tp, false);
        }

        if (pos.openTime) {
          let openTimestamp: number;
          if (typeof pos.openTime === 'string') {
            openTimestamp = Math.floor(new Date(pos.openTime).getTime() / 1000);
          } else {
            openTimestamp = Number(pos.openTime);
            if (openTimestamp > 1_000_000_000_000) openTimestamp = Math.floor(openTimestamp / 1000);
          }

          if (openTimestamp > 0) {
            markers.push({
              time: openTimestamp as (number | string) as Time,
              position: isBuy ? 'belowBar' : 'aboveBar',
              color: isBuy ? '#26a69a' : '#ef5350',
              shape: isBuy ? 'arrowUp' : 'arrowDown',
              text: \`\${isBuy ? 'BUY' : 'SELL'} \${volume}\`,
            });
          }
        }
      }

      if (markersHandleRef.current) {
        try { markersHandleRef.current.detach(); } catch { }
        markersHandleRef.current = null;
      }
      
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      try {
        series.setMarkers(markers);
      } catch { }
    };
`;

const startIndex = code.indexOf('    const createLeftLabel =');
let endIndex = code.indexOf('      // Set markers using lightweight-charts native API');

if (endIndex === -1) {
    endIndex = code.indexOf('           markersHandleRef.current = createSeriesMarkers(series, markers);');
    endIndex = code.indexOf('}', endIndex) + 1; // get to end of try-catch
    endIndex = code.indexOf('}', endIndex) + 1; // get to end of if
    endIndex = code.indexOf('    };', endIndex) + 6; // end of renderPositionLines
} else {
    endIndex = code.indexOf('    };', endIndex) + 6; // end of renderPositionLines
}

if (startIndex !== -1 && endIndex !== -1) {
    code = code.substring(0, startIndex) + newRenderCode + code.substring(endIndex);
    fs.writeFileSync('src/components/TradingChart.tsx', code);
    console.log('Successfully updated position markers logic!');
} else {
    console.log('Failed to find replace block');
    console.log('startIndex:', startIndex);
    console.log('endIndex:', endIndex);
}

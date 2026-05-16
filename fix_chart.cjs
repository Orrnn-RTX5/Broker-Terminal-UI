const fs = require('fs');

let content = fs.readFileSync('src/components/TradingChart.tsx', 'utf8');

// Replace clickHandler check
content = content.replace(
  `    const clickHandler = (param: any) => {
      if (!param.time || !param.point || !seriesRef.current) return;`,
  `    const clickHandler = (param: any) => {
      if (!param.point || !seriesRef.current) return;
      const activeDrawing = drawingManager.getActiveDrawing();
      if (!param.time && !activeDrawing) return;`
);

// Replace crosshairHandler check
content = content.replace(
  `      if (param.time && param.point && seriesRef.current) {`,
  `      const activeD = drawingManager.getActiveDrawing();
      if ((param.time || activeD) && param.point && seriesRef.current) {`
);

// Replace clickHandler addPoint logic
const oldClickLogic = `          // For vlines: use pixel-precise logical index instead of candle-snapped time
          if (activeDrawing.type === 'vline') {
            const rawX = (param.sourceEvent && containerRef.current) ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left) : param.point.x;
            const logicalIndex = chart.timeScale().coordinateToLogical(rawX);
            const logicalForStorage = logicalIndex !== null ? logicalIndex : 0;
            drawingManager.addPointWithLogical(param.time as number, price, logicalForStorage);
          } else {
            drawingManager.addPoint(param.time as number, price);
          }`;

const newClickLogic = `          const rawX = (param.sourceEvent && containerRef.current) ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left) : param.point.x;
          const logicalIndex = chart.timeScale().coordinateToLogical(rawX);
          const logicalForStorage = logicalIndex !== null ? logicalIndex : 0;
          drawingManager.addPointWithLogical((param.time || Date.now() / 1000) as number, price, logicalForStorage);`;

content = content.replace(oldClickLogic, newClickLogic);

// Replace crosshairHandler preview logic
const oldPreviewLogic = `            // For vline: use fractional logical index for pixel-precise ghost preview
            const activeD = drawingManager.getActiveDrawing();
            if (activeD && activeD.type === 'vline') {
              const rawX = (param.sourceEvent && containerRef.current) ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left) : param.point.x;
              const logicalIndex = chart.timeScale().coordinateToLogical(rawX);
              drawingManager.updatePreviewPointWithLogical(param.time as number, price, logicalIndex ?? undefined);
            } else {
              drawingManager.updatePreviewPoint(param.time as number, price);
            }`;

const newPreviewLogic = `            const rawX = (param.sourceEvent && containerRef.current) ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left) : param.point.x;
            const logicalIndex = chart.timeScale().coordinateToLogical(rawX);
            drawingManager.updatePreviewPointWithLogical((param.time || Date.now() / 1000) as number, price, logicalIndex ?? undefined);`;

content = content.replace(oldPreviewLogic, newPreviewLogic);

fs.writeFileSync('src/components/TradingChart.tsx', content, 'utf8');
console.log('Done');

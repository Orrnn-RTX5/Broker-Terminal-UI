const fs = require('fs');

let content = fs.readFileSync('src/components/TradingChart.tsx', 'utf8');

const broken = `crosshairHandler = (param: any) => {\r\n      // lightweight-charts re-applies cursor:crosshair on every crosshair event.\r\n      // Enforce the correct cursor here every frame so it doesn't flicker back.\r\n      if (!activeToolRef.current && containerRef.current) {\r\n        containerRef.current.querySelectorAll('canvas').forEach((c) => {\r\n          if ((c as HTMLElement).style.cursor !== 'default') {\r\n      }\r\n      // Note: param.time=null on mouse leave \u2014 updatePreviewPoint no-ops gracefully\r\n    };`;

const fixed = `crosshairHandler = (param: any) => {\r\n      // lightweight-charts re-applies cursor:crosshair on every crosshair event.\r\n      // Enforce the correct cursor here every frame so it doesn't flicker back.\r\n      if (!activeToolRef.current && containerRef.current) {\r\n        containerRef.current.querySelectorAll('canvas').forEach((c) => {\r\n          if ((c as HTMLElement).style.cursor !== 'default') {\r\n            (c as HTMLElement).style.cursor = 'default';\r\n          }\r\n        });\r\n      }\r\n\r\n      if (param.time && param.point && seriesRef.current) {\r\n        const price = seriesRef.current.coordinateToPrice(param.point.y);\r\n        if (price !== null) {\r\n          if (isDrawingFreehand) {\r\n            drawingManager.addPoint(param.time as number, price);\r\n          } else {\r\n            // For vline: use fractional logical index for pixel-precise ghost preview\r\n            const activeD = drawingManager.getActiveDrawing();\r\n            if (activeD && activeD.type === 'vline') {\r\n              const logicalIndex = chart.timeScale().coordinateToLogical(param.point.x);\r\n              drawingManager.updatePreviewPointWithLogical(param.time as number, price, logicalIndex ?? undefined);\r\n            } else {\r\n              drawingManager.updatePreviewPoint(param.time as number, price);\r\n            }\r\n          }\r\n        }\r\n      }\r\n      // Note: param.time=null on mouse leave \u2014 updatePreviewPoint no-ops gracefully\r\n    };`;

if (!content.includes(broken)) {
  console.error('ERROR: broken section not found');
  process.exit(1);
}

content = content.replace(broken, fixed);
fs.writeFileSync('src/components/TradingChart.tsx', content, 'utf8');
console.log('SUCCESS: crosshairHandler restored and fixed');

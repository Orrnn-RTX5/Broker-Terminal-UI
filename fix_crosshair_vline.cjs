const fs = require('fs');

let content = fs.readFileSync('src/components/TradingChart.tsx', 'utf8');

const broken = `            if (activeD && activeD.type === 'vline') {
              const logicalIndex = chart.timeScale().coordinateToLogical(param.point.x);
              drawingManager.updatePreviewPointWithLogical(param.time as number, price, logicalIndex ?? undefined);
            } else {`;

const fixed = `            if (activeD && activeD.type === 'vline') {
              const rawX = (param.sourceEvent && containerRef.current) ? (param.sourceEvent.clientX - containerRef.current.getBoundingClientRect().left) : param.point.x;
              const logicalIndex = chart.timeScale().coordinateToLogical(rawX);
              drawingManager.updatePreviewPointWithLogical(param.time as number, price, logicalIndex ?? undefined);
            } else {`;

if (!content.includes(broken)) {
  console.log("Not found with exact match, trying regex...");
  const regex = /if \(activeD && activeD\.type === 'vline'\) \{\s+const logicalIndex = chart\.timeScale\(\)\.coordinateToLogical\(param\.point\.x\);\s+drawingManager\.updatePreviewPointWithLogical\(param\.time as number, price, logicalIndex \?\? undefined\);\s+\} else \{/;
  if (regex.test(content)) {
    content = content.replace(regex, fixed);
  } else {
    console.error('ERROR: Could not find target');
    process.exit(1);
  }
} else {
  content = content.replace(broken, fixed);
}

fs.writeFileSync('src/components/TradingChart.tsx', content, 'utf8');
console.log('SUCCESS');

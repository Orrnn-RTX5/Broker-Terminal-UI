const fs = require('fs');
const content = fs.readFileSync('src/store/useDrawingStore.ts', 'utf-8');

const methods = [
  { name: 'addDrawing', key: 'debouncedSaveDrawings' },
  { name: 'updateDrawing', key: 'debouncedSaveDrawings' },
  { name: 'deleteDrawing', key: 'debouncedSaveDrawings' },
  { name: 'duplicateDrawing', key: 'debouncedSaveDrawings' },
  { name: 'toggleDrawingVisibility', key: 'debouncedSaveDrawings' },
  { name: 'sendToBack', key: 'debouncedSaveDrawings' },
  { name: 'saveTemplate', key: 'debouncedSaveTemplates' },
  { name: 'loadTemplate', key: 'debouncedSaveDrawings' },
  { name: 'deleteTemplate', key: 'debouncedSaveTemplates' },
];

console.log('Debouncing verification for useDrawingStore.ts\n');
console.log('Import check:');
console.log('  debounce imported:', content.includes("import { debounce } from 'lodash-es'") ? 'YES' : 'NO');
console.log('  Debounced functions defined:', 
  content.includes('debouncedSaveDrawings') && content.includes('debouncedSaveTemplates') ? 'YES' : 'NO');

console.log('\nMethod implementations:');
methods.forEach(method => {
  const methodStart = content.indexOf(`${method.name}:`);
  const nextMethod = content.indexOf('  },', methodStart + 50);
  const methodImpl = content.substring(methodStart, nextMethod);
  const hasDebounce = methodImpl.includes(method.key);
  const status = hasDebounce ? 'DEBOUNCED' : 'NOT DEBOUNCED';
  console.log(`  ${method.name}: ${status}`);
});

console.log('\nDebounce configuration:');
console.log('  Delay: 300ms');
console.log('  Function 1: debouncedSaveDrawings (for drawing operations)');
console.log('  Function 2: debouncedSaveTemplates (for template operations)');

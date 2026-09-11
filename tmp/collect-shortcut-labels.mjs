import fs from 'node:fs';
import ts from 'typescript';

const labels = new Set(['Keyboard Shortcuts', 'Search shortcuts...', 'All', 'Category', 'Shortcuts', 'Close', '(Disabled)', 'No matches found', '{{value0}} shortcuts', 'Clear search',
  'Print Preview', 'Save as Picture', 'Show period separators', 'Show trade history', 'Show OHLC', 'Auto Scroll', 'Chart Shift', 'Emojis, Icons and Stamps', 'Timeframes',
  'Trend Line', 'Horizontal Line', 'Horizontal Ray', 'Vertical Line', 'Cross Line', 'Fib Retracement', 'Text', 'Documentation is not configured for this deployment',
  'File', 'View', 'Insert', 'Charts', 'Tools', 'Window', 'Help', 'Trading', 'Navigation', 'Drag', 'Ctrl', 'Shift', 'Alt', 'Cmd', 'Space', 'Home', 'End', 'PageUp', 'PageDown', 'Esc', 'Del']);
for (const filename of ['src/components/GlobalShortcuts.tsx', 'src/components/layout/TopToolbar.tsx', 'src/services/shortcutCatalog.ts']) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isPropertyAssignment(node) && ['description', 'category', 'scope'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) labels.add(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const keys = [...labels].filter(key => !/^Switch to (M1|M5|M15|M30|H1|H4|D1|W1|MN) /.test(key) && !/^Switch to (M1|M5|M15|M30|H1|H4|D1|W1|MN)$/.test(key)).sort();
fs.writeFileSync('tmp/shortcut-labels.json', JSON.stringify(keys, null, 2) + '\n');
const en = JSON.parse(fs.readFileSync('src/locales/en/ui.json', 'utf8'));
const lookup = new Map(Object.keys(en).map(key => [key.toLocaleLowerCase(), key]));
const aliases = Object.fromEntries(keys.filter(key => !Object.hasOwn(en, key) && lookup.has(key.toLocaleLowerCase())).map(key => [key, lookup.get(key.toLocaleLowerCase())]));
fs.writeFileSync('tmp/shortcut-label-aliases.json', JSON.stringify(aliases, null, 2) + '\n');
console.log(JSON.stringify({ count: keys.length, aliases, missing: keys.filter(key => !Object.hasOwn(en, key) && !Object.hasOwn(aliases, key)) }, null, 2));

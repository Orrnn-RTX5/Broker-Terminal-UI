import fs from 'node:fs';

const rows = JSON.parse(fs.readFileSync('tmp/shortcut-matrix-inventory.json', 'utf8'));
const globalRows = rows.filter(row => !row.id.startsWith('local.'));
const path = 'docs/SHORTCUT_VERIFICATION.md';
const browserResults = {
  'window.tile': 'Browser verified: Alt+R restored a 2×2 grid of four charts.',
  'window.tile-horizontal': 'Browser verified: menu action and Shift+Alt+H both rendered four rows.',
  'window.tile-vertical': 'Browser verified: Shift+Alt+V rendered four columns.',
  'window.cascade': 'Browser verified: Shift+Alt+C rendered four floating charts above the Toolbox.',
  'window.arrange-icons': 'Browser verified: minimized chart titlebar arranged above the Toolbox by Shift+Alt+M; disabled menu state checked before minimizing.',
  'window.reset': 'Browser verified: Shift+Alt+R retained all four chart IDs and their M5/M1/M1/M5 timeframes.',
  'help.shortcuts': 'Browser verified: F1 opened Keyboard Shortcuts with 89 entries and the minimized-window scope for Arrange Icons.',
  'trading.toggle-one-click': 'Browser verified: Shift+Alt+T toggled all four views of the same symbol, reflecting the shared symbol preference; toggled again to restore.',
  'file.print-preview': 'Browser verified: Ctrl+Shift+P opened a rendered ADAUSD M5 preview; screenshot visually checked. Native printing not invoked.',
  'charts.properties': 'Browser verified: F8 opened Chart Properties for ADAUSD M1.',
  'charts.bar-chart': 'Browser verified: Alt+1 selected the Bar Chart toolbar radio; native bar rendering not separately captured.',
  'charts.line-chart': 'Browser verified: Alt+3 selected Line; actual chart screenshot confirmed the line conversion.',
  'charts.area-chart': 'Browser verified: Alt+0 selected the Area Chart toolbar radio; native area rendering not separately captured.',
  'charts.candlestick': 'Browser verified: Alt+2 selected Candlesticks and an actual chart screenshot confirmed candles.',
  'window.undo': 'Not yet verified: layout history implementation is in progress after discovering an inactive stub.',
  'window.redo': 'Not yet verified: layout history implementation is in progress after discovering an inactive stub.',
};
for (const timeframe of ['m1','m5','m15','m30','h1','h4','d1','w1','mn']) {
  browserResults[`timeframe.${timeframe}`] = 'Browser verified: key changed the active ADAUSD chart label and selected toolbar timeframe; three sibling chart IDs/timeframes unchanged. Active chart restored to M1 after all nine.';
}
const callbackIds = new Set(['file.save', 'file.print', 'view.fullscreen', 'tools.new-order', 'view.depth-of-market', 'trading.quick-sell']);
const eventIds = new Set(['file.close-chart','file.print-preview','file.save-picture','view.data-window','view.symbols','tools.options',
  'trading.toggle-one-click','charts.object-list','charts.properties','charts.undo-drawing','charts.redo-drawing','charts.delete-drawing','charts.delete-last-drawing']);
const properties = new Set(['charts.toggle-grid','charts.toggle-grid-alt','charts.toggle-volumes','charts.period-separators','charts.trade-history','charts.ohlc','charts.auto-scroll','charts.chart-shift']);
const panelIds = new Set(['view.market-watch','view.navigator','view.terminal']);
const bottomIds = new Set(['trading.order-history','view.toolbox','tools.history-center']);
function evidence(row) {
  if (callbackIds.has(row.id)) return row.id === 'trading.quick-sell' ? 'Actual key handler → mocked quick-sell callback with exact active symbol; no broker transaction.' : 'Actual key handler → mocked application callback; native/downstream action not exercised by matrix.';
  if (eventIds.has(row.id)) return 'Actual key handler → expected custom event; chart events assert active context. Consumer behavior separate.';
  if (properties.has(row.id)) return 'Actual key handler → active-symbol chart settings; sibling symbol unchanged. Toolbar state asserted where applicable.';
  if (row.id.startsWith('timeframe.')) return 'Actual command consumer → target dock chart timeframe and selected toolbar button; sibling chart unchanged.';
  if (row.id.startsWith('window.')) return 'Actual key handler → expected layout API method/argument (method mocked); layout geometry requires separate evidence.';
  if (panelIds.has(row.id)) return 'Actual key handler → togglePanel event with correct panel name; panel mounting separate.';
  if (bottomIds.has(row.id)) return 'Actual key handler → requested BottomDock tab state; rendered panel content separate.';
  if (row.id === 'drawing.select-all') return 'Actual key handler → drawingManager.selectAll with active context (method mocked).';
  if (row.id === 'view.drawing-tools') return 'Actual key handler → drawing sidebar visibility state.';
  if (['drawing.emojis','drawing.stamps'].includes(row.id)) return 'Actual key handler → rendered rail popup and visible sidebar.';
  if (row.id === 'help.shortcuts') return 'Actual key handler → help-open state; full dialog separately covered in ShortcutHelpDialog.test.tsx.';
  if (row.id === 'navigation.close-modal') return 'Actual key handler → cursor-selection command for active chart; modal consumers separate.';
  if (['charts.scroll-left','charts.scroll-right'].includes(row.id)) return 'Actual chart-scroll consumer → mocked chart time-scale range; sibling chart unchanged.';
  if (row.id === 'charts.indicator-list') return 'Actual key handler → scoped OPEN_INDICATOR_LIST command; dialog consumer separate.';
  if (['charts.zoom-in','charts.zoom-out'].includes(row.id)) return 'Actual key handler → scoped zoom command and toolbar candleWidth state; rendered chart scale separate.';
  return 'Actual key handler → scoped chart command and corresponding toolbar state; renderer separate.';
}
function combo(row) {
  const keyMap = { ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Delete: 'Del', Backspace: '⌫', Enter: '↵', Tab: '⇥', ' ': 'Space' };
  return [row.ctrl && 'Ctrl',row.shift && 'Shift',row.alt && 'Alt',row.meta && 'Cmd',keyMap[row.key] || row.key.toUpperCase()].filter(Boolean).join('+');
}
const escape = value => String(value).replaceAll('|','\\|').replaceAll('\n',' ');
const table = ['| ID | Keys | Action / context | Automated evidence | Browser result |', '| --- | --- | --- | --- | --- |',
  ...globalRows.map(row => `| \`${row.id}\` | ${escape(combo(row))} | ${escape(row.description + (row.scope ? ` — ${row.scope}` : ''))} | ${escape(evidence(row))} | ${escape(browserResults[row.id] || 'Not exercised in this pass')} |`)].join('\n');
const document = fs.readFileSync(path, 'utf8');
fs.writeFileSync(path, document.replace(/<!-- GLOBAL_SHORTCUT_MATRIX_START -->[\s\S]*?<!-- GLOBAL_SHORTCUT_MATRIX_END -->/, `<!-- GLOBAL_SHORTCUT_MATRIX_START -->\n${table}\n<!-- GLOBAL_SHORTCUT_MATRIX_END -->`));
console.log(`Merged ${globalRows.length} registered global bindings; ${rows.length - globalRows.length} local rows documented separately.`);

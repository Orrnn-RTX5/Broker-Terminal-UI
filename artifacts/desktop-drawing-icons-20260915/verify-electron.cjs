// Isolated native Electron fixture. Renders actual icon component source with
// representative rail markup and current built application CSS. No app session.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ChevronRight } = require('lucide-react');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtx5-drawing-icon-fixture-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Source TSX is evaluated unchanged; only its unused translation dependency is
// stubbed so the fixture never initializes application state or network code.
const cache = new Map();
function sourceModule(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
  }).outputText;
  const instance = new Module(file, module);
  instance.filename = file;
  instance.paths = Module._nodeModulePaths(path.dirname(file));
  cache.set(file, instance);
  const nativeRequire = instance.require.bind(instance);
  instance.require = name => {
    if (name.endsWith('/hooks/useUiTranslation')) return { useUiTranslation: () => value => value };
    if (name.startsWith('.')) {
      for (const ext of ['.tsx', '.ts']) {
        const target = path.resolve(path.dirname(file), `${name}${ext}`);
        if (fs.existsSync(target)) return sourceModule(target);
      }
    }
    return nativeRequire(name);
  };
  instance._compile(compiled, file);
  return instance.exports;
}
const { DrawingRailIcon } = sourceModule(path.join(root, 'src/drawing-tools/DrawingRailIcon.tsx'));
const { DRAWING_TOOL_ICONS } = sourceModule(path.join(root, 'src/drawing-tools/toolIcons.ts'));
const baselineCss = execFileSync('git', ['show', 'HEAD:src/drawing-tools/WebDrawingToolsRail.css'], { cwd: root, encoding: 'utf8' });
fs.writeFileSync(path.join(__dirname, 'baseline-rail.css'), baselineCss);
const assets = fs.readdirSync(path.join(root, 'dist/assets'));
const css = ['index-', 'authenticatedStyles-', 'App-', 'TradingChart-'].map(prefix => {
  const file = assets.find(name => name.startsWith(prefix) && name.endsWith('.css'));
  if (!file) throw new Error(`Missing ${prefix} CSS; run build:electron first`);
  return file;
});
const results = {
  fixture: true,
  description: 'Hidden native Electron renderer, actual DrawingRailIcon and ReferenceToolbarGlyph TSX, actual alternate selected ray icon, source-matching rail wrappers and bundled app CSS. Fixed neighboring command placeholder; no full application, account, installed package or network.',
  css: css.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/assets', file))).digest('hex') })),
  variants: {}, failures: [], geometryComparisons: 0,
};
const defaultNames = ['trendline', 'fibonacci', 'patterns', 'forecast', 'brush', 'text', 'stamps', 'trade-stamps', 'measure', 'magnet', 'unlock', 'eye'];
const moreNames = ['lock', 'eye-off', 'zoom-out', 'alternate-ray'];
const flyout = renderToStaticMarkup(React.createElement(ChevronRight, { className: 'web-drawing-tools-rail__flyout-mark', 'aria-hidden': true, size: 7 }));
function button(name, active = false) {
  const icon = name === 'alternate-ray'
    ? React.createElement(DRAWING_TOOL_ICONS.ray, { 'aria-hidden': true, size: 28, strokeWidth: 1 })
    : React.createElement(DrawingRailIcon, { name });
  return `<button type="button" class="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button${name === 'trash' ? ' web-drawing-tools-rail__remove-button' : ''}" aria-label="${name}" aria-expanded="false" data-active="${active}" data-button="${name}">${renderToStaticMarkup(icon)}${flyout}</button>`;
}
function rail(horizontal, extra = false) {
  const names = extra ? moreNames : horizontal ? defaultNames : [...defaultNames.slice(0, 9), 'zoom', 'magnet', 'keep-drawing', 'unlock', 'eye'];
  return `<aside class="web-drawing-tools-rail" data-orientation="${horizontal ? 'horizontal' : 'vertical'}" data-expanded="true" role="toolbar" aria-orientation="${horizontal ? 'horizontal' : 'vertical'}" data-rail="${extra ? 'states' : 'main'}"><div class="web-drawing-tools-rail__tools">${names.map((name, i) => `${i === 8 || i === 9 ? '<div class="web-drawing-tools-rail__separator" role="separator"></div>' : ''}${button(name, extra && i < 2)}`).join('')}</div><div class="web-drawing-tools-rail__footer"><div class="web-drawing-tools-rail__separator" role="separator"></div>${button('trash')}</div></aside>`;
}
function html({ desktop, before, theme }) {
  return `<!doctype html><html class="rtx-advanced-view ${theme === 'light' ? 'rtx-skin-untitled-light' : ''}${desktop ? ' rtx-desktop-shell-active' : ''}" data-theme="${theme}"><head><meta charset="utf-8"><title>Drawing icon renderer fixture</title>
    ${css.map(file => `<link rel="stylesheet" href="../../dist/assets/${file}">`).join('\n')}
    ${before ? '<link rel="stylesheet" href="baseline-rail.css">' : ''}
    <style>
      html,body,#root { min-height:100%; height:100%; overflow:hidden; }
      body { margin:0; background:var(--bg-primary); color:var(--text-primary); }
      [data-banner] { height:52px; display:flex; align-items:center; padding:0 18px; font:14px 'Segoe UI',sans-serif; }
      [data-command-placeholder] { flex:0 0 min(62vw,1190px); padding-left:18px; white-space:nowrap; overflow:hidden; }
      [data-fixture-row] { display:flex; width:100%; align-items:center; }
      [data-state-label] { margin:28px 18px 10px; font:13px 'Segoe UI',sans-serif; }
      [data-state-stage] { width:350px; margin-left:18px; }
      [data-web-stage] { height:750px; }
    </style></head><body><div id="root"><div class="${desktop ? 'rtx-desktop-shell' : ''}"><div class="rtx-app-shell">
      <div data-banner>NATIVE ELECTRON FIXTURE · ${desktop ? 'Desktop horizontal toolbar' : 'Web vertical toolbar'} · ${before ? 'Before' : 'After'} · ${theme}</div>
      ${desktop ? `<div data-fixture-row class="rtx-desktop-command-row"><div data-command-placeholder>Neighboring command area (fixture) &nbsp; M1 &nbsp; M5 &nbsp; M15 &nbsp; M30 &nbsp; H1 &nbsp; H4 &nbsp; D1</div><div class="rtx-desktop-inline-drawings">${rail(true)}</div></div>
        <div data-state-label>Active locked / hidden icons, zoom-out and alternate Ray tool</div><div data-state-stage class="rtx-desktop-command-row"><div class="rtx-desktop-inline-drawings">${rail(true, true)}</div></div>` : `<div data-web-stage>${rail(false)}</div>`}
    </div></div></div></body></html>`;
}
const read = `(() => {
  const rectangle = node => { const {x,y,width,height}=node.getBoundingClientRect(); return {x,y,width,height}; };
  return {
    devicePixelRatio,
    rails:Array.from(document.querySelectorAll('[data-rail]')).map(rail => ({
      name:rail.dataset.rail,rect:rectangle(rail),
      tools: {rect:rectangle(rail.querySelector('.web-drawing-tools-rail__tools')),scrollWidth:rail.querySelector('.web-drawing-tools-rail__tools').scrollWidth,gap:getComputedStyle(rail.querySelector('.web-drawing-tools-rail__tools')).gap},
      footer:rectangle(rail.querySelector('.web-drawing-tools-rail__footer')),
      buttons:Array.from(rail.querySelectorAll('[data-button]')).map(button => {
        const svg=button.querySelector('svg:not(.web-drawing-tools-rail__flyout-mark)');
        const style=getComputedStyle(svg), buttonStyle=getComputedStyle(button);
        return {name:button.dataset.button,rect:rectangle(button),color:buttonStyle.color,
          svg:{rect:rectangle(svg),fill:style.fill,stroke:style.stroke,strokeWidth:style.strokeWidth},
          mark:rectangle(button.querySelector('.web-drawing-tools-rail__flyout-mark'))};
      })
    }))
  };
})()`;
let win;
app.whenReady().then(async () => {
  const isolated = session.fromPartition(`drawing-icons-${Date.now()}`);
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  win = new BrowserWindow({ width:1920, height:850, useContentSize:true, show:false, frame:false,
    webPreferences:{session:isolated,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,offscreen:true} });
  for (const theme of ['light', 'dark']) for (const width of [1920,1280]) for (const desktop of [true,false]) {
    win.setContentSize(width,850);
    const variants = [];
    for (const before of [true,false]) {
      const id = `${desktop ? 'desktop' : 'web'}-${before ? 'before' : 'after'}-${theme}-${width}`;
      const file = path.join(__dirname, `${id}.html`);
      fs.writeFileSync(file, html({desktop,before,theme}));
      await win.loadFile(file);
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      const values = await win.webContents.executeJavaScript(read);
      results.variants[id] = values;
      variants.push(values);
      const crop = desktop ? {x:0,y:0,width,height:245} : {x:0,y:0,width:450,height:830};
      fs.writeFileSync(path.join(__dirname, `${id}.png`), (await win.webContents.capturePage(crop,{stayHidden:true,stayAwake:true})).toPNG());
    }
    const [before, after] = variants;
    for (let i=0;i<before.rails.length;i++) {
      const oldRail=before.rails[i],newRail=after.rails[i];
      for (const key of ['rect','tools','footer']) {
        results.geometryComparisons++;
        if (JSON.stringify(oldRail[key]) !== JSON.stringify(newRail[key])) results.failures.push({theme,width,desktop,rail:oldRail.name,key,before:oldRail[key],after:newRail[key]});
      }
      for (let j=0;j<oldRail.buttons.length;j++) {
        const oldButton=oldRail.buttons[j],newButton=newRail.buttons[j];
        for (const key of ['rect','color','mark']) {
          results.geometryComparisons++;
          if (JSON.stringify(oldButton[key]) !== JSON.stringify(newButton[key])) results.failures.push({theme,width,desktop,name:oldButton.name,key,before:oldButton[key],after:newButton[key]});
        }
        const expectedBefore = desktop ? 20 : 28;
        if (oldButton.svg.rect.width !== expectedBefore || newButton.svg.rect.width !== 28) results.failures.push({theme,width,desktop,name:oldButton.name,error:'Unexpected SVG size',before:oldButton.svg.rect,after:newButton.svg.rect});
        if (newButton.svg.fill !== 'none' && newButton.svg.stroke !== 'none') results.failures.push({theme,width,desktop,name:oldButton.name,error:'Added stroke remains on filled icon',svg:newButton.svg});
        if (newButton.svg.fill === 'none' && newButton.svg.strokeWidth !== '1px') results.failures.push({theme,width,desktop,name:oldButton.name,error:'Stroke icon should retain authored 1px width',svg:newButton.svg});
        if (!desktop && JSON.stringify(oldButton.svg) !== JSON.stringify(newButton.svg)) results.failures.push({theme,width,name:oldButton.name,error:'Web SVG changed'});
        if (desktop && newButton.rect.height !== 32) results.failures.push({theme,width,name:oldButton.name,error:'Desktop button height changed'});
      }
    }
  }
  results.passed = results.failures.length === 0;
  results.electron = process.versions.electron;
  results.chromium = process.versions.chrome;
  results.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:results.passed,geometryComparisons:results.geometryComparisons,variants:Object.keys(results.variants).length,failures:results.failures}));
  win.destroy();
  app.exit(results.passed ? 0 : 1);
}).catch(error => {
  results.error = error.stack;
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(results,null,2));
  console.error(error);
  if(win)win.destroy();
  app.exit(1);
});

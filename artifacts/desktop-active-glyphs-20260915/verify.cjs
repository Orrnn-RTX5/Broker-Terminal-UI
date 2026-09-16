// Actual React timeframe component and the source CommandIconButton,
// rendered in an isolated hidden Electron fixture with built application CSS.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rtx-active-glyphs-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let win;
const report = { fixture:true, description:'Actual TimeframePicker and ChartCommandIcon with CommandIconButton definition extracted from TopToolbar. Before variants disable only the new active-fill CSS rule. Local state supplies selection events; no full application, installed package, authentication or network.', passed:false, cases:[], scopeComparisons:0, geometryComparisons:0, fillChecks:0 };
const evaluate = code => win.webContents.executeJavaScript(code, true);
const pause = () => new Promise(resolve => setTimeout(resolve,180));
const until = async code => {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await evaluate(code)) return;
    await new Promise(resolve => setTimeout(resolve,40));
  }
  throw new Error('Fixture not ready: ' + code);
};
const measure = selector => evaluate(`(() => {
  const element=document.querySelector(${JSON.stringify(selector)}),style=getComputedStyle(element),rect=element.getBoundingClientRect(),svg=element.querySelector('svg');
  const svgBounds=svg&&svg.getBoundingClientRect();
  return {rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},font:{family:style.fontFamily,size:style.fontSize,weight:style.fontWeight},background:style.backgroundColor,border:style.borderColor,borderWidth:style.borderWidth,shadow:style.boxShadow,color:style.color,outline:style.outline,checked:element.getAttribute('aria-checked'),pressed:element.getAttribute('aria-pressed'),svgColor:svg&&getComputedStyle(svg).color,svgSize:svgBounds&&{width:svgBounds.width,height:svgBounds.height},activeFill:Array.from(element.querySelectorAll('.rtx-chart-command-icon__active-fill')).map(path=>getComputedStyle(path).fill)};
})()`);
const capture = async name => fs.writeFileSync(path.join(__dirname,`${name}.png`),(await win.webContents.capturePage({x:0,y:0,width:1100,height:170},{stayHidden:true,stayAwake:true})).toPNG());
const selectors = {
  candle: '.rtx-toolbar-icon-button[aria-label="Candlesticks"]',
  line: '.rtx-toolbar-icon-button[aria-label="Line Chart"]',
  bar: '.rtx-toolbar-icon-button[aria-label="Bar Chart"]',
  area: '.rtx-toolbar-icon-button[aria-label="Area Chart"]',
  period: '.rtx-period-separator-toggle',
  other: '.rtx-trade-history-overlay-button',
  timeframe: '.rtx-timeframe-option[aria-checked="true"]',
};
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(); };
const hover = async selector => {
  const value=await measure(selector);
  win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(value.rect.x+value.rect.width/2),y:Math.round(value.rect.y+value.rect.height/2)});
  await pause();
};
const clearHover = async () => { win.webContents.sendInputEvent({type:'mouseMove',x:5,y:350}); await pause(); };
const assertPlain = value => {
  assert.equal(value.background,'rgba(0, 0, 0, 0)');
  assert.equal(value.border,'rgba(0, 0, 0, 0)');
  assert.equal(value.shadow,'none');
};
const assertFill = (value, enabled) => {
  assert.equal(value.activeFill.length,1,'Expected one candle-body fill path');
  assert.equal(value.activeFill[0],enabled?value.svgColor:'none');
  report.fillChecks++;
};
app.whenReady().then(async () => {
  const toolbar=fs.readFileSync(path.join(root,'src/components/layout/TopToolbar.tsx'),'utf8');
  const command=toolbar.slice(toolbar.indexOf('const CommandIconButton ='),toolbar.indexOf('\nconst MT5Btn ='));
  assert(command.includes('<ChartCommandIcon name={icon} />'),'CommandIconButton extraction failed');
  const activeFillRules=[];
  require('postcss').parse(fs.readFileSync(path.join(root,'src/styles/theme.css'),'utf8')).walkRules(rule=>{if(rule.selector.includes('.rtx-chart-command-icon__active-fill'))activeFillRules.push(rule.toString());});
  assert.equal(activeFillRules.length,1);
  fs.writeFileSync(path.join(__dirname,'active-fill-source.css'),activeFillRules[0]);
  await require('esbuild').build({
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { TimeframePicker } from './src/components/layout/TimeframePicker';
      import { ChartCommandIcon } from './src/components/layout/ChartCommandIcon';
      ${command}
      function Fixture() {
        const [chart,setChart]=useState('candlestick');
        const [period,setPeriod]=useState(true);
        const [timeframe,setTimeframe]=useState('M1');
        const [overlay,setOverlay]=useState(true);
        window.resetFixtureControls=()=>{setChart('candlestick');setPeriod(true);setTimeframe('M1');setOverlay(false);};
        return <div className="rtx-desktop-command-row flex items-center">
          <div className="rtx-toolbar-command-cluster flex items-center">
            <div className="rtx-toolbar-group flex items-center" role="radiogroup" aria-label="Chart type">
              <CommandIconButton icon="bar-chart" title="Bar Chart" active={chart==='bar'} selectionRole="radio" onClick={()=>setChart('bar')}/>
              <CommandIconButton icon="candlestick" title="Candlesticks" active={chart==='candlestick'} selectionRole="radio" onClick={()=>setChart('candlestick')}/>
              <CommandIconButton icon="line-chart" title="Line Chart" active={chart==='line'} selectionRole="radio" onClick={()=>setChart('line')}/>
              <CommandIconButton icon="area-chart" title="Area Chart" active={chart==='area'} selectionRole="radio" onClick={()=>setChart('area')}/>
            </div>
            <div className="rtx-toolbar-group flex items-center">
              <CommandIconButton icon="period-separator" className="rtx-period-separator-toggle" title="Period Separators" active={period} onClick={()=>setPeriod(!period)}/>
              <CommandIconButton icon="sliders-horizontal" className="rtx-trade-history-overlay-button" title="Trade History Overlays" active={overlay}/>
            </div>
            <TimeframePicker timeframe={timeframe} advancedViewEnabled={true} onSelect={setTimeframe}/>
          </div>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `},bundle:true,jsx:'automatic',format:'esm',outfile:path.join(__dirname,'component.js'),
    define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},
    plugins:[{name:'fixture-english-copy',setup(build){
      build.onResolve({filter:/useUiTranslation$/},()=>({path:'translation',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
        export const translateUi=(text,values={})=>typeof text==='string'?text.replace(/{{(.*?)}}/g,(_,key)=>values[key]??key):text;
        export const useUiTranslation=()=>translateUi;
      `}));
    }}],
  });
  const assets=fs.readdirSync(path.join(root,'dist/assets'));
  const css=['index-','authenticatedStyles-','App-'].map(prefix=>{
    const name=assets.find(name=>name.startsWith(prefix)&&name.endsWith('.css'));
    assert(name,'Missing CSS '+prefix);return name;
  });
  report.css=css.map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/assets',name))).digest('hex')}));
  // Snapshot styles and their local assets so a concurrent root build can
  // replace dist without changing the fixture halfway through comparisons.
  const snapshot=path.join(__dirname,'css-snapshot');fs.mkdirSync(snapshot,{recursive:true});
  for(const name of css){
    const text=fs.readFileSync(path.join(root,'dist/assets',name),'utf8').replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(match,quote,url)=>{
      if(/^(data:|https?:|#)/.test(url))return match;
      const assetName=path.basename(url.split(/[?#]/)[0]),source=path.join(root,'dist/assets',assetName);
      if(!fs.existsSync(source))return match;
      fs.copyFileSync(source,path.join(snapshot,assetName));return `url("./${assetName}")`;
    });
    fs.writeFileSync(path.join(snapshot,name),text);
  }
  const links=css.map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(snapshot,name)).href}">`).join('');
  const isolated=session.fromPartition(`active-glyphs-${Date.now()}`);
  isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,callback)=>callback({cancel:true}));
  win=new BrowserWindow({width:1100,height:420,show:false,frame:false,useContentSize:true,
    webPreferences:{session:isolated,offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  for(const theme of ['light','dark']) for(const desktop of [true,false]) {
    const variants=[];
    for(const before of [true,false]) {
      const id=`${desktop?'desktop':'web'}-${before?'before':'after'}-${theme}`;
      const fixture=path.join(__dirname,`${id}.html`);
      fs.writeFileSync(fixture,`<!doctype html><html class="rtx-advanced-view${desktop?' rtx-desktop-shell-active':''}${theme==='light'?' rtx-skin-untitled-light':''}" data-theme="${theme}"><head><meta charset="utf-8">${links}<style>html,body{margin:0;background:var(--bg-primary);color:var(--text-primary);font-family:'Segoe UI',sans-serif}header{height:52px;display:flex;align-items:center;padding:0 14px;font-size:14px}#root{width:100%}.rtx-desktop-command-row{width:100%;min-height:40px}</style></head><body><header>NATIVE ELECTRON FIXTURE · ${desktop?'Desktop':'Web scope'} · ${before?'Before':'After'} · ${theme}</header><div id="root"></div><script type="module" src="component.js"></script></body></html>`);
      await win.loadFile(fixture);
      await until(`!!document.querySelector('.rtx-toolbar-icon-button')`);
      await evaluate('document.fonts.ready.then(()=>true)');
      const loadedFillRules=await evaluate(`(() => {let count=0;const scan=sheet=>{for(const rule of sheet.cssRules){if(rule.selectorText?.includes('.rtx-chart-command-icon__active-fill'))count++;else if(rule.cssRules)scan(rule);}};for(const sheet of document.styleSheets)scan(sheet);return count;})()`);
      if(!loadedFillRules){
        await evaluate(`(() => {const style=document.createElement('style');style.textContent=${JSON.stringify(activeFillRules[0])};document.head.append(style);})()`);
        report.styleSource='Existing application build plus exact new active-fill rule extracted from current source';
      }else{
        assert.equal(loadedFillRules,1);
        report.styleSource='Current built application CSS';
      }
      if(before){
        const removed=await evaluate(`(() => {
          let removed=0;
          function clean(sheet){for(let i=sheet.cssRules.length-1;i>=0;i--){const rule=sheet.cssRules[i];if(rule.selectorText?.includes('.rtx-chart-command-icon__active-fill')){sheet.deleteRule(i);removed++;}else if(rule.cssRules)clean(rule);}}
          for(const sheet of document.styleSheets)clean(sheet);
          return removed;
        })()`);
        assert.equal(removed,1,'Expected exactly the new active-fill rule');
      }
      await clearHover();
      const current={id,initial:{},hover:{},alternate:{},chartStates:{},periodOff:null,periodOn:null};
      for(const [name,selector] of Object.entries(selectors))current.initial[name]=await measure(selector);
      assertFill(current.initial.candle,desktop&&!before);
      assertFill(current.initial.period,desktop&&!before);
      for(const name of ['candle','period','bar']){await hover(selectors[name]);current.hover[name]=await measure(selectors[name]);}
      assertFill(current.hover.candle,desktop&&!before);
      assertFill(current.hover.period,desktop&&!before);
      await clearHover();
      await click(selectors.line);
      current.alternate.line=await measure(selectors.line);
      current.alternate.candle=await measure(selectors.candle);
      assertFill(current.alternate.candle,false);
      for(const name of ['bar','line','area','candle']){
        await click(selectors[name]);
        const selected=await measure(selectors[name]);
        const candle=await measure(selectors.candle);
        assert.equal(selected.checked,'true');
        assert.equal(await evaluate(`document.querySelectorAll('.rtx-toolbar-icon-button[role="radio"][aria-checked="true"]').length`),1);
        assertFill(candle,name==='candle'&&desktop&&!before);
        if(name!=='candle')assert.deepEqual(selected.activeFill,[]);
        current.chartStates[name]={selected,candle};
      }
      await click(selectors.period);
      current.periodOff=await measure(selectors.period);
      assertFill(current.periodOff,false);
      await capture(`${id}-period-off`);
      await click(selectors.period);
      current.periodOn=await measure(selectors.period);
      assertFill(current.periodOn,desktop&&!before);
      await click('.rtx-timeframe-option[aria-label="Timeframe: 5 minutes"]');
      current.timeframeAfter=await measure(selectors.timeframe);
      assert.equal(await evaluate(`document.querySelector('.rtx-timeframe-option[aria-checked="true"]').textContent`),'M5');
      assert.notEqual(current.timeframeAfter.border,'rgba(0, 0, 0, 0)','Timeframe must retain visible selection border');
      if(desktop&&!before){
        const accent=await evaluate(`(() => {const el=document.createElement('span');el.style.color='var(--rtx-light-accent, #a78bfa)';document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color;})()`);
        current.activeAccent=accent;
        for(const value of [current.initial.candle,current.initial.period,current.hover.candle,current.hover.period,current.alternate.line]){assertPlain(value);assert.equal(value.color,accent);assert.equal(value.svgColor,accent);}
        for(const value of [current.initial.bar,current.initial.area,current.hover.bar,current.periodOff,current.alternate.candle])assertPlain(value);
        assert.notEqual(current.periodOff.color,accent,'Inactive period icon must not retain active violet');
      }
      await evaluate('window.resetFixtureControls()');
      await until(`document.querySelector('.rtx-toolbar-icon-button[aria-label="Candlesticks"]').getAttribute('aria-checked')==='true'&&document.querySelector('.rtx-timeframe-option[aria-checked="true"]').textContent==='M1'`);
      await clearHover();
      await capture(id);
      variants.push(current);report.cases.push(current);
    }
    const [before,after]=variants;
    for(const name of Object.keys(selectors)){
      assert.deepEqual(before.initial[name].rect,after.initial[name].rect,`Button geometry changed: ${name}`);report.geometryComparisons++;
      assert.deepEqual(before.initial[name].font,after.initial[name].font,`Button font changed: ${name}`);
      if(name!=='timeframe'){assert.equal(after.initial[name].rect.width,32);assert.equal(after.initial[name].rect.height,32);assert.deepEqual(after.initial[name].svgSize,{width:20,height:20});}
      if(!desktop){assert.deepEqual(before.initial[name],after.initial[name],`Web scope changed: ${name}`);report.scopeComparisons++;}
    }
    assert.deepEqual(before.initial.timeframe,after.initial.timeframe,'Initial timeframe selection changed');
    assert.deepEqual(before.timeframeAfter,after.timeframeAfter,'Changed timeframe selection changed');
    assert.deepEqual(before.initial.other,after.initial.other,'Unrelated overlay command changed');
    report.scopeComparisons+=3;
    if(!desktop){assert.deepEqual(before.hover,after.hover,'Web hover changed');assert.deepEqual(before.alternate,after.alternate,'Web alternate state changed');assert.deepEqual(before.periodOff,after.periodOff,'Web period state changed');assert.deepEqual(before.chartStates,after.chartStates,'Web chart selections changed');report.scopeComparisons+=4;}
  }
  report.passed=true;
  report.electron=process.versions.electron;
  report.chromium=process.versions.chrome;
}).catch(error=>{report.error=error.stack;}).finally(()=>{
  report.completedAt=new Date().toISOString();
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,geometryComparisons:report.geometryComparisons,scopeComparisons:report.scopeComparisons,fillChecks:report.fillChecks,styleSource:report.styleSource,error:report.error}));
  if(win)win.destroy();
  app.exit(report.passed?0:1);
});

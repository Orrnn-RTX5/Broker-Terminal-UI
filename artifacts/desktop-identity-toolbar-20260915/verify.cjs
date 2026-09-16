// Actual React account/timeframe components and the source CommandIconButton,
// rendered in an isolated hidden Electron fixture with built application CSS.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rtx-identity-toolbar-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let win;
const report = { fixture:true, description:'Actual DesktopQuickActions, TimeframePicker and ChartCommandIcon with CommandIconButton definition extracted from TopToolbar. Before variants disable only the two new desktop CSS rules; the account component is current in every variant. Local state supplies events and account props; no full application, installed package, authentication or network.', passed:false, cases:[], scopeComparisons:0, geometryComparisons:0 };
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
  return {rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},background:style.backgroundColor,border:style.borderColor,borderWidth:style.borderWidth,shadow:style.boxShadow,color:style.color,outline:style.outline,checked:element.getAttribute('aria-checked'),pressed:element.getAttribute('aria-pressed'),svgColor:svg&&getComputedStyle(svg).color};
})()`);
const capture = async name => fs.writeFileSync(path.join(__dirname,`${name}.png`),(await win.webContents.capturePage({x:0,y:0,width:1100,height:420},{stayHidden:true,stayAwake:true})).toPNG());
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
app.whenReady().then(async () => {
  const toolbar=fs.readFileSync(path.join(root,'src/components/layout/TopToolbar.tsx'),'utf8');
  const command=toolbar.slice(toolbar.indexOf('const CommandIconButton ='),toolbar.indexOf('\nconst MT5Btn ='));
  assert(command.includes('<ChartCommandIcon name={icon} />'),'CommandIconButton extraction failed');
  await require('esbuild').build({
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { DesktopQuickActions } from './src/components/layout/DesktopQuickActions';
      import { TimeframePicker } from './src/components/layout/TimeframePicker';
      import { ChartCommandIcon } from './src/components/layout/ChartCommandIcon';
      ${command}
      window.fixtureAccounts=0; window.fixtureLogouts=0;
      window.addEventListener('toggleAccountPanel',()=>window.fixtureAccounts++);
      function Fixture() {
        const [chart,setChart]=useState('candlestick');
        const [period,setPeriod]=useState(true);
        const [timeframe,setTimeframe]=useState('M1');
        const [overlay,setOverlay]=useState(true);
        const [account,setAccount]=useState({accountId:'200032',accountName:'Raj Halder',accountServer:'https://service.achieverfinancials.com'});
        window.switchFixtureAccount=()=>setAccount({accountId:'300033',accountName:'Alex Rao',accountServer:'https://gateway.second-fixture.invalid',accountBrokerName:'Grow Trading Academy'});
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
          <DesktopQuickActions {...account} savedAccountCount={2} onLogout={()=>window.fixtureLogouts++}/>
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
  const links=css.map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(root,'dist/assets',name)).href}">`).join('');
  const isolated=session.fromPartition(`identity-toolbar-${Date.now()}`);
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
      await until(`!!document.querySelector('.rtx-desktop-account-button')`);
      await evaluate('document.fonts.ready.then(()=>true)');
      if(before){
        const removed=await evaluate(`(() => {
          let removed=0;
          function clean(sheet){for(let i=sheet.cssRules.length-1;i>=0;i--){const rule=sheet.cssRules[i];if(rule.selectorText?.includes('.rtx-desktop-command-row')&&rule.selectorText.includes('.rtx-period-separator-toggle')){sheet.deleteRule(i);removed++;}else if(rule.cssRules)clean(rule);}}
          for(const sheet of document.styleSheets)clean(sheet);
          return removed;
        })()`);
        assert.equal(removed,2,'Expected exactly the two new desktop rules');
      }
      await clearHover();
      const current={id,initial:{},hover:{},alternate:{},periodOff:null,account:null};
      for(const [name,selector] of Object.entries(selectors))current.initial[name]=await measure(selector);
      for(const name of ['candle','period','bar']){await hover(selectors[name]);current.hover[name]=await measure(selectors[name]);}
      await clearHover();
      await click(selectors.line);
      current.alternate.line=await measure(selectors.line);
      current.alternate.candle=await measure(selectors.candle);
      await click(selectors.period);
      current.periodOff=await measure(selectors.period);
      await click(selectors.period);
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
      await click('.rtx-desktop-account-button');
      await until(`!!document.querySelector('.rtx-desktop-quick-menu')`);
      current.account=await evaluate(`(() => {const menu=document.querySelector('.rtx-desktop-quick-menu');const rect=menu.getBoundingClientRect();return {id:menu.querySelector('.rtx-desktop-quick-menu__account-id').textContent,meta:Array.from(menu.querySelectorAll('.rtx-desktop-quick-menu__meta')).map(el=>el.textContent),text:menu.textContent,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},fits:rect.left>=8&&rect.right<=innerWidth-8&&rect.bottom<=innerHeight-8};})()`);
      assert.equal(current.account.id,'200032');
      assert.deepEqual(current.account.meta,['Raj Halder','Achiever Financials']);
      assert(!/https?:\/\//i.test(current.account.text),'Account menu exposed server URL');
      assert(current.account.fits,'Account menu overflow');
      await capture(`${id}-interaction-state`);
      await evaluate('window.resetFixtureControls()');
      await until(`document.querySelector('.rtx-toolbar-icon-button[aria-label="Candlesticks"]').getAttribute('aria-checked')==='true'&&document.querySelector('.rtx-timeframe-option[aria-checked="true"]').textContent==='M1'`);
      await clearHover();
      await capture(id);
      await evaluate('window.switchFixtureAccount()');
      await until(`document.querySelector('.rtx-desktop-quick-menu__account-id').textContent==='300033'`);
      current.switchedMeta=await evaluate(`Array.from(document.querySelectorAll('.rtx-desktop-quick-menu__meta')).map(el=>el.textContent)`);
      assert.deepEqual(current.switchedMeta,['Alex Rao','Grow Trading Academy']);
      await click('.rtx-desktop-quick-menu__item');
      await until(`!document.querySelector('.rtx-desktop-quick-menu')`);
      assert.equal(await evaluate('window.fixtureAccounts'),1);
      await click('.rtx-desktop-account-button');
      await until(`!!document.querySelector('.rtx-desktop-quick-menu')`);
      await click('.rtx-desktop-quick-menu__item--danger');
      await until(`!document.querySelector('.rtx-desktop-quick-menu')`);
      assert.equal(await evaluate('window.fixtureLogouts'),1);
      variants.push(current);report.cases.push(current);
    }
    const [before,after]=variants;
    for(const name of Object.keys(selectors)){
      assert.deepEqual(before.initial[name].rect,after.initial[name].rect,`Button geometry changed: ${name}`);report.geometryComparisons++;
      if(!desktop){assert.deepEqual(before.initial[name],after.initial[name],`Web scope changed: ${name}`);report.scopeComparisons++;}
    }
    assert.deepEqual(before.initial.timeframe,after.initial.timeframe,'Initial timeframe selection changed');
    assert.deepEqual(before.timeframeAfter,after.timeframeAfter,'Changed timeframe selection changed');
    assert.deepEqual(before.initial.other,after.initial.other,'Unrelated overlay command changed');
    report.scopeComparisons+=3;
    if(!desktop){assert.deepEqual(before.hover,after.hover,'Web hover changed');assert.deepEqual(before.alternate,after.alternate,'Web alternate state changed');assert.deepEqual(before.periodOff,after.periodOff,'Web period state changed');report.scopeComparisons+=3;}
  }
  report.passed=true;
  report.electron=process.versions.electron;
  report.chromium=process.versions.chrome;
}).catch(error=>{report.error=error.stack;}).finally(()=>{
  report.completedAt=new Date().toISOString();
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,geometryComparisons:report.geometryComparisons,scopeComparisons:report.scopeComparisons,error:report.error}));
  if(win)win.destroy();
  app.exit(report.passed?0:1);
});

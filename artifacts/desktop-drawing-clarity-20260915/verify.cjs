// Source-icon fixture in an isolated native Electron renderer. Baselines are
// snapshots captured before this change; current styles come from the app build.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Module=require('node:module'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),postcss=require('postcss'),ts=require('typescript');
const {pathToFileURL}=require('node:url');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {ChevronRight}=require('lucide-react');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'rtx-icon-balance-')));
app.commandLine.appendSwitch('force-device-scale-factor','1');
const cache=new Map();
function sourceModule(file){
  if(cache.has(file))return cache.get(file).exports;
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  const instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,instance);
  const nativeRequire=instance.require.bind(instance);
  instance.require=name=>{
    if(name.endsWith('/hooks/useUiTranslation'))return {useUiTranslation:()=>((value,values={})=>typeof value==='string'?value.replace(/{{(.*?)}}/g,(_,key)=>values[key]??key):value)};
    if(name.startsWith('.'))for(const ext of ['.tsx','.ts']){const target=path.resolve(path.dirname(file),`${name}${ext}`);if(fs.existsSync(target))return sourceModule(target);}
    return nativeRequire(name);
  };
  instance._compile(output,file);return instance.exports;
}
const {DrawingRailIcon}=sourceModule(path.join(root,'src/drawing-tools/DrawingRailIcon.tsx'));
const {DRAWING_TOOL_ICONS}=sourceModule(path.join(root,'src/drawing-tools/toolIcons.ts'));
const {ChartCommandIcon}=sourceModule(path.join(root,'src/components/layout/ChartCommandIcon.tsx'));
const {Icon}=sourceModule(path.join(root,'src/components/ui/Icon.tsx'));
const {TimeframePicker}=sourceModule(path.join(root,'src/components/layout/TimeframePicker.tsx'));
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const normalize=value=>value.replace(/[\s'\"]/g,'');
const changedSelectors=[],baselineOverrides=[];
for(const [baseline,current] of [['baseline-rail.css','src/drawing-tools/WebDrawingToolsRail.css'],['baseline-theme.css','src/styles/theme.css']]){
  const oldRules=new Map(),oldCounts=new Map(),newCounts=new Map();
  const ruleKey=(rule,counts)=>{const parents=[];for(let parent=rule.parent;parent&&parent.type!=='root';parent=parent.parent)parents.push(parent.name+':'+parent.params);const base=normalize(rule.selector)+'|'+parents.join('|'),count=counts.get(base)||0;counts.set(base,count+1);return base+'|'+count;};
  postcss.parse(fs.readFileSync(path.join(__dirname,baseline),'utf8')).walkRules(rule=>oldRules.set(ruleKey(rule,oldCounts),rule));
  postcss.parse(fs.readFileSync(path.join(root,current),'utf8')).walkRules(rule=>{
    const old=oldRules.get(ruleKey(rule,newCounts));
    if(!old||normalize(old.toString())!==normalize(rule.toString())){changedSelectors.push(normalize(rule.selector));if(old)baselineOverrides.push(old.toString());}
  });
}
assert.equal(changedSelectors.length,1,'Expected only the new filled drawing icon stroke rule');
fs.writeFileSync(path.join(__dirname,'baseline-overrides.css'),baselineOverrides.join('\n'));
const assets=fs.readdirSync(path.join(root,'dist/assets'));
const css=['index-','authenticatedStyles-','App-'].map(prefix=>{const name=assets.find(name=>name.startsWith(prefix)&&name.endsWith('.css'));assert(name,'Missing built CSS '+prefix);return name;});
const report={fixture:true,description:'Actual DrawingRailIcon, ChartCommandIcon, Icon and TimeframePicker source rendered with source-matching toolbar wrappers and current built CSS. Before disables only the new filled drawing icon stroke rule, compared with pre-edit snapshots. No installed application, account session or network.',passed:false,cases:[],geometryComparisons:0,fontComparisons:0,scopeComparisons:0,changedSelectors,css:css.map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/assets',name))).digest('hex')}))};
const drawingNames=['trendline','fibonacci','patterns','forecast','brush','text','stamps','trade-stamps','measure','magnet','unlock','eye'];
const flyout=render(ChevronRight,{className:'web-drawing-tools-rail__flyout-mark','aria-hidden':true,size:7});
function drawingButton(name){return `<button type="button" class="web-drawing-tools-rail__button web-drawing-tools-rail__flyout-button" data-button="drawing.${name}" aria-label="${name}" data-active="false">${name==='alternate-ray'?render(DRAWING_TOOL_ICONS.ray,{size:28,strokeWidth:1,'aria-hidden':true}):render(DrawingRailIcon,{name})}${flyout}</button>`;}
function rail(desktop,states=false){
  const names=states?['lock','eye-off','alternate-ray']:desktop?drawingNames:[...drawingNames.slice(0,9),'zoom','magnet','keep-drawing','unlock','eye'];
  return `<aside class="web-drawing-tools-rail" data-orientation="${desktop?'horizontal':'vertical'}" data-expanded="true" data-geometry="${states?'states.rail':'rail'}" role="toolbar"><div class="web-drawing-tools-rail__tools" data-geometry="${states?'states.tools':'drawing-tools'}">${names.map(name=>drawingButton(name)).join('')}</div><div class="web-drawing-tools-rail__footer" data-geometry="${states?'states.footer':'drawing-footer'}">${drawingButton('trash')}</div></aside>`;
}
function command(name,label,active=false,radio=false){return `<button type="button" class="rtx-toolbar-icon-button${name==='period-separator'?' rtx-period-separator-toggle':''}" data-button="command.${name}" aria-label="${label}" ${radio?`role="radio" aria-checked="${active}"`:`aria-pressed="${active}"`}>${render(ChartCommandIcon,{name})}</button>`;}
function group(contents){return `<div class="rtx-toolbar-group flex items-center">${contents}</div>`;}
function commands(){return `<div class="rtx-toolbar-command-cluster flex shrink-0 items-center" data-geometry="command-cluster" role="toolbar">${group(`<button type="button" class="rtx-toolbar-action rtx-toolbar-action--primary text-[13px] font-normal font-segoe" data-button="new-order"><span class="rtx-toolbar-action__icon" aria-hidden="true">${render(Icon,{name:'new-order',size:20})}</span><span class="rtx-toolbar-action__label" data-text="new-order">New Order</span></button><button type="button" class="rtx-toolbar-action rtx-toolbar-action--last-symbol text-[13px] font-normal font-segoe" data-button="last-symbol"><span class="rtx-toolbar-action__icon" aria-hidden="true">${render(Icon,{name:'activity',size:20})}</span><span class="rtx-toolbar-action__label" data-text="last-symbol">Last Symbol</span></button>`)}${group(['bar-chart','candlestick','line-chart','area-chart'].map(name=>command(name,name,name==='candlestick',true)).join(''))}${group(['zoom-in','zoom-out','grid','refresh','chart-shift','indicator-list'].map(name=>command(name,name)).join(''))}${group(['camera','period-separator','sliders-horizontal'].map(name=>command(name,name,name==='period-separator')).join(''))}${render(TimeframePicker,{timeframe:'M1',advancedViewEnabled:true,onSelect:()=>{}})}</div>`;}
function html({desktop,before,theme}){
  const links=css.map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(root,'dist/assets',name)).href}">`).join('');
  const commandRow=desktop?`<div class="rtx-desktop-command-row flex h-[32px] min-w-0 w-full shrink-0 items-center overflow-hidden" data-geometry="row"><div class="rtx-desktop-command-scroll rtx-chart-toolbar-scroll flex min-w-0 flex-1 self-stretch items-center overflow-x-auto px-1" data-geometry="command-scroll">${commands()}<div class="min-w-[24px] flex-1 self-stretch"></div></div><button class="rtx-desktop-quick-button rtx-desktop-symbol-search" data-button="search">${render(Icon,{name:'search',size:20})}</button><div class="rtx-desktop-inline-drawings" data-geometry="inline-drawings">${rail(true)}</div><div class="rtx-desktop-command-actions ml-auto flex h-full shrink-0 items-center"><button class="rtx-desktop-quick-button" data-button="account">${render(Icon,{name:'user',size:20})}</button></div></div>`:`<div class="rtx-chart-toolbar-scroll flex min-w-0 self-stretch items-center overflow-x-auto px-1.5" data-geometry="row">${commands()}</div><div style="height:610px">${rail(false)}</div>`;
  return `<!doctype html><html class="rtx-advanced-view${desktop?' rtx-desktop-shell-active':''}${theme==='light'?' rtx-skin-untitled-light':''}" data-theme="${theme}"><head><meta charset="utf-8">${links}<style>html,body,#root{margin:0;height:100%;overflow:hidden}body{background:var(--bg-primary);color:var(--text-primary)}header{height:52px;display:flex;align-items:center;padding:0 14px;font:14px 'Segoe UI',sans-serif}[data-state-label]{margin:24px 14px 8px;font:13px 'Segoe UI',sans-serif}[data-state-stage]{width:270px;margin-left:14px}</style></head><body><div id="root"><div class="${desktop?'rtx-desktop-shell':''}"><div class="rtx-app-shell"><header>NATIVE ELECTRON FIXTURE · ${desktop?'Desktop':'Web'} · ${before?'Before':'After'} · ${theme}</header>${commandRow}${desktop?`<div data-state-label>Stroke-based lock, hidden and alternate Ray glyphs</div><div class="rtx-desktop-command-row" data-state-stage><div class="rtx-desktop-inline-drawings">${rail(true,true)}</div></div>`:''}</div></div></div></body></html>`;
}
const read=`(() => {
  const rect=node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height};};
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
  const rgbColor=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const pixel=context.getImageData(0,0,1,1).data;return 'rgb('+pixel[0]+', '+pixel[1]+', '+pixel[2]+')';};
  const geometry=Object.fromEntries(Array.from(document.querySelectorAll('[data-geometry]')).map(node=>[node.dataset.geometry,{rect:rect(node),scrollWidth:node.scrollWidth,gap:getComputedStyle(node).gap}]));
  const buttons=Array.from(document.querySelectorAll('[data-button],.rtx-timeframe-option')).map((node,index)=>{
    const style=getComputedStyle(node),svg=node.querySelector('svg:not(.web-drawing-tools-rail__flyout-mark)'),svgStyle=svg&&getComputedStyle(svg),mark=node.querySelector('.web-drawing-tools-rail__flyout-mark');
    return {name:node.dataset.button||'timeframe.'+node.textContent,index,rect:rect(node),font:{family:style.fontFamily,size:style.fontSize,weight:style.fontWeight},color:style.color,background:style.backgroundColor,border:style.borderColor,shadow:style.boxShadow,svg:svg&&{rect:rect(svg),color:svgStyle.color,rgbColor:rgbColor(svgStyle.color),fill:svgStyle.fill,stroke:svgStyle.stroke,strokeWidth:svgStyle.strokeWidth,strokeLinejoin:svgStyle.strokeLinejoin},mark:mark&&rect(mark)};
  });
  const text=Object.fromEntries(Array.from(document.querySelectorAll('[data-text]')).map(node=>{const style=getComputedStyle(node);return[node.dataset.text,{rect:rect(node),family:style.fontFamily,size:style.fontSize,weight:style.fontWeight,color:style.color}];}));
  const row=document.querySelector('[data-geometry="row"]');
  return {geometry,buttons,text,rowBackground:getComputedStyle(row).backgroundColor};
})()`;
function contrast(color,background){const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(channel=>{const n=channel/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=luminance(color),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
let win;
app.whenReady().then(async()=>{
  const isolated=session.fromPartition(`icon-balance-${Date.now()}`);
  isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,callback)=>callback({cancel:true}));
  win=new BrowserWindow({width:1920,height:760,useContentSize:true,show:false,frame:false,webPreferences:{session:isolated,offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  for(const theme of ['light','dark'])for(const width of [1920,1280])for(const desktop of [true,false]){
    const variants=[];
    for(const before of [true,false]){
      const id=`${desktop?'desktop':'web'}-${before?'before':'after'}-${theme}-${width}`;
      const file=path.join(__dirname,`${id}.html`);fs.writeFileSync(file,html({desktop,before,theme}));win.setContentSize(width,760);await win.loadFile(file);
      if(before){
        const removed=await win.webContents.executeJavaScript(`(() => {const targets=new Set(${JSON.stringify(changedSelectors)});let removed=0;const clean=sheet=>{for(let i=sheet.cssRules.length-1;i>=0;i--){const rule=sheet.cssRules[i];if(rule.selectorText&&targets.has(rule.selectorText.replace(/[\\s'\"]/g,''))){sheet.deleteRule(i);removed++;}else if(rule.cssRules)clean(rule);}};for(const sheet of document.styleSheets)clean(sheet);const style=document.createElement('style');style.textContent=${JSON.stringify(baselineOverrides.join('\n'))};document.head.append(style);return removed;})()`);
        assert.equal(removed,1,'Expected only the new filled drawing icon stroke rule to restore baseline');
      }
      await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
      const values=await win.webContents.executeJavaScript(read);report.cases.push({id,...values});variants.push(values);
      fs.writeFileSync(path.join(__dirname,`${id}.png`),(await win.webContents.capturePage({x:0,y:0,width:desktop?width:Math.min(width,1280),height:desktop?220:745},{stayHidden:true,stayAwake:true})).toPNG());
    }
    const [before,after]=variants;assert.deepEqual(before.geometry,after.geometry,'Toolbar geometry changed');report.geometryComparisons+=Object.keys(before.geometry).length;
    assert.deepEqual(before.text,after.text,'Toolbar label styles changed');report.fontComparisons+=Object.keys(before.text).length;
    for(let i=0;i<before.buttons.length;i++){
      const old=before.buttons[i],current=after.buttons[i];assert.deepEqual(old.rect,current.rect,`Button geometry changed: ${current.name}`);report.geometryComparisons++;
      assert.deepEqual(old.font,current.font,`Button font changed: ${current.name}`);report.fontComparisons++;
      assert.deepEqual(old.mark,current.mark,`Flyout marker changed: ${current.name}`);
      assert.equal(old.color,current.color,`Button color changed: ${current.name}`);
      if(current.name.startsWith('drawing.')){
        assert.equal(old.svg.rect.width,desktop?20:28);assert.deepEqual(old.svg.rect,current.svg.rect);
        if(current.svg.fill==='none'){
          assert.equal(current.svg.strokeWidth,desktop?'1.5px':'1px');assert.deepEqual(old.svg,current.svg,'Stroke-based icon changed');report.scopeComparisons++;
        }else{
          assert.equal(old.svg.stroke,'none');
          if(desktop){assert.equal(current.svg.stroke,current.svg.color);assert.equal(current.svg.strokeWidth,'0.5px');assert.equal(current.svg.strokeLinejoin,'round');}
          else assert.equal(current.svg.stroke,'none','Web filled icon acquired a stroke');
        }
      }else if(current.svg){assert.equal(current.svg.rect.width,20);if(current.name!=='new-order'){assert.deepEqual(old.svg,current.svg,`Other icon changed: ${current.name}`);report.scopeComparisons++;}}
      if(!desktop){assert.deepEqual(old,current,`Web button changed: ${current.name}`);report.scopeComparisons++;}
      if(current.name==='command.candlestick'||current.name==='command.period-separator'){
        assert.deepEqual({color:old.color,background:old.background,border:old.border,shadow:old.shadow},{color:current.color,background:current.background,border:current.border,shadow:current.shadow},'Selected chart control styling changed');
        if(desktop){assert.equal(current.background,'rgba(0, 0, 0, 0)');assert.equal(current.border,'rgba(0, 0, 0, 0)');assert.equal(current.shadow,'none');}
      }
      if(current.name==='timeframe.M1'){assert.notEqual(current.border,'rgba(0, 0, 0, 0)');assert.deepEqual(old,current,'Timeframe selection changed');report.scopeComparisons++;}
    }
    const oldOrder=before.buttons.find(button=>button.name==='new-order'),newOrder=after.buttons.find(button=>button.name==='new-order');
    if(desktop&&theme==='light')assert.equal(newOrder.svg.color,'rgb(29, 78, 216)');else assert.equal(newOrder.svg.color,oldOrder.svg.color,'Dark or web New Order color changed');
    assert.deepEqual(oldOrder.svg.rect,newOrder.svg.rect);assert.equal(oldOrder.svg.strokeWidth,newOrder.svg.strokeWidth);
    assert.deepEqual(oldOrder.svg,newOrder.svg,'New Order icon changed');
    if(desktop&&theme==='light'){const oldContrast=contrast(oldOrder.svg.rgbColor,after.rowBackground),newContrast=contrast(newOrder.svg.rgbColor,after.rowBackground);assert.equal(newContrast,oldContrast);report.newOrderContrast={background:after.rowBackground,before:oldContrast,after:newContrast};}
  }
  report.passed=true;report.electron=process.versions.electron;report.chromium=process.versions.chrome;
}).catch(error=>{report.error=error.stack;}).finally(()=>{
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,geometryComparisons:report.geometryComparisons,fontComparisons:report.fontComparisons,scopeComparisons:report.scopeComparisons,newOrderContrast:report.newOrderContrast,error:report.error}));if(win)win.destroy();app.exit(report.passed?0:1);
});

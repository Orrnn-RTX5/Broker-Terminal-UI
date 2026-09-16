// Actual FileMenu -> OpenAccountDialog components, isolated local service mocks.
// Native HTTP/WebSocket requests are blocked; no account is created or connected.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'rtx-account-wizard-')));
app.commandLine.appendSwitch('force-device-scale-factor','1');
const report={fixture:true,description:'Actual FileMenu and OpenAccountDialog/CountryCombobox in hidden native Electron. Broker discovery, account creation, authentication and app stores are local mocks; all native network requests are blocked. All personal details and account data are fictitious.',passed:false,cases:[],blockedNetwork:[]};
const stubs={
  translation:`export const translateUi=(text,values={})=>typeof text==='string'?text.replace(/{{(.*?)}}/g,(_,key)=>values[key]??key):text;export const useUiTranslation=()=>translateUi;`,
  i18n:`const labels={'menu.file.newChart':'New Chart','menu.file.openDeleted':'Open Deleted','menu.file.profiles':'Profiles','menu.file.close':'Close','menu.file.save':'Save','menu.file.saveAsPicture':'Save as Picture','menu.file.openDataFolder':'Open Data Folder','menu.file.print':'Print','menu.file.printPreview':'Print Preview','menu.file.printSetup':'Print Setup','menu.file.openAccount':'Open an Account','menu.file.loginTrade':'Login to Trade Account','menu.file.loginWeb':'Login to Web Trader','menu.file.loginMql5':'Login to MQL5','menu.file.exit':'Exit'};export const useTranslation=()=>({t:key=>labels[key]||key,i18n:{language:'en',resolvedLanguage:'en'}});`,
  trade:`export const tradeApi={account:{create:async(request,options)=>{window.fixtureCalls.create.push({request,options});return {account:{login:900101,currency:request.currency,leverage:request.leverage,balance:10000,group:'fixture-demo',server:'Fixture server'}};}},auth:{login:async(request,options)=>{window.fixtureCalls.login.push({username:request.username,broker_id:request.broker_id,options});return {access_token:'fixture-token-not-valid',account_login:Number(request.username),user:{username:'Fixture Account Holder'}};}}};`,
  client:`export const parseTokenExpiresAt=()=>1900000000000;`,
  config:`export const BROKER_DISCOVERY_URL='https://directory.fixture.invalid';export const normalizeBrokerServerUrl=value=>value.endsWith('/')?value.slice(0,-1):value;export const updateDynamicUrls=()=>{};`,
  target:`export const normalizeBrokerInfoForTarget=broker=>broker;export const resolveBrokerBackendUrl=broker=>broker.backend_url||broker.server_url||broker.server||'';export const resolveBrokerExtApiUrl=broker=>broker.market_api_url||broker.backend_url||broker.server_url||broker.server||'';`,
  session:`export const persistBrokerSessionDiscovery=value=>window.fixtureCalls.persisted.push({broker_id:value.broker_id,server_url:value.server_url});`,
  store:`const state={isAuthenticated:false,selectedSymbol:'EURUSD',timeframe:'M1',setAuthTokens:()=>{},setAuthenticated:(authenticated,accountId)=>window.fixtureCalls.auth.push({authenticated,accountId}),logout:()=>{}};export const useAppStore=selector=>selector(state);useAppStore.getState=()=>state;`,
  dock:`const state={recentlyClosedCharts:[],closeActiveChart:()=>{},restoreClosedChart:()=>false};export const useDockLayoutStore=selector=>selector(state);useDockLayoutStore.getState=()=>state;`,
  releaseHook:`export const useDesktopRelease=()=>({release:null,status:'idle'});`,
  release:`export const getDesktopReleaseButtonTitle=()=>'';export const getDesktopReleaseVersionLabel=()=>'';export const openDesktopReleaseDownload=()=>{};`,
  profiles:`export const listWorkspaceProfiles=()=>[];export const restoreWorkspaceProfile=()=>{};export const saveCurrentWorkspaceProfile=()=>{};`,
  shortcuts:`export const getTerminalShortcutHint=()=>'';`,
  activeChart:`export const getActiveChartSource=()=>null;`,
  printer:`export const chartPrinter={getPreferences:()=>({}),setPreferences:()=>{},captureActiveChartData:async()=>null,printChart:async()=>{}};`,
  api:`export default {market:{getSymbols:async()=>[]}};`,
};
const mappings=[
  [/useUiTranslation$/,'translation'],[/^react-i18next$/,'i18n'],[/\/api\/trade$/,'trade'],[/\/api\/client$/,'client'],
  [/\/config\/api$/,'config'],[/\/config\/backendTarget\.js$/,'target'],[/\/services\/brokerSession$/,'session'],
  [/\/store\/useAppStore$/,'store'],[/\/store\/useDockLayoutStore$/,'dock'],[/\/hooks\/useDesktopRelease$/,'releaseHook'],
  [/\/services\/desktopRelease$/,'release'],[/\/services\/localWorkspaceProfiles$/,'profiles'],[/\/services\/shortcutCatalog$/,'shortcuts'],
  [/\/services\/activeChartSource$/,'activeChart'],[/\/services\/chartPrinter$/,'printer'],[/\/services\/api$/,'api'],
];
let win;
const evaluate=code=>win.webContents.executeJavaScript(code,true);
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
async function until(code){const end=Date.now()+10000;while(Date.now()<end){if(await evaluate(code))return;await pause();}throw new Error('Fixture not ready: '+code);}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause();}
async function footer(label){await evaluate(`(() => {const button=Array.from(document.querySelectorAll('.rtx-account-footer button')).find(button=>button.textContent.includes(${JSON.stringify(label)}));if(!button)throw new Error('Footer button missing: '+${JSON.stringify(label)});button.click();})()`);await pause();}
const fieldSelector=label=>label==='Country'?'.rtx-country-combobox input':`[aria-label="${label}"]`;
async function input(label,value){await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(fieldSelector(label))});if(!input)throw new Error('Input missing: '+${JSON.stringify(label)});const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause();}
async function value(label){return evaluate(`document.querySelector(${JSON.stringify(fieldSelector(label))}).value`);}
async function capture(name,crop){await pause();fs.writeFileSync(path.join(__dirname,`${name}.png`),(await win.webContents.capturePage(crop,{stayHidden:true,stayAwake:true})).toPNG());}
async function assertDialogFits(){const values=await evaluate(`(() => {const dialog=document.querySelector('.rtx-open-account-dialog');const rect=dialog.getBoundingClientRect();const footer=dialog.querySelector('.rtx-account-footer').getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,footerBottom:footer.bottom};})()`);assert(values.left>=0&&values.right<=values.viewportWidth&&values.top>=0&&values.bottom<=values.viewportHeight&&values.footerBottom<=values.viewportHeight,JSON.stringify(values));return values;}
app.whenReady().then(async()=>{
  await require('esbuild').build({entryPoints:[path.join(__dirname,'fixture.tsx')],bundle:true,jsx:'automatic',format:'esm',outfile:path.join(__dirname,'component.js'),
    define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},loader:{'.css':'empty'},
    plugins:[{name:'isolated-services',setup(build){
      for(const [filter,name] of mappings)build.onResolve({filter},()=>({path:name,namespace:'fixture'}));
      build.onResolve({filter:/(SaveWorkspaceDialog|PrintSetupDialog|PrintPreviewDialog|ExitConfirmDialog|SavePictureDialog|NewChartSymbolMenu)$/},args=>({path:'component:'+args.path.split('/').pop(),namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.startsWith('component:')?`export const ${args.path.slice(10)}=()=>null;`:stubs[args.path],loader:'js'}));
    }}],
  });
  const assets=fs.readdirSync(path.join(root,'dist/assets'));
  const css=['index-','authenticatedStyles-','App-'].map(prefix=>{const name=assets.find(name=>name.startsWith(prefix)&&name.endsWith('.css'));assert(name,'Missing built CSS '+prefix);return name;});
  report.css=css.map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/assets',name))).digest('hex')}));
  const snapshot=path.join(__dirname,'css-snapshot');fs.mkdirSync(snapshot,{recursive:true});
  for(const name of css){const text=fs.readFileSync(path.join(root,'dist/assets',name),'utf8').replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(match,quote,url)=>{if(/^(data:|https?:|#)/.test(url))return match;const assetName=path.basename(url.split(/[?#]/)[0]),source=path.join(root,'dist/assets',assetName);if(!fs.existsSync(source))return match;fs.copyFileSync(source,path.join(snapshot,assetName));return `url("./${assetName}")`;});fs.writeFileSync(path.join(snapshot,name),text);}
  let links=css.map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(snapshot,name)).href}">`).join('');
  const builtStyles=css.map(name=>fs.readFileSync(path.join(snapshot,name),'utf8')).join('\n');
  if(process.argv.includes('--source-styles')||!builtStyles.includes('.rtx-account-progress')||!builtStyles.includes('.rtx-country-combobox__list')){
    const sources=['src/components/dialogs/open-account-dialog.css','src/components/dialogs/CountryCombobox.css','src/components/layout/file-menu-desktop.css'];
    fs.writeFileSync(path.join(__dirname,'current-component-styles.css'),sources.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n'));
    links+='<link rel="stylesheet" href="current-component-styles.css">';
    report.styleSource='Existing application CSS plus exact current wizard, CountryCombobox and FileMenu source styles';
  }else report.styleSource='Current built application CSS';
  const isolated=session.fromPartition(`account-wizard-${Date.now()}`);
  isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(details,callback)=>{report.blockedNetwork.push(details.url);callback({cancel:true});});
  win=new BrowserWindow({width:1000,height:760,useContentSize:true,show:false,frame:false,webPreferences:{session:isolated,offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',(_event,...details)=>console.error(...details));
  for(const settings of [{theme:'light',width:1000,height:760,count:2},{theme:'dark',width:1000,height:760,count:1},{theme:'light',width:800,height:430,count:2}]){
    const id=`${settings.theme}-${settings.width}x${settings.height}-${settings.count}-brokers`;
    const current={id,steps:{}};
    win.setContentSize(settings.width,settings.height);
    const file=path.join(__dirname,`${id}.html`);
    fs.writeFileSync(file,`<!doctype html><html class="rtx-desktop-shell-active rtx-advanced-view${settings.theme==='light'?' rtx-skin-untitled-light':''}" data-theme="${settings.theme}"><head><meta charset="utf-8">${links}<style>html,body{margin:0;width:100%;height:100%;background:var(--bg-primary);color:var(--text-primary);font-family:'Segoe UI',sans-serif}header{height:40px;display:flex;align-items:center;padding:0 12px;font-size:13px}#root{width:290px;margin-left:12px}</style></head><body><header>NATIVE ELECTRON FIXTURE · Fictitious data · Network blocked</header><div id="root"></div><script>window.fixtureConfig=${JSON.stringify(settings)};</script><script type="module" src="component.js"></script></body></html>`);
    await win.loadFile(file);await until(`!!document.querySelector('.rtx-file-menu__logout')`);await evaluate('document.fonts.ready.then(()=>true)');
    current.logout=await evaluate(`(() => {const button=document.querySelector('.rtx-file-menu__logout');const style=getComputedStyle(button);return{text:button.textContent.trim(),icons:button.querySelectorAll('svg').length,border:style.borderColor,borderWidth:style.borderWidth,width:button.getBoundingClientRect().width};})()`);
    assert.equal(current.logout.text,'Log Out');assert.equal(current.logout.icons,0);assert.notEqual(current.logout.border,'rgba(0, 0, 0, 0)');
    if(settings.height>500)await capture(`${id}-file-menu`,{x:0,y:0,width:340,height:Math.min(settings.height,720)});
    await click('button[title="Register new trading account"]');
    await until(`document.querySelectorAll('.rtx-open-account-dialog__broker').length===${settings.count}`);
    current.steps.broker=await assertDialogFits();await capture(`${id}-step-0-brokers`);
    if(settings.count===2)await evaluate(`Array.from(document.querySelectorAll('.rtx-open-account-dialog__broker')).find(button=>button.textContent.includes('Sample Trading Group')).click()`);
    await footer('Next');await until(`!!document.querySelector('[aria-label="Demo account"]')`);
    await footer('Next');await until(`!!document.querySelector('[aria-label="First name"]')`);
    current.steps.details=await assertDialogFits();assert.equal(await value('First name'),'');
    await footer('Next');await until(`document.querySelector('[role="alert"]')?.textContent.includes('First name and last name')`);
    assert.equal(await evaluate('window.fixtureCalls.create.length'),0);
    await input('First name','Casey');await input('Last name','Example');await input('Email','not-an-email');
    await footer('Next');await until(`document.querySelector('[role="alert"]')?.textContent.includes('valid email')`);
    await input('Email','casey@example.test');await input('Mobile phone','+1 202 555 0123');
    await evaluate(`document.querySelector('.rtx-country-combobox input').scrollIntoView({block:'center'})`);
    await input('Country','');
    await until(`!!document.querySelector('[role="listbox"]')`);
    current.countryList=await evaluate(`(() => {const list=document.querySelector('[role="listbox"]');const r=list.getBoundingClientRect();const options=Array.from(list.querySelectorAll('[role="option"]'));const visible=options.filter(option=>{const q=option.getBoundingClientRect();return q.top>=r.top&&q.bottom<=r.bottom;});return{rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},optionCount:options.length,visibleCount:visible.length,hitTest:visible.slice(0,1).every(option=>{const q=option.getBoundingClientRect();return option.contains(document.elementFromPoint(q.left+q.width/2,q.top+q.height/2));})};})()`);
    const list=current.countryList;assert(list.rect.left>=0&&list.rect.right<=list.viewport.width&&list.rect.top>=0&&list.rect.bottom<=list.viewport.height,JSON.stringify(list));assert(list.optionCount>100&&list.visibleCount>0&&list.hitTest,JSON.stringify(list));
    await capture(`${id}-country-list`);
    await input('Country','No such country');
    await footer('Next');await until(`document.querySelector('.rtx-country-combobox input')?.getAttribute('aria-invalid')==='true'`);
    await evaluate(`document.querySelector('.rtx-country-combobox input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    current.invalidCountry=await evaluate(`(() => {const input=document.querySelector('.rtx-country-combobox input');const probe=document.createElement('span');probe.style.borderColor='var(--color-loss)';document.body.append(probe);const expected=getComputedStyle(probe).borderColor;probe.remove();return{border:getComputedStyle(input).borderColor,expected,error:document.querySelector('.rtx-country-combobox__error')?.textContent};})()`);
    assert.equal(current.invalidCountry.border,current.invalidCountry.expected,'Invalid country border should show the error color');
    assert.equal(current.invalidCountry.error,'Select a country from the list.');
    await capture(`${id}-country-validation`);
    await input('Country','Ind');await until(`!!document.querySelector('[role="option"][aria-label="India"]')`);
    current.countrySearch=await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).map(option=>option.textContent.trim())`);
    await click('[role="option"][aria-label="India"]');
    await until(`!document.querySelector('[role="listbox"]')`);assert((await value('Country')).includes('India'));
    await capture(`${id}-step-2-details`);
    await footer('Next');await until(`!!document.querySelector('[aria-label="Currency"]')`);
    current.steps.settings=await assertDialogFits();await input('Currency','EUR');await input('Leverage','200');
    await footer('Create Demo Account');await until(`document.querySelector('[role="alert"]')?.textContent.includes('Accept the terms')`);assert.equal(await evaluate('window.fixtureCalls.create.length'),0);
    await footer('Back');await until(`!!document.querySelector('[aria-label="First name"]')`);
    assert.equal(await value('First name'),'Casey');assert.equal(await value('Last name'),'Example');assert.equal(await value('Email'),'casey@example.test');assert.equal(await value('Mobile phone'),'+1 202 555 0123');assert((await value('Country')).includes('India'));
    await footer('Next');await until(`!!document.querySelector('[aria-label="Currency"]')`);assert.equal(await value('Currency'),'EUR');assert.equal(await value('Leverage'),'200');
    await click('[aria-label="Accept account terms"]');await capture(`${id}-step-3-settings`);
    await footer('Create Demo Account');await until(`window.fixtureCalls.create.length===1&&document.querySelector('.rtx-open-account-dialog')?.textContent.includes('900101')`);
    current.mockCalls=await evaluate('window.fixtureCalls');
    assert.deepEqual(current.mockCalls.create[0].request,{name:'Casey Example',email:'casey@example.test',phone:'+1 202 555 0123',country:'IN',currency:'EUR',leverage:200});
    assert.equal(current.mockCalls.create[0].options.baseUrl,`https://${settings.count===2?'two':'one'}-api.fixture.invalid/api/v2`);assert.equal(current.mockCalls.create[0].options.skipDynamicUrl,true);assert.equal(current.mockCalls.login.length,0);
    await capture(`${id}-step-4-mock-success`);report.cases.push(current);
  }
  report.passed=true;report.electron=process.versions.electron;report.chromium=process.versions.chrome;
}).catch(error=>{report.error=error.stack;}).finally(()=>{
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,blockedNetwork:report.blockedNetwork,error:report.error}));if(win)win.destroy();app.exit(report.passed?0:1);
});

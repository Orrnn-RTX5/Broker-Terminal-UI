import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const page=(await browser.pages()).find(p=>p.url().startsWith('file:'));
 await page.waitForSelector('.rtx-chart-symbol-trigger');
 await page.evaluate(async()=>{if(!await window.electron.window.isMaximized())window.electron.window.maximize();});
 const toolbar=await page.evaluate(()=>{
  const rail=document.querySelector('.rtx-desktop-inline-drawings');
  const zoom=[...rail.querySelectorAll('button')].filter(b=>/Zoom (In|Out)/i.test(b.getAttribute('aria-label')||''));
  const order=document.querySelector('.rtx-toolbar-action--primary svg').getBoundingClientRect();
  const search=document.querySelector('#rtxMarketWatchSymbolSearch').parentElement.querySelector('svg').getBoundingClientRect();
  return {zoom:zoom.length,alignment:Math.abs(order.x+order.width/2-search.x-search.width/2)};
 });
 assert.equal(toolbar.zoom,0);assert.ok(toolbar.alignment<=1.5,JSON.stringify(toolbar));
 await page.click('.rtx-trade-history-overlay-button');
 await page.waitForSelector('.rtx-history-overlay-menu');
 const colors=await page.evaluate(()=>{
  const menu=getComputedStyle(document.querySelector('.rtx-history-overlay-menu'));
  const app=getComputedStyle(document.querySelector('.web-drawing-tools-rail'));
  const probe=document.createElement('div');probe.style.background='var(--bg-secondary)';document.body.append(probe);
  const expected=getComputedStyle(probe).backgroundColor;probe.remove();
  return {menu:menu.backgroundColor,expected};
 });
 assert.equal(colors.menu,colors.expected);
 await page.screenshot({path:'tmp/desktop-history-popup-fixed.png'});
 await page.click('.rtx-trade-history-overlay-button');
 const read=()=>page.$$eval('.rtx-chart-symbol-trigger',bs=>bs.map(b=>({context:b.closest('[data-chart-context-id]').dataset.chartContextId,symbol:b.textContent.trim()})));
 const before=await read();
 assert.ok(before.length>=2,'Existing multi-chart layout required for pane isolation check');
 const target=before[1];
 const trigger=`[data-chart-context-id="${target.context}"] .rtx-chart-symbol-trigger`;
 await page.click(trigger);
 await page.waitForSelector('.rtx-chart-symbol-dropdown');
 const choice=await page.$$eval('.rtx-chart-symbol-dropdown [role=option]',(bs,current)=>bs.map(b=>b.textContent.trim()).find(s=>s!==current),target.symbol);
 assert.ok(choice);
 await page.screenshot({path:'tmp/desktop-chart-symbol-dropdown-fixed.png'});
 await page.evaluate(choice=>[...document.querySelectorAll('.rtx-chart-symbol-dropdown [role=option]')].find(b=>b.textContent.trim()===choice).click(),choice);
 await page.waitForFunction((ctx,symbol)=>[...document.querySelectorAll('.rtx-chart-symbol-trigger')].some(b=>b.closest('[data-chart-context-id]').dataset.chartContextId===ctx&&b.textContent.trim()===symbol),{},target.context,choice);
 const after=await read();
 assert.equal(after.length,before.length);
 for(const original of before)if(original.context!==target.context)assert.equal(after.find(p=>p.context===original.context).symbol,original.symbol);
 await page.click(trigger);await page.waitForSelector('.rtx-chart-symbol-dropdown');
 await page.evaluate(original=>[...document.querySelectorAll('.rtx-chart-symbol-dropdown [role=option]')].find(b=>b.textContent.trim()===original).click(),target.symbol);
 await page.waitForFunction((ctx,symbol)=>document.querySelector(`[data-chart-context-id="${ctx}"] .rtx-chart-symbol-trigger`)?.textContent.trim()===symbol,{},target.context,target.symbol);
 await page.screenshot({path:'tmp/desktop-four-fixes-final.png'});
 console.log('PASS installed desktop: duplicate zoom removed, icons aligned, popup theme matches, second-pane symbol changed independently and restored.');
} finally {await browser.disconnect();}

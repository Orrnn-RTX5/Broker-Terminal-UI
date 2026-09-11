import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const p=(await b.pages()).find(p=>p.url().startsWith('file:'));
 const read=()=>p.$$eval('.rtx-chart-symbol-trigger',es=>es.map(e=>({symbol:e.textContent.trim(),context:e.closest('[data-chart-context-id]').dataset.chartContextId})));
 const initial=await read();const target=initial[1].context;
 async function choose(symbol){
  await p.keyboard.press('Escape');
  await p.evaluate(ctx=>document.querySelector(`[data-chart-context-id="${ctx}"] .rtx-chart-symbol-trigger`).click(),target);
  await p.waitForSelector('.rtx-chart-symbol-dropdown');
  await p.evaluate(symbol=>{
   const el=[...document.querySelectorAll('.rtx-chart-symbol-dropdown [role=option]')].find(e=>e.textContent.trim()===symbol);
   if(!el)throw Error('Missing symbol '+symbol);el.click();
  },symbol);
  await p.waitForFunction((ctx,s)=>document.querySelector(`[data-chart-context-id="${ctx}"] .rtx-chart-symbol-trigger`)?.textContent.trim()===s,{},target,symbol);
 }
 await choose('EURUSD');const before=await read();
 await choose('XAUUSD');const after=await read();
 assert.equal(before.length,after.length);
 for(const c of before)if(c.context!==target)assert.equal(after.find(a=>a.context===c.context).symbol,c.symbol);
 console.log('PASS: second chart changed EURUSD to XAUUSD; first chart retained its symbol.');
 await choose('EURUSD');
 console.log('Restored EURUSD on the second chart.');
 await p.evaluate(ctx=>document.querySelector(`[data-chart-context-id="${ctx}"] .rtx-chart-symbol-trigger`).click(),target);
 await p.waitForSelector('.rtx-chart-symbol-dropdown');
 await p.screenshot({path:'tmp/desktop-chart-symbol-dropdown-fixed.png'});
 await p.keyboard.press('Escape');
 await p.screenshot({path:'tmp/desktop-four-fixes-final.png'});
}finally{await b.disconnect();}

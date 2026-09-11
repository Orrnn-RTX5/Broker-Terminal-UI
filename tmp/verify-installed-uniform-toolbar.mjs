import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const page=(await browser.pages()).find(p=>p.url().startsWith('file:'));
 await page.waitForSelector('.rtx-desktop-inline-drawings');
 await page.evaluate(async()=>{if(!await window.electron.window.isMaximized())window.electron.window.maximize();});
 await new Promise(r=>setTimeout(r,600));
 const data=await page.evaluate(()=>{
  const row=document.querySelector('.rtx-desktop-command-row');
  const controls=[...row.querySelectorAll('.rtx-toolbar-action,.rtx-toolbar-icon-button,.rtx-timeframe-option,.rtx-desktop-quick-button,.web-drawing-tools-rail__button')];
  return {
   buttons:controls.map(b=>{const s=getComputedStyle(b);return {font:s.fontSize,weight:s.fontWeight,height:b.getBoundingClientRect().height}}),
   glyphs:[...row.querySelectorAll('.web-drawing-tools-rail__glyph')].map(g=>getComputedStyle(g).width),
   reference:[...row.querySelectorAll('.rtx-chart-command-icon')].map(g=>getComputedStyle(g).width),
   fontFamily:[...new Set(controls.map(b=>getComputedStyle(b).fontFamily))],
  };
 });
 assert.ok(data.buttons.length>25);
 assert.ok(data.buttons.every(b=>b.font==='13px'&&b.weight==='400'&&b.height===32),JSON.stringify(data));
 assert.ok(data.glyphs.every(w=>w==='20px'));
 assert.ok(data.reference.every(w=>w==='20px'));
 assert.equal(data.fontFamily.length,1);
 await page.screenshot({path:'tmp/desktop-toolbar-uniform-final.png'});
 console.log(`PASS installed desktop: ${data.buttons.length} controls share 13px/400 typography and 32px height; drawing and command icons share 20px size.`);
} finally {await browser.disconnect();}

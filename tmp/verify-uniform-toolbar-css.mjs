import puppeteer from 'puppeteer';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const css=readdirSync('dist/assets').filter(n=>n.endsWith('.css')).map(n=>readFileSync(`dist/assets/${n}`,'utf8')).join('\n');
const browser=await puppeteer.launch({headless:true});
try {
 const page=await browser.newPage();
 for(const width of [1280,1920,2560]) for(const light of [false,true]) {
  await page.setViewport({width,height:900});
  await page.setContent(`<html class="rtx-desktop-shell-active ${light?'rtx-advanced-view rtx-skin-untitled-light':''}"><style>${css} body{margin:0}</style><div class="rtx-desktop-command-row flex items-center w-full overflow-hidden">
  <div class="rtx-desktop-command-scroll rtx-chart-toolbar-scroll flex min-w-0 items-center overflow-x-auto"><div class="rtx-toolbar-command-cluster flex shrink-0 items-center" style="width:1240px"><button id="reference" class="rtx-toolbar-action">New Order</button><div class="rtx-timeframe-strip flex"><button id="tf" class="rtx-timeframe-option">M1</button></div></div></div>
  <button id="search" class="rtx-desktop-quick-button rtx-desktop-symbol-search"><svg></svg></button>
  <div class="rtx-desktop-inline-drawings"><aside id="rail" class="web-drawing-tools-rail" data-orientation="horizontal"><div class="web-drawing-tools-rail__tools">${Array.from({length:16},(_,i)=>`<button id="draw${i}" class="web-drawing-tools-rail__button"><svg class="web-drawing-tools-rail__glyph" fill="currentColor"></svg></button>`).join('')}</div><div class="web-drawing-tools-rail__footer"><button class="web-drawing-tools-rail__button">X</button></div></aside></div>
  <div class="rtx-desktop-command-actions flex items-center shrink-0"><button id="account" class="rtx-desktop-quick-button"><svg></svg></button></div></div></html>`);
  const r=await page.evaluate(()=>{
   const rect=id=>document.getElementById(id).getBoundingClientRect();
   const font=id=>{const s=getComputedStyle(document.getElementById(id));return [s.fontFamily,s.fontSize,s.fontWeight]};
   const strip=document.querySelector('.web-drawing-tools-rail__tools');
   const gap=rect('draw1').left-rect('draw0').right;
   document.getElementById('draw15').focus();
   return {searchFont:font('search'),accountFont:font('account'),icon:getComputedStyle(document.querySelector('#draw0 svg')).width,outline:getComputedStyle(document.querySelector('#draw0 svg')).strokeWidth,font:font('reference'),tf:font('tf'),draw:font('draw0'),gap,searchGap:rect('draw0').left+strip.scrollLeft-rect('search').right,heights:['reference','tf','draw0','search','account'].map(id=>rect(id).height),accountRight:rect('account').right,scrollNeeded:strip.scrollWidth>strip.clientWidth,scrolled:strip.scrollLeft>0,railShadow:getComputedStyle(document.getElementById('rail')).boxShadow};
  });
  assert.deepEqual(r.searchFont,r.font);assert.deepEqual(r.accountFont,r.font);assert.equal(r.icon,'20px');assert.equal(r.outline,'0.5px');assert.deepEqual(r.tf,r.font);assert.deepEqual(r.draw,r.font);assert.deepEqual(r.heights,[32,32,32,32,32]);
  assert.equal(r.gap,width<=1280?8:10);assert.equal(r.searchGap,r.gap);assert.ok(r.accountRight<=width);
  if(r.scrollNeeded)assert.ok(r.scrolled);assert.equal(r.railShadow,'none');
  console.log(`PASS ${width}px ${light?'light':'dark'}: matching fonts, control heights and gaps; account visible and overflowing tools accessible.`);
 }
} finally {await browser.close();}

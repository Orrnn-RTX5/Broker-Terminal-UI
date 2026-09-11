import puppeteer from 'puppeteer';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const css = readdirSync('dist/assets').filter(n => n.endsWith('.css')).map(n => readFileSync(`dist/assets/${n}`, 'utf8')).join('\n');
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const width of [1280, 1920]) {
    await page.setViewport({ width, height: 900 });
    await page.setContent(`<html class="rtx-desktop-shell-active"><style>${css}</style>
      <div class="rtx-toolbar-command-cluster"><div class="rtx-toolbar-group"><button id="reference" class="rtx-toolbar-action">New Order</button></div></div>
      <div style="display:flex;width:100%"><div class="rtx-desktop-inline-drawings"><aside class="web-drawing-tools-rail" data-orientation="horizontal"><div class="web-drawing-tools-rail__tools">${Array.from({length:16},(_,i)=>`<button id="draw${i}" class="web-drawing-tools-rail__button"><svg viewBox="0 0 28 28"></svg></button>`).join('')}</div><div class="web-drawing-tools-rail__footer"><button class="web-drawing-tools-rail__button">X</button></div></aside></div></div>
      <div class="web-drawing-tools-menu"><button id="menu" class="web-drawing-tools-menu__item"><span class="web-drawing-tools-menu__label">Trendline</span></button></div>
      <div id="tip" class="web-drawing-tools-tooltip" data-orientation="horizontal">Cursor</div></html>`);
    const result = await page.evaluate(() => {
      const style = id => { const s=getComputedStyle(document.getElementById(id)); return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight}; };
      const first=document.getElementById('draw0').getBoundingClientRect();
      const next=document.getElementById('draw1').getBoundingClientRect();
      const strip=document.querySelector('.web-drawing-tools-rail__tools');
      document.getElementById('draw15').focus();
      return {reference:style('reference'),drawing:style('draw0'),menu:style('menu'),tip:style('tip'),width:first.width,height:first.height,gap:next.left-first.right,icon:getComputedStyle(document.querySelector('#draw0 svg')).width,scrollLeft:strip.scrollLeft};
    });
    for (const key of ['drawing','menu','tip']) assert.deepEqual(result[key],result.reference,key);
    assert.equal(result.width,32); assert.equal(result.height,32); assert.equal(result.icon,'20px');
    assert.equal(result.gap,width<=1280?8:10); assert.ok(result.scrollLeft>0,'Keyboard focus reveals overflowing tools');
    console.log(`PASS ${width}px: typography matches, 32px buttons, 20px icons, ${result.gap}px gaps; keyboard focus reveals hidden tools.`);
  }
} finally { await browser.close(); }

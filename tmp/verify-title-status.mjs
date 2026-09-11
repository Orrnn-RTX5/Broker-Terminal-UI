import puppeteer from 'puppeteer';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readdirSync('dist/assets').filter(n => n.endsWith('.css')).map(n => readFileSync(`dist/assets/${n}`, 'utf8')).join('\n');
const browser = await puppeteer.launch({ headless: true });
try {
 const page = await browser.newPage();
 for (const light of [false, true]) {
  for (const width of [600, 1920]) {
   await page.setViewport({width, height: 900});
   await page.setContent(`<html class="rtx-desktop-shell-active ${light ? 'rtx-advanced-view rtx-skin-untitled-light' : ''}"><style>${css}body{margin:0}</style><header class="rtx-desktop-titlebar"><div class="rtx-desktop-titlebar__drag-region"><img class="rtx-desktop-titlebar__icon"><time class="rtx-desktop-titlebar__clock">07:19:35 UTC</time><span class="rtx-desktop-titlebar__title">200032 - https://service.achieverfinancials.com - Hedge - RTX Terminal - XAUUSD,M5</span></div><div class="rtx-desktop-titlebar__controls"><button class="rtx-desktop-titlebar__control">-</button><button class="rtx-desktop-titlebar__control">[]</button><button class="rtx-desktop-titlebar__control">X</button></div></header></html>`);
   const result = await page.evaluate(() => {
    const time = document.querySelector('time'), title = document.querySelector('.rtx-desktop-titlebar__title'), controls = document.querySelector('.rtx-desktop-titlebar__controls');
    return { fonts: [time, title].map(n => { const s = getComputedStyle(n); return [s.fontSize, s.fontWeight, s.lineHeight]; }), timeWidth: time.getBoundingClientRect().width, timeScroll: time.scrollWidth, titleRight: title.getBoundingClientRect().right, controlsLeft: controls.getBoundingClientRect().left, pageWidth: document.documentElement.scrollWidth };
   });
   assert.deepEqual(result.fonts, [['13px','400','18px'], ['13px','400','18px']]);
   assert.ok(result.timeWidth >= result.timeScroll - 1);
   assert.ok(result.titleRight <= result.controlsLeft);
   assert.equal(result.pageWidth, width);
   console.log(`PASS ${light ? 'light' : 'dark'} ${width}px: matching title typography, visible clock, no overlap or page overflow`);
  }
 }
} finally { await browser.close(); }

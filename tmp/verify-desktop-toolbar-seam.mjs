import puppeteer from 'puppeteer';
import {readFileSync, readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const css=readdirSync('dist/assets').filter(n=>n.endsWith('.css')).map(n=>readFileSync(`dist/assets/${n}`,'utf8')).join('\n');
const browser=await puppeteer.launch({headless:true});
try {
 const page=await browser.newPage();
 for (const light of [false,true]) {
  await page.setContent(`<html class="rtx-desktop-shell-active ${light?'rtx-advanced-view rtx-skin-untitled-light':''}"><style>${css}</style><div class="rtx-main-toolbar rtx-desktop-main-toolbar"><div class="rtx-desktop-command-row"><div class="rtx-desktop-inline-drawings"><aside id="inline" class="web-drawing-tools-rail" data-orientation="horizontal"></aside></div></div></div><aside id="vertical" class="web-drawing-tools-rail" data-orientation="vertical"></aside></html>`);
  const result=await page.evaluate(()=>Object.fromEntries(['inline','vertical'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [id,{background:s.backgroundColor,image:s.backgroundImage,shadow:s.boxShadow,border:s.borderLeftWidth}]})));
  assert.deepEqual(result.inline,{background:'rgba(0, 0, 0, 0)',image:'none',shadow:'none',border:'0px'});
  assert.notEqual(result.vertical.shadow,'none');
  console.log(`PASS ${light?'light':'dark'}: inline rail has no background seam, shadow, or left border; vertical sidebar finish retained.`);
 }
} finally {await browser.close();}

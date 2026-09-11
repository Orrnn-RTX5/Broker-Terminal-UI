import puppeteer from 'puppeteer';
import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const css=readdirSync('dist/assets').filter(n=>n.endsWith('.css')).map(n=>readFileSync(`dist/assets/${n}`,'utf8')).join('\n');
const browser=await puppeteer.launch({headless:true});
try {
 const page=await browser.newPage();
 for(const light of [false,true]) {
  await page.setContent(`<html class="rtx-desktop-shell-active ${light?'rtx-advanced-view rtx-skin-untitled-light':''}"><style>${css}body{margin:0}</style><div class="rtx-desktop-shell" style="height:900px"><header id="title" class="rtx-desktop-titlebar"><div class="rtx-desktop-titlebar__drag-region"><span class="rtx-desktop-titlebar__title">200032 — Broker</span></div><div class="rtx-desktop-titlebar__controls"><button class="rtx-desktop-titlebar__control">X</button></div></header><div><div id="menu" class="rtx-desktop-menu-row"><div class="rtx-desktop-menu-bar flex h-full items-center"><button id="menuButton" class="rtx-application-menu-trigger">File</button></div></div><div id="commands" class="rtx-desktop-command-row flex items-center"><button id="commandButton" class="rtx-toolbar-action">New Order</button></div></div></div></html>`);
  const r=await page.evaluate(()=>Object.fromEntries(['title','menu','commands','menuButton','commandButton'].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return [id,{top:b.top,bottom:b.bottom,height:b.height}]})));
  assert.equal(r.title.height,36);assert.equal(r.menu.height,30);assert.equal(r.commands.height,40);
  assert.equal(r.title.bottom,r.menu.top);assert.equal(r.menu.bottom,r.commands.top);
  for(const [child,parent] of [['menuButton','menu'],['commandButton','commands']]) {
   assert.ok(r[child].top>r[parent].top);assert.ok(r[child].bottom<r[parent].bottom);
  }
  console.log(`PASS ${light?'light':'dark'}: 36px title, 30px menu, 40px toolbar; centered controls have vertical clearance.`);
 }
} finally {await browser.close();}

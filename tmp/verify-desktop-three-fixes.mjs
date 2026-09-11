import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9225'});
try {
 const pages=await browser.pages();
 const page=pages.find(p=>p.url().startsWith('file:'));
 assert.ok(page,'Packaged desktop page');
 await page.waitForSelector('.rtx-desktop-inline-drawings');
 const metrics=await page.evaluate(()=>({
  glyphs:[...document.querySelectorAll('.rtx-desktop-inline-drawings .web-drawing-tools-rail__glyph')].map(n=>({width:getComputedStyle(n).width,color:getComputedStyle(n).color})),
  duplicate:[...document.querySelectorAll('button')].some(b=>b.title==='Arrange Windows'),
  lang:document.documentElement.lang
 }));
 assert.ok(metrics.glyphs.length>5);
 assert.ok(metrics.glyphs.every(g=>g.width==='28px'));
 assert.equal(metrics.duplicate,false);
 assert.equal(metrics.lang,'en');
 const openView=()=>page.evaluate(()=>document.querySelectorAll('[data-desktop-menu-button]')[1].click());
 const chooseLabel=label=>page.evaluate(label=>{
  const b=[...document.querySelectorAll('button.rtx-menu-row')].find(b=>b.textContent.trim()===label);
  if(!b)throw new Error('Menu option missing: '+label);
  b.click();
 },label);
 await openView();
 await chooseLabel('Languages');
 await page.waitForSelector('[data-rtx-desktop-submenu]');
 const bounds=await page.evaluate(()=>{
  const el=document.querySelector('[data-rtx-desktop-submenu]');const r=el.getBoundingClientRect();
  return {parent:el.parentElement.tagName,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};
 });
 assert.equal(bounds.parent,'BODY');assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height);
 await page.screenshot({path:'tmp/desktop-language-menu-fixed.png'});
 await chooseLabel('Français');
 await page.waitForFunction(()=>document.documentElement.lang==='fr');
 assert.equal(await page.evaluate(()=>localStorage.getItem('i18nextLng')),'fr');
 const fr=JSON.parse(readFileSync('src/locales/fr/ui.json','utf8'));
 assert.equal(await page.$eval('[data-desktop-menu-button]',b=>b.textContent.trim()),fr.File);
 await page.screenshot({path:'tmp/desktop-language-french-fixed.png'});
 await openView();
 const labels=JSON.parse(readFileSync('src/locales/fr/translation.json','utf8'));
 await chooseLabel(labels.menu.view.languages);
 await chooseLabel('English');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 await page.screenshot({path:'tmp/desktop-three-fixes-final.png'});
 console.log('PASS packaged desktop: 28px drawing glyphs, duplicate removed, language submenu visible, French resources load and update menus, English restored.');
} finally {await browser.disconnect();}

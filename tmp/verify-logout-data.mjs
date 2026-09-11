import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const browser = await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const page=(await browser.pages()).find(p=>p.url().startsWith('file:'));
 await page.waitForSelector('[data-chart-context-id]',{timeout:60000});
 await page.evaluate(()=>{if(!document.querySelector('.rtx-data-window'))window.dispatchEvent(new CustomEvent('openDataWindow'));});
 await page.waitForFunction(()=>[...document.querySelectorAll('.rtx-data-window__row')].some(r=>/Open.*\d/.test(r.textContent)),{timeout:30000});
 const rows=await page.$$eval('.rtx-data-window__row',rows=>rows.map(r=>r.textContent));
 assert(rows.some(r=>/Open.*\d/.test(r)));
 const menus=await page.$$('[role="menubar"] [role="menuitem"]');
 await menus[0].click();
 await page.waitForSelector('[data-testid="file-menu-account-header"] [aria-label="Log Out"]');
 console.log(JSON.stringify({dataWindowRows:rows,logoutVisible:true}));
 await page.screenshot({path:'tmp/logout-data-window-verified.png'});
 await page.keyboard.press('Escape');
} finally {await browser.disconnect();}
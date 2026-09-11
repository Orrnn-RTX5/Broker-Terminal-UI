import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const p=(await b.pages()).find(p=>p.url().startsWith('file:'));
 await p.waitForFunction(()=>document.title.includes('Achiever Financials') && [...document.querySelectorAll('.navigator-tree-item__label')].some(x=>x.textContent==='Achiever Financials'),{timeout:60000});
 const result=await p.evaluate(()=>({title:document.title,navigator:[...document.querySelectorAll('.navigator-tree-item__label')].map(x=>x.textContent)}));
 assert(!result.title.includes('https://'));
 assert(!result.navigator.some(x=>x.includes('https://')));
 console.log(JSON.stringify(result));
 await p.screenshot({path:'tmp/broker-name-desktop-verified.png'});
} finally {await b.disconnect();}

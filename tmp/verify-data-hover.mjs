import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try{
const p=(await b.pages()).find(p=>p.url().startsWith('file:'));
await p.keyboard.press('Escape');
const getTime=()=>p.$$eval('.rtx-data-window__row',r=>r.find(x=>x.textContent.startsWith('Time'))?.textContent);
await p.mouse.move(500,80);
await new Promise(r=>setTimeout(r,300));
const live=await getTime();
await p.mouse.move(480,520);
await new Promise(r=>setTimeout(r,400));
const hovered=await getTime();
assert.notEqual(hovered,live);
console.log(JSON.stringify({live,hovered,hoverUpdates:true}));
await p.mouse.move(500,80);
}finally{await b.disconnect();}

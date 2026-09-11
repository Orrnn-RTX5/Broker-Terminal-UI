import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const p=(await b.pages()).find(p=>p.url().startsWith('file:'));
 await p.waitForSelector('.navigator-tree-item__lock');
 await p.evaluate(async()=>{if(!await window.electron.window.isMaximized())window.electron.window.maximize();});
 await new Promise(r=>setTimeout(r,700));
 const m=await p.evaluate(()=>{
  const rail=document.querySelector('.rtx-desktop-inline-drawings');
  const tools=[...rail.querySelectorAll('.web-drawing-tools-rail__tools > button')].map(b=>b.getBoundingClientRect());
  const trash=rail.querySelector('.web-drawing-tools-rail__footer button').getBoundingClientRect();
  return {gaps:tools.slice(1).map((r,i)=>r.left-tools[i].right),lastGap:trash.left-tools.at(-1).right,
   separators:[...document.querySelectorAll('.rtx-desktop-command-row .rtx-mt5-divider,.rtx-desktop-inline-drawings .web-drawing-tools-rail__separator')].map(s=>getComputedStyle(s).display),
   footerBorder:getComputedStyle(rail.querySelector('.web-drawing-tools-rail__footer')).borderLeftWidth,
   locks:[...document.querySelectorAll('.navigator-tree-item__lock')].map(s=>({color:getComputedStyle(s).color,width:getComputedStyle(s.querySelector('svg')).width,stroke:getComputedStyle(s.querySelector('svg')).strokeWidth})),
  };
 });
 assert.ok(m.gaps.length>5);assert.ok(Math.max(...m.gaps)-Math.min(...m.gaps)<1);
 assert.ok(m.lastGap<=11,JSON.stringify(m));assert.ok(m.separators.every(s=>s==='none'));assert.equal(m.footerBorder,'0px');
 assert.equal(m.locks.length,4);assert.ok(m.locks.every(l=>l.width==='14px'&&l.stroke==='1.75px'));
 await p.screenshot({path:'tmp/desktop-spacing-lock-final.png'});
 console.log('PASS: evenly distributed drawing controls, no empty tail gap or toolbar separators, four clear 14px Navigator locks.');
 console.log(JSON.stringify({drawingGap:m.gaps[0],trashGap:m.lastGap,lockColor:m.locks[0].color}));
}finally{await b.disconnect();}

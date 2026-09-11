import puppeteer from 'puppeteer';
const b=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {const p=(await b.pages()).find(p=>p.url().startsWith('file:'));console.log(await p.evaluate(()=>({state:document.readyState,charts:[...document.querySelectorAll('.rtx-chart-symbol-trigger')].map(e=>({symbol:e.textContent,context:e.closest('[data-chart-context-id]').dataset.chartContextId})),picker:!!document.querySelector('.rtx-chart-symbol-dropdown')})));}finally{await b.disconnect();}

import puppeteer from 'puppeteer';
const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9225',defaultViewport:null});
try {
 const page=(await browser.pages()).find(p=>p.url().startsWith('file:'));
 const cdp=await page.createCDPSession();
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 await page.evaluate(async()=>{if(!await window.electron.window.isMaximized())window.electron.window.maximize();});
 await new Promise(r=>setTimeout(r,800));
 await page.screenshot({path:'tmp/desktop-three-fixes-full.png'});
 console.log('Desktop viewport restored; English retained.');
} finally {await browser.disconnect();}

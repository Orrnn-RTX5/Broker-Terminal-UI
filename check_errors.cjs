const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`PAGE ERROR: ${msg.text()}`);
            }
        });
        
        page.on('pageerror', err => {
            console.log(`PAGE EXCEPTION: ${err.message}`);
        });

        await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 10000 });
        
        // Wait a few seconds for the app to initialize
        await new Promise(r => setTimeout(r, 2000));
        
        await browser.close();
        console.log("Done");
    } catch (err) {
        console.error("Puppeteer script failed:", err);
    }
})();

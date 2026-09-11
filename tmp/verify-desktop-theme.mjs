import puppeteer from 'puppeteer';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Exercise the packaged CSS cascade in Chromium, changing only shell/theme classes.
const files = readdirSync('dist/assets');
const css = ['index-', 'authenticatedStyles-', 'App-'].map(prefix =>
  readFileSync(`dist/assets/${files.find(name => name.startsWith(prefix) && name.endsWith('.css'))}`, 'utf8'),
).join('\n');
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style><div class="rtx-app-shell text-zinc-300">
    <div class="rtx-top-chrome"><div class="rtx-main-toolbar bg-[#131316]" id="toolbar">
      <button id="tool" class="rtx-toolbar-icon-button" role="radio" aria-checked="false">Tool</button>
      <div class="rtx-timeframe-strip"><button id="timeframe" class="rtx-timeframe-option border-blue-500/50 bg-blue-500/15 text-blue-300" aria-checked="true">M5</button></div>
    </div></div>
    <div id="menu" class="rtx-menu-surface"><button id="menuitem" class="rtx-menu-row">Menu item</button><button id="disabled" class="rtx-menu-row is-disabled">Locked</button></div>
    <div id="rail" class="web-drawing-tools-rail"><button id="drawing" class="web-drawing-tools-rail__button">Draw</button></div>
    <div id="status" class="rtx-status-bar bg-[#10151d] text-zinc-200"><span id="connected" class="text-profit">Connected</span></div>
    <div id="panel" class="rtx-market-watch"></div>
    <div id="titlebar" class="rtx-desktop-titlebar"><span class="rtx-desktop-titlebar__title">Terminal</span></div>
  </div>`);
  const results = [];

  for (const light of [false, true]) {
    for (const selected of [false, true]) {
      for (const hover of [null, "tool", "menuitem", "timeframe"]) {
      const capture = async desktop => {
        await page.evaluate(({ desktop, light, selected }) => {
          document.documentElement.className = [desktop ? 'rtx-desktop-shell-active' : '', light ? 'rtx-advanced-view rtx-skin-untitled-light' : ''].join(' ');
          document.querySelector('#toolbar').classList.toggle('rtx-desktop-main-toolbar', desktop);
          document.querySelector('#toolbar').classList.toggle('bg-[#131316]', !desktop);
          document.querySelector('#tool').setAttribute('aria-checked', String(selected));
        }, { desktop, light, selected });
        if (hover) await page.hover(`#${hover}`);
        else await page.mouse.move(900, 700);
        await new Promise(resolve => setTimeout(resolve, 250));
        return page.evaluate(() => Object.fromEntries(['toolbar', 'tool', 'timeframe', 'menu', 'menuitem', 'disabled', 'rail', 'drawing', 'status', 'connected', 'panel', 'titlebar'].map(id => {
          const element = document.getElementById(id);
          const style = getComputedStyle(element);
          let background = style.backgroundColor;
          if (id === 'toolbar' && background === 'rgba(0, 0, 0, 0)') background = getComputedStyle(element.parentElement).backgroundColor;
          return [id, { background, color: style.color, sheen: style.backgroundImage, border: style.borderTopColor }];
        })));
      };
      const web = await capture(false);
      const desktop = await capture(true);
      for (const id of Object.keys(web)) {
        // The desktop titlebar has no web counterpart; it matches the shared toolbar palette.
        if (id === 'titlebar') continue;
        if (id === "toolbar") { delete desktop[id].color; delete web[id].color; delete desktop[id].border; delete web[id].border; }
        assert.deepEqual(desktop[id], web[id], `${light ? 'light' : 'dark'} ${selected ? 'selected' : 'normal'} ${id}`);
      }
      assert.equal(desktop.titlebar.background, desktop.toolbar.background);
      results.push({ hover, theme: light ? 'light' : 'dark', selected, matchedSurfaces: Object.keys(web).length - 1, colors: desktop });
    }
  }
  }
  writeFileSync('tmp/desktop-theme-color-verification.json', JSON.stringify(results, null, 2));
  console.log('PASS: packaged web/desktop colors match for 11 surfaces in dark/light modes and normal/selected/hover states.');
} finally { await browser.close(); }

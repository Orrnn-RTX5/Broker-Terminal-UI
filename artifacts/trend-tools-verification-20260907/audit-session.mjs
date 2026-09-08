import fs from 'node:fs/promises';
import { createRecorder } from './capture.mjs';

// Runs only through the approved browser runtime. UI actions use observed
// menu labels; evaluate reads rendered DOM only. No application stores/API calls.
export async function createAuditSession(tab, root) {
  const record = createRecorder(root);
  const results = JSON.parse(await fs.readFile(`${root}/RTX5-APPLICATION-AUDIT.json`, 'utf8'));
  const save = () => fs.writeFile(`${root}/RTX5-APPLICATION-AUDIT.json`, JSON.stringify(results, null, 2));
  const read = () => tab.playwright.evaluate(() => {
    const scalar = (element, key) => element.hasAttribute(key) ? Number(element.getAttribute(key)) : null;
    const overlay = document.querySelector('svg.chart-svg-overlay');
    const bounds = overlay?.getBoundingClientRect();
    return {
      toolbar: [...document.querySelectorAll('[role="toolbar"]')]
        .map(element => element.getAttribute('aria-label')).filter(label => label?.startsWith('Edit ')),
      anchors: [...document.querySelectorAll('[data-geometry-role^="selection-anchor-"]')]
        .map(element => ({
          role: element.getAttribute('data-geometry-role'),
          group: element.closest('g[data-id]')?.getAttribute('data-id'),
          tag: element.tagName,
          cx: scalar(element, 'cx'), cy: scalar(element, 'cy'),
          x: scalar(element, 'x'), y: scalar(element, 'y'),
          width: scalar(element, 'width'), height: scalar(element, 'height'),
        })),
      drafts: [...document.querySelectorAll('g[data-id$="-preview"],g[data-id$="-construction"],g[data-id$="-ghost"]')]
        .map(element => ({ id: element.getAttribute('data-id'), shapes: element.children.length })),
      drawingGroups: document.querySelectorAll('g[data-id]').length,
      cursor: document.querySelector('[aria-label="Cursor"]')?.getAttribute('aria-pressed'),
      overlay: bounds ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } : null,
    };
  });
  const apply = async (name, label, points) => {
    let snapshot = await tab.playwright.domSnapshot();
    for (let attempt = 0; attempt < 3 && !snapshot.includes(`menuitemradio "${label}"`); attempt++) {
      await tab.screenshot({});
      snapshot = await tab.playwright.domSnapshot();
    }
    if (!snapshot.includes(`menuitemradio "${label}"`)) throw new Error(`Menu not ready for ${label}`);
    const stages = [];
    const capture = await record(tab, name, async () => {
      await tab.playwright.getByRole('menuitemradio', { name: label, exact: true }).click();
      stages.push({ stage: 'armed', state: await read() });
      for (let index = 0; index < points.length; index++) {
        await tab.cua.move(points[index]);
        await tab.screenshot({});
        stages.push({ stage: `preview-${index + 1}`, state: await read() });
        await tab.cua.click(points[index]);
        stages.push({ stage: `anchor-${index + 1}`, state: await read() });
        await tab.screenshot({});
      }
    });
    const item = { name, label, capture, stages, final: await read(), extractorVersion: 2 };
    results.push(item);
    await save();
    return item;
  };
  const confirm = async (name) => {
    const item = name ? results.findLast(result => result.name === name) : results.at(-1);
    if (!item) throw new Error(`No audit result for ${name}`);
    item.confirmed = await read();
    item.confirmationExtractorVersion = 2;
    await fs.writeFile(`${root}/${item.name}-result.png`, await tab.screenshot({}));
    await save();
    return { name: item.name, state: item.confirmed };
  };
  const openMenu = async ({ removeSelectedTestDrawing = true } = {}) => {
    let snapshot = await tab.playwright.domSnapshot();
    if (removeSelectedTestDrawing && snapshot.includes('button "Delete drawing"')) {
      await tab.playwright.getByRole('button', { name: 'Delete drawing', exact: true }).click();
      snapshot = await tab.playwright.domSnapshot();
    }
    const label = snapshot.match(/button "([^"]+ — Trend Line Tools)"/)?.[1];
    if (!label) throw new Error('Trend tools rail button not found in visible DOM');
    await tab.playwright.getByRole('button', { name: label, exact: true }).click();
  };
  const one = async (name, label, points) => {
    await apply(name, label, points);
    const result = await confirm(name);
    if (result.state.anchors.length && result.state.cursor === 'true' && !result.state.drafts.length) {
      await openMenu();
    }
    return result;
  };
  return { read, apply, confirm, openMenu, one, record, results, save };
}

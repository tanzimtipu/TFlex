// Phase 34 run-close item 5 — fresh re-confirmation of the two most
// consequential Phase 34 behaviours in the CURRENT build:
//   (a) opening the All Tools panel in Multi Mode shrinks BOTH panes equally
//       with no blank strip inside either pane;
//   (b) Multi Mode shows exactly ONE tab whose label names both documents.
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const { twoPaneSetup } = require('../lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p34-reconfirm');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function paneGeom(pane) {
  return win.evaluate((p) => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) };
    };
    const main = rect(`.tab-pane[data-pane="${p}"] .workspace-main`);
    const scroller = rect(`.tab-pane[data-pane="${p}"] .document-scroller`);
    return { main, scroller, blankBand: main !== null && scroller !== null ? Math.round(main.w - scroller.w) : null };
  }, pane);
}

test('item 5a: the panel shrinks both panes equally with no blank strip in either pane', async () => {
  await twoPaneSetup(app, win);
  const beforeA = await paneGeom('A');
  const beforeB = await paneGeom('B');
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(900);
  const afterA = await paneGeom('A');
  const afterB = await paneGeom('B');
  const dA = beforeA.main.w - afterA.main.w;
  const dB = beforeB.main.w - afterB.main.w;
  console.log(`[P34-reconfirm-a] before A=${JSON.stringify(beforeA)} B=${JSON.stringify(beforeB)}`);
  console.log(`[P34-reconfirm-a] after  A=${JSON.stringify(afterA)} B=${JSON.stringify(afterB)}`);
  console.log(`[P34-reconfirm-a] deltas A=${dA} B=${dB} |dA-dB|=${Math.abs(dA - dB)} blankBand A=${afterA.blankBand} B=${afterB.blankBand}`);
  expect(Math.abs(dA - dB), `pane shrink deltas differ: A=${dA} B=${dB}`).toBeLessThanOrEqual(1);
  expect(dA).toBeGreaterThan(50);
  expect(Math.abs(afterA.blankBand), `pane A blank strip ${afterA.blankBand}px`).toBeLessThanOrEqual(4);
  expect(Math.abs(afterB.blankBand), `pane B blank strip ${afterB.blankBand}px`).toBeLessThanOrEqual(4);
});

test('item 5b: Multi Mode shows exactly ONE tab whose label names both documents', async () => {
  await twoPaneSetup(app, win);
  const tabs = win.locator('.tab[data-tab-id]');
  const count = await tabs.count();
  const id = await tabs.first().getAttribute('data-tab-id');
  const selected = await tabs.first().getAttribute('aria-selected');
  const label = (await win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-title').innerText()).replace(/\s+/g, ' ').trim();
  console.log(`[P34-reconfirm-b] tabs=${count} id=${id} aria-selected=${selected} label="${label}"`);
  expect(count, 'Multi Mode tab count').toBe(1);
  expect(id).toBe('tf-multi-workspace');
  expect(selected).toBe('true');
  expect(label).toContain('p33-alpha');
  expect(label).toContain('p33-beta');
});
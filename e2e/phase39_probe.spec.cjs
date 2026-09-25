// Phase 39 probe - does the shared Multi Mode dock vanish when the EMPTY pane
// is focused (one document)? Also measures the thumbnail panel's bottom
// page-action bar vs the dock. Canonical launchApp only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let app = null;
let win = null;
test.setTimeout(180000);

const R = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1), right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1), opacity:cs.opacity, display:cs.display, visibility:cs.visibility }; })()`;

async function rect(w, sel) { return w.evaluate(R(sel)); }
function inter(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.right, b.right), bo = Math.min(a.bottom, b.bottom);
  return { w:+(Math.max(0,r-x)).toFixed(1), h:+(Math.max(0,bo-y)).toFixed(1), area:+(Math.max(0,r-x)*Math.max(0,bo-y)).toFixed(1) };
}

async function dockState(w, label) {
  const d = await w.evaluate(`(() => {
    const dock = document.querySelector('.action-dock');
    const layer = document.querySelector('[data-multi-dock-layer]');
    const verbs = [...document.querySelectorAll('[data-dock-verb]')].map((b) => b.getAttribute('data-dock-verb'));
    return { dock: !!dock, layer: !!layer, verbs,
      idle: dock ? dock.getAttribute('data-dock-idle') : null,
      opacity: dock ? getComputedStyle(dock).opacity : null,
      focused: document.querySelector('.tab-pane[data-pane-focused="true"]')?.getAttribute('data-pane') ?? null };
  })()`);
  console.log(`[P39-PROBE ${label}] ${JSON.stringify(d)}`);
  return d;
}

test('one-doc multi: dock presence across focus + thumbnail action bar', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, getSamplePath('report.pdf'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1500);
  await dockState(win, 'focus-A');

  // Move the mouse (clear idle) then click the empty pane B.
  await win.mouse.move(700, 400);
  await win.waitForTimeout(200);
  await dockState(win, 'focus-A-after-move');
  await win.locator('.tab-pane[data-pane="B"]').first().click({ position: { x: 60, y: 120 } });
  await win.waitForTimeout(700);
  const focusB = await dockState(win, 'focus-B-empty');

  // Focus back to pane A by clicking a page.
  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ force: true });
  await win.waitForTimeout(700);
  await dockState(win, 'focus-A-again');

  // Select a thumbnail -> the strip's bottom page-action bar.
  await win.locator('.tab-pane[data-pane="A"] .thumb-item').first().click();
  await win.waitForTimeout(500);
  const bar = await rect(win, '.tab-pane[data-pane="A"] [data-rail-action-bar]');
  const strip = await rect(win, '.tab-pane[data-pane="A"] .pane-thumb-strip');
  const dock = await rect(win, '.action-dock');
  const rotCw = await rect(win, '.tab-pane[data-pane="A"] [data-rail-action-bar] button[aria-label="Rotate clockwise"]');
  console.log(`[P39-PROBE bar] bar=${JSON.stringify(bar)} strip=${JSON.stringify(strip)} dock=${JSON.stringify(dock)}`);
  console.log(`[P39-PROBE barInterDock] ${JSON.stringify(inter(bar, dock))}`);
  console.log(`[P39-PROBE rotateBtnInterDock] ${JSON.stringify(inter(rotCw, dock))}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-349-rail-bar.png') });
  console.log(`[P39-PROBE focusBEmpty=${JSON.stringify(focusB)}]`);
  expect(app).not.toBeNull();
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p39-probe');
  app = null;
  win = null;
});

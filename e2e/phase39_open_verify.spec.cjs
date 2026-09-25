// Phase 39 item 2 (open affordances) verification.
// Every "Open a PDF" affordance in Multi Mode must open the OS file picker and
// must NOT move the divider / resize the panes - including the path where the
// EMPTY pane is focused first (pre-fix that cleared the active document, closed
// the Inspector and moved the divider on open). One and two documents.
// Measurement harness: raw [P39-OPEN ...] lines are the evidence. Canonical
// launchApp only.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

let app = null;
let win = null;
test.setTimeout(300000);

async function openDoc(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function setWindow(width, height) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [width, height]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, width, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

const STATE = `(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect();
    return { left:+b.left.toFixed(1), w:+b.width.toFixed(1), right:+b.right.toFixed(1) }; };
  const stage = document.querySelector('.tab-stage');
  const canvasA = document.querySelectorAll('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').length;
  const canvasB = document.querySelectorAll('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').length;
  return { frac: stage ? getComputedStyle(stage).getPropertyValue('--tf-split-frac').trim() : null,
    divider: r('[data-multi-divider]'), paneA: r('.tab-pane[data-pane="A"]'), paneB: r('.tab-pane[data-pane="B"]'),
    toolsOpen: document.querySelector('.app-main')?.getAttribute('data-tools-open') ?? null,
    dockPresent: !!document.querySelector('.action-dock'),
    focused: document.querySelector('.tab-pane[data-pane-focused="true"]')?.getAttribute('data-pane') ?? null,
    activePane: document.querySelector('.tab-pane[aria-hidden="false"][data-pane]')?.getAttribute('data-pane') ?? null,
    canvasA, canvasB,
    paneOpen: document.querySelectorAll('[data-pane-open]').length,
    toolbarOpen: document.querySelectorAll('[data-toolbar-open]').length };
})()`;

async function readState(label) {
  const s = await win.evaluate(STATE);
  console.log(`[P39-OPEN ${label}] ${JSON.stringify(s)}`);
  return s;
}

async function mockDialog(nextPath) {
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__openCalls = 0;
    dialog.showOpenDialog = async () => { globalThis.__openCalls += 1; return { canceled: false, filePaths: [p] }; };
  }, nextPath);
}
async function calls() { return app.evaluate(() => globalThis.__openCalls); }

function assertStable(before, after, label) {
  expect(after.frac, `${label} split fraction unchanged`).toBe(before.frac);
  for (const k of ['left', 'w', 'right']) {
    expect(Math.abs(after.divider[k] - before.divider[k]), `${label} divider.${k} unchanged`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.paneA[k] - before.paneA[k]), `${label} paneA.${k} unchanged`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.paneB[k] - before.paneB[k]), `${label} paneB.${k} unchanged`).toBeLessThanOrEqual(0.5);
  }
}

test('item2 one doc: focus the EMPTY pane first, then open - layout must not move', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);

  // Focus the EMPTY pane B by clicking its body (no open yet).
  await win.locator('.tab-pane[data-pane="B"]').click({ position: { x: 30, y: 60 } });
  await win.waitForTimeout(700);
  const focusedEmpty = await readState('focused-empty');
  expect(focusedEmpty.toolsOpen, 'Inspector stays open while the empty pane is focused').toBe('true');
  expect(focusedEmpty.dockPresent, 'dock stays present while the empty pane is focused').toBe(true);

  const before = await readState('before');
  await mockDialog(getSamplePath('long.pdf'));
  await win.locator('[data-pane-open]').first().click();
  await win.waitForTimeout(3000);
  const after = await readState('after');
  const n = await calls();
  console.log(`[P39-OPEN one-doc-focus-first] dialogCalls=${n}`);
  expect(n, 'the OS file picker was invoked exactly once').toBe(1);
  expect(after.canvasB, 'the chosen document landed in pane B').toBeGreaterThan(0);
  expect(after.toolsOpen, 'Inspector stayed open after the open').toBe('true');
  assertStable(before, after, 'one-doc-focus-first');

  await hardClose(app, 'open-1');
  app = null; win = null;
});

test('item2 one doc: direct pane Open at default and narrow windows', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);

  const before = await readState('direct-before');
  await mockDialog(getSamplePath('long.pdf'));
  await win.locator('[data-pane-open]').first().click();
  await win.waitForTimeout(3000);
  const after = await readState('direct-after');
  console.log(`[P39-OPEN direct] dialogCalls=${await calls()}`);
  expect(await calls()).toBe(1);
  assertStable(before, after, 'direct');

  await hardClose(app, 'open-2');
  app = null; win = null;

  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await setWindow(700, 720);
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);
  await win.locator('.tab-pane[data-pane="B"]').click({ position: { x: 30, y: 60 } });
  await win.waitForTimeout(600);
  const nb = await readState('narrow-focus-first-before');
  await mockDialog(getSamplePath('long.pdf'));
  await win.locator('[data-pane-open]').first().click();
  await win.waitForTimeout(3000);
  const na = await readState('narrow-focus-first-after');
  console.log(`[P39-OPEN narrow] dialogCalls=${await calls()}`);
  expect(await calls()).toBe(1);
  assertStable(nb, na, 'narrow');

  await hardClose(app, 'open-3');
  app = null; win = null;
});

test('item2 two docs: the title-bar Open opens the picker without moving the split', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await openDoc(getSamplePath('long.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const pick = win.locator('.tab-pane[data-pane-empty] [data-pane-pick]').first();
  if (await pick.count()) { await pick.click(); await win.waitForTimeout(1800); }
  const before = await readState('two-before');
  expect(before.paneOpen, 'no pane Open affordance once both panes are filled').toBe(0);
  expect(before.toolbarOpen, 'title-bar Open present').toBeGreaterThan(0);

  await mockDialog(getSamplePath('scanned.pdf'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(3000);
  const after = await readState('two-after');
  console.log(`[P39-OPEN two] dialogCalls=${await calls()}`);
  expect(await calls()).toBe(1);
  assertStable(before, after, 'two');

  await hardClose(app, 'open-4');
  app = null; win = null;
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'open');
  app = null;
  win = null;
});

// Phase 33 e2e shared helpers (qa). CommonJS so .cjs specs can require it.
// Launches always go through the canonical e2e/lib/launch.cjs launchApp.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { toggleMultiModeViaPalette } = require('./helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(ROOT, 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf'); // 34 pages
const LONG = path.join(FIX, 'long.pdf'); // 520 pages
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tflex-p33');

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function mockOpen(app, p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

async function openFile(app, win, p) {
  await mockOpen(app, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function waitTabCount(win, n) {
  const { expect } = require('@playwright/test');
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}

// Two different documents, both panes filled (alpha in A, beta in B).
async function twoPaneSetup(app, win) {
  const alphaPath = tmpCopy(REPORT, 'p33-alpha.pdf');
  const betaPath = tmpCopy(LONG, 'p33-beta.pdf');
  await openFile(app, win, alphaPath);
  await waitTabCount(win, 1);
  await openFile(app, win, betaPath);
  await waitTabCount(win, 2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p33-alpha' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — the CommandBar row is retired in single mode; the
  // Multi Mode toggle now lives in the All-tools palette.
  await toggleMultiModeViaPalette(win);
  const { expect } = require('@playwright/test');
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p33-beta' }).first().click();
  await win.waitForTimeout(1200);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
  return { alphaPath, betaPath };
}

// Focus a pane by pressing its page area (the pane's pointerdown-capture
// focus). Avoids the pane header, which the shared toolbar currently overlaps.
async function focusPaneByPage(win, pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`focusPaneByPage: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(20, Math.min(box.x + box.width / 2, vp.w - 20));
  const y = Math.max(20, Math.min(box.y + box.height / 2, vp.h - 20));
  await win.mouse.click(x, y);
  await win.waitForTimeout(350);
}

async function paneCount(win, pane) {
  const raw = await win.locator(`.multi-pane-header[data-pane="${pane}"]`).innerText();
  const m = raw.match(/(\d+)\s+pages?/);
  return m ? Number(m[1]) : null;
}

async function switchTheme(win, theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector(`[data-theme-option="${theme}"]`, { state: 'visible', timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForTimeout(700);
}

module.exports = {
  ROOT,
  FIX,
  REPORT,
  LONG,
  SHOTS,
  TMP,
  tmpCopy,
  mockOpen,
  openFile,
  waitTabCount,
  twoPaneSetup,
  focusPaneByPage,
  paneCount,
  switchTheme,
};
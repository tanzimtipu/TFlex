// TFL-663 — focused diagnostic: does the EDIT-mode minus persist removals?
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const tmpDir = (label) => {
  const d = path.join(os.tmpdir(), `tfl663d-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

async function openSample(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
const readFileSafe = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

test('H2 persist: minus on disabled REVIEW forms vs minus on PAGES split', async () => {
  const dir = tmpDir('persist');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForTimeout(300);

    // --- PAGES: minus on 'split' (enabled default) ---
    await win.keyboard.press('Control+1');
    await win.waitForTimeout(600);
    console.log(`[H2P] pages split before=${await win.locator('[data-dock-verb="split"]').count()}`);
    await win.locator('[data-dock-minus="split"]').first().click();
    await win.waitForTimeout(2500);
    const ipcSplit = await win.evaluate(() => window.tflex.loadSettings());
    const fileSplit = readFileSafe(path.join(dir, 'settings.json'));
    console.log(`[H2P] after split minus: count=${await win.locator('[data-dock-verb="split"]').count()} ipc.unpinned=${JSON.stringify(ipcSplit && ipcSplit.dockUnpinned)} file.unpinned=${JSON.stringify(fileSplit && fileSplit.dockUnpinned)}`);

    // --- REVIEW: minus on 'forms' (disabled default) ---
    await win.keyboard.press('Control+3');
    await win.waitForTimeout(700);
    console.log(`[H2P] review forms before=${await win.locator('[data-dock-verb="forms"]').count()} disabled=${await win.locator('[data-dock-verb="forms"]').first().isDisabled()}`);
    await win.locator('[data-dock-minus="forms"]').first().click();
    await win.waitForTimeout(2500);
    const ipcForms = await win.evaluate(() => window.tflex.loadSettings());
    const fileForms = readFileSafe(path.join(dir, 'settings.json'));
    console.log(`[H2P] after forms minus: count=${await win.locator('[data-dock-verb="forms"]').count()} ipc.unpinned=${JSON.stringify(ipcForms && ipcForms.dockUnpinned)} file.unpinned=${JSON.stringify(fileForms && fileForms.dockUnpinned)}`);
    console.log(`[H2P] activeStage attr via dock state=${await win.locator('[data-action-dock]').getAttribute('data-dock-state')}`);
  } finally {
    await hardClose(app, 'tfl663d-1');
  }

  // Relaunch same dir and see what survived.
  const app2 = await launchApp([], dir);
  const win2 = await app2.firstWindow();
  try {
    await openSample(win2);
    await win2.keyboard.press('Control+1');
    await win2.waitForTimeout(700);
    const pagesVerbs = await win2.$$eval('[data-action-dock] [data-dock-verb]', (els) => els.map((e) => e.getAttribute('data-dock-verb')));
    await win2.keyboard.press('Control+3');
    await win2.waitForTimeout(700);
    const reviewVerbs = await win2.$$eval('[data-action-dock] [data-dock-verb]', (els) => els.map((e) => e.getAttribute('data-dock-verb')));
    console.log(`[H2P] relaunch pages verbs=${JSON.stringify(pagesVerbs)}`);
    console.log(`[H2P] relaunch review verbs=${JSON.stringify(reviewVerbs)}`);
    console.log(`[H2P] relaunch split present=${pagesVerbs.includes('split')} forms present=${reviewVerbs.includes('forms')}`);
  } finally {
    await hardClose(app2, 'tfl663d-2');
  }
});
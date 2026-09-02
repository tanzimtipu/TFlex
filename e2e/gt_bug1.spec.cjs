const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

async function dumpDiag(firstWindow, label) {
  const d = await firstWindow.evaluate(() => (typeof tflexDiagnostics === 'function' ? tflexDiagnostics() : '<none>'));
  fs.writeFileSync(`screenshots/gt_diag_${label}.json`, JSON.stringify(d, null, 2));
  return d;
}

test.describe('GT Bug 1 / 1.1 — placed signature action bar + move residue', () => {
  let electronApp;
  let firstWindow;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, INSTALLED);
    firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    await firstWindow.waitForSelector('.sample-card .sample-name', { timeout: 20000 });
    const card = firstWindow.locator('.sample-card', { has: firstWindow.locator('.sample-name', { hasText: 'report.pdf' }) });
    console.log('Sample cards:', await firstWindow.$$eval('.sample-card .sample-name', e => e.map(x => x.textContent)));
    await card.click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(1500);
    console.log('TAB TITLE:', await firstWindow.$eval('.tab-title', e => e.textContent).catch(() => '<none>'));
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('place a signature', async () => {
    await firstWindow.click('button[aria-label="Sign tool"]');
    await firstWindow.waitForSelector('.sig-manager', { timeout: 10000 });
    await firstWindow.click('.sig-tab:has-text("Type")');
    await firstWindow.fill('input[aria-label="Type your signature"]', 'QA Ground');
    await firstWindow.click('.sig-manager button:text-is("Save")');
    await firstWindow.waitForTimeout(300);
    await firstWindow.click('.sig-saved-pick');
    await firstWindow.waitForTimeout(400);

    // Move over the page layer and click to create pending placement
    const layer = firstWindow.locator('.signatures-layer[data-page="1"]');
    const box = await layer.boundingBox();
    console.log('SIG LAYER box:', JSON.stringify(box));
    await firstWindow.mouse.move(box.x + 150, box.y + 200);
    await firstWindow.waitForTimeout(300);
    await firstWindow.mouse.click(box.x + 150, box.y + 200);
    await firstWindow.waitForSelector('[data-sig-action-bar]', { timeout: 5000 });
    console.log('Pending action bar visible after placement click.');
    await firstWindow.screenshot({ path: 'screenshots/gt_b1_pending.png' });

    // Confirm
    await firstWindow.click('[data-sig-action="confirm"]');
    await firstWindow.waitForTimeout(600);
    const barGone = await firstWindow.evaluate(() => !!document.querySelector('[data-sig-action-bar]'));
    console.log('After confirm, action bar present?', barGone);
    await firstWindow.screenshot({ path: 'screenshots/gt_b1_placed.png' });
  });

  test('BUG1: click placed signature -> action bar?', async () => {
    // Find the committed placement
    const placed = firstWindow.locator('.sig-placement').first();
    await placed.click({ force: true });
    await firstWindow.waitForTimeout(500);
    const state = await firstWindow.evaluate(() => {
      const actionBar = document.querySelector('[data-sig-action-bar]');
      const handles = document.querySelectorAll('.sig-placement-selected[data-placement-id] .sig-handle').length;
      const allSigHandles = document.querySelectorAll('div[data-handle]').length;
      const selected = document.querySelectorAll('.sig-placement-selected').length;
      return {
        actionBarPresent: !!actionBar,
        actionBarActions: [...(document.querySelectorAll('[data-sig-action-bar] [data-sig-action]'))].map(b => b.getAttribute('data-sig-action')),
        selectedCount: selected,
        sigHandlesInSelected: handles,
        allSigHandles,
        selectedOuter: (document.querySelector('.sig-placement-selected')?.outerHTML || '').slice(0, 400),
      };
    });
    console.log('BUG1 click placed signature state:', JSON.stringify(state, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b1_clicked_placed.png' });
  });

  test('BUG1.1: move placed signature -> residue at original position', async () => {
    const placed = firstWindow.locator('.sig-placement').first();
    const box = await placed.boundingBox();
    console.log('Placed box before move:', JSON.stringify(box));
    // Clip the ORIGINAL position region BEFORE the drag.
    await firstWindow.screenshot({
      path: 'screenshots/gt_b11_before_orig.png',
      clip: { x: box.x - 20, y: box.y - 30, width: 320, height: 180 },
    });
    await firstWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await firstWindow.mouse.down();
    await firstWindow.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 60, { steps: 12 });
    await firstWindow.mouse.up();
    await firstWindow.waitForTimeout(1000);
    // Clip the SAME original-position region AFTER the drag.
    await firstWindow.screenshot({
      path: 'screenshots/gt_b11_after_orig.png',
      clip: { x: box.x - 20, y: box.y - 30, width: 320, height: 180 },
    });
    await firstWindow.screenshot({ path: 'screenshots/gt_b1_after_move.png' });
    const after = await firstWindow.evaluate(() => {
      const layers = [...document.querySelectorAll('.signatures-layer')];
      const sigs = [...document.querySelectorAll('[data-sig-ghost], .sig-pending, .sig-placement')].map(e => ({
        cls: e.className,
        style: e.getAttribute('style'),
        dataPlacement: e.getAttribute('data-placement-id'),
      }));
      return { layerCount: layers.length, sigs };
    });
    console.log('After move sigs:', JSON.stringify(after, null, 2));
  });
});

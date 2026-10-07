// TFL-1119 (TFL-1116 C2) - R02 export draft retention, focused QA verification.
// qa-owned. Launches ONLY via the canonical e2e/lib/launch.cjs `launchApp`.
// Asserts the Deliver export draft survives the compact-width Inspector
// collapse/remount and a stage return, and that a resize never opens an export.
//
// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node ("Process failed to launch!"). Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1119-r02');
  app = null;
  win = null;
});

test.setTimeout(300000);

const setSize = async (w, h) => {
  // The window launches MAXIMIZED on this host, and setSize is ignored while
  // maximized, so unmaximize first, then size the normal bounds.
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(250);
};

const clickStage = async (stage) => {
  await win.locator(`[data-stage-rail] [data-stage="${stage}"]`).first().click();
  await win.waitForFunction((s) => {
    const rail = document.querySelector('[data-stage-rail]');
    const btn = document.querySelector(`[data-stage-rail] [data-stage="${s}"]`);
    return (rail && rail.getAttribute('data-active-stage') === s)
      || (btn && btn.getAttribute('aria-pressed') === 'true');
  }, stage, { timeout: 8000 });
  await win.waitForTimeout(350);
};

test('R02 export draft retention across Inspector collapse/remount and stage return', async () => {
  // 1. Open a multi-page sample (report.pdf) and reach the Deliver export
  // surface at a wide width, so the custom range exercises a real span.
  const report = win.locator('.sample-card').filter({ hasText: 'report.pdf' });
  if ((await report.count()) > 0) {
    await report.first().click();
  } else {
    await win.locator('.sample-card').first().click();
  }
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await setSize(1280, 800);
  await clickStage('deliver');
  await win.waitForSelector('[data-export-config]', { timeout: 8000 });

  // 2. Select Word (docx is text-only: no DPI control), then a custom range.
  await win.locator('[data-export-config-format-option="docx"]').check();
  await expect(win.locator('[data-export-config-format-option="docx"]')).toBeChecked();
  expect(await win.locator('[data-export-config-dpi]').count()).toBe(0);
  await win.locator('[data-export-config-scope="custom"]').check();
  const range = win.locator('[data-export-config-range]');
  await range.waitFor({ state: 'visible', timeout: 5000 });
  const placeholder = (await range.getAttribute('placeholder')) || '1-1';
  const totalPages = Number((placeholder.split('-')[1] || '1')) || 1;
  const typed = totalPages >= 2 ? '1-2' : '1';
  await range.fill(typed);
  expect(await win.locator('[data-export-config-range-error]').count()).toBe(0);
  await win.screenshot({ path: shot('tfl1119_r02_wide_word_selected.png') });

  // 3. Compact width collapses the Inspector and unmounts the export section.
  await setSize(960, 640);
  await win.waitForSelector('[data-inspector-collapsed-strip]', { timeout: 8000 });
  expect(await win.locator('[data-export-config]').count()).toBe(0);
  expect(await win.locator('[data-export-dialog]').count()).toBe(0);
  await win.screenshot({ path: shot('tfl1119_r02_compact_collapsed.png') });
  await setSize(1280, 800);
  await win.waitForSelector('[data-export-config]', { timeout: 8000 });

  // 4. Restore: the SAME draft is re-rendered, not the persisted default.
  await expect(win.locator('[data-export-config-format-option="docx"]')).toBeChecked();
  expect(await win.locator('[data-export-config-dpi]').count()).toBe(0);
  await expect(win.locator('[data-export-config-scope="custom"]')).toBeChecked();
  expect(await win.locator('[data-export-config-range]').inputValue()).toBe(typed);
  expect(await win.locator('[data-export-dialog]').count()).toBe(0);
  await win.screenshot({ path: shot('tfl1119_r02_wide_after_restore.png') });

  // 5. A stage return also keeps the draft; a resize/remount never exports.
  await clickStage('edit');
  expect(await win.locator('[data-export-dialog]').count()).toBe(0);
  await clickStage('deliver');
  await win.waitForSelector('[data-export-config]', { timeout: 8000 });
  await expect(win.locator('[data-export-config-format-option="docx"]')).toBeChecked();
  await expect(win.locator('[data-export-config-scope="custom"]')).toBeChecked();
  expect(await win.locator('[data-export-config-range]').inputValue()).toBe(typed);
  expect(await win.locator('[data-export-config-dpi]').count()).toBe(0);
  expect(await win.locator('[data-export-dialog]').count()).toBe(0);

  console.log(`[tfl1119-r02] retained typed="${typed}" (docx + custom scope) across collapse/remount and stage return`);
});

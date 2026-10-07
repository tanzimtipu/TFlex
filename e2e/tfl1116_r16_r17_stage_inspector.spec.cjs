// TFL-1116 C11 - R16 compact stage context + R17 explicit inspector state
// (frontend-dev).
//
// R16: below the panel ladder threshold the compact context must not decay to a
// page-number rail in Edit/Review/Deliver. Each stage's launcher opens ITS
// context drawer; only Pages keeps the ruler.
//
// R17: entering Edit with Select must not show an empty CropBox; the Inspector
// resolves an explicit state (here `page`) and shows page facts instead.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shotPath = (name) => path.join(SHOTS, name);

let app = null;
let win = null;
test.setTimeout(240000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r16-r17');
  app = null;
  win = null;
});

const setSize = async (w, h) => {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
};

async function openDoc() {
  await win.click('.sample-card');
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForSelector('[data-stage-rail]', { timeout: 20000 });
  await win.waitForTimeout(700);
}

async function selectStage(stage) {
  await win.click(`[data-stage-rail] [data-stage="${stage}"]`);
  await win.waitForTimeout(300);
}

/** Wait for the drawer entrance animation to settle before capturing. */
async function settleAnimations(selector) {
  await win.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return el.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle');
  }, selector, { timeout: 4000 }).catch(() => {});
  await win.waitForTimeout(150);
}

test('R16: the compact context launcher opens the ACTIVE stage context, not a page rail', async () => {
  await openDoc();
  await setSize(960, 640);
  await win.waitForTimeout(500);

  // Pages keeps its page-number ruler.
  expect(await win.locator('[data-context-panel-ruler]').count()).toBeGreaterThan(0);

  for (const stage of ['edit', 'review', 'deliver']) {
    await selectStage(stage);
    await expect(
      win.locator(`[data-context-panel-launcher-stage="${stage}"]`),
      `${stage}: its own compact launcher`,
    ).toHaveCount(1, { timeout: 8000 });
    // A non-Pages stage must NOT inherit the generic page-number rail.
    await expect(win.locator('[data-context-panel-ruler]')).toHaveCount(0);
    await win.locator('[data-context-panel-launcher-open]').click();
    await expect(
      win.locator(`[data-context-panel="${stage}"][data-context-panel-drawer="true"]`),
      `${stage}: drawer opens`,
    ).toHaveCount(1, { timeout: 8000 });
    // It opens the STAGE content, never a generic page list.
    await expect(win.locator('[data-context-panel-thumbs]')).toHaveCount(0);
    await win.keyboard.press('Escape');
    await expect(win.locator('[data-context-panel-drawer="true"]')).toHaveCount(0, { timeout: 6000 });
  }

  // Capture the Deliver stage context (the finding's exact regression).
  await selectStage('deliver');
  await win.locator('[data-context-panel-launcher-open]').click();
  await win.waitForSelector('[data-context-panel-section="preflight"]', { timeout: 8000 });
  await settleAnimations('[data-context-panel-drawer="true"]');
  await win.screenshot({ path: shotPath('tfl1116_r16_compact_stage.png') });
});

test('R17: entering Edit with Select shows page facts, never an empty CropBox', async () => {
  await openDoc();
  await setSize(960, 640);
  await win.waitForTimeout(500);
  await selectStage('edit');

  // Compact width collapses the Inspector; open its drawer so the sections
  // actually render and can be asserted.
  const opener = win.locator('[data-inspector-collapse]');
  if ((await opener.count()) > 0) {
    await opener.first().click();
    await win.waitForTimeout(500);
  }
  await expect(win.locator('[data-inspector]')).toHaveCount(1, { timeout: 8000 });
  await expect(win.locator('[data-inspector][data-inspector-state="page"]')).toHaveCount(1, {
    timeout: 8000,
  });
  await expect(win.locator('[data-inspector-section="cropbox"]')).toHaveCount(0);
  await expect(win.locator('[data-inspector-row="cropbox"]')).toHaveCount(0);
  await settleAnimations('[data-inspector-drawer="true"]');
  await win.screenshot({ path: shotPath('tfl1116_r17_edit_no_cropbox.png') });
});

// ADVERSARY probe 2 (TFL-622) - draggable Stamp/Watermark (attack item 2).
const path = require('node:path');
const REPO = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const { launchApp, getSamplePath } = require(path.join(REPO, 'e2e/lib/launch.cjs'));
const { openSamplePath } = require(path.join(REPO, 'e2e/lib/helpers.cjs'));
delete process.env.ELECTRON_RUN_AS_NODE;

async function openPaletteTool(win, id, label) {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill(label);
  await win.waitForTimeout(300);
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 6000 });
  await row.click();
  await win.waitForSelector('[data-command-palette-layer]', { state: 'detached', timeout: 6000 }).catch(() => {});
  await win.waitForTimeout(450);
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const out = [];
  let code = 0;
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const sample = getSamplePath('report.pdf');
    await openSamplePath(win, app, sample);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(700);

    await openPaletteTool(win, 'stamp', 'Stamp');
    await win.waitForSelector('[data-stamp-dialog]', { state: 'visible', timeout: 12000 });
    await win.waitForTimeout(300);

    const rootSel = '[data-stamp-dialog]';
    const before = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    }, rootSel);

    // (a) drag chrome (title) and release ON the backdrop at (5,5)
    const title = await win.locator('[data-stamp-dialog] .modal-title').first().boundingBox();
    await win.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
    await win.mouse.down();
    const draggingSeen = await win.evaluate((sel) => document.querySelector(sel).classList.contains('modal-dialog-dragging'), rootSel);
    await win.mouse.move(5, 5, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const afterDrag = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { present: false };
      const r = el.getBoundingClientRect();
      return { present: true, left: r.left, top: r.top, dragging: el.classList.contains('modal-dialog-dragging') };
    }, rootSel);
    out.push({ probe: 'chrome-drag-release-on-backdrop', draggingSeen, before, afterDrag });

    // (b) drag far off-screen (bottom-right) to test clamp
    const t2 = await win.locator('[data-stamp-dialog] .modal-title').first().boundingBox();
    await win.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2);
    await win.mouse.down();
    await win.mouse.move(2200, 1400, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const clamped = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight };
    }, rootSel);
    out.push({ probe: 'clamp-offscreen', clamped, within: clamped.right <= clamped.vw + 1 && clamped.bottom <= clamped.vh + 1 && clamped.left >= -1 && clamped.top >= -1 });

    // (c) press a control (first radio input) must NOT start a drag
    const ctrl = await win.locator('[data-stamp-dialog] input[type=radio]').first().boundingBox();
    await win.mouse.move(ctrl.x + ctrl.width / 2, ctrl.y + ctrl.height / 2);
    await win.mouse.down();
    const controlDrag = await win.evaluate((sel) => document.querySelector(sel).classList.contains('modal-dialog-dragging'), rootSel);
    await win.mouse.up();
    out.push({ probe: 'control-press-no-drag', controlDrag });

    // (d) genuine backdrop click still closes
    await win.mouse.click(3, 300);
    await win.waitForTimeout(500);
    const stillOpen = await win.locator(rootSel).count();
    out.push({ probe: 'genuine-backdrop-click-closes', stillOpen });
  } catch (e) {
    out.push({ probe: 'ERROR', message: e.message });
    code = 2;
  } finally {
    try { await app.close(); } catch {}
  }
  console.log('PROBE_RESULT ' + JSON.stringify(out, null, 2));
  process.exit(code);
})();

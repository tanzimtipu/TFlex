// QA ground-truth reproduction — installed v1.7.5 app.
// Group 3: Bug 8 (crop-box adjustment flashes a larger-crop artifact),
// Bug 9 (OTA update prompt update-click UX).
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1500);
}
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }
async function openToolsPalette() {
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.waitForTimeout(300);
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// ---------------------------------------------------------------------------
// Bug 8 — crop box adjustment flashes a larger crop-window artifact briefly
// ---------------------------------------------------------------------------
test('GT-08: crop box drag does not flash a larger crop window / remount canvas', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await openToolsPalette();
  await window.click('[data-tool-id="cropPages"]');
  await window.waitForSelector('[data-crop-pages-dialog]');
  await window.waitForTimeout(700);
  await snap('gt-bug8-crop-open');

  // Capture the canvas element identity + the box rect before the drag.
  const before = await window.evaluate(() => {
    const canvas = document.querySelector('[data-crop-canvas]');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const box = mask ? mask.getBoundingClientRect() : null;
    // label the current canvas so we can detect remount (new node)
    if (canvas) canvas.setAttribute('data-canvas-tag', 'CANVAS-A');
    return {
      canvasTag: canvas ? canvas.getAttribute('data-canvas-tag') : null,
      box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
      previewReadyOpacity: canvas ? getComputedStyle(canvas).opacity : null,
    };
  });
  console.log('GT-08 before drag:', JSON.stringify(before));

  // Grab the SE handle and drag it outward, capturing frames mid-drag.
  const se = window.locator('[data-crop-handle="se"]').first();
  const seBox = await se.boundingBox();
  console.log('GT-08 SE handle box:', JSON.stringify(seBox));
  await window.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await window.mouse.down();
  // Move and sample a few frames for the flash / remount.
  const frames = [];
  for (let step = 1; step <= 4; step++) {
    await window.mouse.move(seBox.x + seBox.width / 2 + step * 18, seBox.y + seBox.height / 2 + step * 10, { steps: 2 });
    const f = await window.evaluate(() => {
      const canvas = document.querySelector('[data-crop-canvas]');
      const mask = document.querySelector('[data-crop-handle="move"]');
      const box = mask ? mask.getBoundingClientRect() : null;
      return {
        canvasTag: canvas ? canvas.getAttribute('data-canvas-tag') : null,
        canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
        box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
      };
    });
    frames.push(f);
    await window.waitForTimeout(30);
  }
  await snap('gt-bug8-before-mouseup');
  // Release — on COMMIT the host updates sharedBox, the CropEditor `key`
  // (which embeds the box coords) changes, and the component remounts.
  await window.mouse.up();
  // Sample immediately after the commit (the flash/remount moment).
  const post = [];
  for (let i = 0; i < 6; i++) {
    const f = await window.evaluate(() => {
      const canvas = document.querySelector('[data-crop-canvas]');
      const mask = document.querySelector('[data-crop-handle="move"]');
      const box = mask ? mask.getBoundingClientRect() : null;
      return {
        canvasTag: canvas ? canvas.getAttribute('data-canvas-tag') : null,
        canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
        canvasRect: canvas ? (() => { const r = canvas.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
        box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
      };
    });
    post.push(f);
    await snap(`gt-bug8-post-${i}`);
    await window.waitForTimeout(60);
  }
  await window.waitForTimeout(400);
  await snap('gt-bug8-crop-after-drag');
  console.log('GT-08 mid-drag frames:', JSON.stringify(frames, null, 2));
  console.log('GT-08 POST-commit frames:', JSON.stringify(post, null, 2));
});

// ---------------------------------------------------------------------------
// Bug 9 — OTA update prompt: update-click UX (needs an available update)
// ---------------------------------------------------------------------------
test('GT-09: update prompt / update-click UX is triggerable', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await snap('gt-bug9-app-open');

  // Read the live update state directly from the preload surface.
  const updateState = await window.evaluate(() => {
    const api = window.tflex && window.tflex.update;
    if (api === undefined) return { present: false };
    let st = null;
    try { st = api.getStatus(); } catch (e) { st = { evalError: String(e) }; }
    return { present: true, state: st };
  });
  console.log('GT-09 update getStatus=', JSON.stringify(updateState));

  // Is there an update-prompt dialog / indicator visible right now?
  const ui = await window.evaluate(() => {
    const prompt = document.querySelector('[data-update-prompt]');
    const promptKind = prompt ? prompt.getAttribute('data-update-prompt-kind') : null;
    const indicator = document.querySelector('[data-update-indicator]');
    const indicatorKind = indicator ? indicator.getAttribute('data-update-indicator-kind') : null;
    const updateBtn = document.querySelector('[data-update-prompt-update]');
    return { promptOpen: !!prompt, promptKind, indicator: !!indicator, indicatorKind, updateBtn: !!updateBtn };
  });
  console.log('GT-09 update UI=', JSON.stringify(ui));

  // Trigger a manual check via the About dialog's Check for Updates if reachable.
  const hasCheck = await window.evaluate(() => {
    const api = window.tflex && window.tflex.update;
    return typeof (api && api.check) === 'function';
  });
  if (hasCheck) {
    await window.evaluate(() => { window.tflex.update.check().catch(() => {}); });
    await window.waitForTimeout(2500);
    const st2 = await window.evaluate(() => window.tflex.update.getStatus());
    console.log('GT-09 after manual check state=', JSON.stringify(st2));
    const ui2 = await window.evaluate(() => {
      const prompt = document.querySelector('[data-update-prompt]');
      return { promptKind: prompt ? prompt.getAttribute('data-update-prompt-kind') : null, promptOpen: !!prompt };
    });
    console.log('GT-09 after check UI=', JSON.stringify(ui2));
  }
  await snap('gt-bug9-after-check');
});

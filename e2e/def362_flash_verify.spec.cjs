// DEF-362 retest (qa) — the annotation "scroll to" flash overlay must animate
// through the centralised motion system. The fix replaced the hardcoded
// `animation: ann-flash 1.6s ease-out forwards` with
// `animation: ann-flash var(--motion-duration-flash) var(--motion-ease-exit) forwards`.
//
// This spec drives the REAL app: open report.pdf, draw one ink annotation so the
// REVIEW annotations panel has a row, click the row's jump button (which sets
// flashId and mounts `.ann-flash`), then read the LIVE computed animation and
// assert it resolves from the token (1.6s / cubic-bezier(0.4, 0, 1, 1)).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openAnnotationFlyout, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(240000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'def362-flash');
  app = null;
  win = null;
});

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function slotBox(page = 1) {
  return win.evaluate((want) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const slot = pane && pane.querySelector(`.page-slot[data-page="${want}"]`);
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, page);
}

test('DEF-362: the annotation flash overlay animates on --motion-duration-flash', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample();

  // Create one annotation so the REVIEW panel has a row to jump to.
  await openAnnotationFlyout(win);
  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(400);
  const box = await slotBox(1);
  expect(box, 'page slot 1 mounted').not.toBeNull();
  await win.mouse.move(box.x + box.w * 0.35, box.y + box.h * 0.3);
  await win.mouse.down();
  await win.mouse.move(box.x + box.w * 0.55, box.y + box.h * 0.42, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(700);

  // REVIEW stage -> the annotations panel row.
  await gotoStage(win, 3);
  await win.waitForSelector('[data-context-panel="review"] [data-annotation-panel]', { timeout: 8000 });
  const row = win.locator('[data-context-panel="review"] .ann-panel-row').first();
  await expect(row).toBeVisible();

  // Click the row's jump button; the flash overlay mounts.
  await row.locator('.ann-panel-row-jump').click();
  await win.waitForSelector('.ann-flash', { state: 'attached', timeout: 5000 });

  const anim = await win.locator('.ann-flash').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      dur: cs.animationDuration,
      ease: cs.animationTimingFunction,
      fill: cs.animationFillMode,
      cls: el.className,
    };
  });
  console.log(`[DEF362] .ann-flash computed: ${JSON.stringify(anim)}`);

  expect(anim.name, 'the flash plays the ann-flash keyframe').toBe('ann-flash');
  expect(anim.dur, 'duration resolves from --motion-duration-flash (1.6s)').toBe('1.6s');
  expect(anim.ease, 'easing resolves from --motion-ease-exit').toBe('cubic-bezier(0.4, 0, 1, 1)');
  expect(anim.fill, 'the flash holds its end state').toBe('forwards');

  await win.screenshot({ path: path.join(SHOTS, 'def-362-ann-flash.png') });
  console.log(`[DEF362] screenshot: ${path.join(SHOTS, 'def-362-ann-flash.png')}`);
});